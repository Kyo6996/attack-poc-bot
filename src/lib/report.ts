import "server-only";
import { db } from "./db";
import { env } from "./env";
import { signalHireCredits } from "./providers/signalhire";
import { apolloStatus } from "./providers/apollo";
import { getSettings, type ReportRecipient } from "./settings";
import { computeStats, type FunnelStep } from "./stats";
import type { CallRow } from "./types";

export interface DayKpis {
  new_contacts: number;
  calls: number;
  answered: number;
  missed: number;
  failed: number;
  meetings: number;
  talk_minutes: number;
  contact_rate: number | null;
  acceptance_rate: number | null;
}

export interface DailyReport {
  date: string;
  label: string;
  generated_at: string;
  generated_label: string;
  partial: boolean;
  today: DayKpis;
  yesterday: DayKpis;
  funnel: FunnelStep[];
  hourly: { hour: string; answered: number; missed: number; failed: number }[];
  pipeline: { label: string; value: number }[];
  sla: { compliance: number | null; met: number; breached: number; pending: number; avg_minutes: number | null };
  reps: { name: string; area: string; today: number; upcoming: number }[];
  tomorrow: { time: string; contact: string; company: string | null; rep: string | null }[];
  attention: { needs_review: number; stuck_calls: number; errors: number; without_phone: number; skipped: { reason: string; count: number }[] };
  costs: { signalhire_credits: number | null; apollo_used: number | null; apollo_limit: number | null; hunter: boolean; anthropic: boolean };
  recipients: ReportRecipient[];
}

export interface Decision {
  priority: "alta" | "media" | "baja";
  action: string;
  reason: string;
}

export interface Analysis {
  summary: string;
  decisions: Decision[];
  risks: string[];
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

const TZ_OFFSET_H = 5; // America/Bogota es UTC-5 todo el año

function dayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = parts.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d, TZ_OFFSET_H);
  return { date: parts, start, end: start + 86400_000 };
}

function kpis(calls: CallRow[], newContacts: number, meetings: number): DayKpis {
  const answered = calls.filter((c) => c.status === "answered").length;
  const done = calls.filter((c) => c.status !== "in_progress").length;
  const talk = calls.reduce((a, c) => a + (c.duration_sec ?? 0), 0);
  return {
    new_contacts: newContacts,
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

const iso = (t: number) => new Date(t).toISOString();

export async function buildDailyReport(): Promise<DailyReport> {
  const now = new Date();
  const { date, start, end } = dayBounds(now);
  const yStart = start - 86400_000;
  const tz = env.timeZone();

  const [calls, yCalls, contacts, meetingsToday, meetingsY, upcoming, reps, events, stats, settings, shCredits, apollo] = await Promise.all([
    db().from("calls").select("*").gte("started_at", iso(start)).lt("started_at", iso(end)),
    db().from("calls").select("*").gte("started_at", iso(yStart)).lt("started_at", iso(start)),
    db().from("contacts").select("id, first_name, last_name, company, status, phone, created_at, updated_at, call_id"),
    db().from("meetings").select("id, sales_rep_id").gte("created_at", iso(start)).lt("created_at", iso(end)),
    db().from("meetings").select("id").gte("created_at", iso(yStart)).lt("created_at", iso(start)),
    db().from("meetings").select("starts_at, sales_rep_id, contact_id").gte("starts_at", now.toISOString()).order("starts_at"),
    db().from("sales_reps").select("id, name, area, active"),
    db().from("events").select("level, message, step").gte("created_at", iso(start)).lt("created_at", iso(end)),
    computeStats(),
    getSettings(),
    signalHireCredits(),
    apolloStatus().catch(() => null),
  ]);

  const all = contacts.data ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const repById = new Map((reps.data ?? []).map((r) => [r.id, r]));
  const created = (from: number, to: number) => all.filter((c) => Date.parse(c.created_at) >= from && Date.parse(c.created_at) < to).length;

  const todayCalls = (calls.data ?? []) as CallRow[];
  const hourly = Array.from({ length: 13 }, (_, i) => {
    const h = 7 + i;
    const from = start + h * 3600_000;
    const inH = todayCalls.filter((c) => Date.parse(c.started_at) >= from && Date.parse(c.started_at) < from + 3600_000);
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      answered: inH.filter((c) => c.status === "answered").length,
      missed: inH.filter((c) => c.status === "missed").length,
      failed: inH.filter((c) => c.status === "failed").length,
    };
  });

  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const pipeline = [...counts.entries()].map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v })).sort((a, b) => b.value - a.value);

  const tomorrowStart = end;
  const tomorrowEnd = end + 86400_000;
  const timeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h12" });
  const up = upcoming.data ?? [];
  const tomorrow = up
    .filter((m) => Date.parse(m.starts_at) >= tomorrowStart && Date.parse(m.starts_at) < tomorrowEnd)
    .map((m) => {
      const c = byId.get(m.contact_id);
      return {
        time: timeFmt.format(new Date(m.starts_at)),
        contact: c ? `${c.first_name} ${c.last_name}` : "—",
        company: c?.company ?? null,
        rep: m.sales_rep_id ? (repById.get(m.sales_rep_id)?.name ?? null) : null,
      };
    });

  const repRows = (reps.data ?? [])
    .filter((r) => r.active)
    .map((r) => ({
      name: r.name,
      area: r.area,
      today: (meetingsToday.data ?? []).filter((m) => m.sales_rep_id === r.id).length,
      upcoming: up.filter((m) => m.sales_rep_id === r.id).length,
    }));

  const ev = events.data ?? [];
  const skippedMap = new Map<string, number>();
  for (const e of ev) {
    const m = e.message.match(/Se omite → siguiente registro: (.+)$/);
    if (m) skippedMap.set(m[1].slice(0, 60), (skippedMap.get(m[1].slice(0, 60)) ?? 0) + 1);
  }
  const stuck = all.filter((c) => c.status === "calling" && Date.now() - Date.parse(c.updated_at) > 15 * 60_000).length;

  const dateLabel = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const genLabel = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(now);
  const hourNow = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));

  return {
    date,
    label: dateLabel,
    generated_at: now.toISOString(),
    generated_label: genLabel,
    partial: hourNow < 18,
    today: kpis(todayCalls, created(start, end), meetingsToday.data?.length ?? 0),
    yesterday: kpis((yCalls.data ?? []) as CallRow[], created(yStart, start), meetingsY.data?.length ?? 0),
    funnel: stats.funnel,
    hourly,
    pipeline,
    sla: { compliance: stats.sla.compliance, met: stats.sla.met, breached: stats.sla.breached, pending: stats.sla.pendingInSla, avg_minutes: stats.sla.avgMinutesToFirstCall },
    reps: repRows,
    tomorrow,
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
    recipients: settings.report.recipients,
  };
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

// Análisis base sin IA: siempre disponible y sirve de respaldo si Claude no responde.
export function rulesAnalysis(r: DailyReport): Analysis {
  const t = r.today;
  const d: Decision[] = [];
  const best = [...r.hourly].sort((a, b) => b.answered - a.answered)[0];
  if (t.missed > 0) d.push({ priority: "alta", action: `Reintentar a ${t.missed} contacto(s) que no contestaron${best?.answered ? ` mañana cerca de las ${best.hour}` : " mañana en otra franja"}`, reason: best?.answered ? `Es la franja con más llamadas contestadas hoy (${best.answered}).` : "Cambiar de horario sube la tasa de contacto." });
  if (r.attention.needs_review > 0) d.push({ priority: "alta", action: `Confirmar la identidad de ${r.attention.needs_review} contacto(s) en "Por revisar"`, reason: "Sin identidad confirmada no se enriquecen ni se llaman." });
  if (r.sla.breached > 0) d.push({ priority: "alta", action: `Atender ${r.sla.breached} contacto(s) con el SLA de 24 h vencido`, reason: `Cumplimiento actual: ${pct(r.sla.compliance)}.` });
  if (r.attention.stuck_calls > 0) d.push({ priority: "alta", action: `Liberar ${r.attention.stuck_calls} llamada(s) trabadas en "En llamada"`, reason: "Bloquean la cola del bot." });
  if (t.failed > 0) d.push({ priority: "media", action: `Revisar ${t.failed} llamada(s) fallida(s): saldo de Twilio y números autorizados`, reason: "Las fallas técnicas no cuentan como intento real." });
  if (r.attention.without_phone > 0) d.push({ priority: "media", action: `Conseguir celular para ${r.attention.without_phone} contacto(s) sin teléfono`, reason: r.costs.signalhire_credits ? `Quedan ${r.costs.signalhire_credits} crédito(s) de SignalHire: usarlos en los de mayor interés.` : "Sin créditos de SignalHire: pedir el número al comercial o por el formulario QR." });
  if (t.calls > 0 && t.meetings === 0 && t.answered > 0) d.push({ priority: "media", action: "Revisar el guion: hubo conversaciones pero ninguna reunión", reason: `${t.answered} contestadas, 0 agendadas.` });
  if (t.calls === 0) d.push({ priority: "media", action: "No hubo llamadas hoy: revisar la cola, los números autorizados y el modo de llamadas", reason: "El bot no tuvo a quién llamar o estaba en simulación." });
  if (r.tomorrow.length) d.push({ priority: "baja", action: `Preparar ${r.tomorrow.length} reunión(es) de mañana con el resumen de cada cliente`, reason: "El comercial llega con contexto de la empresa y de la llamada." });
  if (r.costs.signalhire_credits !== null && r.costs.signalhire_credits <= 2) d.push({ priority: "baja", action: "Recargar créditos de SignalHire o priorizar su uso", reason: `Quedan ${r.costs.signalhire_credits}.` });

  const delta = t.calls - r.yesterday.calls;
  const summary = `${r.partial ? "Corte parcial: " : ""}hoy se cargaron ${t.new_contacts} contacto(s) y se hicieron ${t.calls} llamada(s) (${delta >= 0 ? "+" : ""}${delta} frente a ayer): ${t.answered} contestada(s), ${t.missed} sin respuesta y ${t.failed} fallida(s). Se agendaron ${t.meetings} reunión(es); tasa de contacto ${pct(t.contact_rate)} y de aceptación ${pct(t.acceptance_rate)}. Cumplimiento del SLA de 24 h: ${pct(r.sla.compliance)}.`;
  const risks: string[] = [];
  if (r.attention.errors) risks.push(`${r.attention.errors} error(es) registrados hoy en la bitácora.`);
  if (r.sla.pending) risks.push(`${r.sla.pending} contacto(s) siguen dentro del plazo del SLA y deben llamarse pronto.`);
  for (const s of r.attention.skipped.slice(0, 2)) risks.push(`${s.count} omitido(s) por: ${s.reason}.`);
  return { summary, decisions: d.slice(0, 7), risks };
}

// Instrucción para Claude (la usa n8n y también el envío directo desde la app).
export function claudePrompt(r: DailyReport): string {
  const data = { ...r, recipients: undefined };
  return `Eres analista de operaciones comerciales. Este es el corte diario de un bot que llama a contactos de la feria ANDICOM 2026 para agendar reuniones de 15 minutos con un comercial de Lenovo.
${r.partial ? "El corte es PARCIAL (se envió antes de las 6:00 p. m.)." : ""}
Datos del día en JSON:
${JSON.stringify(data)}

Responde SOLO con un JSON válido, en español de Colombia, sin texto adicional, con esta forma:
{"summary": "4 a 6 líneas para gerencia: cómo fue el día frente a ayer y qué destaca", "decisions": [{"priority": "alta|media|baja", "action": "acción concreta con números", "reason": "por qué, citando el dato"}], "risks": ["riesgo u observación breve"]}
Máximo 6 decisiones, ordenadas por prioridad. Usa solo los datos entregados; no inventes cifras.`;
}

export function parseAnalysis(text: string | null | undefined): Analysis | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<Analysis>;
    if (!j.summary || !Array.isArray(j.decisions)) return null;
    return { summary: String(j.summary), decisions: j.decisions.slice(0, 8), risks: Array.isArray(j.risks) ? j.risks.slice(0, 6) : [] };
  } catch {
    return null;
  }
}

export async function claudeAnalysis(r: DailyReport): Promise<Analysis | null> {
  const key = env.anthropicKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.anthropicModel(), max_tokens: 4000, messages: [{ role: "user", content: claudePrompt(r) }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content: { type: string; text?: string }[] };
    return parseAnalysis(j.content.find((b) => b.type === "text")?.text);
  } catch {
    return null;
  }
}
