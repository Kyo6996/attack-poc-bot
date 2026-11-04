import "server-only";
import { db } from "../db";
import { env } from "../env";
import { fullName, type Contact } from "../types";

export interface Slot {
  start: string;
  end: string;
  label: string;
}

export interface BookedMeeting {
  startsAt: string;
  endsAt: string;
  meetUrl: string | null;
  eventId: string | null;
  provider: string;
}

export function formatSlot(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: env.timeZone(),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function candidateSlots(days = 5): { start: Date; end: Date }[] {
  const { start: h0, end: h1 } = env.businessHours();
  const minutes = env.meetingMinutes();
  const offset = env.tzOffset();
  const out: { start: Date; end: Date }[] = [];
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone() }).format(new Date());
  const base = new Date(`${todayLocal}T12:00:00${offset}`);

  let added = 0;
  for (let d = 1; added < days && d < 14; d++) {
    const day = new Date(base.getTime() + d * 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone() }).format(day);
    const weekday = new Date(`${ymd}T12:00:00${offset}`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    added++;
    for (let m = h0 * 60; m + minutes <= h1 * 60; m += minutes) {
      if (m >= 12 * 60 && m < 14 * 60) continue; // almuerzo
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const start = new Date(`${ymd}T${hh}:${mm}:00${offset}`);
      out.push({ start, end: new Date(start.getTime() + minutes * 60000) });
    }
  }
  return out;
}

async function busyIntervals(from: Date, to: Date): Promise<{ start: number; end: number }[]> {
  // también cuenta lo que ya agendó el bot
  const { data } = await db()
    .from("meetings")
    .select("starts_at, ends_at")
    .gte("ends_at", from.toISOString())
    .lte("starts_at", to.toISOString());
  const busy = (data ?? []).map((m) => ({ start: Date.parse(m.starts_at), end: Date.parse(m.ends_at) }));

  if (env.providers.calendar === "google") {
    const token = await googleAccessToken();
    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: env.googleCalendarId() }],
      }),
    });
    if (!res.ok) throw new Error(`Google freeBusy ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
    for (const cal of Object.values(json.calendars)) {
      for (const b of cal.busy ?? []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
  }
  return busy;
}

export async function getAvailableSlots(count = 3): Promise<Slot[]> {
  const cands = candidateSlots();
  if (cands.length === 0) return [];
  const busy = await busyIntervals(cands[0].start, cands[cands.length - 1].end);
  const free = cands.filter(
    (s) => !busy.some((b) => s.start.getTime() < b.end && s.end.getTime() > b.start),
  );

  // un horario por día, alternando mañana y tarde
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone() });
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: env.timeZone(), hour: "numeric", hour12: false });
  const byDay = new Map<string, typeof free>();
  for (const s of free) {
    const k = dayFmt.format(s.start);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const picked: Slot[] = [];
  let i = 0;
  for (const slots of byDay.values()) {
    const wantMorning = i % 2 === 0;
    const s = slots.find((x) => (Number(hourFmt.format(x.start)) < 12) === wantMorning) ?? slots[0];
    picked.push({ start: s.start.toISOString(), end: s.end.toISOString(), label: formatSlot(s.start.toISOString()) });
    i++;
    if (picked.length >= count) break;
  }
  return picked;
}

export async function isSlotFree(startIso: string): Promise<boolean> {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + env.meetingMinutes() * 60000);
  const busy = await busyIntervals(start, end);
  return !busy.some((b) => start.getTime() < b.end && end.getTime() > b.start);
}

// Con sendUpdates=all es Google quien envía la invitación al correo del contacto.
export async function bookMeeting(contact: Contact, startIso: string, attendeeEmail: string): Promise<BookedMeeting> {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + env.meetingMinutes() * 60000);
  const brand = env.brandName();
  const q = contact.qualification ?? {};
  const area = q.area_interes ? ` (${q.area_interes})` : "";
  const summary = `${brand} × ${contact.company ?? fullName(contact)}: conversación con especialista${area}`;
  const description = [
    `Hola, ${contact.first_name}:`,
    `Gracias por acompañarnos en ${env.eventName()} y por tu tiempo en la llamada.`,
    `Esta es la conversación de ${env.meetingMinutes()} minutos con el especialista de ${brand} para entender mejor la iniciativa y ver cómo podemos aportar.`,
    q.proyecto ? `\nIniciativa: ${q.proyecto}` : "",
    q.etapa ? `Etapa: ${q.etapa}` : "",
    q.fecha_meta ? `Meta: ${q.fecha_meta}` : "",
    `\nEquipo ${env.companyName()}, en nombre de ${brand}.`,
  ]
    .filter(Boolean)
    .join("\n");

  if (env.providers.calendar === "google") {
    const token = await googleAccessToken();
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.googleCalendarId())}/events`,
    );
    url.searchParams.set("conferenceDataVersion", "1");
    url.searchParams.set("sendUpdates", "all");
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: start.toISOString(), timeZone: env.timeZone() },
        end: { dateTime: end.toISOString(), timeZone: env.timeZone() },
        attendees: [{ email: attendeeEmail, displayName: fullName(contact) }],
        conferenceData: {
          createRequest: { requestId: `poc-${contact.id}-${start.getTime()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
        reminders: { useDefault: true },
      }),
    });
    if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
    const ev = (await res.json()) as { id: string; hangoutLink?: string; htmlLink?: string };
    return {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      meetUrl: ev.hangoutLink ?? ev.htmlLink ?? null,
      eventId: ev.id,
      provider: "google",
    };
  }

  const code = Math.random().toString(36).slice(2, 12);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    meetUrl: `https://meet.google.com/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7, 10)} (sandbox)`,
    eventId: null,
    provider: "sandbox",
  };
}

let cachedToken: { value: string; exp: number } | null = null;

async function googleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      refresh_token: env.googleRefreshToken(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}
