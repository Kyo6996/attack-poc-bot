import "server-only";
import { after } from "next/server";
import { db, getContact, logEvent, updateContact } from "./db";
import { sendEmail } from "./email/send";
import { reconcileEmail, spokenEmail } from "./email-fix";
import { bookMeeting, formatSlot, getAvailableSlots, isSlotFree } from "./providers/calendar";
import { sendBookingSms } from "./providers/sms";
import { assignRep } from "./reps";
import { spokenSlot } from "./speech";
import type { Contact, Qualification, SalesRep } from "./types";

// Compartido por las tools de Vapi, la llamada simulada y la página pública de agenda.
// Los textos que devuelve los dice el agente de voz, por eso van redactados para hablarse.

export async function availabilityForAgent(contactId: string): Promise<string> {
  const slots = await getAvailableSlots(3);
  await logEvent(contactId, "calendar", `Ofreciendo ${slots.length} horarios`, "info", slots.map((s) => s.label));
  if (slots.length === 0) {
    return "No hay espacios esta semana. Dile que un especialista le escribirá por correo para cuadrar la hora.";
  }
  return [
    "Ofrece máximo dos de estas opciones, dichas tal cual y con naturalidad (hora Colombia).",
    "El código entre corchetes es solo para agendar_reunion: NUNCA lo leas en voz alta.",
    ...slots.map((s) => `- ${spokenSlot(s.start)} [${s.start}]`),
  ].join("\n");
}

export interface BookingResult {
  ok: boolean;
  message: string;
  rep?: SalesRep | null;
  startsAt?: string;
}

export async function bookForAgent(
  contactId: string,
  startIso: string,
  emailOverride?: string | null,
  qualification?: Qualification,
): Promise<BookingResult> {
  let contact = await getContact(contactId);
  if (qualification && Object.values(qualification).some(Boolean)) {
    contact = await updateContact(contactId, { qualification: { ...contact.qualification, ...clean(qualification) } });
  }

  const { data: existing } = await db().from("meetings").select("id").eq("contact_id", contactId).limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, message: "La reunión ya estaba agendada. Confírmasela y despídete con amabilidad." };
  }

  // El correo dictado por voz se reconcilia con el registrado y con la ortografía del nombre antes de enviar la invitación.
  const check = await reconcileEmail(emailOverride, contact);
  if (!check.email) {
    if (emailOverride) await logEvent(contactId, "call", `Correo dictado rechazado: ${check.error}`, "warn");
    return {
      ok: false,
      message: emailOverride
        ? `Ese correo no parece válido (${check.error}). Pídele con calma que te lo deletree letra por letra, repítelo y vuelve a llamar a agendar_reunion.`
        : "Falta un correo válido. Pídeselo con calma, deletréalo para confirmar y vuelve a llamar a agendar_reunion.",
    };
  }
  const email = check.email;
  if (check.corrected) await logEvent(contactId, "call", `Correo ajustado antes de agendar: ${check.note}`, "warn", { dictado: emailOverride, usado: email });
  if (Number.isNaN(Date.parse(startIso))) {
    return { ok: false, message: "No entendí el horario. Llama a consultar_disponibilidad y usa el código de una de las opciones." };
  }
  if (!(await isSlotFree(startIso))) {
    return { ok: false, message: "Ese horario se acaba de ocupar. Discúlpate, llama a consultar_disponibilidad y ofrece otro." };
  }

  try {
    const rep = await assignRep(contact.qualification?.area_interes);
    const m = await bookMeeting(contact, startIso, email, rep);
    await db().from("meetings").insert({
      contact_id: contactId,
      starts_at: m.startsAt,
      ends_at: m.endsAt,
      attendee_email: email,
      meet_url: m.meetUrl,
      calendar_event_id: m.eventId,
      calendar_link: m.calendarLink,
      calendar_provider: m.provider,
      sales_rep_id: rep?.id ?? null,
    });
    await updateContact(contactId, { status: "meeting_scheduled", call_outcome: "accepted", email });
    await logEvent(
      contactId,
      "calendar",
      `Reunión agendada ${formatSlot(m.startsAt)}${rep ? ` con ${rep.name}` : ""} · invitación de calendario ${m.provider === "google" ? "enviada" : "(sandbox)"} a ${email}`,
      "success",
      m,
    );

    // Los correos salen después de responder, para no demorar al agente en la llamada.
    after(async () => {
      await sendEmail("confirmacion", contactId);
      if (rep?.email) await sendEmail("brief_comercial", contactId);
      await sendBookingSms(contact, m.startsAt);
    });

    const repLine = rep
      ? ` Te va a atender ${rep.name}${rep.title ? `, ${rep.title.toLowerCase()}` : ""}; antes de la reunión te escribe para conocer mejor tu proyecto y llegar preparado.`
      : "";
    return {
      ok: true,
      rep,
      startsAt: m.startsAt,
      message: `Quedó agendada para ${spokenSlot(m.startsAt)}.${repLine} La invitación va a ${spokenEmail(email)}${check.corrected ? " (confírmale despacio ese correo, deletreando el apellido)" : ""}. Díselo con calidez, con tus palabras, y despídete.`,
    };
  } catch (e) {
    await logEvent(contactId, "calendar", `Error al agendar: ${(e as Error).message}`, "error");
    return { ok: false, message: "Hubo un problema técnico al agendar. Dile que un especialista le enviará la invitación por correo hoy mismo." };
  }
}

export async function recordOutcome(
  contact: Contact,
  outcome: string,
  notes?: string,
  qualification?: Qualification,
  email?: string | null,
) {
  const check = email ? await reconcileEmail(email, contact) : null;
  const validEmail = check?.email ?? null;
  if (check?.corrected) await logEvent(contact.id, "call", `Correo ajustado: ${check.note}`, "warn", { dictado: email, usado: validEmail });
  await updateContact(contact.id, {
    call_outcome: outcome,
    call_summary: notes ?? contact.call_summary,
    qualification: { ...contact.qualification, ...clean(qualification ?? {}), ...(notes ? { notas: notes } : {}) },
    ...(validEmail ? { email: validEmail } : {}),
  });
  await logEvent(contact.id, "call", `Resultado registrado por el agente: ${outcome}${notes ? ` — ${notes}` : ""}`, "info", qualification);
  if (outcome === "enviar_info_correo") after(() => sendEmail("seguimiento", contact.id).then(() => undefined));
}

function clean(q: Qualification): Qualification {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => typeof v === "string" && v.trim() !== "")) as Qualification;
}
