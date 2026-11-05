"use client";

import type { Workbook, Worksheet } from "exceljs";
import type { Stats } from "@/lib/stats";
import { provenanceRows } from "@/lib/provenance";
import type { CallRow, Contact, EmailRow, Meeting, SalesRep } from "@/lib/types";

// exceljs pesa ~1 MB: se carga solo al exportar/importar.
async function excel() {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") } & typeof import("exceljs");
  return mod.default ?? mod;
}

const INK = "FF161616";
const RED = "FFE2231A";
const LINE = "FFE6E6E6";
const tz = { timeZone: "America/Bogota" } as const;
const fmtDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-CO", { ...tz, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "";

function header(ws: Worksheet, columns: { header: string; key: string; width: number }[]) {
  ws.columns = columns;
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { vertical: "middle" };
    c.border = { bottom: { style: "medium", color: { argb: RED } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

function body(ws: Worksheet) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = { name: "Arial", size: 10 };
      c.border = { bottom: { style: "thin", color: { argb: LINE } } };
    });
  });
}

async function save(wb: Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Rasteriza una gráfica SVG en tema claro (el Excel siempre es fondo blanco).
async function svgToPng(svg: SVGSVGElement): Promise<{ base64: string; width: number; height: number }> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const width = vb?.width || svg.clientWidth;
  const height = vb?.height || svg.clientHeight;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.querySelectorAll("text").forEach((t) => {
    if (!t.getAttribute("fill")) t.setAttribute("fill", t.classList.contains("axis-strong") ? "#202124" : "#5f6368");
    t.setAttribute("font-family", "Arial, Helvetica, sans-serif");
  });
  clone.querySelectorAll("tspan").forEach((t) => t.setAttribute("fill", "#5f6368"));
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("No se pudo rasterizar la gráfica"));
    img.src = src;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return { base64: canvas.toDataURL("image/png"), width, height };
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export async function exportSlaReport(stats: Stats, calls: CallRow[], contacts: Contact[]) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Attack POC";
  wb.created = new Date();

  // Resumen con indicadores y gráficas
  const ws = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 62 }];
  ws.mergeCells("A1:C1");
  const t = ws.getCell("A1");
  t.value = "Reporte de desempeño · Bot de prospección ANDICOM";
  t.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" }, name: "Arial" };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells("A2:C2");
  const sub = ws.getCell("A2");
  sub.value = `SLA ${stats.windowHours} h · generado ${fmtDateTime(stats.generatedAt)} (hora Colombia)`;
  sub.font = { color: { argb: "FF5F6368" }, name: "Arial", size: 10 };
  sub.border = { top: { style: "medium", color: { argb: RED } } };

  const s = stats.sla;
  const kpis: [string, string | number, string][] = [
    ["Llamadas (24 h)", stats.calls, `${stats.answered} contestadas · ${stats.missed} perdidas · ${stats.failed} fallidas`],
    ["Ritmo de llamadas", `${stats.callsPerMinuteLastHour} /min`, `Última hora · pico ${stats.peakPerMinute} llamadas/min`],
    ["Tasa de contacto", pct(stats.contactRate), "Contestadas sobre llamadas terminadas"],
    ["Aceptación de citas", pct(stats.acceptanceRate), `${stats.meetings} reuniones de ${stats.answered} contestadas`],
    ["Cumplimiento SLA", pct(s.compliance), `${s.met} a tiempo · ${s.breached} vencidos · ${s.pendingInSla} en plazo`],
    ["Minutos al teléfono", stats.talkMinutes, `Duración promedio ${stats.avgDurationSec} s`],
    ["Tiempo promedio a 1.ª llamada", s.avgMinutesToFirstCall === null ? "—" : `${s.avgMinutesToFirstCall} min`, `Meta: antes de ${stats.windowHours} h desde la carga`],
  ];
  const hr = ws.getRow(4);
  hr.values = ["Indicador", "Valor", "Detalle"];
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  });
  kpis.forEach((k, i) => {
    const r = ws.getRow(5 + i);
    r.values = k;
    r.getCell(1).font = { bold: true, name: "Arial", size: 10 };
    r.getCell(2).font = { bold: true, name: "Arial", size: 12, color: { argb: RED } };
    r.getCell(2).alignment = { horizontal: "left" };
    r.getCell(3).font = { name: "Arial", size: 10, color: { argb: "FF5F6368" } };
    r.eachCell((c) => (c.border = { bottom: { style: "thin", color: { argb: LINE } } }));
  });

  let rowCursor = 5 + kpis.length + 2;
  const charts = [...document.querySelectorAll<HTMLElement>("[data-chart]")];
  for (const fig of charts) {
    const svg = fig.querySelector("svg");
    if (!svg) continue;
    const title = fig.querySelector("figcaption")?.textContent ?? "";
    const tc = ws.getCell(`A${rowCursor}`);
    tc.value = title;
    tc.font = { bold: true, size: 12, name: "Arial" };
    rowCursor += 1;
    const png = await svgToPng(svg);
    const w = 760;
    const h = Math.round((png.height / png.width) * w);
    const id = wb.addImage({ base64: png.base64, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: rowCursor - 1 }, ext: { width: w, height: h } });
    rowCursor += Math.ceil(h / 20) + 2;
  }

  // Datos
  const wh = wb.addWorksheet("Llamadas por hora");
  header(wh, [
    { header: "Hora", key: "hour", width: 12 },
    { header: "Contestadas", key: "answered", width: 14 },
    { header: "Perdidas", key: "missed", width: 12 },
    { header: "Fallidas", key: "failed", width: 12 },
    { header: "Total", key: "total", width: 10 },
  ]);
  stats.hourly.forEach((b) => wh.addRow(b));
  body(wh);

  const wf = wb.addWorksheet("Embudo");
  header(wf, [
    { header: "Etapa", key: "label", width: 30 },
    { header: "Contactos", key: "value", width: 12 },
    { header: "% del paso anterior", key: "prev", width: 20 },
    { header: "% del total", key: "total", width: 14 },
  ]);
  stats.funnel.forEach((f, i) => {
    const prev = i ? stats.funnel[i - 1].value : null;
    const first = stats.funnel[0].value || 1;
    wf.addRow({ label: f.label, value: f.value, prev: prev ? f.value / prev : null, total: f.value / first });
  });
  wf.getColumn("prev").numFmt = "0%";
  wf.getColumn("total").numFmt = "0%";
  body(wf);

  const wsla = wb.addWorksheet("Detalle SLA");
  header(wsla, [
    { header: "Contacto", key: "name", width: 26 },
    { header: "Empresa", key: "company", width: 24 },
    { header: "Cargado", key: "loaded", width: 18 },
    { header: "Primer intento", key: "first", width: 18 },
    { header: "Minutos a 1.ª llamada", key: "mins", width: 20 },
    { header: "SLA", key: "sla", width: 12 },
    { header: "Intentos", key: "attempts", width: 10 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Nota", key: "note", width: 34 },
  ]);
  stats.slaRows.forEach((r) => {
    const row = wsla.addRow({
      name: r.name,
      company: r.company,
      loaded: fmtDateTime(r.loadedAt),
      first: fmtDateTime(r.firstCallAt),
      mins: r.minutesToFirstCall,
      sla: r.sla,
      attempts: r.attempts,
      status: r.status,
      note: r.note,
    });
    const color = { "A tiempo": "FFE5F6EC", Vencido: "FFFDE7E5", "En plazo": "FFFFF3DC", "No aplica": "FFF1F3F4" }[r.sla];
    row.getCell("sla").fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  });
  body(wsla);

  const wc = wb.addWorksheet("Llamadas");
  header(wc, [
    { header: "Contacto", key: "name", width: 26 },
    { header: "Inicio", key: "start", width: 18 },
    { header: "Resultado", key: "status", width: 14 },
    { header: "Duración (s)", key: "dur", width: 12 },
    { header: "Motivo de fin", key: "reason", width: 26 },
    { header: "Proveedor", key: "provider", width: 12 },
  ]);
  const label = { in_progress: "En curso", answered: "Contestada", missed: "Perdida", failed: "Fallida" };
  const since = Date.now() - stats.windowHours * 3600_000;
  calls
    .filter((c) => Date.parse(c.started_at) >= since)
    .forEach((c) => {
      const ct = contacts.find((x) => x.id === c.contact_id);
      wc.addRow({
        name: ct ? `${ct.first_name} ${ct.last_name}` : c.contact_id,
        start: fmtDateTime(c.started_at),
        status: label[c.status],
        dur: c.duration_sec,
        reason: c.ended_reason,
        provider: c.provider,
      });
    });
  body(wc);

  await save(wb, `reporte-sla-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------- Base de clientes

const TEMPLATE_COLUMNS = [
  { header: "nombre", key: "first_name", width: 16 },
  { header: "apellidos", key: "last_name", width: 20 },
  { header: "empresa", key: "company", width: 24 },
  { header: "cargo", key: "title", width: 24 },
  { header: "ciudad", key: "city", width: 14 },
  { header: "email", key: "email", width: 28 },
  { header: "consentimiento", key: "consent", width: 15 },
  { header: "stand", key: "event_notes", width: 40 },
];

export async function downloadTemplate() {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contactos");
  header(ws, TEMPLATE_COLUMNS);
  ws.addRow({
    first_name: "Mariana",
    last_name: "Quintero Salazar",
    company: "Agro Sabana",
    title: "Gerente General",
    city: "Bogotá",
    email: "",
    consent: "si",
    event_notes: "los portátiles para equipos en campo",
  });
  body(ws);
  await save(wb, "plantilla-contactos.xlsx");
}

export async function exportContacts(d: { contacts: Contact[]; meetings: Meeting[]; reps: SalesRep[]; emails: EmailRow[] }) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Base de clientes");
  header(ws, [
    ...TEMPLATE_COLUMNS,
    { header: "estado", key: "status", width: 18 },
    { header: "motivo", key: "skip", width: 30 },
    { header: "linkedin", key: "linkedin", width: 40 },
    { header: "celular", key: "phone", width: 16 },
    { header: "reunión", key: "meeting", width: 18 },
    { header: "comercial", key: "rep", width: 20 },
    { header: "meet", key: "meet", width: 34 },
    { header: "correo confirmación", key: "mail", width: 20 },
    { header: "área de interés", key: "area", width: 16 },
    { header: "proyecto", key: "project", width: 40 },
    { header: "etapa", key: "stage", width: 18 },
    { header: "resumen llamada", key: "summary", width: 60 },
    { header: "cargado", key: "created", width: 18 },
  ]);
  for (const c of d.contacts) {
    const m = d.meetings.find((x) => x.contact_id === c.id);
    const rep = m ? d.reps.find((r) => r.id === m.sales_rep_id) : undefined;
    const mail = d.emails.find((e) => e.contact_id === c.id && e.kind === "confirmacion");
    ws.addRow({
      first_name: c.first_name,
      last_name: c.last_name,
      company: c.company,
      title: c.title,
      city: c.city,
      email: c.email,
      consent: c.consent ? "si" : "no",
      event_notes: c.event_notes,
      status: c.status,
      skip: c.skip_reason,
      linkedin: c.linkedin_url,
      phone: c.phone,
      meeting: m ? fmtDateTime(m.starts_at) : "",
      rep: rep?.name ?? "",
      meet: m?.meet_url && !m.meet_url.includes("(sandbox)") ? m.meet_url : "",
      mail: mail ? (mail.status === "sent" ? "enviado" : "falló") : "",
      area: c.qualification?.area_interes,
      project: c.qualification?.proyecto,
      stage: c.qualification?.etapa,
      summary: c.call_summary,
      created: fmtDateTime(c.created_at),
    });
  }
  body(ws);

  // Procedencia de cada dato, para auditoría
  const wp = wb.addWorksheet("Origen de los datos");
  header(wp, [
    { header: "Contacto", key: "contact", width: 26 },
    { header: "Campo", key: "field", width: 26 },
    { header: "Valor", key: "value", width: 40 },
    { header: "Fuente", key: "source", width: 34 },
    { header: "Detalle", key: "detail", width: 30 },
    { header: "Enlace de respaldo", key: "url", width: 40 },
    { header: "Fecha", key: "at", width: 18 },
  ]);
  for (const c of d.contacts) {
    for (const r of provenanceRows(c)) {
      wp.addRow({ contact: `${c.first_name} ${c.last_name}`, field: r.field, value: r.value, source: r.source, detail: r.detail ?? "", url: r.url ?? "", at: fmtDateTime(r.at ?? null) });
    }
  }
  body(wp);
  await save(wb, `base-clientes-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Convierte la primera hoja de un .xlsx a CSV para reutilizar el importador del servidor.
export async function xlsxToCsv(file: File): Promise<string> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene hojas");
  const lines: string[] = [];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v && "text" in v) v = (v as { text: string }).text;
    if (typeof v === "object" && v && "result" in v) v = (v as { result: unknown }).result;
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as unknown[]).slice(1);
    lines.push(vals.map(cell).join(","));
  });
  return lines.join("\n");
}
