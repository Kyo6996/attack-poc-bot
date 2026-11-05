import "server-only";
import nodemailer from "nodemailer";
import { logEvent } from "./db";
import { env } from "./env";
import { buildReport, claudeAnalysis, rulesAnalysis, type Analysis, type Report } from "./report";
import { renderReportPdf } from "./report-pdf";
import { getSettings } from "./settings";

const span = (r: Report) => (r.period.from === r.period.to ? r.period.from : `${r.period.from} al ${r.period.to}`);
export const reportFileName = (r: Report) => `reporte-${r.period.title}-capricorne-${r.period.to}.pdf`;
export const reportSubject = (r: Report) => `Reporte operativo ${r.period.title} ${span(r)}${r.partial ? " (corte parcial)" : ""} · Capricorne Project`;

export async function generateReport(opts: { analysis?: Analysis | null; source?: string; useClaude?: boolean } = {}) {
  const data = await buildReport();
  let analysis = opts.analysis ?? null;
  let source = opts.source ?? "Claude Haiku 5.5";
  if (!analysis && opts.useClaude) analysis = await claudeAnalysis(data);
  if (!analysis) {
    analysis = rulesAnalysis(data);
    source = "reglas de operación";
  }
  const pdf = await renderReportPdf(data, analysis, source);
  return { data, analysis, source, pdf };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function reportEmailHtml(r: Report, a: Analysis, source: string) {
  const top = a.decisions
    .slice(0, 4)
    .map((d) => `<li style="margin:0 0 6px"><b>[${d.priority}]</b> ${esc(d.action)}</li>`)
    .join("");
  const offers = a.leads
    .slice(0, 4)
    .map((p) => `<li style="margin:0 0 6px"><b>${esc(p.name)}${p.company ? ` (${esc(p.company)})` : ""}:</b> ${esc(p.offer)}</li>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;color:#141826;max-width:620px">
<h2 style="color:#5b4bdb;margin:0 0 4px">Reporte operativo ${r.period.title}</h2>
<p style="color:#646b82;margin:0 0 14px">${esc(r.period.label)}${r.partial ? " · corte parcial" : ""}</p>
<p style="line-height:1.5">${esc(a.summary)}</p>
${top ? `<h3 style="margin:18px 0 8px">Decisiones prioritarias</h3><ul style="padding-left:18px">${top}</ul>` : ""}
${offers ? `<h3 style="margin:18px 0 8px">Qué ofrecer a cada lead</h3><ul style="padding-left:18px">${offers}</ul>` : ""}
<p style="color:#646b82;font-size:12px;margin-top:18px">Análisis: ${esc(source)}. El PDF adjunto trae los gráficos, el SLA, los comerciales y la agenda.</p>
</div>`;
}

// Envío directo desde la app (respaldo si n8n no está configurado o no responde).
async function sendDirect(trigger: string) {
  const { recipients } = (await getSettings()).report;
  if (!recipients.length) throw new Error("No hay destinatarios configurados");
  const { data, analysis, source, pdf } = await generateReport({ useClaude: true });
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env.smtpUser(), pass: env.smtpPass() } });
  await t.sendMail({
    from: { name: "Capricorne Project", address: env.smtpUser() },
    to: recipients.map((r) => r.email).join(", "),
    subject: reportSubject(data),
    html: reportEmailHtml(data, analysis, source),
    attachments: [{ filename: reportFileName(data), content: pdf, contentType: "application/pdf" }],
  });
  await logEvent(null, "report", `Reporte ${data.period.title} ${span(data)} enviado a ${recipients.length} destinatario(s) desde la app (${trigger}; análisis: ${source})`, "success", {
    via: "app",
    trigger,
    recipients: recipients.length,
    analysis: source,
    frequency: data.period.frequency,
  });
  return { via: "app" as const, recipients: recipients.length };
}

// "Enviar ahora": si hay webhook de n8n se dispara el flujo (queda visible en n8n); si no, la app lo envía.
export async function triggerReport(trigger: "manual" | "programado") {
  const { n8n_webhook } = (await getSettings()).report;
  if (n8n_webhook) {
    const res = await fetch(n8n_webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger, requested_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(15000),
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as const);
    if (res.ok) {
      await logEvent(null, "report", `Reporte solicitado a n8n (${trigger})`, "info");
      return { via: "n8n" as const };
    }
    await logEvent(null, "report", `n8n no respondió (${res.status}); se envía desde la app`, "warn");
  }
  return sendDirect(trigger);
}
