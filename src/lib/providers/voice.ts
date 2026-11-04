import "server-only";
import { availabilityForAgent, bookForAgent, recordOutcome } from "../booking";
import { closeCall, openCall } from "../calls";
import { db, logEvent, updateContact } from "../db";
import { env } from "../env";
import { buildSystemPrompt, firstMessage } from "../script";
import { spokenSlot } from "../speech";
import type { Contact } from "../types";
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

  // En pruebas solo se marca de verdad a los números autorizados; el resto se simula.
  const allowed = env.voiceLiveNumbers();
  if (allowed.length && !allowed.includes(contact.phone)) {
    await logEvent(contact.id, "call", "Número fuera de VOICE_LIVE_NUMBERS: se simula la llamada");
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

export const VAPI_TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_disponibilidad",
      description: "Devuelve los próximos horarios libres para la conversación con el especialista (hora Colombia).",
      parameters: { type: "object", properties: {} },
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
          correo: { type: "string", description: "Solo si la persona dio un correo distinto al registrado." },
          ...QUALIFICATION_PROPS,
        },
        required: ["inicio_iso"],
      },
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

async function startVapiCall(contact: Contact): Promise<CallStart> {
  const serverUrl = `${env.appUrl()}/api/webhooks/vapi?token=${encodeURIComponent(env.webhookSecret())}`;
  const body = {
    phoneNumberId: env.vapiPhoneNumberId(),
    customer: { number: contact.phone, name: `${contact.first_name} ${contact.last_name}`, externalId: contact.id },
    assistant: {
      name: `${env.companyName()} POC agendador`,
      firstMessage: firstMessage(contact),
      firstMessageMode: "assistant-speaks-first",
      model: {
        provider: env.vapiModelProvider(),
        model: env.vapiModel(),
        temperature: 0.6,
        messages: [{ role: "system", content: buildSystemPrompt(contact) }],
        tools: VAPI_TOOLS,
      },
      voice: { provider: env.vapiVoiceProvider(), voiceId: env.vapiVoiceId(), speed: 0.95 },
      transcriber: { provider: "deepgram", model: "nova-3", language: "es" },
      backgroundSound: "office",
      startSpeakingPlan: { waitSeconds: 0.6, smartEndpointingEnabled: true },
      stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3, backoffSeconds: 1 },
      maxDurationSeconds: 420,
      endCallMessage: "Mil gracias por tu tiempo. ¡Que tengas un excelente día!",
      server: { url: serverUrl },
      serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
      metadata: { contactId: contact.id },
    },
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
