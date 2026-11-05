import { after, NextResponse, type NextRequest } from "next/server";
import { availabilityForAgent, bookForAgent, recordOutcome } from "@/lib/booking";
import { finishVapiCall } from "@/lib/callresult";
import { db, logEvent, updateContact } from "@/lib/db";
import { env } from "@/lib/env";
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
  if (req.nextUrl.searchParams.get("token") !== env.webhookSecret()) {
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

async function runTool(contact: Contact, tc: ToolCall): Promise<string> {
  const args = parseArgs(tc.function.arguments);
  await logEvent(contact.id, "call", `Tool → ${tc.function.name}`, "info", args);
  try {
    switch (tc.function.name) {
      case "consultar_disponibilidad":
        return await availabilityForAgent(contact.id);
      case "agendar_reunion":
        return (await bookForAgent(contact.id, args.inicio_iso, args.correo || null, qualificationFrom(args))).message;
      case "registrar_resultado":
        await recordOutcome(contact, args.resultado, args.notas, { ...qualificationFrom(args), referido: args.referido }, args.correo);
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
