import "server-only";
import { db } from "./db";
import { env } from "./env";
import type { CallRow } from "./types";

export const SLA_HOURS = 24;

export interface HourBucket {
  hour: string; // "14:00"
  start: string;
  answered: number;
  missed: number;
  failed: number;
  total: number;
}

export interface SlaRow {
  contactId: string;
  name: string;
  company: string | null;
  loadedAt: string;
  firstCallAt: string | null;
  minutesToFirstCall: number | null;
  sla: "A tiempo" | "Vencido" | "En plazo" | "No aplica";
  note: string | null;
  status: string;
  attempts: number;
}

export interface FunnelStep {
  label: string;
  value: number;
}

export interface Stats {
  windowHours: number;
  calls: number;
  answered: number;
  missed: number;
  failed: number;
  inProgress: number;
  callsPerMinuteLastHour: number;
  peakPerMinute: number;
  talkMinutes: number;
  avgDurationSec: number;
  contactRate: number | null; // contestadas / terminadas
  meetings: number;
  acceptanceRate: number | null; // reuniones / contestadas
  sla: {
    eligible: number;
    met: number;
    breached: number;
    pendingInSla: number;
    compliance: number | null;
    avgMinutesToFirstCall: number | null;
    nextDeadline: string | null;
  };
  hourly: HourBucket[];
  funnel: FunnelStep[];
  slaRows: SlaRow[];
  generatedAt: string;
}

// SLA: todo contacto con consentimiento debe recibir su primer intento de llamada
// dentro de las 24 h siguientes a su carga en la base.
export async function computeStats(): Promise<Stats> {
  const now = Date.now();
  const since = new Date(now - SLA_HOURS * 3600_000).toISOString();

  const [callsRes, meetingsRes, contactsRes, firstCallsRes] = await Promise.all([
    db().from("calls").select("*").gte("started_at", since),
    db().from("meetings").select("id, created_at").gte("created_at", since),
    db().from("contacts").select("id, first_name, last_name, company, created_at, consent, status, skip_reason, linkedin_url, phone"),
    db().from("calls").select("contact_id, started_at").order("started_at", { ascending: true }),
  ]);
  const calls = (callsRes.data ?? []) as CallRow[];
  const done = calls.filter((c) => c.status !== "in_progress");
  const answered = calls.filter((c) => c.status === "answered").length;
  const missed = calls.filter((c) => c.status === "missed").length;
  const failed = calls.filter((c) => c.status === "failed").length;
  const meetings = meetingsRes.data?.length ?? 0;

  const lastHour = calls.filter((c) => Date.parse(c.started_at) >= now - 3600_000).length;
  const perMinute = new Map<string, number>();
  for (const c of calls) {
    const k = c.started_at.slice(0, 16);
    perMinute.set(k, (perMinute.get(k) ?? 0) + 1);
  }
  const durations = done.map((c) => c.duration_sec ?? 0).filter((d) => d > 0);
  const talk = durations.reduce((a, b) => a + b, 0);

  const firstCall = new Map<string, number>();
  for (const c of firstCallsRes.data ?? []) {
    if (!firstCall.has(c.contact_id)) firstCall.set(c.contact_id, Date.parse(c.started_at));
  }
  // Los omitidos antes de llamar (sin perfil, sin celular, sin consentimiento) no cuentan para el SLA.
  const eligible = (contactsRes.data ?? []).filter((c) => c.consent && !(c.status === "skipped" && !firstCall.has(c.id)));
  let met = 0;
  let breached = 0;
  let pendingInSla = 0;
  let nextDeadline: number | null = null;
  const waits: number[] = [];
  for (const c of eligible) {
    const created = Date.parse(c.created_at);
    const deadline = created + SLA_HOURS * 3600_000;
    const first = firstCall.get(c.id);
    if (first !== undefined) {
      waits.push((first - created) / 60000);
      if (first <= deadline) met++;
      else breached++;
    } else if (now > deadline) breached++;
    else {
      pendingInSla++;
      nextDeadline = nextDeadline === null ? deadline : Math.min(nextDeadline, deadline);
    }
  }
  const judged = met + breached;

  const all = contactsRes.data ?? [];
  const attempts = new Map<string, number>();
  const answeredBy = new Set<string>();
  for (const c of (firstCallsRes.data ?? []) as { contact_id: string }[]) attempts.set(c.contact_id, (attempts.get(c.contact_id) ?? 0) + 1);
  const { data: answeredRows } = await db().from("calls").select("contact_id").eq("status", "answered");
  for (const r of answeredRows ?? []) answeredBy.add(r.contact_id);
  const funnel: FunnelStep[] = [
    { label: "Contactos en base", value: all.length },
    { label: "Con consentimiento", value: all.filter((c) => c.consent).length },
    { label: "Perfil de LinkedIn ubicado", value: all.filter((c) => c.linkedin_url).length },
    { label: "Celular encontrado", value: all.filter((c) => c.phone).length },
    { label: "Llamados", value: all.filter((c) => firstCall.has(c.id)).length },
    { label: "Contestaron", value: all.filter((c) => answeredBy.has(c.id)).length },
    { label: "Reunión agendada", value: all.filter((c) => c.status === "meeting_scheduled").length },
  ];

  const slaRows: SlaRow[] = all.map((c) => {
    const created = Date.parse(c.created_at);
    const first = firstCall.get(c.id);
    const eligibleRow = c.consent && !(c.status === "skipped" && first === undefined);
    let sla: SlaRow["sla"] = "No aplica";
    if (eligibleRow) {
      if (first !== undefined) sla = first - created <= SLA_HOURS * 3600_000 ? "A tiempo" : "Vencido";
      else sla = now > created + SLA_HOURS * 3600_000 ? "Vencido" : "En plazo";
    }
    return {
      contactId: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company,
      loadedAt: c.created_at,
      firstCallAt: first !== undefined ? new Date(first).toISOString() : null,
      minutesToFirstCall: first !== undefined ? Math.round((first - created) / 60000) : null,
      sla,
      note: !c.consent ? "Sin consentimiento" : c.status === "skipped" ? c.skip_reason : null,
      status: c.status,
      attempts: attempts.get(c.id) ?? 0,
    };
  });

  const hourFmt = new Intl.DateTimeFormat("es-CO", { timeZone: env.timeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const currentHour = Math.floor(now / 3600_000) * 3600_000;
  const hourly: HourBucket[] = Array.from({ length: SLA_HOURS }, (_, i) => {
    const start = currentHour - (SLA_HOURS - 1 - i) * 3600_000;
    const inBucket = calls.filter((c) => {
      const t = Date.parse(c.started_at);
      return t >= start && t < start + 3600_000;
    });
    return {
      hour: hourFmt.format(new Date(start)),
      start: new Date(start).toISOString(),
      answered: inBucket.filter((c) => c.status === "answered").length,
      missed: inBucket.filter((c) => c.status === "missed").length,
      failed: inBucket.filter((c) => c.status === "failed").length,
      total: inBucket.length,
    };
  });

  return {
    windowHours: SLA_HOURS,
    calls: calls.length,
    answered,
    missed,
    failed,
    inProgress: calls.length - done.length,
    callsPerMinuteLastHour: Math.round((lastHour / 60) * 100) / 100,
    peakPerMinute: Math.max(0, ...perMinute.values()),
    talkMinutes: Math.round((talk / 60) * 10) / 10,
    avgDurationSec: durations.length ? Math.round(talk / durations.length) : 0,
    contactRate: done.length ? answered / done.length : null,
    meetings,
    acceptanceRate: answered ? Math.min(1, meetings / answered) : null,
    sla: {
      eligible: eligible.length,
      met,
      breached,
      pendingInSla,
      compliance: judged ? met / judged : null,
      avgMinutesToFirstCall: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      nextDeadline: nextDeadline ? new Date(nextDeadline).toISOString() : null,
    },
    hourly,
    funnel,
    slaRows,
    generatedAt: new Date(now).toISOString(),
  };
}
