import "server-only";
import { logEvent } from "../db";
import { env } from "../env";
import { getSettings } from "../settings";
import type { Contact } from "../types";
import { formatSlot } from "./calendar";

// Texto en GSM-7 (sin tildes ni espacios especiales) para que quepa en un solo SMS y cueste un segmento.
function gsm(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// Se envía solo a números con consentimiento y autorizados para llamada real, igual que la voz.
export async function sendBookingSms(contact: Contact, startsAt: string): Promise<void> {
  const sid = env.twilioSid();
  const token = env.twilioToken();
  const from = env.twilioSmsFrom();
  if (!contact.phone || !contact.consent) return;
  if (!sid || !token || !from) {
    await logEvent(contact.id, "sms", "SMS de confirmación no enviado: Twilio no está configurado", "warn");
    return;
  }
  const { live_numbers } = await getSettings();
  if (!live_numbers.includes(contact.phone)) {
    await logEvent(contact.id, "sms", "SMS de confirmación omitido: el número no está autorizado para contacto real", "info");
    return;
  }

  const body = gsm(
    `Hola ${contact.first_name}, tu reunion con ${env.brandName()} quedo agendada para el ${formatSlot(startsAt)}. ` +
      `Ya te enviamos los detalles a tu correo. ¡Muchas gracias por tu confianza!`,
  );
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: contact.phone, From: from, Body: body }),
    });
    const json = (await res.json()) as { sid?: string; message?: string; code?: number };
    if (!res.ok) throw new Error(`${json.code ?? res.status}: ${json.message ?? "error"}`);
    await logEvent(contact.id, "sms", `SMS de confirmación enviado a ${contact.phone}`, "success", { sid: json.sid, body });
  } catch (e) {
    await logEvent(contact.id, "sms", `No se pudo enviar el SMS de confirmación: ${(e as Error).message}`, "error");
  }
}
