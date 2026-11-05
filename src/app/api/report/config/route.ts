import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nextSends } from "@/lib/report";
import { getSettings, setSetting, type ReportConfig, type ReportFrequency } from "@/lib/settings";

const FREQS: ReportFrequency[] = ["diario", "semanal", "quincenal", "mensual"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const { report } = await getSettings();
  const { data } = await db().from("events").select("message, level, created_at").eq("step", "report").order("created_at", { ascending: false }).limit(5);
  return NextResponse.json({ ...report, history: data ?? [], next: nextSends(report.schedule.frequency, report.schedule.hour, Date.now(), 3), key_set: !!process.env.REPORT_API_KEY?.trim() });
}

export async function PUT(req: NextRequest) {
  const b = (await req.json()) as Partial<ReportConfig>;
  const cur = (await getSettings()).report;
  const areas = b.areas ? [...new Set(b.areas.map((a) => a.trim()).filter(Boolean))] : cur.areas;
  const recipients = (b.recipients ?? cur.recipients).map((r) => ({ email: r.email.trim().toLowerCase(), name: r.name?.trim() || null, area: r.area }));
  const bad = recipients.find((r) => !EMAIL.test(r.email));
  if (bad) return NextResponse.json({ error: `Correo inválido: ${bad.email}` }, { status: 400 });
  const orphan = recipients.find((r) => !areas.includes(r.area));
  if (orphan) return NextResponse.json({ error: `El área "${orphan.area}" de ${orphan.email} ya no existe` }, { status: 400 });
  const unique = recipients.filter((r, i) => recipients.findIndex((x) => x.email === r.email) === i);
  const hook = b.n8n_webhook === undefined ? cur.n8n_webhook : b.n8n_webhook?.trim() || null;
  if (hook && !/^https:\/\//.test(hook)) return NextResponse.json({ error: "El webhook de n8n debe empezar por https://" }, { status: 400 });
  const schedule = { ...cur.schedule, ...(b.schedule ?? {}) };
  if (!FREQS.includes(schedule.frequency)) return NextResponse.json({ error: "Frecuencia no válida" }, { status: 400 });
  schedule.hour = Math.round(Number(schedule.hour));
  if (!(schedule.hour >= 6 && schedule.hour <= 23)) return NextResponse.json({ error: "La hora debe estar entre 6:00 a. m. y 11:00 p. m." }, { status: 400 });
  const next: ReportConfig = { areas, recipients: unique, n8n_webhook: hook, schedule };
  await setSetting("report", next);
  return NextResponse.json(next);
}
