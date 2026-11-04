import { env } from "../env";
import type { Contact, Meeting, SalesRep } from "../types";

// Invitación iCalendar (METHOD:REQUEST): Gmail y Outlook la muestran con botones Sí / No / Quizás.

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// RFC 5545: líneas de máx. 75 octetos, continuadas con un espacio.
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function meetingIcs(c: Contact, m: Meeting, rep: SalesRep | null, meetUrl: string | null) {
  const sender = env.sender();
  const brand = env.brandName();
  const summary = `${brand} · Conversación con especialista${c.qualification?.area_interes ? ` (${c.qualification.area_interes})` : ""}`;
  const description = [
    `Conversación de ${env.meetingMinutes()} minutos con el especialista de ${brand}.`,
    rep ? `Te atenderá: ${rep.name}${rep.title ? `, ${rep.title}` : ""}.` : "",
    meetUrl ? `Enlace: ${meetUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const attendees = [
    `ATTENDEE;CN=${text(`${c.first_name} ${c.last_name}`)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${m.attendee_email}`,
    ...(rep?.email ? [`ATTENDEE;CN=${text(rep.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${rep.email}`] : []),
  ];

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Attack POC//Agendador ANDICOM//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${m.id}@attack-poc-bot`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(m.starts_at)}`,
    `DTEND:${stamp(m.ends_at)}`,
    `SUMMARY:${text(summary)}`,
    `DESCRIPTION:${text(description)}`,
    meetUrl ? `LOCATION:${text(meetUrl)}` : "LOCATION:Videollamada",
    meetUrl ? `URL:${meetUrl}` : "",
    `ORGANIZER;CN=${text(sender.name)}:mailto:${sender.email}`,
    ...attendees,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .map(fold)
    .join("\r\n");
}
