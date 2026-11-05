import "server-only";
import { closeCall } from "./calls";
import { db, logEvent, updateContact } from "./db";
import type { Contact } from "./types";

// Lo que se necesita del reporte de fin de Vapi (webhook) o del objeto llamada (consulta directa).
export interface VapiEnd {
  call?: { id?: string };
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

const NO_ANSWER = ["customer-did-not-answer", "customer-busy", "voicemail", "sip-outbound-unallocated-number"];

// Contestó y quedó resultado → answered. No contestó → llamada perdida.
// Colgó sin resultado o hubo error → llamada fallida.
export async function finishVapiCall(contactId: string, m: VapiEnd, overrideSkip?: string) {
  const fresh = (await db().from("contacts").select("*").eq("id", contactId).single()).data as Contact;
  if (!fresh) return;
  const transcript = m.artifact?.transcript ?? m.transcript ?? null;
  const recording =
    m.artifact?.recordingUrl ?? m.artifact?.recording?.url ?? m.artifact?.recording?.mono?.combinedUrl ?? m.recordingUrl ?? null;
  const reason = m.endedReason ?? "";
  const missed = NO_ANSWER.includes(reason);
  const hadOutcome = fresh.status === "meeting_scheduled" || !!fresh.call_outcome;

  let status = fresh.status;
  let summary = m.analysis?.summary ?? m.summary ?? fresh.call_summary;
  let skip: string | null = null;
  if (status === "calling") {
    if (missed) {
      status = "no_answer";
      skip = reason === "voicemail" ? "Llamada perdida: entró a buzón de voz" : reason === "customer-busy" ? "Llamada perdida: ocupado" : "Llamada perdida: no contestó";
    } else if (hadOutcome) {
      status = "declined";
    } else {
      status = "call_failed";
      skip =
        overrideSkip ??
        (/customer-ended-call|silence-timed-out/.test(reason) ? "Llamada fallida: se cortó antes de terminar" : `Llamada fallida: ${reason || "error técnico"}`);
    }
    summary = summary ?? skip;
  }

  const durationSec =
    m.durationSeconds ?? (m.startedAt && m.endedAt ? Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000) : null);
  await closeCall(
    { providerCallId: m.call?.id ?? fresh.call_id ?? "" },
    { status: missed ? "missed" : hadOutcome ? "answered" : "failed", endedReason: reason || null, outcome: fresh.call_outcome, durationSec },
  );

  await updateContact(contactId, {
    status,
    skip_reason: skip ?? fresh.skip_reason,
    call_transcript: transcript,
    recording_url: recording,
    call_summary: summary,
    call_outcome: fresh.call_outcome ?? (reason || null),
  });
  await logEvent(contactId, "call", skip ?? `Llamada finalizada (${reason || "?"})`, status === "meeting_scheduled" ? "success" : "warn");
}
