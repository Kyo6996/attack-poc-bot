import "server-only";
import { db, logEvent } from "../db";
import { env } from "../env";
import { googleAccessToken } from "../google";
import type { Contact, EmailKind, Meeting, SalesRep } from "../types";
import { confirmationEmail, followupEmail, htmlToText, repBriefEmail } from "./templates";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

async function sendGmail(to: string, subject: string, html: string): Promise<string> {
  const sender = env.sender();
  const boundary = `b_${Date.now().toString(36)}`;
  const from = sender.email ? `${encodeHeader(sender.name)} <${sender.email}>` : undefined;
  const mime = [
    from && `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(htmlToText(html)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
  ]
    .filter((l) => l !== undefined)
    .join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime) }),
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function deliver(params: {
  kind: EmailKind;
  contactId: string;
  meetingId?: string | null;
  to: string;
  subject: string;
  html: string;
}) {
  const provider = env.providers.email;
  let status: "sent" | "failed" = "sent";
  let error: string | null = null;
  let providerId: string | null = null;
  try {
    // En sandbox el correo no sale: queda guardado para verlo desde el panel.
    if (provider === "gmail") providerId = await sendGmail(params.to, params.subject, params.html);
  } catch (e) {
    status = "failed";
    error = (e as Error).message.slice(0, 500);
  }
  await db().from("emails").insert({
    contact_id: params.contactId,
    meeting_id: params.meetingId ?? null,
    kind: params.kind,
    to_email: params.to,
    subject: params.subject,
    html: params.html,
    provider,
    status,
    error,
    provider_id: providerId,
  });
  const label = { confirmacion: "Confirmación enviada", seguimiento: "Correo de seguimiento enviado", brief_comercial: "Brief enviado al comercial" }[
    params.kind
  ];
  await logEvent(
    params.contactId,
    "email",
    status === "sent" ? `${label} a ${params.to}${provider === "sandbox" ? " (sandbox)" : ""}` : `${label.split(" enviad")[0]} falló: ${error}`,
    status === "sent" ? "success" : "error",
  );
  return { ok: status === "sent", error };
}

async function loadMeeting(contactId: string) {
  const { data } = await db()
    .from("meetings")
    .select("*, sales_reps(*)")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { sales_reps: rep, ...meeting } = data as Meeting & { sales_reps: SalesRep | null };
  return { meeting: meeting as Meeting, rep };
}

export async function sendEmail(kind: EmailKind, contactId: string): Promise<{ ok: boolean; error: string | null }> {
  const { data: contact } = await db().from("contacts").select("*").eq("id", contactId).single();
  const c = contact as Contact;
  if (!c) return { ok: false, error: "Contacto no encontrado" };

  if (kind === "seguimiento") {
    if (!c.email) return { ok: false, error: "El contacto no tiene correo" };
    const { subject, html } = followupEmail(c, `${env.appUrl()}/agendar/${c.booking_token}`);
    return deliver({ kind, contactId, to: c.email, subject, html });
  }

  const found = await loadMeeting(contactId);
  if (!found) return { ok: false, error: "El contacto no tiene reunión agendada" };
  const { meeting, rep } = found;

  if (kind === "confirmacion") {
    const { subject, html } = confirmationEmail(c, meeting, rep);
    return deliver({ kind, contactId, meetingId: meeting.id, to: meeting.attendee_email, subject, html });
  }

  if (!rep?.email) return { ok: false, error: "El comercial asignado no tiene correo" };
  const { subject, html } = repBriefEmail(c, meeting, rep);
  return deliver({ kind, contactId, meetingId: meeting.id, to: rep.email, subject, html });
}
