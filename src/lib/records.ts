import "server-only";
import { db, logEvent } from "./db";
import { cancelGoogleEvent, replaceGoogleAttendee } from "./providers/calendar";
import { toE164 } from "./util";

export const CONTACT_FIELDS = ["first_name", "last_name", "company", "title", "city", "email", "consent", "event_notes", "phone"];

// Un teléfono puesto a mano manda: el pipeline no lo reemplaza ni lo borra al reprocesar.
export const isManualPhone = (source: string | null | undefined) => !!source?.startsWith("manual");
export const SANDBOX_FIELDS = ["full_name", "company", "headline", "linkedin_url", "mobile_phone", "email", "mock_call_outcome"];
export const REP_FIELDS = ["name", "title", "email", "phone", "area", "active"];
const AREAS = ["dispositivos", "infraestructura", "servicios", "IA", "general"];

export function validateRep(data: Record<string, unknown>, creating: boolean) {
  if (creating && !data.name) throw new InputError("El nombre es obligatorio");
  if ("name" in data && !data.name) throw new InputError("El nombre no puede quedar vacío");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) throw new InputError("Correo inválido");
  if ("area" in data && !AREAS.includes(String(data.area))) throw new InputError("Área inválida");
  if ("active" in data) data.active = Boolean(data.active);
}

// Campos que cambian el resultado de algún paso: si se editan, el contacto se vuelve a procesar.
const FLOW_FIELDS = ["first_name", "last_name", "company", "title", "consent"];

const PIPELINE_RESET = {
  status: "pending",
  skip_reason: null,
  linkedin_url: null,
  linkedin_confidence: null,
  linkedin_source: null,
  enrichment_source: null,
  phone: null,
  call_id: null,
  call_outcome: null,
  call_summary: null,
  call_transcript: null,
  recording_url: null,
  qualification: null,
  profile: null,
  linkedin_candidates: null,
  locked_until: null,
};

export class InputError extends Error {}

export function pick(body: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f in body)) continue;
    const v = body[f];
    out[f] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
  }
  return out;
}

export function validateContact(data: Record<string, unknown>, creating: boolean) {
  if (creating && (!data.first_name || !data.last_name)) throw new InputError("Nombre y apellidos son obligatorios");
  if ("first_name" in data && !data.first_name) throw new InputError("El nombre no puede quedar vacío");
  if ("last_name" in data && !data.last_name) throw new InputError("Los apellidos no pueden quedar vacíos");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) throw new InputError("Correo inválido");
  if ("consent" in data) data.consent = Boolean(data.consent);
  if ("phone" in data) {
    if (!data.phone) data.phone = null;
    else {
      const p = toE164(String(data.phone));
      if (!p) throw new InputError("Teléfono inválido. Usa +573001234567 o 3001234567");
      data.phone = p;
      data.enrichment_source = "manual";
    }
  }
}

export function validateSandbox(data: Record<string, unknown>, creating: boolean) {
  if (creating && (!data.full_name || !data.linkedin_url)) throw new InputError("Nombre y URL de LinkedIn son obligatorios");
  if (data.linkedin_url && !/linkedin\.com\/in\/[^/\s]+/i.test(String(data.linkedin_url))) {
    throw new InputError("La URL debe ser de un perfil: https://www.linkedin.com/in/…");
  }
  if (data.linkedin_url) data.linkedin_url = String(data.linkedin_url).split("?")[0].replace(/\/$/, "");
  if (data.mobile_phone) {
    const e164 = toE164(String(data.mobile_phone));
    if (!e164) throw new InputError("Celular inválido. Usa formato +573001234567 o 3001234567");
    data.mobile_phone = e164;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) throw new InputError("Correo inválido");
}

export function touchesFlow(data: Record<string, unknown>) {
  return FLOW_FIELDS.some((f) => f in data);
}

export async function cancelEvents(filter: { contactId?: string }) {
  let q = db().from("meetings").select("calendar_event_id, contact_id").eq("calendar_provider", "google").not("calendar_event_id", "is", null);
  if (filter.contactId) q = q.eq("contact_id", filter.contactId);
  const { data } = await q;
  for (const m of data ?? []) {
    try {
      await cancelGoogleEvent(m.calendar_event_id);
      await logEvent(m.contact_id, "calendar", "Evento cancelado en Google Calendar");
    } catch (e) {
      await logEvent(m.contact_id, "calendar", `No se pudo cancelar el evento: ${(e as Error).message}`, "error");
    }
  }
}

// La reunión anterior se cancela y se borra para que el contacto pueda volver a agendar.
export async function resetContact(id: string, reason: string) {
  const { data } = await db().from("contacts").select("status, phone, enrichment_source").eq("id", id).single();
  if (data?.status === "calling") throw new InputError("El contacto está en llamada; espera a que termine");
  await cancelEvents({ contactId: id });
  await db().from("meetings").delete().eq("contact_id", id);
  const keep = isManualPhone(data?.enrichment_source) ? { phone: data!.phone, enrichment_source: data!.enrichment_source } : {};
  const { error } = await db().from("contacts").update({ ...PIPELINE_RESET, ...keep }).eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent(id, "system", `Vuelve a pendiente: ${reason}`);
}

export async function resetAllContacts() {
  await db().from("emails").delete().gte("id", 0);
  await db().from("calls").delete().not("id", "is", null);
  await cancelEvents({});
  await db().from("meetings").delete().not("id", "is", null);
  const { phone: _p, enrichment_source: _e, ...keepPhone } = PIPELINE_RESET;
  await db().from("contacts").update(keepPhone).like("enrichment_source", "manual%");
  const { error } = await db().from("contacts").update(PIPELINE_RESET).or("enrichment_source.is.null,enrichment_source.not.like.manual*");
  if (error) throw new Error(error.message);
}

// Al cambiar un perfil sandbox se reprocesan los contactos que lo usaron y los que se
// omitieron con ese nombre (p. ej. "perfil no encontrado"), para que tomen el dato nuevo.
export async function resetContactsForProfile(linkedinUrls: (string | null | undefined)[], fullName?: string | null) {
  const ids = new Set<string>();
  const urls = linkedinUrls.filter((u): u is string => !!u);
  if (urls.length) {
    const { data } = await db().from("contacts").select("id").in("linkedin_url", urls).neq("status", "calling");
    data?.forEach((c) => ids.add(c.id));
  }
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) {
    const { data } = await db().from("contacts").select("id").eq("status", "skipped").ilike("first_name", first);
    data?.forEach((c) => ids.add(c.id));
  }
  for (const id of ids) await resetContact(id, "se editaron sus datos sandbox");
  return ids.size;
}

// Si se corrige el correo de un contacto con reunión, la reunión y el evento pasan al correo nuevo.
export async function syncMeetingEmail(contactId: string, newEmail: string, displayName: string) {
  const { data: meetings } = await db().from("meetings").select("*").eq("contact_id", contactId);
  for (const m of meetings ?? []) {
    if (m.attendee_email?.toLowerCase() === newEmail.toLowerCase()) continue;
    if (m.calendar_provider === "google" && m.calendar_event_id) {
      try {
        await replaceGoogleAttendee(m.calendar_event_id, m.attendee_email, newEmail, displayName);
        await logEvent(contactId, "calendar", `Invitación de Google Calendar movida de ${m.attendee_email} a ${newEmail}`, "success");
      } catch (e) {
        await logEvent(contactId, "calendar", `No se pudo actualizar el invitado en Google: ${(e as Error).message}`, "error");
      }
    }
    await db().from("meetings").update({ attendee_email: newEmail }).eq("id", m.id);
  }
}
