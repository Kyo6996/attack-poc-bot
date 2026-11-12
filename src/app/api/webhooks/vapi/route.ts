import { after, NextResponse, type NextRequest } from "next/server";
import { availabilityForAgent, bookForAgent, recordOutcome } from "@/lib/booking";
import { finishVapiCall } from "@/lib/callresult";
import { db, logEvent, updateContact } from "@/lib/db";
import { reconcileEmail, spokenEmailFor } from "@/lib/email-fix";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security";
import { runPipeline } from "@/lib/pipeline";
import type { Contact } from "@/lib/types";

export const maxDuration = 60;

interface ToolCall {
  id: string;
  function: { name: string; arguments: unknown };
}

interface VapiMessage {
  type: string;
  call?: { id?: string; customer?: { externalId?: string }; assistant?: { metadata?: { contactId?: string } } };
  assistant?: { metadata?: { contactId?: string } };
  toolCallList?: ToolCall[];
  status?: string;
  endedReason?: string;
  artifact?: {
    transcript?: string;
    recordingUrl?: string;
    recording?: { url?: string; stereoUrl?: string; mono?: { combinedUrl?: string } };
  };
  analysis?: { summary?: string };
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  startedAt?: string;
  endedAt?: string;
}


export async function POST(req: NextRequest) {
  if (!safeEqual(req.nextUrl.searchParams.get("token"), env.webhookSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { message } = (await req.json()) as { message: VapiMessage };
  const contact = await findContact(message);

  switch (message.type) {
    case "tool-calls": {
      const results = [];
      for (const tc of message.toolCallList ?? []) {
        const result = contact
          ? await runTool(contact, tc)
          : "No encuentro el contacto de esta llamada. Despídete amablemente.";
        results.push({ toolCallId: tc.id, result });
      }
      // Vapi espera 200 y result como texto plano.
      return NextResponse.json({ results });
    }

    case "status-update": {
      if (contact && message.status) await logEvent(contact.id, "call", `Estado de llamada: ${message.status}`);
      return NextResponse.json({ ok: true });
    }

    case "end-of-call-report": {
      if (contact) await finishVapiCall(contact.id, message);
      // Al colgar se sigue con el siguiente contacto.
      after(async () => {
        try {
          await runPipeline();
        } catch (e) {
          await logEvent(null, "system", `Error al continuar el pipeline: ${(e as Error).message}`, "error");
        }
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: true });
  }
}

async function findContact(m: VapiMessage): Promise<Contact | null> {
  const id =
    m.call?.assistant?.metadata?.contactId ?? m.assistant?.metadata?.contactId ?? m.call?.customer?.externalId;
  let q = db().from("contacts").select("*");
  if (id) q = q.eq("id", id);
  else if (m.call?.id) q = q.eq("call_id", m.call.id);
  else return null;
  const { data } = await q.maybeSingle();
  return (data as Contact) ?? null;
}

function parseArgs(a: unknown): Record<string, string> {
  if (typeof a === "string") {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return (a as Record<string, string>) ?? {};
}

function qualificationFrom(a: Record<string, string>) {
  return {
    area_interes: a.area_interes,
    proyecto: a.proyecto,
    etapa: a.etapa,
    fecha_meta: a.fecha_meta,
    decisores: a.decisores,
    cargo: a.cargo,
    celular: a.celular,
  };
}

// Guarda en la ficha el correo apenas lo dicta, ya normalizado, para verlo en vivo en el panel y corregirlo si hace falta.
async function noteEmail(contact: Contact, dictated: string | undefined): Promise<string> {
  const check = await reconcileEmail(dictated, contact);
  if (!dictated?.trim() || !check.email) {
    await logEvent(contact.id, "call", `Correo dictado no válido: ${dictated ?? "vacío"} (${check.error})`, "warn");
    return "No me quedó claro el correo. Pídeselo otra vez con calma, como en una conversación normal.";
  }
  if (check.email !== contact.email) {
    await updateContact(contact.id, { email: check.email });
  }
  await logEvent(contact.id, "call", `Correo anotado en la llamada: ${check.email}`, "success", { dictado: dictated, anterior: contact.email, nota: check.note });
  const spoken = spokenEmailFor(check.email, contact);
  return `Anotado. Confírmaselo una sola vez, despacio y natural, tal cual: "${spoken}". Si te corrige algo, vuelve a llamar a anotar_correo con el correo completo corregido. Ya quedó en la ficha: no lo pases en agendar_reunion.`;
}

async function runTool(contact: Contact, tc: ToolCall): Promise<string> {
  const args = parseArgs(tc.function.arguments);
  await logEvent(contact.id, "call", `Tool → ${tc.function.name}`, "info", args);
  try {
    switch (tc.function.name) {
      case "consultar_disponibilidad":
        return await availabilityForAgent(contact.id);
      case "anotar_correo":
        return await noteEmail(contact, args.correo);
      // Si ya hay correo en la ficha (anotado en la llamada o corregido en vivo desde el panel), manda ese y no el que pase el modelo.
      case "agendar_reunion":
        return (await bookForAgent(contact.id, args.inicio_iso, contact.email ? null : args.correo || null, qualificationFrom(args))).message;
      case "registrar_resultado":
        await recordOutcome(contact, args.resultado, args.notas, { ...qualificationFrom(args), referido: args.referido }, contact.email ? null : args.correo);
        return args.resultado === "enviar_info_correo"
          ? "Registrado. El correo con la información sale en unos minutos: díselo, agradece y despídete."
          : "Registrado. Agradece con calidez y despídete.";
      default:
        return "Herramienta desconocida.";
    }
  } catch (e) {
    await logEvent(contact.id, "call", `Error en tool ${tc.function.name}: ${(e as Error).message}`, "error");
    return "Hubo un problema técnico. Dile que un asesor le escribirá por correo.";
  }
}
