import "server-only";
import { db, getContact, logEvent, updateContact } from "./db";
import { bookMeeting, formatSlot, getAvailableSlots, isSlotFree } from "./providers/calendar";
import type { Contact, Qualification } from "./types";

// Compartido por las tools de Vapi y la llamada simulada; devuelve texto que el agente puede usar.

export async function availabilityForAgent(contactId: string): Promise<string> {
  const slots = await getAvailableSlots(3);
  await logEvent(contactId, "calendar", `Ofreciendo ${slots.length} horarios`, "info", slots);
  if (slots.length === 0) return "No hay espacios disponibles esta semana. Ofrece que un asesor le escribirá por correo.";
  return (
    "Horarios disponibles (hora Colombia). Ofrécelos en lenguaje natural y usa el valor ISO al agendar:\n" +
    slots.map((s) => `- ${s.label} → ${s.start}`).join("\n")
  );
}

export async function bookForAgent(
  contactId: string,
  startIso: string,
  emailOverride?: string | null,
  qualification?: Qualification,
): Promise<{ ok: boolean; message: string }> {
  let contact = await getContact(contactId);
  if (qualification && Object.values(qualification).some(Boolean)) {
    contact = await updateContact(contactId, { qualification: { ...contact.qualification, ...clean(qualification) } });
  }

  const { data: existing } = await db().from("meetings").select("id").eq("contact_id", contactId).limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, message: "La reunión ya estaba agendada. Confírmala y despídete." };
  }

  const email = (emailOverride ?? contact.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Falta un correo válido. Pídelo deletreado y vuelve a llamar a agendar_reunion." };
  }
  if (Number.isNaN(Date.parse(startIso))) {
    return { ok: false, message: "Horario inválido. Llama a consultar_disponibilidad y usa uno de los valores ISO." };
  }
  if (!(await isSlotFree(startIso))) {
    return { ok: false, message: "Ese horario acaba de ocuparse. Llama a consultar_disponibilidad y ofrece otro." };
  }

  try {
    const m = await bookMeeting(contact, startIso, email);
    await db().from("meetings").insert({
      contact_id: contactId,
      starts_at: m.startsAt,
      ends_at: m.endsAt,
      attendee_email: email,
      meet_url: m.meetUrl,
      calendar_event_id: m.eventId,
      calendar_provider: m.provider,
    });
    await updateContact(contactId, { status: "meeting_scheduled", call_outcome: "accepted", email });
    await logEvent(
      contactId,
      "calendar",
      `Reunión agendada ${formatSlot(m.startsAt)} · invitación ${m.provider === "google" ? "enviada" : "(sandbox)"} a ${email}`,
      "success",
      m,
    );
    return { ok: true, message: `Listo: reunión agendada para el ${formatSlot(m.startsAt)}. La invitación llega a su correo. Confírmalo y despídete.` };
  } catch (e) {
    await logEvent(contactId, "calendar", `Error al agendar: ${(e as Error).message}`, "error");
    return { ok: false, message: "Hubo un problema técnico al agendar. Dile que un asesor le enviará la invitación por correo hoy mismo." };
  }
}

export async function recordOutcome(contact: Contact, outcome: string, notes?: string, qualification?: Qualification) {
  await updateContact(contact.id, {
    call_outcome: outcome,
    call_summary: notes ?? contact.call_summary,
    qualification: { ...contact.qualification, ...clean(qualification ?? {}), ...(notes ? { notas: notes } : {}) },
  });
  await logEvent(contact.id, "call", `Resultado registrado por el agente: ${outcome}${notes ? ` — ${notes}` : ""}`, "info", qualification);
}

function clean(q: Qualification): Qualification {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => typeof v === "string" && v.trim() !== "")) as Qualification;
}
