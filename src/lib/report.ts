import "server-only";
import { db } from "./db";
import { env } from "./env";
import { attendeeResponse, type RsvpStatus } from "./providers/calendar";
import { signalHireCredits } from "./providers/signalhire";
import { apolloStatus } from "./providers/apollo";
import { getSettings, type ReportFrequency, type ReportRecipient } from "./settings";
import { computeStats, type FunnelStep } from "./stats";
import type { CallRow } from "./types";

export interface PeriodKpis {
  new_leads: number;
  calls: number;
  answered: number;
  missed: number;
  failed: number;
  meetings: number;
  talk_minutes: number;
  contact_rate: number | null;
  acceptance_rate: number | null;
}

export interface ReportPeriod {
  frequency: ReportFrequency;
  title: string; // "diario", "semanal"...
  label: string; // "jueves, 5 de noviembre de 2026" o "del 2 al 8 de noviembre de 2026"
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (incluido)
  previous_label: string; // "ayer", "la semana anterior"...
}

export interface RepRow {
  name: string;
  area: string;
  leads: number; // leads con reunión asignada a este comercial (histórico)
  meetings_period: number;
  upcoming: number;
  confirmed: number;
  pending: number;
  declined: number;
  confirmation_rate: number | null; // confirmadas / (confirmadas + rechazadas + pendientes)
}

export interface Report {
  period: ReportPeriod;
  generated_at: string;
  generated_label: string;
  partial: boolean;
  current: PeriodKpis;
  previous: PeriodKpis;
  funnel: FunnelStep[];
  timeline: { label: string; answered: number; missed: number; failed: number }[];
  timeline_unit: "hora" | "día";
  pipeline: { label: string; value: number }[];
  sla: { compliance: number | null; met: number; breached: number; pending: number; avg_minutes: number | null };
  reps: RepRow[];
  agenda: { when: string; lead: string; company: string | null; rep: string | null; rsvp: string }[];
  agenda_label: string;
  attention: { needs_review: number; stuck_calls: number; errors: number; without_phone: number; skipped: { reason: string; count: number }[] };
  costs: { signalhire_credits: number | null; apollo_used: number | null; apollo_limit: number | null; hunter: boolean; anthropic: boolean };
  leads: LeadBrief[];
  recipients: ReportRecipient[];
}

// Lo mínimo de cada lead activo para que la IA recomiende qué ofrecerle (textos recortados para ahorrar tokens).
export interface LeadBrief {
  name: string;
  company: string | null;
  title: string | null;
  sector: string | null;
  size: string | null;
  status: string;
  meeting: string | null;
  rsvp: string | null;
  rep: string | null;
  interest: string | null;
  project: string | null;
  stage: string | null;
  deadline: string | null;
  deciders: string | null;
  call: string | null;
  hiring: number | null;
  news: string | null;
}

export interface Decision {
  priority: "alta" | "media" | "baja";
  action: string;
  reason: string;
}

export interface LeadAdvice {
  name: string;
  company: string | null;
  offer: string;
  pitch: string;
  next_step: string;
}

export interface Analysis {
  summary: string;
  decisions: Decision[];
  risks: string[];
  leads: LeadAdvice[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  needs_review: "Por revisar",
  linkedin_found: "Perfil ubicado",
  enriching: "Buscando celular",
  phone_found: "Listo para llamar",
  calling: "En llamada",
  meeting_scheduled: "Reunión agendada",
  declined: "No interesado",
  no_answer: "No contestó",
  call_failed: "Llamada fallida",
  skipped: "Omitido",
};

const RSVP_LABEL: Record<RsvpStatus, string> = {
  accepted: "Confirmada",
  declined: "Rechazada",
  tentative: "Tal vez",
  needsAction: "Sin responder",
  cancelled: "Cancelada",
};

const TZ_OFFSET_H = 5; // America/Bogota es UTC-5 todo el año
const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString();

// Fecha local de Bogotá (año, mes 1-12, día) para un instante.
function localParts(t: number) {
  const d = new Date(t - TZ_OFFSET_H * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
}
const localStart = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, TZ_OFFSET_H);
const ymd = (t: number) => {
  const p = localParts(t);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

export const FREQ_TITLE: Record<ReportFrequency, string> = { diario: "diario", semanal: "semanal", quincenal: "quincenal", mensual: "mensual" };

// Ventana del reporte según la frecuencia; el período anterior tiene la misma forma para comparar.
export function periodBounds(freq: ReportFrequency, now = Date.now()) {
  const p = localParts(now);
  const today = localStart(p.y, p.m, p.d);
  if (freq === "semanal") {
    const start = today - ((p.dow + 6) % 7) * DAY; // lunes
    return { start, end: start + 7 * DAY, prevStart: start - 7 * DAY, prevEnd: start, previous: "la semana anterior" };
  }
  if (freq === "quincenal") {
    const first = p.d <= 15;
    const start = localStart(p.y, p.m, first ? 1 : 16);
    const end = first ? localStart(p.y, p.m, 16) : localStart(p.y, p.m + 1, 1);
    const prevStart = first ? localStart(p.y, p.m - 1, 16) : localStart(p.y, p.m, 1);
    return { start, end, prevStart, prevEnd: start, previous: "la quincena anterior" };
  }
  if (freq === "mensual") {
    const start = localStart(p.y, p.m, 1);
    return { start, end: localStart(p.y, p.m + 1, 1), prevStart: localStart(p.y, p.m - 1, 1), prevEnd: start, previous: "el mes anterior" };
  }
  return { start: today, end: today + DAY, prevStart: today - DAY, prevEnd: today, previous: "ayer" };
}

function kpis(calls: CallRow[], newLeads: number, meetings: number): PeriodKpis {
  const answered = calls.filter((c) => c.status === "answered").length;
  const done = calls.filter((c) => c.status !== "in_progress").length;
  const talk = calls.reduce((a, c) => a + (c.duration_sec ?? 0), 0);
  return {
    new_leads: newLeads,
    calls: calls.length,
    answered,
    missed: calls.filter((c) => c.status === "missed").length,
    failed: calls.filter((c) => c.status === "failed").length,
    meetings,
    talk_minutes: Math.round((talk / 60) * 10) / 10,
    contact_rate: done ? answered / done : null,
    acceptance_rate: answered ? Math.min(1, meetings / answered) : null,
  };
}

interface MeetingRow {
  id: string;
  contact_id: string;
  starts_at: string;
  created_at: string;
  sales_rep_id: string | null;
  calendar_event_id: string | null;
  calendar_provider: string;
}

// Respuesta a la invitación de cada reunión (Google Calendar). Las de sandbox quedan sin dato.
async function rsvps(meetings: MeetingRow[]) {
  const out = new Map<string, RsvpStatus | null>();
  const google = meetings.filter((m) => m.calendar_provider === "google" && m.calendar_event_id).slice(0, 40);
  await Promise.all(google.map(async (m) => out.set(m.id, await attendeeResponse(m.calendar_event_id!).catch(() => null))));
  return out;
}

export async function buildReport(opts: { frequency?: ReportFrequency } = {}): Promise<Report> {
  const now = Date.now();
  const tz = env.timeZone();
  const settings = await getSettings();
  const frequency = opts.frequency ?? settings.report.schedule.frequency;
  const { start, end, prevStart, prevEnd, previous } = periodBounds(frequency, now);

  const [calls, prevCalls, contacts, meetings, reps, events, stats, shCredits, apollo] = await Promise.all([
    db().from("calls").select("*").gte("started_at", iso(start)).lt("started_at", iso(end)),
    db().from("calls").select("*").gte("started_at", iso(prevStart)).lt("started_at", iso(prevEnd)),
    db().from("contacts").select("id, first_name, last_name, company, title, status, phone, created_at, updated_at, event_notes, qualification, call_summary, profile"),
    db().from("meetings").select("id, contact_id, starts_at, created_at, sales_rep_id, calendar_event_id, calendar_provider"),
    db().from("sales_reps").select("id, name, area, active"),
    db().from("events").select("level, message, step").gte("created_at", iso(start)).lt("created_at", iso(end)),
    computeStats(),
    signalHireCredits(),
    apolloStatus().catch(() => null),
  ]);

  const all = (contacts.data ?? []) as Row[];
  const byId = new Map(all.map((c) => [c.id, c]));
  const repById = new Map((reps.data ?? []).map((r) => [r.id, r]));
  const created = (from: number, to: number) => all.filter((c) => Date.parse(c.created_at as string) >= from && Date.parse(c.created_at as string) < to).length;
  const allMeetings = (meetings.data ?? []) as MeetingRow[];
  const inWindow = (t: string, a: number, b: number) => Date.parse(t) >= a && Date.parse(t) < b;
  const periodMeetings = allMeetings.filter((m) => inWindow(m.created_at, start, end));
  const prevMeetings = allMeetings.filter((m) => inWindow(m.created_at, prevStart, prevEnd));
  const upcoming = allMeetings.filter((m) => Date.parse(m.starts_at) >= now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const rsvp = await rsvps([...new Map([...periodMeetings, ...upcoming].map((m) => [m.id, m])).values()]);

  // Línea de tiempo: por hora si es diario, por día si el período es más largo.
  const periodCalls = (calls.data ?? []) as CallRow[];
  const bucket = (from: number, to: number) => {
    const inB = periodCalls.filter((c) => inWindow(c.started_at, from, to));
    return { answered: inB.filter((c) => c.status === "answered").length, missed: inB.filter((c) => c.status === "missed").length, failed: inB.filter((c) => c.status === "failed").length };
  };
  const dayFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "short", day: "numeric" });
  const timeline =
    frequency === "diario"
      ? Array.from({ length: 13 }, (_, i) => ({ label: String(7 + i).padStart(2, "0"), ...bucket(start + (7 + i) * 3600_000, start + (8 + i) * 3600_000) }))
      : Array.from({ length: Math.round((end - start) / DAY) }, (_, i) => ({ label: dayFmt.format(new Date(start + i * DAY + 12 * 3600_000)).replace(".", ""), ...bucket(start + i * DAY, start + (i + 1) * DAY) }));

  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const pipeline = [...counts.entries()].map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v })).sort((a, b) => b.value - a.value);

  const timeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h12" });
  const whenFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h12" });
  const agendaUntil = frequency === "diario" ? localStart(localParts(now).y, localParts(now).m, localParts(now).d) + 2 * DAY : now + 7 * DAY;
  const agenda = upcoming
    .filter((m) => Date.parse(m.starts_at) < agendaUntil)
    .map((m) => {
      const c = byId.get(m.contact_id);
      const r = rsvp.get(m.id);
      return {
        when: frequency === "diario" ? timeFmt.format(new Date(m.starts_at)) : whenFmt.format(new Date(m.starts_at)),
        lead: c ? `${c.first_name} ${c.last_name}` : "—",
        company: (c?.company as string) ?? null,
        rep: m.sales_rep_id ? (repById.get(m.sales_rep_id)?.name ?? null) : null,
        rsvp: r ? RSVP_LABEL[r] : "Sin dato",
      };
    });

  const repRows: RepRow[] = (reps.data ?? [])
    .filter((r) => r.active)
    .map((r) => {
      const mine = allMeetings.filter((m) => m.sales_rep_id === r.id);
      const judged = [...new Map([...mine.filter((m) => inWindow(m.created_at, start, end)), ...mine.filter((m) => Date.parse(m.starts_at) >= now)].map((m) => [m.id, m])).values()];
      const st = judged.map((m) => rsvp.get(m.id));
      const confirmed = st.filter((s) => s === "accepted").length;
      const declined = st.filter((s) => s === "declined" || s === "cancelled").length;
      const pending = st.filter((s) => s === "needsAction" || s === "tentative").length;
      const base = confirmed + declined + pending;
      return {
        name: r.name,
        area: r.area,
        leads: new Set(mine.map((m) => m.contact_id)).size,
        meetings_period: mine.filter((m) => inWindow(m.created_at, start, end)).length,
        upcoming: mine.filter((m) => Date.parse(m.starts_at) >= now).length,
        confirmed,
        pending,
        declined,
        confirmation_rate: base ? confirmed / base : null,
      };
    })
    .sort((a, b) => b.leads - a.leads || b.meetings_period - a.meetings_period);

  const ev = events.data ?? [];
  const skippedMap = new Map<string, number>();
  for (const e of ev) {
    const m = e.message.match(/Se omite → siguiente registro: (.+)$/);
    if (m) skippedMap.set(m[1].slice(0, 60), (skippedMap.get(m[1].slice(0, 60)) ?? 0) + 1);
  }
  const stuck = all.filter((c) => c.status === "calling" && now - Date.parse(c.updated_at) > 15 * 60_000).length;

  const longFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, day: "numeric", month: "long" });
  const label = frequency === "diario" ? longFmt.format(new Date(now)) : `del ${shortFmt.format(new Date(start + 12 * 3600_000))} al ${longFmt.format(new Date(end - 12 * 3600_000)).replace(/^\S+,\s*/, "")}`;
  const sendAt = end - DAY + settings.report.schedule.hour * 3600_000;

  return {
    period: { frequency, title: FREQ_TITLE[frequency], label, from: ymd(start), to: ymd(end - DAY), previous_label: previous },
    generated_at: new Date(now).toISOString(),
    generated_label: new Intl.DateTimeFormat("es-CO", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(new Date(now)),
    partial: now < sendAt,
    current: kpis(periodCalls, created(start, end), periodMeetings.length),
    previous: kpis((prevCalls.data ?? []) as CallRow[], created(prevStart, prevEnd), prevMeetings.length),
    funnel: stats.funnel.map((f) => ({ ...f, label: f.label.replace("Contactos en base", "Leads en base") })),
    timeline,
    timeline_unit: frequency === "diario" ? "hora" : "día",
    pipeline,
    sla: { compliance: stats.sla.compliance, met: stats.sla.met, breached: stats.sla.breached, pending: stats.sla.pendingInSla, avg_minutes: stats.sla.avgMinutesToFirstCall },
    reps: repRows,
    agenda,
    agenda_label: frequency === "diario" ? "Agenda de mañana" : "Agenda de los próximos 7 días",
    attention: {
      needs_review: counts.get("needs_review") ?? 0,
      stuck_calls: stuck,
      errors: ev.filter((e) => e.level === "error").length,
      without_phone: all.filter((c) => !c.phone && ["linkedin_found", "skipped", "needs_review"].includes(c.status)).length,
      skipped: [...skippedMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    },
    costs: {
      signalhire_credits: shCredits,
      apollo_used: apollo?.usedToday ?? null,
      apollo_limit: apollo?.dayLimit ?? null,
      hunter: !!process.env.HUNTER_API_KEY,
      anthropic: !!env.anthropicKey(),
    },
    leads: pickLeads(all, upcoming, rsvp, repById, whenFmt),
    recipients: settings.report.recipients,
  };
}

const cut = (v: unknown, n: number) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
};

type Row = Record<string, unknown> & { id: string; status: string; updated_at: string; first_name: string; last_name: string };
const RANK: Record<string, number> = { meeting_scheduled: 0, declined: 2, no_answer: 3, call_failed: 4, phone_found: 5 };

// Leads que vale la pena trabajar: reunión agendada, ya hablaron con el bot o están listos para llamar.
function pickLeads(all: Row[], upcoming: MeetingRow[], rsvp: Map<string, RsvpStatus | null>, repById: Map<string, { name: string }>, whenFmt: Intl.DateTimeFormat): LeadBrief[] {
  return all
    .filter((c) => c.status in RANK || !!c.call_summary || !!c.qualification)
    .sort((a, b) => (RANK[a.status] ?? 6) - (RANK[b.status] ?? 6) || Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 8)
    .map((c) => {
      const q = (c.qualification ?? {}) as Record<string, string>;
      const p = (c.profile ?? {}) as { company?: { category?: string | null; attributes?: Record<string, string> | null; signals?: { jobs_total?: number; news?: { title: string }[] } } | null; headline?: string | null };
      const m = upcoming.find((x) => x.contact_id === c.id);
      const r = m ? rsvp.get(m.id) : null;
      return {
        name: `${c.first_name} ${c.last_name}`,
        company: (c.company as string) ?? null,
        title: cut(c.title ?? p.headline, 60),
        sector: cut(p.company?.category, 40),
        size: p.company?.attributes?.["Empleados (aprox.)"] ?? null,
        status: STATUS_LABEL[c.status] ?? c.status,
        meeting: m ? whenFmt.format(new Date(m.starts_at)) : null,
        rsvp: r ? RSVP_LABEL[r] : null,
        rep: m?.sales_rep_id ? (repById.get(m.sales_rep_id)?.name ?? null) : null,
        interest: cut(q.area_interes ? `${q.area_interes}. ${c.event_notes ?? ""}` : c.event_notes, 140),
        project: cut(q.proyecto, 140),
        stage: cut(q.etapa, 50),
        deadline: cut(q.fecha_meta, 50),
        deciders: cut(q.decisores, 80),
        call: cut(c.call_summary, 220),
        hiring: p.company?.signals?.jobs_total ?? null,
        news: cut(p.company?.signals?.news?.[0]?.title, 90),
      };
    });
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

// Análisis base sin IA: siempre disponible y sirve de respaldo si Claude no responde.
export function rulesAnalysis(r: Report): Analysis {
  const t = r.current;
  const d: Decision[] = [];
  const best = [...r.timeline].sort((a, b) => b.answered - a.answered)[0];
  if (t.missed > 0) d.push({ priority: "alta", action: `Reintentar a ${t.missed} lead(s) que no contestaron${best?.answered ? ` en la franja de ${best.label}` : " en otra franja"}`, reason: best?.answered ? `Es la franja con más llamadas contestadas del período (${best.answered}).` : "Cambiar de horario sube la tasa de contacto." });
  if (r.attention.needs_review > 0) d.push({ priority: "alta", action: `Confirmar la identidad de ${r.attention.needs_review} lead(s) en "Por revisar"`, reason: "Sin identidad confirmada no se enriquecen ni se llaman." });
  if (r.sla.breached > 0) d.push({ priority: "alta", action: `Atender ${r.sla.breached} lead(s) con el SLA de 24 h vencido`, reason: `Cumplimiento actual: ${pct(r.sla.compliance)}.` });
  if (r.attention.stuck_calls > 0) d.push({ priority: "alta", action: `Liberar ${r.attention.stuck_calls} llamada(s) trabadas en "En llamada"`, reason: "Bloquean la cola del bot." });
  const pendingRsvp = r.reps.reduce((a, x) => a + x.pending, 0);
  if (pendingRsvp > 0) d.push({ priority: "media", action: `Confirmar por teléfono o WhatsApp ${pendingRsvp} reunión(es) sin respuesta a la invitación`, reason: "Una reunión sin confirmar tiene más riesgo de inasistencia." });
  if (t.failed > 0) d.push({ priority: "media", action: `Revisar ${t.failed} llamada(s) fallida(s): saldo de Twilio y números autorizados`, reason: "Las fallas técnicas no cuentan como intento real." });
  if (r.attention.without_phone > 0) d.push({ priority: "media", action: `Conseguir celular para ${r.attention.without_phone} lead(s) sin teléfono`, reason: r.costs.signalhire_credits ? `Quedan ${r.costs.signalhire_credits} crédito(s) de SignalHire: usarlos en los de mayor interés.` : "Sin créditos de SignalHire: pedir el número al comercial o por el formulario QR." });
  if (t.calls > 0 && t.meetings === 0 && t.answered > 0) d.push({ priority: "media", action: "Revisar el guion: hubo conversaciones pero ninguna reunión", reason: `${t.answered} contestadas, 0 agendadas.` });
  if (t.calls === 0) d.push({ priority: "media", action: "No hubo llamadas en el período: revisar la cola, los números autorizados y el modo de llamadas", reason: "El bot no tuvo a quién llamar o estaba en simulación." });
  if (r.agenda.length) d.push({ priority: "baja", action: `Preparar ${r.agenda.length} reunión(es) próximas con el resumen de cada lead`, reason: "El comercial llega con contexto de la empresa y de la llamada." });

  const delta = t.calls - r.previous.calls;
  const summary = `${r.partial ? "Corte parcial: " : ""}en el período (${r.period.label}) se cargaron ${t.new_leads} lead(s) y se hicieron ${t.calls} llamada(s) (${delta >= 0 ? "+" : ""}${delta} frente a ${r.period.previous_label}): ${t.answered} contestada(s), ${t.missed} sin respuesta y ${t.failed} fallida(s). Se agendaron ${t.meetings} reunión(es); tasa de contacto ${pct(t.contact_rate)} y de aceptación ${pct(t.acceptance_rate)}. Cumplimiento del SLA de 24 h: ${pct(r.sla.compliance)}.`;
  const risks: string[] = [];
  if (r.attention.errors) risks.push(`${r.attention.errors} error(es) registrados en la bitácora del período.`);
  if (r.sla.pending) risks.push(`${r.sla.pending} lead(s) siguen dentro del plazo del SLA y deben llamarse pronto.`);
  for (const s of r.attention.skipped.slice(0, 2)) risks.push(`${s.count} omitido(s) por: ${s.reason}.`);
  return { summary, decisions: d.slice(0, 7), risks, leads: r.leads.slice(0, 6).map(ruleAdvice) };
}

const PORTFOLIO = [
  { re: /\bia\b|inteligencia artificial|anal[ií]tica|datos|machine|modelo/i, offer: "Lenovo Hybrid AI: servidores ThinkSystem y workstations listos para IA", pitch: "Llevar sus casos de IA de piloto a producción con infraestructura propia y costos predecibles." },
  { re: /servidor|infraestructura|data ?center|nube|cloud|almacen|virtualiz|hiperconverg|edge/i, offer: "Infraestructura ThinkSystem / ThinkAgile (hiperconvergencia y almacenamiento)", pitch: "Modernizar el centro de datos sin interrumpir la operación y con escalamiento por etapas." },
  { re: /equipo|port[aá]til|\bpc|computador|dispositivo|renovaci|puesto|h[ií]brido|colaborador/i, offer: "Renovación de equipos ThinkPad / ThinkCentre con PCs con IA", pitch: "Renovar el parque de equipos con dispositivos más seguros y eficientes para trabajo híbrido." },
  { re: /servicio|soporte|pago por uso|opex|suscrip|gesti[oó]n|outsourc/i, offer: "Lenovo TruScale: tecnología como servicio y Premier Support", pitch: "Pasar de compra a pago por uso, con soporte especializado y sin una inversión inicial grande." },
];

function ruleAdvice(p: LeadBrief): LeadAdvice {
  const text = [p.interest, p.project, p.call, p.title].filter(Boolean).join(" ");
  const hit = PORTFOLIO.find((x) => x.re.test(text)) ?? PORTFOLIO[2];
  let next = "Seguimiento por correo con material de la línea sugerida";
  if (p.meeting) next = `Preparar la reunión del ${p.meeting}${p.rep ? ` con ${p.rep}` : ""}${p.rsvp && p.rsvp !== "Confirmada" ? " y confirmar asistencia" : ""}`;
  else if (p.status === "No contestó") next = "Reintentar la llamada en otra franja";
  else if (p.status === "Listo para llamar") next = "Incluir en la próxima ronda de llamadas";
  return { name: p.name, company: p.company, offer: hit.offer, pitch: hit.pitch, next_step: next };
}

// Datos compactos para la IA: solo lo que sirve para decidir (menos tokens, menos costo).
function compactForAI(r: Report) {
  const drop = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== ""));
  return {
    reporte: `${r.period.title} ${r.period.label}`,
    parcial: r.partial,
    periodo_actual: r.current,
    periodo_anterior: { ...r.previous, cual: r.period.previous_label },
    embudo: r.funnel.map((f) => `${f.label}: ${f.value}`),
    [`llamadas_por_${r.timeline_unit}`]: r.timeline.filter((h) => h.answered + h.missed + h.failed > 0),
    estado_base: r.pipeline,
    sla_24h: r.sla,
    comerciales: r.reps.map(drop),
    agenda: r.agenda,
    atencion: r.attention,
    creditos_signalhire_restantes: r.costs.signalhire_credits,
    leads: r.leads.map(drop),
  };
}

const FORMAT = '{"summary":"","decisions":[{"priority":"alta|media|baja","action":"","reason":""}],"risks":[""],"leads":[{"name":"","company":"","offer":"","pitch":"","next_step":""}]}';

// Instrucción para Claude (la usa n8n y también el envío directo desde la app).
export function claudePrompt(r: Report): string {
  return [
    "Eres el analista comercial de un equipo que vende soluciones Lenovo en Colombia. Un bot llama a los leads que visitaron el stand de Lenovo en ANDICOM 2026, los califica con 4 preguntas (proyecto, etapa, fecha meta, decisores) y agenda una reunión de 15 minutos con un comercial.",
    "Portafolio que se puede ofrecer: equipos ThinkPad/ThinkCentre y PCs con IA; infraestructura ThinkSystem/ThinkAgile (servidores, hiperconvergencia, almacenamiento, edge); Lenovo Hybrid AI; TruScale (tecnología como servicio, pago por uso) y Premier Support.",
    `Este es el reporte ${r.period.title} (${r.period.label}). ${r.partial ? "El corte es PARCIAL: se pidió antes del cierre programado." : "Es el cierre del período."}`,
    "En comerciales, confirmation_rate es la proporción de reuniones que el lead aceptó en Google Calendar. El embudo cuenta leads únicos; las llamadas del período cuentan intentos (un lead puede tener varios).",
    "Escribe para personas: no menciones nombres de campos del JSON.",
    "",
    "DATOS:",
    JSON.stringify(compactForAI(r)),
    "",
    "Responde SOLO con JSON válido, en español de Colombia, sin markdown, con esta forma exacta:",
    FORMAT,
    "Reglas:",
    `- summary: 3 a 5 frases para gerencia. Qué pasó en el período frente a ${r.period.previous_label}, qué funcionó, qué preocupa y cómo van los comerciales con sus leads.`,
    '- decisions: máximo 5, ordenadas por impacto. Acciones operativas concretas con números y responsable o momento (ej. "mañana 10 a. m."). reason cita el dato que la justifica.',
    "- risks: máximo 3, breves.",
    "- leads: uno por cada lead de DATOS (máximo 6). offer = la línea del portafolio que mejor encaja con lo que dijo (proyecto, interés, sector, tamaño). pitch = una frase para abrir la conversación usando su propio contexto. next_step = qué hacer, quién y cuándo.",
    "- Usa solo los datos entregados. No inventes cifras, nombres ni compromisos.",
    "- Sé breve: action, offer, pitch y next_step de máximo 25 palabras; reason y risks de máximo 20.",
  ].join("\n");
}

export function parseAnalysis(text: string | null | undefined): Analysis | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<Analysis> & { prospects?: LeadAdvice[] };
    if (!j.summary || !Array.isArray(j.decisions)) return null;
    const leads = Array.isArray(j.leads) ? j.leads : Array.isArray(j.prospects) ? j.prospects : [];
    return {
      summary: String(j.summary),
      decisions: j.decisions.slice(0, 6),
      risks: Array.isArray(j.risks) ? j.risks.slice(0, 4) : [],
      leads: leads.filter((p) => p?.name && p?.offer).slice(0, 6),
    };
  } catch {
    return null;
  }
}

// Haiku con esfuerzo bajo: el análisis cuesta fracciones de centavo por reporte.
export const CLAUDE_REPORT_MODEL = "claude-haiku-5-5";

export async function claudeAnalysis(r: Report): Promise<Analysis | null> {
  const key = env.anthropicKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_REPORT_MODEL, max_tokens: 8000, output_config: { effort: "low" }, messages: [{ role: "user", content: claudePrompt(r) }] }),
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) {
      console.error("Claude reporte", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j = (await res.json()) as { content: { type: string; text?: string }[] };
    return parseAnalysis(j.content.find((b) => b.type === "text")?.text);
  } catch (e) {
    console.error("Claude reporte", e);
    return null;
  }
}

// ¿Toca el envío programado en esta hora? (n8n pregunta cada hora; la app decide con la configuración).
export function isDue(freq: ReportFrequency, hour: number, now = Date.now()) {
  const p = localParts(now);
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  if (h !== hour) return false;
  const lastOfMonth = localParts(localStart(p.y, p.m + 1, 1) - DAY).d;
  if (freq === "diario") return p.dow >= 1 && p.dow <= 5;
  if (freq === "semanal") return p.dow === 5;
  if (freq === "quincenal") return p.d === 15 || p.d === lastOfMonth;
  return p.d === lastOfMonth;
}

// Próximas fechas de envío programado (para el calendario).
export function nextSends(freq: ReportFrequency, hour: number, from = Date.now(), count = 6): string[] {
  const out: string[] = [];
  const p = localParts(from);
  let day = localStart(p.y, p.m, p.d);
  for (let i = 0; i < 400 && out.length < count; i++, day += DAY) {
    const at = day + hour * 3600_000;
    if (at >= from && isDue(freq, hour, at)) out.push(ymd(at));
  }
  return out;
}
