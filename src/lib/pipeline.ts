import "server-only";
import { claimContact, db, logEvent, releaseContact, updateContact } from "./db";
import { isManualPhone } from "./records";
import { env } from "./env";
import { enrichContact, webPhone, type EnrichmentResult } from "./providers/enrichment";
import { findWorkEmail, MIN_SCORE } from "./providers/hunter";
import { findLinkedInProfile } from "./providers/linkedin";
import { searchSignalHire, signalHireEnabled } from "./providers/signalhire";
import { startCall } from "./providers/voice";
import { fullName, type Contact, type ContactStatus, type SignalHireInfo } from "./types";
import { maskPhone } from "./util";
import { withProvenance } from "./provenance";

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
      const sh = await signalHireFree(contact);
      // LinkedIn manda; SignalHire (gratis) completa lo que aún falte.
      const liFill = fillFromProfile(contact, r.best?.headline ?? null, r.profile.location);
      const shJob = sh?.best?.experience?.[0];
      const shFill: Partial<Contact> = {
        ...(!contact.title && !liFill.title && shJob?.title ? { title: shJob.title.slice(0, 80) } : {}),
        ...(!contact.city && !liFill.city && sh?.best?.location ? { city: sh.best.location.split(",")[0].trim() } : {}),
      };
      const fill = { ...liFill, ...shFill };
      const liUrl = r.best?.sources[0]?.url ?? r.best?.url ?? null;
      r.profile = withProvenance({ ...r.profile, provenance: contact.profile?.provenance }, {
        ...(r.best
          ? {
              linkedin_url: {
                source: r.best.origin === "sandbox" ? "Datos de prueba (sandbox)" : "Google vía Serper",
                detail: `${Math.round(r.best.confidence * 100)}% · ${r.best.reason}`,
                url: liUrl,
              },
            }
          : {}),
        ...Object.fromEntries(Object.keys(liFill).map((k) => [k, { source: "Perfil público de LinkedIn (Google)", url: liUrl }])),
        ...Object.fromEntries(Object.keys(shFill).map((k) => [k, { source: "SignalHire (búsqueda gratuita)", detail: sh?.best?.uid ?? null }])),
      });
      // Lo revelado con crédito nunca se pierde al volver a buscar.
      const prevReveal = contact.profile?.signalhire?.reveal;
      if (sh && prevReveal) sh.reveal = prevReveal;
      r.profile.signalhire = sh ?? contact.profile?.signalhire;
      const paidPhones = (contact.profile?.phones ?? []).filter((p) => p.source.startsWith("SignalHire"));
      if (paidPhones.length) r.profile.phones = [...(r.profile.phones ?? []), ...paidPhones.filter((p) => !(r.profile.phones ?? []).some((x) => x.value === p.value))];

      // SignalHire con la persona en su empresa actual pesa más que candidatos de LinkedIn dudosos o empatados.
      const shStrong = r.decision !== "found" && !!sh?.best && (sh.best.score ?? 0) >= SIGNALHIRE_IDENTITY;
      if (shStrong) {
        const job = sh!.best!.experience?.[0];
        contact = await updateContact(contact.id, {
          status: "linkedin_found",
          linkedin_url: null,
          linkedin_source: "signalhire",
          linkedin_confidence: sh!.best!.score ?? null,
          linkedin_candidates: r.candidates,
          skip_reason: null,
          profile: withProvenance(
            { ...r.profile, headline: r.profile.headline ?? (job ? `${job.title} @ ${job.company}` : null), location: r.profile.location ?? sh!.best!.location },
            { identity: { source: "SignalHire (búsqueda gratuita)", detail: `${Math.round((sh!.best!.score ?? 0) * 100)}% · ${sh!.best!.fullName}${job ? ` · ${job.title} @ ${job.company}` : ""}` } },
          ),
          ...fill,
        });
        await logEvent(contact.id, "linkedin", `Identidad confirmada con SignalHire (${Math.round((sh!.best!.score ?? 0) * 100)}%); LinkedIn solo tenía candidatos dudosos`, "success");
      } else if (r.decision === "review" && contact.phone && isManualPhone(contact.enrichment_source)) {
        // Con teléfono registrado a mano la duda sobre LinkedIn no frena la llamada; el perfil se puede elegir después.
        contact = await updateContact(contact.id, { status: "linkedin_found", linkedin_candidates: r.candidates, profile: r.profile, ...fill });
        await logEvent(contact.id, "linkedin", `${r.candidates.length} perfiles posibles por revisar; sigue con el teléfono registrado`, "warn");
      } else if (r.decision === "review") {
        contact = await updateContact(contact.id, {
          status: "needs_review",
          linkedin_candidates: r.candidates,
          profile: r.profile,
          skip_reason: "Confianza media: confirma el perfil correcto",
        });
        await logEvent(contact.id, "linkedin", `${r.candidates.length} perfiles posibles (mejor ${Math.round(r.candidates[0].confidence * 100)}%): queda por revisar`, "warn");
        return contact.status;
      } else if (r.decision === "not_found" || !r.best) {
        await updateContact(contact.id, { linkedin_candidates: r.candidates, profile: r.profile });
        if (!(contact.phone && isManualPhone(contact.enrichment_source))) {
          contact = await skip(contact, "perfil de LinkedIn no encontrado", "linkedin");
          return contact.status;
        }
        await logEvent(contact.id, "linkedin", "Sin perfil de LinkedIn, pero tiene teléfono registrado a mano: sigue el flujo", "warn");
        contact = await updateContact(contact.id, { status: "linkedin_found", ...fill });
      } else {
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
    }

    // Correo profesional (Hunter) solo si falta y ya se conoce el dominio de la empresa.
    if (contact.status === "linkedin_found" && !contact.email && contact.profile?.company?.domain) {
      contact = await findEmailFor(contact);
    }

    if (contact.status === "linkedin_found" && contact.phone && isManualPhone(contact.enrichment_source)) {
      contact = await updateContact(contact.id, { status: "phone_found" });
      await logEvent(contact.id, "enrichment", `Se usa el teléfono registrado a mano: ${maskPhone(contact.phone)}`, "success");
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
    const web = webPhone(contact);
    if (!web) return skip({ ...contact, enrichment_source: r.source }, r.reason, "enrichment");
    await logEvent(contact.id, "enrichment", `${r.reason}; se usa el teléfono público encontrado (${web.kind === "found" ? web.source : ""})`);
    r = web;
  }
  if (r.kind !== "found") return contact;
  const updated = await updateContact(contact.id, {
    status: "phone_found",
    phone: r.phone,
    email: contact.email ?? r.email,
    profile: withProvenance(contact.profile, {
      phone: { source: r.source.startsWith("sandbox") ? "Datos de prueba (sandbox)" : r.source.startsWith("signalhire") ? "SignalHire" : r.source },
      ...(!contact.email && r.email ? { email: { source: r.source.startsWith("signalhire") ? "SignalHire" : "Datos de prueba (sandbox)" } } : {}),
    }),
    enrichment_source: r.source,
  });
  await logEvent(contact.id, "enrichment", `Teléfono encontrado: ${maskPhone(r.phone)} · ${r.source}`, "success");
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

// Al registrar o importar: busca LinkedIn, ficha y teléfono de inmediato, sin llamar.
export async function prepareContacts(ids: string[]) {
  for (const id of ids) {
    const { data } = await db().from("contacts").select("*").eq("id", id).maybeSingle();
    const st = (data as Contact | null)?.status;
    if (data && (st === "pending" || st === "linkedin_found")) await advanceContact(data as Contact, { allowCall: false });
  }
}

const SIGNALHIRE_IDENTITY = 0.9;

async function findEmailFor(contact: Contact): Promise<Contact> {
  const domain = contact.profile!.company!.domain!;
  const { found, error } = await findWorkEmail(contact.first_name, contact.last_name, domain);
  if (error) {
    await logEvent(contact.id, "enrichment", `Correo no consultado: ${error}`, "warn");
    return contact;
  }
  if (!found) {
    await logEvent(contact.id, "enrichment", `Hunter no encontró correo en ${domain}`);
    return contact;
  }
  const trusted = found.score >= MIN_SCORE || found.status === "valid";
  const profile = {
    ...contact.profile!,
    email: { value: found.email, score: found.score, status: found.status, source: "Hunter" },
    phones: [...(contact.profile!.phones ?? []), ...found.phones.filter((p) => !(contact.profile!.phones ?? []).some((x) => x.value === p.value))],
  };
  const updated = await updateContact(contact.id, {
    profile: withProvenance(profile, {
      ...(trusted ? { email: { source: "Hunter", detail: `confianza ${found.score}%${found.status ? ` · ${found.status}` : ""}` } } : {}),
      ...(!contact.title && found.position ? { title: { source: "Hunter" } } : {}),
    }),
    ...(trusted ? { email: found.email } : {}),
    ...(!contact.title && found.position ? { title: found.position } : {}),
  });
  await logEvent(
    contact.id,
    "enrichment",
    trusted
      ? `Correo profesional encontrado: ${found.email} (confianza ${found.score}%${found.status ? `, ${found.status}` : ""})`
      : `Correo probable con baja confianza (${found.score}%): ${found.email} — no se usa automáticamente`,
    trusted ? "success" : "warn",
  );
  return updated;
}

// Búsqueda gratuita en SignalHire (cupo diario, sin créditos). Nunca revela contactos.
async function signalHireFree(contact: Contact): Promise<SignalHireInfo | undefined> {
  if (!signalHireEnabled()) return undefined;
  try {
    const info = await searchSignalHire(contact);
    const job = info.best?.experience?.[0];
    await logEvent(
      contact.id,
      "linkedin",
      info.best
        ? `SignalHire (gratis): ${info.best.fullName}${job ? ` · ${job.title} @ ${job.company}` : ""} (${Math.round((info.best.score ?? 0) * 100)}%)`
        : `SignalHire (gratis): ${info.total} resultado(s), ninguno coincide con seguridad`,
      info.best ? "success" : "info",
    );
    return info;
  } catch (e) {
    await logEvent(contact.id, "linkedin", `SignalHire (gratis) no disponible: ${(e as Error).message}`, "warn");
    return { searched_at: new Date().toISOString(), total: 0, best: null, others: [], error: (e as Error).message };
  }
}
