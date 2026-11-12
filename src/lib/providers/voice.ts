import "server-only";
import { availabilityForAgent, bookForAgent, recordOutcome } from "../booking";
import { closeCall, openCall } from "../calls";
import { db, logEvent, updateContact } from "../db";
import { env } from "../env";
import { buildSystemPrompt, firstMessage } from "../script";
import { getSettings } from "../settings";
import { spokenSlot } from "../speech";
import type { Contact } from "../types";
import { vapiVoice, type AgentVoice } from "../voices";
import { maskPhone } from "../util";
import { getAvailableSlots } from "./calendar";

export type CallStart =
  | { kind: "started"; callId: string } // el resultado llega por webhook
  | { kind: "finished" }
  | { kind: "failed"; reason: string };

// La simulada usa la misma lógica de agenda que las tools de Vapi.
export async function startCall(contact: Contact): Promise<CallStart> {
  if (!contact.phone) return { kind: "failed", reason: "sin número" };
  if (env.providers.voice !== "vapi") return simulateCall(contact);
  const settings = await getSettings();
  if (!settings.live_calls) {
    await logEvent(contact.id, "call", "Llamadas reales desactivadas en el panel: se simula la llamada");
    return simulateCall(contact);
  }

  // Solo se marca de verdad a números autorizados (con consentimiento); el resto se simula.
  if (!settings.live_numbers.includes(contact.phone)) {
    await logEvent(contact.id, "call", "Número no autorizado para llamada real: se simula (autorízalo en la app si hay consentimiento)");
    return simulateCall(contact);
  }
  return startVapiCall(contact);
}

const QUALIFICATION_PROPS = {
  area_interes: {
    type: "string",
    enum: ["dispositivos", "infraestructura", "servicios", "IA", "otro"],
    description: "Tema principal de interés.",
  },
  proyecto: { type: "string", description: "De qué se trata el proyecto y qué buscan resolver." },
  etapa: { type: "string", enum: ["exploración", "evaluación de opciones", "ejecución", "desconocida"] },
  fecha_meta: { type: "string", description: "Fecha o meta que marca el ritmo, si la mencionó." },
  decisores: { type: "string", description: "Quién lidera y quién participa en la decisión." },
  cargo: { type: "string", description: "Cargo confirmado por la persona." },
  celular: { type: "string", description: "Celular confirmado por la persona, solo dígitos." },
};

// Frases que el agente dice mientras la herramienta trabaja, para que no haya silencios.
// Se elige una variante por llamada para que no suene repetido.
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];
const waitMessages = (start: string[], delayed: string[]) => [
  { type: "request-start", content: pick(start) },
  { type: "request-response-delayed", content: pick(delayed), timingMilliseconds: 3500 },
  { type: "request-failed", content: "Uy, se me trabó el sistema un momentico. Dame un segundo." },
];

export const VAPI_TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_disponibilidad",
      description: "Devuelve los próximos horarios libres para la conversación con el especialista (hora Colombia).",
      parameters: { type: "object", properties: {} },
    },
    get messages() {
      return waitMessages(
        ["Dame un segundito y reviso la agenda…", "Listo, déjame mirar los espacios que tenemos…", "Mmm, ya te reviso la agenda…"],
        ["Ya casi, está cargando…", "Un momentico más…"],
      );
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_reunion",
      description:
        "Agenda la conversación, asigna el especialista, envía la invitación de calendario y el correo de confirmación. Devuelve quién lo atenderá.",
      parameters: {
        type: "object",
        properties: {
          inicio_iso: { type: "string", description: "El código entre corchetes del horario elegido en consultar_disponibilidad." },
          correo: {
            type: "string",
            description: "Solo si la persona dio un correo distinto al registrado. Correo armado (nombre@dominio.com), tal como lo deletreó.",
          },
          correo_deletreado: {
            type: "boolean",
            description: "true solo si la persona te deletreó letra por letra la parte antes de la arroba y te confirmó tu repetición.",
          },
          ...QUALIFICATION_PROPS,
        },
        required: ["inicio_iso"],
      },
    },
    get messages() {
      return waitMessages(
        ["Perfecto, ya te lo dejo agendado…", "Listo, lo agendo de una…", "Dale, ya mismo lo registro…"],
        ["Ya casi queda, un segundito…", "Está terminando de guardar…"],
      );
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_resultado",
      description:
        "Registra el resultado cuando NO se agenda: no le interesa, prefiere info por correo (se le envía el correo de seguimiento), llamar después, persona equivocada o referido.",
      parameters: {
        type: "object",
        properties: {
          resultado: {
            type: "string",
            enum: ["no_interesa", "enviar_info_correo", "llamar_despues", "persona_equivocada", "referido", "no_contactar"],
          },
          correo: { type: "string", description: "Correo que dio la persona, si lo dio." },
          correo_deletreado: { type: "boolean", description: "true solo si te deletreó el correo y confirmó tu repetición." },
          referido: { type: "string", description: "Nombre y contacto de la persona indicada, si lo compartió." },
          notas: { type: "string" },
          ...QUALIFICATION_PROPS,
        },
        required: ["resultado"],
      },
    },
  },
  { type: "endCall" },
];

const SUMMARY_PROMPT =
  "Eres analista comercial. Resume la llamada en español, en máximo 3 frases: si tiene proyecto y de qué trata, si agendó (día y hora) y cualquier objeción o dato a corregir. Sin saludos ni viñetas.";

const DEMO_NOTE = `

MODO DEMOSTRACIÓN (prueba desde el navegador): no tienes herramientas conectadas. Cuando acepte la reunión, ofrece
"mañana a las nueve de la mañana" o "el viernes a las dos y media de la tarde"; cuando elija, confirma los datos, dile que
lo atenderá Carolina Pérez, especialista en infraestructura, que le escribirá antes de la reunión, y despídete.`;

// Misma configuración para la llamada real y para la prueba en el navegador (sin herramientas ni webhooks).
export function buildAssistant(contact: Contact, voice: AgentVoice, mode: "call" | "preview") {
  const base = {
    name: mode === "call" ? `${env.companyName()} POC agendador` : `${env.companyName()} POC prueba de voz`,
    firstMessage: firstMessage(contact),
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: env.vapiModelProvider(),
      model: env.vapiModel(),
      temperature: 0.7,
      messages: [{ role: "system", content: buildSystemPrompt(contact, voice.agentName) + (mode === "preview" ? DEMO_NOTE : "") }],
      tools: mode === "call" ? VAPI_TOOLS : [{ type: "endCall" }],
    },
    voice: vapiVoice(voice),
    // Cada nombre y apellido por separado, la empresa y las palabras del dictado de correos como términos clave.
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "es",
      keyterm: [
        contact.first_name,
        ...contact.first_name.split(/\s+/),
        contact.last_name,
        ...contact.last_name.split(/\s+/),
        contact.company,
        "arroba",
        "Gmail",
        "Hotmail",
        "Outlook",
      ].filter((t, i, a): t is string => !!t && t.length > 2 && a.indexOf(t) === i).slice(0, 14),
    },
    backgroundSound: "office",
    // Espera un poco más antes de responder para no cortar a quien dicta o piensa en voz alta.
    startSpeakingPlan: { waitSeconds: 0.8, smartEndpointingEnabled: true },
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3, backoffSeconds: 1 },
    maxDurationSeconds: mode === "call" ? 420 : 240,
    artifactPlan: { recordingEnabled: false },
  };
  if (mode === "preview") return base;
  return {
    ...base,
    server: { url: `${env.appUrl()}/api/webhooks/vapi?token=${encodeURIComponent(env.webhookSecret())}` },
    serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
    metadata: { contactId: contact.id },
    analysisPlan: {
      summaryPlan: {
        enabled: true,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: "Transcripción:\n{{transcript}}" },
        ],
      },
    },
  };
}

async function startVapiCall(contact: Contact): Promise<CallStart> {
  const { agent_voice } = await getSettings();
  const body = {
    phoneNumberId: env.vapiPhoneNumberId(),
    customer: { number: contact.phone, name: `${contact.first_name} ${contact.last_name}`, externalId: contact.id },
    assistant: buildAssistant(contact, agent_voice, "call"),
  };

  const res = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.vapiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { kind: "failed", reason: `Vapi ${res.status}: ${await res.text()}` };
  const call = (await res.json()) as { id: string };
  await openCall(contact.id, "vapi", call.id);
  return { kind: "started", callId: call.id };
}

async function simulateCall(contact: Contact): Promise<CallStart> {
  const { data: profile } = await db()
    .from("sandbox_profiles")
    .select("mock_call_outcome")
    .eq("linkedin_url", contact.linkedin_url ?? "")
    .maybeSingle();
  const outcome = (profile?.mock_call_outcome ?? "accept") as "accept" | "decline" | "no_answer";
  const callId = `sim_${Date.now().toString(36)}`;
  const callRow = await openCall(contact.id, "simulated", callId);
  await updateContact(contact.id, { call_id: callId });
  await logEvent(contact.id, "call", `Llamada simulada a ${maskPhone(contact.phone)} (escenario: ${outcome})`);

  const agent = env.agentName();
  const t: string[] = [];
  const say = (who: "Agente" | "Contacto", text: string) => t.push(`${who}: ${text}`);
  // ~6 s por intervención, para que la duración en las métricas sea realista
  const duration = () => t.length * 6;

  if (outcome === "no_answer") {
    await updateContact(contact.id, {
      status: "no_answer",
      call_outcome: "no_answer",
      call_summary: "Llamada perdida: no contestó (buzón de voz).",
      call_transcript: "",
    });
    await closeCall({ id: callRow.id }, { status: "missed", endedReason: "customer-did-not-answer", durationSec: 25 });
    await logEvent(contact.id, "call", "Llamada perdida: no contestó", "warn");
    return { kind: "finished" };
  }

  const brand = env.brandName();
  const event = env.eventName().replace(/\s*\d{4}$/, "");
  say("Agente", firstMessage(contact));
  say("Contacto", "Sí, con él habla.");
  say(
    "Agente",
    `¡Hola, ${contact.first_name}! Soy ${agent}, del equipo que apoya a ${env.companyName()}. Te contacto porque estuviste con nosotros en ${event}.${contact.event_notes ? ` Vi que en el stand preguntaste por ${contact.event_notes}.` : ""} ${brand} está acompañando a empresas en proyectos de transformación tecnológica: dispositivos, infraestructura, servicios e inteligencia artificial. Cuéntame, ¿tienen algún proyecto de modernización en evaluación o planeación?`,
  );

  if (outcome === "decline") {
    say("Contacto", "Por ahora no, la verdad.");
    say("Agente", "Te entiendo. ¿Y hay algún tema que estén empezando a contemplar, aunque sea a más largo plazo?");
    say("Contacto", "No, de momento no.");
    say("Agente", "Listo, perfecto. ¿Te parece si te comparto por correo un resumen de lo que estamos haciendo y retomamos el contacto en unos meses?");
    say("Contacto", "Sí, mándamelo.");
    say("Agente", `Dale. Mil gracias por tu tiempo y por acompañarnos en ${event}.`);
    await recordOutcome(contact, "enviar_info_correo", "Sin proyecto por ahora; retomar en unos meses.", {});
    await updateContact(contact.id, {
      status: "declined",
      call_summary: "Sin proyecto activo. Pidió resumen por correo; retomar en unos meses.",
      call_transcript: t.join("\n"),
    });
    await closeCall({ id: callRow.id }, { status: "answered", outcome: "enviar_info_correo", durationSec: duration() });
    await logEvent(contact.id, "call", "No agendó: se envía correo de seguimiento", "warn");
    return { kind: "finished" };
  }

  const q = {
    area_interes: "infraestructura",
    proyecto: "Renovar el centro de datos y migrar cargas a nube híbrida",
    etapa: "evaluación de opciones",
    fecha_meta: "Primer semestre del próximo año",
    decisores: "Lo lidera TI; decide con Finanzas",
    cargo: contact.title ?? undefined,
  };
  say("Contacto", "Sí, estamos evaluando renovar el centro de datos.");
  say("Agente", "¡Qué bien! ¿De qué se trata el proyecto y qué buscan resolver con él?");
  say("Contacto", "Queremos migrar parte de las cargas a nube híbrida y bajar costos de operación.");
  say("Agente", "Tiene todo el sentido. ¿Y en qué etapa están: explorando, evaluando opciones o ya en ejecución?");
  say("Contacto", "Evaluando opciones.");
  say("Agente", "Perfecto. ¿Hay alguna fecha o meta que esté marcando el ritmo?");
  say("Contacto", "Queremos arrancar el primer semestre del próximo año.");
  say("Agente", "Listo. ¿Quién lidera la iniciativa y quién más participa en la decisión?");
  say("Contacto", "La lidero yo desde TI, y Finanzas aprueba.");
  say(
    "Agente",
    `Perfecto, ${contact.first_name}. Lo que me cuentas encaja muy bien con lo que hace nuestro especialista en infraestructura. ¿Te parece si coordinamos una conversación de quince minutos para ver cómo ${brand} puede aportar?`,
  );
  say("Contacto", "Sí, me parece bien.");
  await logEvent(contact.id, "call", "Tool → consultar_disponibilidad");
  await availabilityForAgent(contact.id);
  const [slot] = await getAvailableSlots(1);
  if (!slot) {
    await updateContact(contact.id, { status: "call_failed", call_summary: "Llamada fallida: sin disponibilidad", call_transcript: t.join("\n") });
    await closeCall({ id: callRow.id }, { status: "failed", endedReason: "sin-disponibilidad", durationSec: duration() });
    return { kind: "finished" };
  }
  say("Agente", `Tengo espacio ${spokenSlot(slot.start)}. ¿Te queda bien?`);
  say("Contacto", "Perfecto, ese me sirve.");
  say("Agente", "¡Listo! ¿Me confirmas tu correo para enviarte la invitación, tu cargo y un celular por si surge algún cambio?");
  say("Contacto", "Sí, al mismo correo que tienen, el cargo es el mismo y este celular.");
  await logEvent(contact.id, "call", "Tool → agendar_reunion", "info", q);
  const r = await bookForAgent(contact.id, slot.start, null, q);
  say(
    "Agente",
    r.ok
      ? `Listo, quedó agendada ${spokenSlot(slot.start)}.${r.rep ? ` Te va a atender ${r.rep.name}, y antes de la reunión te escribe para conocer mejor tu proyecto.` : ""} Hoy mismo te llega la invitación. ¡Gracias por tu tiempo y por acompañarnos en ${event}!`
      : r.message,
  );

  await updateContact(contact.id, {
    ...(r.ok ? {} : { status: "call_failed" as const }),
    call_summary: r.ok
      ? `Proyecto de ${q.area_interes} en ${q.etapa}. Agendó ${slot.label}${r.rep ? ` con ${r.rep.name}` : ""}.`
      : `Llamada fallida: no se pudo agendar (${r.message})`,
    call_transcript: t.join("\n"),
  });
  await closeCall({ id: callRow.id }, { status: r.ok ? "answered" : "failed", outcome: r.ok ? "accepted" : "error", durationSec: duration() });
  return { kind: "finished" };
}
