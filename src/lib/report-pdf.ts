import "server-only";
import PDFDocument from "pdfkit";
import type { Analysis, LeadAdvice, PeriodKpis, Report } from "./report";

const C = {
  accent: "#5b4bdb",
  accentSoft: "#eeecfd",
  ink: "#141826",
  muted: "#646b82",
  border: "#e3e5ee",
  ok: "#1f9d5c",
  warn: "#d98a0b",
  err: "#d64545",
  panel: "#f6f7fb",
};
const PRIO = { alta: C.err, media: C.warn, baja: C.ok } as const;

const W = 595.28;
const M = 40;
const CW = W - M * 2;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function renderReportPdf(r: Report, a: Analysis, source: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `Reporte operativo ${r.period.title} ${r.period.from}`, Author: "Capricorne Project" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const ai = /claude/i.test(source);

  header(doc, r);
  let y = 118;
  y = summaryBox(doc, a, source, ai, y);
  y = kpiGrid(doc, r.current, r.previous, r.period.previous_label, y + 14);
  y = sectionTitle(doc, "Embudo acumulado de leads", y + 18);
  y = funnel(doc, r, y);

  doc.addPage();
  y = sectionTitle(doc, `Llamadas por ${r.timeline_unit} (${r.period.title === "diario" ? "hoy" : "período"})`, M);
  y = timelineChart(doc, r, y);
  y = sectionTitle(doc, "Resultado de las llamadas del período", y + 14);
  y = outcomes(doc, r.current, y);
  y = sectionTitle(doc, "Estado de la base de leads", y + 14);
  y = hbars(doc, r.pipeline.slice(0, 8), y, C.accent);
  y = ensure(doc, y, 230);
  y = sectionTitle(doc, "SLA de primer contacto (24 h)", y + 14);
  y = slaBar(doc, r, y);
  y = slaExplainer(doc, y + 8);

  doc.addPage();
  y = sectionTitle(doc, "Decisiones operativas sugeridas", M, ai);
  y = decisions(doc, a, y);
  if (a.risks.length) {
    y = sectionTitle(doc, "Riesgos y observaciones", y + 12, ai);
    y = bullets(doc, a.risks, y);
  }
  if (a.leads.length) {
    y = ensure(doc, y, 160);
    y = sectionTitle(doc, "Qué ofrecer a cada lead", y + 12, ai);
    y = leadCards(doc, a.leads, y);
  }
  y = ensure(doc, y, 150);
  y = sectionTitle(doc, "Comerciales: leads y confirmación de reuniones", y + 12);
  y = table(
    doc,
    ["Comercial", "Área", "Leads", "Reun. período", "Próximas", "Confirm.", "Pend.", "Rech.", "% confirm."],
    r.reps.map((p) => [p.name, p.area, String(p.leads), String(p.meetings_period), String(p.upcoming), String(p.confirmed), String(p.pending), String(p.declined), pct(p.confirmation_rate)]),
    [100, 78, 40, 62, 50, 48, 38, 38, CW - 454],
    y,
    "No hay comerciales activos.",
  );
  doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(7.5).text("Confirmación = el lead aceptó la invitación en Google Calendar. Se mide sobre las reuniones del período y las próximas.", M, y + 4, { width: CW });
  y += 20;
  y = ensure(doc, y, 110);
  y = sectionTitle(doc, r.agenda_label, y + 12);
  y = table(doc, ["Cuándo", "Lead", "Empresa", "Comercial", "Invitación"], r.agenda.map((t) => [t.when, t.lead, t.company ?? "—", t.rep ?? "—", t.rsvp]), [105, 120, 110, 100, CW - 435], y, "Sin reuniones agendadas en este rango.");
  y = ensure(doc, y, 110);
  y = sectionTitle(doc, "Atención y costos de datos", y + 12);
  bullets(
    doc,
    [
      `Por revisar (identidad): ${r.attention.needs_review} · Sin teléfono: ${r.attention.without_phone} · Llamadas trabadas: ${r.attention.stuck_calls} · Errores en el período: ${r.attention.errors}`,
      `SignalHire: ${r.costs.signalhire_credits ?? "—"} crédito(s) restantes · Apollo: ${r.costs.apollo_used ?? "—"}/${r.costs.apollo_limit ?? "—"} consultas hoy · Hunter: ${r.costs.hunter ? "activo" : "sin configurar"}`,
      ...r.attention.skipped.map((s) => `Omitidos por "${s.reason}": ${s.count}`),
    ],
    y,
  );

  footer(doc, r);
  doc.end();
  return done;
}

type Doc = PDFKit.PDFDocument;

function ensure(doc: Doc, y: number, need: number) {
  if (y + need > 790) {
    doc.addPage();
    return M;
  }
  return y;
}

function header(doc: Doc, r: Report) {
  doc.rect(0, 0, W, 96).fill(C.accent);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text("CAPRICORNE PROJECT · ANDICOM 2026", M, 26, { characterSpacing: 1 });
  doc.font("Helvetica-Bold").fontSize(20).text(`Reporte operativo ${r.period.title}`, M, 40);
  doc.font("Helvetica").fontSize(10.5).text(`${cap(r.period.label)} · generado el ${r.generated_label}`, M, 66);
  if (r.partial) {
    const label = "CORTE PARCIAL";
    doc.font("Helvetica-Bold").fontSize(8.5);
    const w = doc.widthOfString(label) + 16;
    doc.roundedRect(W - M - w, 30, w, 18, 9).fill("#ffffff");
    doc.fillColor(C.accent).text(label, W - M - w + 8, 35);
  }
}

function footer(doc: Doc, r: Report) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font("Helvetica").fontSize(8);
    const span = r.period.from === r.period.to ? r.period.from : `${r.period.from} a ${r.period.to}`;
    doc.text(`Capricorne Project · Reporte ${r.period.title} ${span} · Página ${i + 1} de ${range.count}`, M, 815, { width: CW, align: "center", lineBreak: false });
  }
}

function sectionTitle(doc: Doc, t: string, y: number, ai = false) {
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(12.5).text(t, M, y);
  if (ai) aiTag(doc, M + doc.widthOfString(t) + 8, y + 1);
  doc.moveTo(M, y + 18).lineTo(M + CW, y + 18).lineWidth(0.6).strokeColor(C.border).stroke();
  return y + 28;
}

// Etiqueta que marca todo lo redactado por la IA.
function aiTag(doc: Doc, x: number, y: number, label = "IA · CLAUDE") {
  doc.font("Helvetica-Bold").fontSize(7.5);
  const w = doc.widthOfString(label) + 14;
  doc.roundedRect(x, y, w, 14, 7).fill(C.accent);
  doc.fillColor("#ffffff").text(label, x, y + 3.5, { width: w, align: "center" });
  return w;
}

function summaryBox(doc: Doc, a: Analysis, source: string, ai: boolean, y: number) {
  const note = ai
    ? "Redactado por Claude (Anthropic) a partir de los datos del período. Es una recomendación: valídala antes de actuar."
    : "Resumen automático por reglas de operación (la IA no estuvo disponible en este envío).";
  doc.font("Helvetica").fontSize(10);
  const th = doc.heightOfString(a.summary, { width: CW - 32, lineGap: 1.5 });
  doc.fontSize(7.5);
  const nh = doc.heightOfString(note, { width: CW - 32 });
  const h = th + nh + 56;
  doc.roundedRect(M, y, CW, h, 10).fill(C.accentSoft);
  if (ai) doc.roundedRect(M, y, CW, h, 10).lineWidth(1.4).strokeColor(C.accent).stroke();
  doc.rect(M, y + 10, 4, h - 20).fill(C.accent);
  doc.fillColor(C.accent).font("Helvetica-Bold").fontSize(9).text(ai ? "ANÁLISIS CON INTELIGENCIA ARTIFICIAL" : "RESUMEN EJECUTIVO", M + 16, y + 14);
  if (ai) aiTag(doc, M + CW - 92, y + 11, source.toUpperCase().slice(0, 22));
  doc.fillColor(C.ink).font("Helvetica").fontSize(10).text(a.summary, M + 16, y + 32, { width: CW - 32, lineGap: 1.5 });
  doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(7.5).text(note, M + 16, y + 38 + th, { width: CW - 32 });
  return y + h;
}

function kpiGrid(doc: Doc, t: PeriodKpis, p: PeriodKpis, prevLabel: string, y: number) {
  const vs = prevLabel === "ayer" ? "vs. ayer" : "vs. período anterior";
  const items: [string, string, number | null][] = [
    ["Leads nuevos", String(t.new_leads), t.new_leads - p.new_leads],
    ["Llamadas", String(t.calls), t.calls - p.calls],
    ["Contestadas", String(t.answered), t.answered - p.answered],
    ["Reuniones agendadas", String(t.meetings), t.meetings - p.meetings],
    ["Tasa de contacto", pct(t.contact_rate), null],
    ["Tasa de aceptación", pct(t.acceptance_rate), null],
    ["Sin respuesta", String(t.missed), t.missed - p.missed],
    ["Minutos al teléfono", String(t.talk_minutes), null],
  ];
  const cols = 4;
  const gap = 10;
  const w = (CW - gap * (cols - 1)) / cols;
  const h = 62;
  items.forEach(([label, value, delta], i) => {
    const x = M + (i % cols) * (w + gap);
    const yy = y + Math.floor(i / cols) * (h + gap);
    doc.roundedRect(x, yy, w, h, 8).lineWidth(0.8).fillAndStroke(C.panel, C.border);
    doc.fillColor(C.muted).font("Helvetica").fontSize(8.5).text(label, x + 10, yy + 9, { width: w - 20 });
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(19).text(value, x + 10, yy + 23);
    if (delta !== null) {
      const up = delta > 0;
      const color = label === "Sin respuesta" ? (up ? C.err : C.ok) : up ? C.ok : delta < 0 ? C.err : C.muted;
      doc.fillColor(color).font("Helvetica").fontSize(8).text(`${delta > 0 ? "+" : ""}${delta} ${vs}`, x + 10, yy + 47);
    }
  });
  return y + 2 * h + gap;
}

function funnel(doc: Doc, r: Report, y: number) {
  const max = Math.max(1, ...r.funnel.map((f) => f.value));
  const labelW = 150;
  const barMax = CW - labelW - 110;
  const base = r.funnel[0]?.value ?? 0;
  r.funnel.forEach((f, i) => {
    const yy = y + i * 24;
    const w = Math.max(2, (f.value / max) * barMax);
    doc.fillColor(C.ink).font("Helvetica").fontSize(9.5).text(f.label, M, yy + 4, { width: labelW });
    doc.roundedRect(M + labelW, yy, w, 17, 4).fillOpacity(0.25 + 0.75 * (1 - i / r.funnel.length)).fill(C.accent).fillOpacity(1);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(9.5).text(String(f.value), M + labelW + w + 6, yy + 4);
    if (i > 0 && base) doc.fillColor(C.muted).font("Helvetica").fontSize(8).text(`${Math.round((f.value / base) * 100)}% de la base`, M + CW - 70, yy + 5, { width: 70, align: "right" });
  });
  return y + r.funnel.length * 24;
}

function timelineChart(doc: Doc, r: Report, y: number) {
  const h = 120;
  const peak = Math.max(1, ...r.timeline.map((b) => b.answered + b.missed + b.failed));
  const step = Math.max(1, Math.ceil(peak / 4));
  const ticks = Math.ceil(peak / step);
  const max = step * ticks;
  const n = r.timeline.length;
  const slot = CW / n;
  const bw = Math.min(28, slot * 0.6);
  doc.moveTo(M, y + h).lineTo(M + CW, y + h).lineWidth(0.6).strokeColor(C.border).stroke();
  for (let g = 1; g <= ticks; g++) {
    const gy = y + h - (h * g) / ticks;
    doc.moveTo(M, gy).lineTo(M + CW, gy).lineWidth(0.3).strokeColor(C.border).dash(2, { space: 3 }).stroke().undash();
    doc.fillColor(C.muted).font("Helvetica").fontSize(7).text(String(step * g), M - 18, gy - 4, { width: 14, align: "right" });
  }
  const showEvery = n > 16 ? 2 : 1;
  r.timeline.forEach((b, i) => {
    const x = M + i * slot + (slot - bw) / 2;
    let top = y + h;
    for (const [v, color] of [
      [b.answered, C.ok],
      [b.missed, C.warn],
      [b.failed, C.err],
    ] as [number, string][]) {
      if (!v) continue;
      const bh = (v / max) * h;
      top -= bh;
      doc.rect(x, top, bw, bh).fill(color);
    }
    if (i % showEvery === 0) doc.fillColor(C.muted).font("Helvetica").fontSize(6.5).text(b.label, M + i * slot - 6, y + h + 4, { width: slot * showEvery + 12, align: "center" });
  });
  legend(doc, y + h + 18, [
    ["Contestadas", C.ok],
    ["Sin respuesta", C.warn],
    ["Fallidas", C.err],
  ]);
  return y + h + 34;
}

function legend(doc: Doc, y: number, items: [string, string][]) {
  let x = M;
  for (const [label, color] of items) {
    doc.rect(x, y + 1, 8, 8).fill(color);
    doc.fillColor(C.muted).font("Helvetica").fontSize(8).text(label, x + 12, y);
    x += doc.widthOfString(label) + 30;
  }
}

function outcomes(doc: Doc, t: PeriodKpis, y: number) {
  const parts: [string, number, string][] = [
    ["Reunión agendada", t.meetings, C.accent],
    ["Contestó sin agendar", Math.max(0, t.answered - t.meetings), C.ok],
    ["Sin respuesta", t.missed, C.warn],
    ["Fallida", t.failed, C.err],
  ];
  const total = parts.reduce((s, p) => s + p[1], 0);
  if (!total) {
    doc.fillColor(C.muted).font("Helvetica").fontSize(9.5).text("Sin llamadas terminadas en el período.", M, y);
    return y + 16;
  }
  let x = M;
  for (const [, v, color] of parts) {
    if (!v) continue;
    const w = (v / total) * CW;
    doc.rect(x, y, w, 20).fill(color);
    x += w;
  }
  legend(
    doc,
    y + 28,
    parts.map(([l, v, c]) => [`${l}: ${v} (${Math.round((v / total) * 100)}%)`, c]),
  );
  return y + 44;
}

function hbars(doc: Doc, rows: { label: string; value: number }[], y: number, color: string) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 130;
  rows.forEach((row, i) => {
    const yy = y + i * 19;
    const w = Math.max(2, (row.value / max) * (CW - labelW - 40));
    doc.fillColor(C.ink).font("Helvetica").fontSize(9).text(row.label, M, yy + 2, { width: labelW });
    doc.roundedRect(M + labelW, yy, w, 13, 3).fill(color);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(9).text(String(row.value), M + labelW + w + 6, yy + 2);
  });
  return y + rows.length * 19;
}

function slaBar(doc: Doc, r: Report, y: number) {
  const s = r.sla;
  const total = s.met + s.breached + s.pending;
  if (!total) {
    doc.fillColor(C.muted).font("Helvetica").fontSize(9.5).text("Aún no hay leads para medir el SLA.", M, y);
    return y + 16;
  }
  let x = M;
  for (const [v, color] of [
    [s.met, C.ok],
    [s.pending, C.accent],
    [s.breached, C.err],
  ] as [number, string][]) {
    if (!v) continue;
    const w = (v / total) * CW;
    doc.rect(x, y, w, 16).fill(color);
    x += w;
  }
  legend(doc, y + 24, [
    [`A tiempo: ${s.met}`, C.ok],
    [`En plazo: ${s.pending}`, C.accent],
    [`Vencido: ${s.breached}`, C.err],
  ]);
  doc
    .fillColor(C.ink)
    .font("Helvetica")
    .fontSize(9.5)
    .text(`Cumplimiento: ${pct(s.compliance)} · Tiempo promedio al primer intento: ${s.avg_minutes === null ? "—" : `${s.avg_minutes} min`}`, M, y + 42);
  return y + 58;
}

const SLA_TEXT: [string, string][] = [
  ["Qué mide", "Que cada lead con consentimiento reciba su primer intento de llamada dentro de las 24 horas siguientes a su carga en Capricorne (formulario QR, importación o registro manual)."],
  ["Estados", "A tiempo: el primer intento ocurrió antes de 24 h. Vencido: ocurrió después, o pasaron 24 h sin intento. En plazo: aún no se llama pero quedan horas. No aplica: sin consentimiento u omitido antes de llamar (sin perfil o sin celular)."],
  ["Cumplimiento", "A tiempo ÷ (A tiempo + Vencido). Los leads en plazo no cuentan hasta que se resuelven."],
  ["Efectividad", "Tasa de contacto = llamadas contestadas ÷ llamadas terminadas. Tasa de aceptación = reuniones agendadas ÷ llamadas contestadas. Confirmación = reuniones aceptadas por el lead en Google Calendar."],
];

// Cómo calcula Capricorne el SLA y la efectividad de las llamadas.
function slaExplainer(doc: Doc, y: number) {
  const inner = CW - 28;
  doc.font("Helvetica").fontSize(8.5);
  const hs = SLA_TEXT.map(([, v]) => doc.heightOfString(v, { width: inner - 80 }));
  const h = 30 + hs.reduce((a, b) => a + b + 5, 0);
  y = ensure(doc, y, h);
  doc.roundedRect(M, y, CW, h, 8).lineWidth(0.8).fillAndStroke(C.panel, C.border);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(9.5).text("Cómo mide Capricorne el SLA y la efectividad", M + 14, y + 10);
  let yy = y + 27;
  SLA_TEXT.forEach(([k, v], i) => {
    doc.fillColor(C.accent).font("Helvetica-Bold").fontSize(8).text(k.toUpperCase(), M + 14, yy + 1, { width: 76 });
    doc.fillColor(C.ink).font("Helvetica").fontSize(8.5).text(v, M + 94, yy, { width: inner - 80 });
    yy += hs[i] + 5;
  });
  return y + h;
}

function decisions(doc: Doc, a: Analysis, y: number) {
  if (!a.decisions.length) {
    doc.fillColor(C.muted).font("Helvetica").fontSize(9.5).text("Sin acciones pendientes: la operación está al día.", M, y);
    return y + 18;
  }
  for (const d of a.decisions) {
    const prio = (["alta", "media", "baja"].includes(d.priority) ? d.priority : "media") as keyof typeof PRIO;
    doc.font("Helvetica-Bold").fontSize(10);
    const ah = doc.heightOfString(d.action, { width: CW - 90 });
    doc.font("Helvetica").fontSize(9);
    const rh = doc.heightOfString(d.reason ?? "", { width: CW - 90 });
    const h = ah + rh + 18;
    y = ensure(doc, y, h + 8);
    doc.roundedRect(M, y, CW, h, 8).lineWidth(0.8).strokeColor(C.border).stroke();
    doc.rect(M, y, 4, h).fill(PRIO[prio]);
    doc.roundedRect(M + 12, y + 9, 50, 15, 7).fill(PRIO[prio]);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(prio.toUpperCase(), M + 12, y + 13, { width: 50, align: "center" });
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text(d.action, M + 74, y + 9, { width: CW - 90 });
    doc.fillColor(C.muted).font("Helvetica").fontSize(9).text(d.reason ?? "", M + 74, y + 11 + ah, { width: CW - 90 });
    y += h + 8;
  }
  return y;
}

function leadCards(doc: Doc, list: LeadAdvice[], y: number) {
  const inner = CW - 28;
  for (const p of list) {
    const rows: [string, string][] = [
      ["Ofrecer", p.offer],
      ["Cómo abrir", p.pitch],
      ["Siguiente paso", p.next_step],
    ];
    doc.font("Helvetica").fontSize(9);
    const hs = rows.map(([, v]) => doc.heightOfString(v ?? "", { width: inner - 90 }));
    const h = 30 + hs.reduce((a, b) => a + b + 5, 0);
    y = ensure(doc, y, h + 8);
    doc.roundedRect(M, y, CW, h, 8).lineWidth(0.9).fillAndStroke("#fbfaff", C.accent);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10.5).text(p.name, M + 14, y + 10, { continued: !!p.company });
    if (p.company) doc.fillColor(C.muted).font("Helvetica").fontSize(9.5).text(`  ·  ${p.company}`);
    let yy = y + 28;
    rows.forEach(([k, v], i) => {
      doc.fillColor(C.accent).font("Helvetica-Bold").fontSize(8.5).text(k.toUpperCase(), M + 14, yy + 1, { width: 86 });
      doc.fillColor(C.ink).font("Helvetica").fontSize(9).text(v ?? "", M + 104, yy, { width: inner - 90 });
      yy += hs[i] + 5;
    });
    y += h + 8;
  }
  return y;
}

function bullets(doc: Doc, items: string[], y: number) {
  for (const it of items) {
    doc.font("Helvetica").fontSize(9.5);
    const h = doc.heightOfString(it, { width: CW - 14 });
    y = ensure(doc, y, h + 4);
    doc.circle(M + 3, y + 5, 2).fill(C.accent);
    doc.fillColor(C.ink).text(it, M + 12, y, { width: CW - 14 });
    y += h + 5;
  }
  return y;
}

function table(doc: Doc, head: string[], rows: string[][], widths: number[], y: number, empty: string) {
  if (!rows.length) {
    doc.fillColor(C.muted).font("Helvetica").fontSize(9.5).text(empty, M, y);
    return y + 18;
  }
  const rowH = 20;
  doc.rect(M, y, CW, rowH).fill(C.panel);
  let x = M;
  head.forEach((h, i) => {
    doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(8).text(h, x + 5, y + 6, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
    x += widths[i];
  });
  y += rowH;
  for (const row of rows) {
    y = ensure(doc, y, rowH);
    x = M;
    row.forEach((cell, i) => {
      doc.fillColor(C.ink).font("Helvetica").fontSize(8.5).text(cell, x + 5, y + 6, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.moveTo(M, y + rowH).lineTo(M + CW, y + rowH).lineWidth(0.4).strokeColor(C.border).stroke();
    y += rowH;
  }
  return y;
}
