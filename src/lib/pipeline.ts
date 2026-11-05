import "server-only";
import { claimContact, db, logEvent, releaseContact, updateContact } from "./db";
import { env } from "./env";
import { enrichContact, type EnrichmentResult } from "./providers/enrichment";
import { findLinkedInProfile } from "./providers/linkedin";
import { startCall } from "./providers/voice";
import { fullName, type Contact, type ContactStatus } from "./types";
import { maskPhone } from "./util";

// Cada ejecución avanza un contacto hasta un estado final o hasta quedar esperando un webhook
// (SignalHire o fin de llamada); así cabe en el límite de tiempo de Vercel.

const ACTIONABLE: ContactStatus[] = ["pending", "linkedin_found", "phone_found"];

export interface RunResult {
  processed: { id: string; name: string; from: ContactStatus; to: ContactStatus }[];
  waiting: string | null;
}

export async function runPipeline(opts: { limit?: number; contactId?: string } = {}): Promise<RunResult> {
  const limit = opts.limit ?? 10;
  const result: RunResult = { processed: [], waiting: null };

  let query = db().from("contacts").select("*").in("status", ACTIONABLE).order("created_at").limit(limit);
  if (opts.contactId) query = query.eq("id", opts.contactId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  for (const c of (data ?? []) as Contact[]) {
    // Una llamada real a la vez; LinkedIn y enriquecimiento sí se adelantan.
    const busy = env.providers.voice === "vapi" && (await callInProgress());
    if (busy) result.waiting = "Hay una llamada en curso; el siguiente contacto se llamará cuando termine.";
    const from = c.status;
    const to = await advanceContact(c, { allowCall: !busy });
    result.processed.push({ id: c.id, name: fullName(c), from, to });
  }
  return result;
}

async function callInProgress(): Promise<boolean> {
  const { count } = await db().from("contacts").select("id", { count: "exact", head: true }).eq("status", "calling");
  return (count ?? 0) > 0;
}

export async function advanceContact(c: Contact, opts: { allowCall: boolean }): Promise<ContactStatus> {
  const claimed = await claimContact(c.id, c.status);
  if (!claimed) return c.status;
  let contact = claimed;

  try {
    // Sin consentimiento no se procesa (Ley 1581 de 2012)
    if (!contact.consent) {
      contact = await skip(contact, "sin consentimiento registrado", "system");
      return contact.status;
    }

    if (contact.status === "pending") {
      await logEvent(contact.id, "linkedin", `Buscando perfil de ${fullName(contact)} (${env.providers.linkedin})`);
      const r = await findLinkedInProfile(contact);
      const fill = fillFromProfile(contact, r.best?.headline ?? null, r.profile.location);

      if (r.decision === "review") {
        contact = await updateContact(contact.id, {
          status: "needs_review",
          linkedin_candidates: r.candidates,
          profile: r.profile,
          skip_reason: "Confianza media: confirma el perfil correcto",
        });
        await logEvent(contact.id, "linkedin", `${r.candidates.length} perfiles posibles (mejor ${Math.round(r.candidates[0].confidence * 100)}%): queda por revisar`, "warn");
        return contact.status;
      }
      if (r.decision === "not_found" || !r.best) {
        await updateContact(contact.id, { linkedin_candidates: r.candidates, profile: r.profile });
        contact = await skip(contact, "perfil de LinkedIn no encontrado", "linkedin");
        return contact.status;
      }
      contact = await updateContact(contact.id, {
        status: "linkedin_found",
        linkedin_url: r.best.url,
        linkedin_confidence: r.best.confidence,
        linkedin_source: r.best.origin === "sandbox" ? "sandbox" : r.best.reason.startsWith("IA") ? "serper+claude" : "serper",
        linkedin_candidates: r.candidates,
        profile: r.profile,
        ...fill,
      });
      await logEvent(contact.id, "linkedin", `Perfil encontrado (${Math.round(r.best.confidence * 100)}%, ${r.best.origin}): ${r.best.url}`, "success", {
        reason: r.best.reason,
      });
      if (r.profile.company) {
        await logEvent(contact.id, "linkedin", `Empresa: ${r.profile.company.name}${r.profile.company.website ? ` · ${r.profile.company.website}` : ""}`, "info");
      }
    }

    if (contact.status === "linkedin_found") {
      await logEvent(contact.id, "enrichment", `Buscando celular (${env.providers.enrichment})`);
      const r = await enrichContact(contact);
      contact = await applyEnrichment(contact, r);
      if (contact.status !== "phone_found") return contact.status;
    }

    if (contact.status === "phone_found" && opts.allowCall) {
      contact = await updateContact(contact.id, { status: "calling" });
      await logEvent(contact.id, "call", `Llamando a ${maskPhone(contact.phone)} (${env.providers.voice})`);
      const call = await startCall(contact);
      if (call.kind === "started") {
        contact = await updateContact(contact.id, { call_id: call.callId });
        await logEvent(contact.id, "call", `Llamada iniciada · id ${call.callId}`);
      } else if (call.kind === "failed") {
        contact = await updateContact(contact.id, { status: "call_failed", call_summary: call.reason });
        await logEvent(contact.id, "call", `No se pudo llamar: ${call.reason}`, "error");
      } else {
        contact = await refetch(contact.id);
      }
    }
    return contact.status;
  } catch (e) {
    await logEvent(contact.id, "system", `Error: ${(e as Error).message}`, "error");
    return contact.status;
  } finally {
    await releaseContact(contact.id);
  }
}

export async function applyEnrichment(contact: Contact, r: EnrichmentResult): Promise<Contact> {
  if (r.kind === "pending") {
    await logEvent(contact.id, "enrichment", "Solicitud enviada; esperando respuesta del proveedor");
    return updateContact(contact.id, { status: "enriching", enrichment_source: r.source });
  }
  if (r.kind === "not_found") {
    return skip({ ...contact, enrichment_source: r.source }, r.reason, "enrichment");
  }
  const updated = await updateContact(contact.id, {
    status: "phone_found",
    phone: r.phone,
    email: contact.email ?? r.email,
    enrichment_source: r.source,
  });
  await logEvent(contact.id, "enrichment", `Celular encontrado: ${maskPhone(r.phone)}`, "success");
  return updated;
}

async function skip(contact: Contact, reason: string, step: string): Promise<Contact> {
  await logEvent(contact.id, step, `Se omite → siguiente registro: ${reason}`, "warn");
  return updateContact(contact.id, {
    status: "skipped",
    skip_reason: reason,
    enrichment_source: contact.enrichment_source,
  });
}

async function refetch(id: string): Promise<Contact> {
  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  return data as Contact;
}

// Completa solo los campos vacíos: lo que trae la base del cliente manda.
export function fillFromProfile(c: Contact, headline: string | null, location: string | null): Partial<Contact> {
  const out: Partial<Contact> = {};
  if (!c.title && headline) out.title = headline.split(/s+(?:en|at|@||)s+/i)[0].slice(0, 80);
  if (!c.city && location) out.city = location.split(",")[0].trim();
  return out;
}
