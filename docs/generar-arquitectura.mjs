// Genera docs/Arquitectura-Capricorne.pdf: flujogramas, servicios, conexiones y base de datos.
// Uso: node docs/generar-arquitectura.mjs
import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";

const OUT = "docs/Arquitectura-Capricorne.pdf";
const W = 841.89;
const H = 595.28;
const M = 30;

const C = {
  accent: "#5b4bdb",
  accentSoft: "#eeecfd",
  ink: "#141826",
  muted: "#5f667d",
  border: "#d9dce7",
  panel: "#f6f7fb",
  state: "#e8f5ee",
  stateLine: "#1f9d5c",
  decision: "#fff4dc",
  decisionLine: "#d98a0b",
  ext: "#e9f1ff",
  extLine: "#2f6fd6",
  db: "#f3e8ff",
  dbLine: "#7c3aed",
  danger: "#fdecec",
  dangerLine: "#d64545",
};

const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M, bufferPages: true, info: { Title: "Capricorne Project · Arquitectura", Author: "Capricorne Project" } });
doc.pipe(createWriteStream(OUT));

// ------------------------------------------------------------------ primitivas

function header(title, subtitle) {
  doc.rect(0, 0, W, 54).fill(C.accent);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8).text("CAPRICORNE PROJECT · ARQUITECTURA", M, 12, { characterSpacing: 1 });
  doc.font("Helvetica-Bold").fontSize(16).text(title, M, 24);
  if (subtitle) doc.font("Helvetica").fontSize(8.5).text(subtitle, M + 330, 30, { width: W - M * 2 - 330, align: "right" });
}

function box(x, y, w, h, title, sub, s = {}) {
  const fill = s.fill ?? "#fff";
  const line = s.line ?? C.border;
  doc.roundedRect(x, y, w, h, s.r ?? 7).lineWidth(s.lw ?? 1).fillAndStroke(fill, line);
  if (s.dash) doc.undash();
  const tw = w - 12;
  doc.font("Helvetica-Bold").fontSize(s.size ?? 8.5);
  const th = doc.heightOfString(title, { width: tw, align: "center" });
  let sh = 0;
  if (sub) {
    doc.font("Helvetica").fontSize((s.size ?? 8.5) - 1.5);
    sh = doc.heightOfString(sub, { width: tw, align: "center" }) + 2;
  }
  const top = y + Math.max(4, (h - th - sh) / 2);
  doc.fillColor(s.color ?? C.ink).font("Helvetica-Bold").fontSize(s.size ?? 8.5).text(title, x + 6, top, { width: tw, align: "center" });
  if (sub) doc.fillColor(C.muted).font("Helvetica").fontSize((s.size ?? 8.5) - 1.5).text(sub, x + 6, top + th + 2, { width: tw, align: "center" });
}

const state = (x, y, w, h, t, sub) => box(x, y, w, h, t, sub, { fill: C.state, line: C.stateLine, r: 14 });
const proc = (x, y, w, h, t, sub) => box(x, y, w, h, t, sub, { fill: "#fff", line: C.accent, lw: 1.2 });
const ext = (x, y, w, h, t, sub) => box(x, y, w, h, t, sub, { fill: C.ext, line: C.extLine });
const bad = (x, y, w, h, t, sub) => box(x, y, w, h, t, sub, { fill: C.danger, line: C.dangerLine, r: 14 });

function diamond(cx, cy, w, h, text) {
  doc.polygon([cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]).lineWidth(1.2).fillAndStroke(C.decision, C.decisionLine);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(7.8);
  const th = doc.heightOfString(text, { width: w * 0.62, align: "center" });
  doc.text(text, cx - w * 0.31, cy - th / 2, { width: w * 0.62, align: "center" });
}

// Flecha por varios puntos; la punta va en el último.
function arrow(pts, label, s = {}) {
  const color = s.color ?? C.muted;
  doc.lineWidth(s.lw ?? 1).strokeColor(color);
  if (s.dash) doc.dash(3, { space: 2 });
  doc.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) doc.lineTo(p[0], p[1]);
  doc.stroke().undash();
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const L = 6;
  doc.polygon(b, [b[0] - L * Math.cos(ang - 0.4), b[1] - L * Math.sin(ang - 0.4)], [b[0] - L * Math.cos(ang + 0.4), b[1] - L * Math.sin(ang + 0.4)]).fill(color);
  if (label) {
    const i = s.at ?? Math.floor((pts.length - 1) / 2);
    const [p, q] = [pts[i], pts[i + 1]];
    const mx = (p[0] + q[0]) / 2 + (s.dx ?? 0);
    const my = (p[1] + q[1]) / 2 + (s.dy ?? 0);
    doc.font("Helvetica").fontSize(6.8);
    const lw = doc.widthOfString(label) + 6;
    doc.rect(mx - lw / 2, my - 5, lw, 10).fill("#fff");
    doc.fillColor(s.lcolor ?? C.muted).text(label, mx - lw / 2 + 3, my - 3.6, { lineBreak: false });
  }
}

function group(x, y, w, h, title, color) {
  doc.roundedRect(x, y, w, h, 9).lineWidth(0.8).dash(4, { space: 3 }).strokeColor(color).stroke().undash();
  doc.font("Helvetica-Bold").fontSize(7.5);
  const tw = doc.widthOfString(title) + 10;
  doc.rect(x + 10, y - 5, tw, 10).fill("#fff");
  doc.fillColor(color).text(title, x + 15, y - 3.5, { lineBreak: false });
}

function legend(x, y, items) {
  let cx = x;
  for (const [label, fill, line] of items) {
    doc.roundedRect(cx, y, 12, 9, 2).lineWidth(0.8).fillAndStroke(fill, line);
    doc.fillColor(C.muted).font("Helvetica").fontSize(7.5).text(label, cx + 16, y + 1, { lineBreak: false });
    cx += doc.widthOfString(label) + 34;
  }
}

function table(x, y, widths, head, rows, s = {}) {
  const fs = s.size ?? 7.6;
  const pad = 4;
  doc.font("Helvetica-Bold").fontSize(fs);
  const hh = Math.max(...head.map((h, i) => doc.heightOfString(h, { width: widths[i] - pad * 2 }))) + 8;
  let cx = x;
  doc.rect(x, y, widths.reduce((a, b) => a + b, 0), hh).fill(s.headFill ?? C.accent);
  head.forEach((h, i) => {
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fs).text(h, cx + pad, y + 4, { width: widths[i] - pad * 2 });
    cx += widths[i];
  });
  y += hh;
  rows.forEach((row, r) => {
    doc.font("Helvetica").fontSize(fs);
    const rh = Math.max(...row.map((c, i) => doc.heightOfString(String(c), { width: widths[i] - pad * 2 }))) + 7;
    if (y + rh > H - 26) {
      doc.addPage();
      y = 70;
    }
    if (r % 2) doc.rect(x, y, widths.reduce((a, b) => a + b, 0), rh).fill(C.panel);
    cx = x;
    row.forEach((c, i) => {
      doc.fillColor(i === 0 ? C.ink : C.muted).font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(fs).text(String(c), cx + pad, y + 3.5, { width: widths[i] - pad * 2 });
      cx += widths[i];
    });
    doc.moveTo(x, y + rh).lineTo(x + widths.reduce((a, b) => a + b, 0), y + rh).lineWidth(0.4).strokeColor(C.border).stroke();
    y += rh;
  });
  return y;
}

// Tabla de base de datos (estilo diagrama entidad-relación).
function entity(x, y, w, name, note, cols) {
  const rh = 10.4;
  const hh = 26;
  const h = hh + cols.length * rh + 4;
  doc.roundedRect(x, y, w, h, 6).lineWidth(1).fillAndStroke("#fff", C.dbLine);
  doc.roundedRect(x, y, w, hh, 6).fill(C.dbLine);
  doc.rect(x, y + hh - 6, w, 6).fill(C.dbLine);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5).text(name, x + 7, y + 4);
  doc.font("Helvetica").fontSize(6.4).text(note, x + 7, y + 15, { width: w - 14, lineBreak: false, ellipsis: true });
  cols.forEach(([col, type, tag], i) => {
    const cy = y + hh + 2 + i * rh;
    if (i % 2) doc.rect(x + 1, cy, w - 2, rh).fill(C.panel);
    doc.fillColor(tag === "PK" ? C.accent : tag === "FK" ? C.extLine : C.ink).font(tag ? "Helvetica-Bold" : "Helvetica").fontSize(6.8).text(col, x + 7, cy + 2, { lineBreak: false });
    doc.fillColor(C.muted).font("Helvetica").fontSize(6.3).text(`${type}${tag ? `  ${tag}` : ""}`, x + w * 0.55, cy + 2.3, { width: w * 0.43, height: 9, lineBreak: false, ellipsis: true });
  });
  return { x, y, w, h, row: (i) => y + hh + 2 + i * rh + rh / 2 };
}

function footer() {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font("Helvetica").fontSize(7).text(`Capricorne Project · Arquitectura del sistema · ${new Date().toISOString().slice(0, 10)} · Página ${i + 1} de ${r.count}`, M, H - 18, { width: W - M * 2, align: "center", lineBreak: false });
  }
}

// ------------------------------------------------------------------ 1. portada y resumen

doc.rect(0, 0, W, H).fill(C.accent);
doc.fillColor("#fff").font("Helvetica-Bold").fontSize(11).text("CAPRICORNE PROJECT", M + 20, 120, { characterSpacing: 2 });
doc.font("Helvetica-Bold").fontSize(34).text("Arquitectura del sistema", M + 20, 140);
doc.font("Helvetica").fontSize(13).text("Bot de seguimiento de leads de ANDICOM 2026 para Lenovo: identifica a cada lead, consigue su celular,\nlo llama con un agente de voz, agenda la reunión y reporta la operación.", M + 20, 188, { width: 620, lineGap: 3 });
const summary = [
  ["Aplicación", "Next.js 16 (App Router) + React 19 + TypeScript en Vercel"],
  ["Base de datos", "Supabase (PostgreSQL con RLS), 8 tablas"],
  ["Servicios externos", "Serper, SignalHire, Apollo, Hunter, Claude, Vapi, Twilio, ElevenLabs/Azure, Google Calendar, Gmail, n8n"],
  ["Producción", "https://attack-poc-bot.vercel.app · repositorio privado Kyo6996/attack-poc-bot"],
];
let sy = 270;
for (const [k, v] of summary) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#cfc8ff").text(k.toUpperCase(), M + 20, sy, { width: 150 });
  doc.font("Helvetica").fontSize(11).fillColor("#fff").text(v, M + 175, sy - 1, { width: 560 });
  sy += 30;
}
doc.font("Helvetica-Bold").fontSize(10).fillColor("#cfc8ff").text("CONTENIDO", M + 20, 410);
doc
  .font("Helvetica")
  .fontSize(10.5)
  .fillColor("#fff")
  .text(
    "1. Arquitectura general y conexiones   ·   2. Flujograma del lead (de la base a la reunión)   ·   3. Llamada, webhooks y procesos asíncronos\n4. Reporte operativo con n8n y Claude   ·   5. Modelo de datos   ·   6. Campos JSON y configuración\n7. APIs externas   ·   8. Rutas internas, pantallas y seguridad",
    M + 20,
    428,
    { width: 760, lineGap: 4 },
  );

// ------------------------------------------------------------------ 2. arquitectura general

doc.addPage();
header("1 · Arquitectura general y conexiones", "Quién habla con quién. Las flechas indican quién inicia la conexión.");

// Personas
box(M, 92, 150, 50, "Equipo comercial", "Panel web con usuario y clave", { fill: C.accentSoft, line: C.accent });
box(M, 165, 150, 50, "Lead", "Formulario QR, enlace para agendar, llamada y correos", { fill: C.accentSoft, line: C.accent });
box(M, 238, 150, 50, "Comerciales Lenovo", "Reciben la invitación y el resumen del lead", { fill: C.accentSoft, line: C.accent });
box(M, 311, 150, 50, "Gerencia / destinatarios", "Reciben el reporte PDF por correo", { fill: C.accentSoft, line: C.accent });

// Vercel
group(210, 80, 330, 420, "VERCEL · NEXT.JS 16 (CAPRICORNE)", C.accent);
proc(225, 98, 300, 34, "Proxy de sesión", "Login con cookie firmada (HMAC) · rutas públicas: QR, agendar, webhooks");
proc(225, 142, 145, 50, "Panel web (React 19)", "Leads, agenda, bitácora, SLA, reporte, voces, integraciones");
proc(380, 142, 145, 50, "Páginas públicas", "/registro (QR) · /agendar/[token]");
proc(225, 202, 300, 34, "API interna /api/*", "Leads, importación, comerciales, ajustes, correos, estado");
proc(225, 246, 300, 58, "Pipeline por lead", "identificar › enriquecer › llamar › agendar\nbloqueo optimista (locked_until) y trabajos en segundo plano con after()");
proc(225, 314, 145, 54, "Webhooks", "/api/webhooks/vapi\n/signalhire · /apollo\n(firmados con WEBHOOK_SECRET)");
proc(380, 314, 145, 54, "Reporte /api/report/*", "datos, PDF (pdfkit), envío, calendario\n(n8n entra con x-report-key)");
proc(225, 378, 300, 34, "Correo y agenda", "Plantillas HTML + invitación .ics · Google Calendar con Meet");
box(225, 424, 300, 62, "Supabase · PostgreSQL", "contacts · calls · meetings · emails · events · sales_reps · app_settings · sandbox_profiles\nAcceso solo desde el servidor (clave secreta); RLS activo", { fill: C.db, line: C.dbLine });

arrow([[180, 117], [225, 117]], "HTTPS");
arrow([[180, 197], [452, 197], [452, 192]], null);
arrow([[225, 388], [206, 388], [206, 263], [180, 263]], "invitación y resumen", { dash: true, at: 2, dy: -8 });
arrow([[225, 404], [194, 404], [194, 336], [180, 336]], "PDF por correo", { dash: true, at: 2, dy: 10 });

// Servicios externos
const ex = 590;
const ew = 222;
group(ex - 8, 80, ew + 16, 150, "BÚSQUEDA, IDENTIDAD Y DATOS", C.extLine);
ext(ex, 92, ew, 22, "Serper (Google Search y Maps)", null);
ext(ex, 118, ew, 22, "SignalHire (búsqueda gratis · revelar con crédito)", null);
ext(ex, 144, ew, 22, "Apollo.io (empresa, vacantes, noticias)", null);
ext(ex, 170, ew, 22, "Hunter (correo profesional)", null);
ext(ex, 196, ew, 22, "Claude (homónimos y análisis del reporte)", null);

group(ex - 8, 244, ew + 16, 98, "LLAMADA DE VOZ", C.extLine);
ext(ex, 256, ew, 22, "Vapi (agente de voz, LLM gpt-4o)", null);
ext(ex, 282, ew, 22, "Twilio (número y red telefónica)", null);
ext(ex, 308, ew, 22, "ElevenLabs Marcela · respaldo Azure Salomé", null);

group(ex - 8, 356, ew + 16, 72, "AGENDA Y CORREO", C.extLine);
ext(ex, 368, ew, 22, "Google Calendar + Meet (OAuth)", null);
ext(ex, 394, ew, 22, "Gmail SMTP (contraseña de aplicación)", null);

group(ex - 8, 442, ew + 16, 46, "ORQUESTACIÓN", C.extLine);
ext(ex, 454, ew, 22, "n8n Cloud (reporte programado)", null);

arrow([[525, 268], [560, 268], [560, 155], [582, 155]], "consultas", { at: 1, dx: 12 });
arrow([[525, 285], [560, 285], [560, 293], [582, 293]], "inicia llamada", { at: 0, dy: -7 });
arrow([[582, 322], [540, 322], [540, 341], [525, 341]], "fin de llamada", { at: 0, dy: -7, color: C.extLine });
arrow([[525, 395], [582, 390]], "crea evento / envía", { dy: -7 });
arrow([[582, 465], [545, 465], [545, 352], [525, 352]], "datos · PDF · log", { at: 1, dx: 22, color: C.extLine });
arrow([[540, 470], [582, 470]], null, { dash: true });
doc.fillColor(C.muted).font("Helvetica").fontSize(6.8).text("Enviar ahora", 540, 474, { lineBreak: false });

legend(M, 520, [
  ["Personas", C.accentSoft, C.accent],
  ["Componentes de Capricorne", "#fff", C.accent],
  ["Servicios externos", C.ext, C.extLine],
  ["Base de datos", C.db, C.dbLine],
]);
doc.fillColor(C.muted).font("Helvetica").fontSize(7.5).text("Las flechas azules son conexiones que inician los servicios externos hacia Capricorne (webhooks y n8n).", M, 540, { width: 780 });

// ------------------------------------------------------------------ 3. flujograma del lead

doc.addPage();
header("2 · Flujograma del lead: de la base a la reunión", "Cada paso cambia el estado del lead en la tabla contacts.");

// Fila 1: identificar
proc(M, 96, 120, 58, "Entrada del lead", "Formulario QR · importar Excel/CSV · registro en el panel");
state(178, 106, 86, 38, "Pendiente", "pending");
proc(286, 92, 160, 66, "Identificar", "Serper busca el LinkedIn · SignalHire (gratis) confirma cargo e historial · Claude desempata homónimos");
diamond(520, 125, 104, 66, "¿Identidad segura?");
state(612, 104, 118, 42, "Perfil ubicado", "linkedin_found");
box(752, 96, 82, 58, "Revelar con crédito", "SignalHire, solo manual y con confirmación", { fill: C.ext, line: C.extLine, size: 7.5 });

arrow([[150, 125], [178, 125]]);
arrow([[264, 125], [286, 125]]);
arrow([[446, 125], [468, 125]]);
arrow([[572, 125], [612, 125]], "sí", { lcolor: C.stateLine });
arrow([[752, 125], [730, 125]], null, { dash: true, color: C.extLine });

state(456, 196, 128, 44, "Por revisar", "needs_review: el equipo elige el perfil o el de SignalHire");
bad(300, 196, 130, 44, "Omitido", "skipped (sin perfil, sin celular)");
arrow([[520, 158], [520, 196]], "dudosa", { lcolor: C.decisionLine });
arrow([[584, 218], [646, 218], [646, 146]], "elegido", { at: 0, lcolor: C.stateLine });
arrow([[456, 218], [430, 218]], "ninguno");

// Fila 2: enriquecer
proc(582, 262, 230, 70, "Enriquecer", "Empresa: Google Maps, sitio web y Apollo · Correo: Hunter · Celular: sitio web, sandbox o SignalHire (crédito)");
arrow([[686, 146], [686, 262]]);
diamond(470, 297, 110, 62, "¿Celular válido?");
arrow([[582, 297], [525, 297]]);
state(272, 276, 130, 42, "Listo para llamar", "phone_found");
arrow([[415, 297], [402, 297]], "sí", { lcolor: C.stateLine });
arrow([[470, 328], [470, 346], [365, 346], [365, 240]], "no", { at: 0, lcolor: C.dangerLine });
doc.fillColor(C.muted).font("Helvetica").fontSize(7).text("El equipo también puede elegir o escribir un número a mano (llamada real solo a números autorizados).", 30, 330, { width: 230 });

// Fila 3: llamada y resultado
proc(220, 384, 170, 62, "Llamada con agente de voz", "Vapi + Twilio + voz ElevenLabs · guion con 4 preguntas de calificación · ofrece 3 horarios libres");
state(84, 395, 110, 40, "En llamada", "calling");
arrow([[337, 318], [337, 384]]);
arrow([[220, 415], [194, 415]]);
diamond(470, 415, 110, 64, "Resultado de la llamada");
arrow([[390, 415], [415, 415]]);
state(590, 368, 222, 34, "Reunión agendada", "Google Calendar + Meet · correo al lead · resumen al comercial");
state(590, 408, 222, 26, "No interesado", "declined");
box(590, 440, 222, 34, "No contestó", "no_answer · correo de seguimiento con enlace para agendar", { fill: C.decision, line: C.decisionLine, r: 14 });
bad(590, 480, 222, 26, "Llamada fallida", "call_failed · se puede reintentar");
arrow([[525, 415], [552, 415], [552, 385], [590, 385]], "acepta", { at: 2, lcolor: C.stateLine });
arrow([[552, 415], [552, 421], [590, 421]]);
arrow([[552, 421], [552, 457], [590, 457]]);
arrow([[552, 457], [552, 493], [590, 493]]);
box(84, 460, 300, 46, "El lead agenda por su cuenta", "Desde el enlace del correo o del formulario QR (/agendar/[token]) elige un horario libre › Reunión agendada", { fill: C.accentSoft, line: C.accent, size: 8 });
arrow([[384, 483], [560, 483], [560, 392], [590, 392]], null, { dash: true, color: C.accent });

legend(M, 528, [
  ["Estado del lead", C.state, C.stateLine],
  ["Proceso", "#fff", C.accent],
  ["Decisión", C.decision, C.decisionLine],
  ["Estado de salida", C.danger, C.dangerLine],
  ["Acción manual / externa", C.ext, C.extLine],
]);
doc.fillColor(C.muted).font("Helvetica").fontSize(7.5).text("Cada cambio queda en la bitácora (tabla events) y cada dato guarda su origen (profile.provenance) para mostrar de dónde salió.", M, 546, { width: 780 });

// ------------------------------------------------------------------ 4. llamada y asíncronos

doc.addPage();
header("3 · Llamada, webhooks y procesos asíncronos", "Lo que pasa fuera de la petición del usuario: respuestas que llegan después por webhook.");

const lanes = [
  ["Capricorne (Vercel)", C.accent],
  ["Vapi + Twilio", C.extLine],
  ["Lead", C.stateLine],
  ["Google / Gmail", C.extLine],
];
const laneX = [70, 290, 500, 700];
lanes.forEach(([t, c], i) => {
  box(laneX[i] - 70, 70, 140, 26, t, null, { fill: "#fff", line: c });
  doc.moveTo(laneX[i], 96).lineTo(laneX[i], 340).lineWidth(0.6).dash(3, { space: 3 }).strokeColor(C.border).stroke().undash();
});
const steps = [
  [0, 1, "POST /call con asistente transitorio (guion, voz, herramientas)", 112],
  [1, 2, "Llama al celular; el agente conversa y califica", 136],
  [1, 0, "Herramienta: consultar horarios libres", 160],
  [0, 3, "freeBusy del calendario › 3 horarios", 184],
  [1, 0, "Herramienta: agendar en el horario elegido", 208],
  [0, 3, "Crea evento con Meet e invita (sendUpdates)", 232],
  [0, 3, "Correo de confirmación + resumen al comercial", 256],
  [1, 0, "Webhook end-of-call: resumen, resultado, duración", 280],
  [0, 0, "Guarda la llamada y el estado; si nunca llega, la conciliación consulta GET /call/{id}", 304],
];
for (const [a, b, label, y] of steps) {
  if (a === b) {
    box(laneX[a] - 62, y - 9, 124 + 200, 20, label, null, { fill: C.panel, line: C.border, size: 7 });
    continue;
  }
  arrow([[laneX[a], y], [laneX[b], y]], label, { color: a === 0 ? C.accent : C.extLine });
}

doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text("Otros procesos asíncronos", M, 360);
table(
  M,
  376,
  [150, 250, 380],
  ["Proceso", "Cómo se dispara", "Qué hace"],
  [
    ["SignalHire · revelar", "Botón manual con confirmación (1 crédito)", "POST /candidate/search con callbackUrl › /api/webhooks/signalhire guarda celulares y correos, y deja el lead listo para llamar."],
    ["Apollo · celular (plan pago)", "Automático solo si falta el teléfono", "people/match con reveal_phone_number › /api/webhooks/apollo guarda el celular cuando llega."],
    ["Preparación al registrar", "Formulario QR, importación o registro manual", "after(): identifica y enriquece en segundo plano sin llamar todavía."],
    ["Conciliación de llamadas", "Al consultar el estado o con el botón Liberar", "Si Vapi no avisó el final, consulta la llamada y la cierra; también puede colgarla (controlUrl)."],
    ["Reporte operativo", "n8n cada hora o botón Enviar ahora", "Ver página 4."],
  ],
);

// ------------------------------------------------------------------ 5. reporte n8n

doc.addPage();
header("4 · Reporte operativo con n8n y Claude", "Frecuencia y hora se configuran en Capricorne › Reporte diario; n8n solo pregunta si toca.");

ext(M, 120, 110, 46, "Cada hora", "Schedule 6 a. m.–11 p. m. (Bogotá)");
proc(160, 120, 110, 46, "0 · ¿Toca enviar?", "GET /api/report/due");
diamond(330, 143, 90, 60, "¿Es la hora?");
ext(M, 220, 110, 46, "Enviar ahora", "Webhook desde Capricorne");
proc(400, 180, 120, 46, "1 · Datos del período", "GET /api/report/data");
ext(550, 180, 110, 46, "2 · Claude analiza", "Haiku 5.5 · esfuerzo bajo");
proc(690, 180, 120, 46, "3 · Preparar análisis", "Si Claude falla: reglas");
proc(690, 270, 120, 46, "4 · Generar PDF", "POST /api/report/pdf");
ext(550, 270, 110, 46, "5 · Enviar correo", "SMTP de Gmail con el PDF");
proc(400, 270, 120, 46, "6 · Registrar", "POST /api/report/log");
box(400, 350, 120, 40, "Calendario de envíos", "Capricorne › Reporte diario", { fill: C.accentSoft, line: C.accent });
arrow([[140, 143], [160, 143]]);
arrow([[270, 143], [285, 143]]);
arrow([[375, 143], [460, 143], [460, 180]], "sí", { at: 0, lcolor: C.stateLine });
doc.fillColor(C.muted).font("Helvetica").fontSize(7).text("no › termina", 300, 180, { lineBreak: false });
arrow([[140, 243], [360, 243], [360, 203], [400, 203]]);
arrow([[520, 203], [550, 203]]);
arrow([[660, 203], [690, 203]]);
arrow([[750, 226], [750, 270]]);
arrow([[690, 293], [660, 293]]);
arrow([[550, 293], [520, 293]]);
arrow([[460, 316], [460, 350]]);

table(
  M,
  410,
  [150, 630],
  ["Configuración", "Detalle"],
  [
    ["Frecuencias", "Diario (lunes a viernes) · Semanal (viernes, datos de lunes a domingo) · Quincenal (día 15 y último del mes) · Mensual (último día del mes). Hora entre 6:00 a. m. y 11:00 p. m."],
    ["Contenido del PDF", "Análisis con IA marcado, 8 indicadores frente al período anterior, embudo, llamadas por hora o día, resultados, estado de la base, SLA explicado, decisiones, riesgos, qué ofrecer a cada lead, comerciales con % de confirmación, agenda e invitaciones, costos de datos."],
    ["Costo de IA", "aprox. USD 0,003 por reporte (2.258 tokens de entrada y ~4.700 de salida con Haiku 5.5). Si no hay saldo, sale con el análisis por reglas."],
    ["Seguridad", "n8n solo puede leer /api/report/data, /pdf, /log y /due con la cabecera x-report-key; el resto exige sesión."],
  ],
);

// ------------------------------------------------------------------ 6. modelo de datos

doc.addPage();
header("5 · Modelo de datos (Supabase · PostgreSQL)", "8 tablas con RLS activo y sin políticas públicas: solo el servidor accede con la clave secreta.");

const contacts = entity(M, 66, 196, "contacts", "Un registro por lead y su estado en el flujo", [
  ["id", "uuid", "PK"],
  ["first_name, last_name", "text"],
  ["company, title, city", "text"],
  ["email", "text"],
  ["phone", "text (E.164)"],
  ["consent", "boolean"],
  ["source", "panel | csv | qr:…"],
  ["contact_preference", "llamada | correo"],
  ["event_notes", "text"],
  ["qualification", "jsonb"],
  ["profile", "jsonb"],
  ["linkedin_url", "text"],
  ["linkedin_confidence", "numeric(3,2)"],
  ["linkedin_source", "text"],
  ["linkedin_candidates", "jsonb"],
  ["enrichment_source", "text"],
  ["status", "text (11 estados)"],
  ["skip_reason", "text"],
  ["call_id", "text"],
  ["call_outcome, call_summary", "text"],
  ["call_transcript, recording_url", "text"],
  ["booking_token", "uuid"],
  ["locked_until", "timestamptz"],
  ["created_at, updated_at", "timestamptz"],
]);

const calls = entity(300, 66, 170, "calls", "Cada intento de llamada", [
  ["id", "uuid", "PK"],
  ["contact_id", "uuid › contacts", "FK"],
  ["provider", "vapi | simulado"],
  ["provider_call_id", "text"],
  ["status", "answered, missed, failed…"],
  ["ended_reason, outcome", "text"],
  ["started_at, ended_at", "timestamptz"],
  ["duration_sec", "integer"],
]);
const meetings = entity(300, 196, 170, "meetings", "Reuniones agendadas", [
  ["id", "uuid", "PK"],
  ["contact_id", "uuid › contacts", "FK"],
  ["sales_rep_id", "uuid › sales_reps", "FK"],
  ["starts_at, ends_at", "timestamptz"],
  ["attendee_email", "text"],
  ["meet_url, calendar_link", "text"],
  ["calendar_event_id", "text"],
  ["calendar_provider", "google | sandbox"],
  ["created_at", "timestamptz"],
]);
const emails = entity(300, 340, 170, "emails", "Correos enviados", [
  ["id", "bigserial", "PK"],
  ["contact_id", "uuid › contacts", "FK"],
  ["meeting_id", "uuid › meetings", "FK"],
  ["kind", "confirmación, seguimiento…"],
  ["to_email, subject, html", "text"],
  ["provider, provider_id", "text"],
  ["status, error", "sent | failed"],
  ["created_at", "timestamptz"],
]);
const reps = entity(520, 196, 150, "sales_reps", "Comerciales que reciben las reuniones", [
  ["id", "uuid", "PK"],
  ["name, title", "text"],
  ["email, phone", "text"],
  ["area", "infraestructura, IA…"],
  ["active", "boolean"],
  ["created_at", "timestamptz"],
]);
const events = entity(520, 66, 150, "events", "Bitácora de cada paso", [
  ["id", "bigserial", "PK"],
  ["contact_id", "uuid › contacts", "FK"],
  ["step", "linkedin, call, report…"],
  ["level", "info … error"],
  ["message", "text"],
  ["data", "jsonb"],
  ["created_at", "timestamptz"],
]);
entity(686, 66, 126, "app_settings", "Ajustes de la app", [
  ["key", "text", "PK"],
  ["value", "jsonb"],
  ["updated_at", "timestamptz"],
]);
entity(686, 150, 126, "sandbox_profiles", "Datos de prueba", [
  ["id", "uuid", "PK"],
  ["full_name", "text"],
  ["company, headline", "text"],
  ["linkedin_url", "text (único)"],
  ["mobile_phone", "text"],
  ["email", "text"],
  ["mock_outcome", "accept, …"],
  ["created_at", "timestamptz"],
]);

const rel = (pts, label) => arrow(pts, label, { color: C.dbLine, dx: 0, dy: -6 });
rel([[contacts.x + contacts.w, contacts.row(0)], [270, contacts.row(0)], [270, calls.row(1)], [300, calls.row(1)]], "1 : N");
rel([[270, calls.row(1)], [270, meetings.row(1)], [300, meetings.row(1)]]);
rel([[270, meetings.row(1)], [270, emails.row(1)], [300, emails.row(1)]]);
rel([[270, 80], [270, 58], [500, 58], [500, events.row(1)], [520, events.row(1)]], "1 : N");
rel([[reps.x, reps.row(0)], [490, reps.row(0)], [490, meetings.row(2)], [470, meetings.row(2)]], "1 : N");
rel([[meetings.x + meetings.w, meetings.row(0)], [485, meetings.row(0)], [485, emails.row(2)], [470, emails.row(2)]]);

doc.fillColor(C.muted).font("Helvetica").fontSize(7.3).text(
  "Estados de contacts.status: pending · needs_review · linkedin_found · enriching · phone_found · calling · meeting_scheduled · declined · no_answer · call_failed · skipped.\nBorrado en cascada: al eliminar un lead se borran sus llamadas, reuniones, correos y bitácora. Las reuniones conservan el correo enviado (meeting_id queda en null).",
  520,
  330,
  { width: 290, lineGap: 2 },
);

// ------------------------------------------------------------------ 7. JSON y configuración

doc.addPage();
header("6 · Campos JSON y configuración", "Lo que guarda cada columna jsonb y la tabla app_settings.");
let ty = table(
  M,
  70,
  [150, 220, 410],
  ["Campo", "Contenido", "Detalle"],
  [
    ["contacts.profile.headline / location", "Titular y ciudad del perfil elegido", "Solo del perfil confirmado, nunca de un homónimo."],
    ["contacts.profile.company", "Ficha de empresa", "nombre, web, dominio, descripción, sector, dirección, teléfonos, correos, LinkedIn, atributos (empleados, fundación) y field_sources por campo."],
    ["contacts.profile.company.signals", "Señales de prospección (Apollo)", "Vacantes abiertas (total y Latinoamérica) y noticias recientes."],
    ["contacts.profile.phones / email", "Teléfonos y correo encontrados", "Cada uno con tipo, fuente y si es de la persona o de la empresa; correo con confianza de Hunter."],
    ["contacts.profile.signalhire", "Búsqueda gratuita y revelado", "Mejor coincidencia con historial laboral y habilidades, otros resultados y estado del revelado con crédito."],
    ["contacts.profile.apollo", "Enriquecimiento de persona", "Estado (ok, plan, error), datos de la persona y celular pendiente o recibido."],
    ["contacts.profile.provenance", "Origen de cada dato", "Por campo: servicio, detalle, enlace y fecha. Alimenta “Origen de los datos” y el resumen del lead."],
    ["contacts.qualification", "Respuestas de la llamada", "área de interés, proyecto, etapa, fecha meta, decisores, cargo, celular, referido, notas."],
    ["contacts.linkedin_candidates", "Candidatos de LinkedIn", "url, nombre, titular, confianza, motivo, origen y si salió de una publicación."],
    ["events.data", "Datos del evento", "Ej. en envíos del reporte: vía (n8n o app), disparador, destinatarios, análisis y frecuencia."],
  ],
);
doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text("Tabla app_settings (clave › valor)", M, ty + 14);
table(
  M,
  ty + 30,
  [150, 630],
  ["Clave", "Valor"],
  [
    ["live_calls", "true / false: llamadas reales o simuladas."],
    ["live_numbers", "Números con consentimiento que reciben llamada real."],
    ["agent_voice", "Proveedor, voz, velocidad y nombre del agente (ElevenLabs Marcela con respaldo Azure)."],
    ["report", "areas · recipients (correo, nombre, área) · n8n_webhook · schedule (frecuencia y hora)."],
  ],
);

// ------------------------------------------------------------------ 8. APIs externas

doc.addPage();
header("7 · APIs externas", "Qué servicio, para qué, por dónde se conecta y cómo se autentica. Ninguna clave sale del servidor.");
table(
  M,
  70,
  [100, 220, 270, 90, 100],
  ["Servicio", "Uso en Capricorne", "Endpoints", "Autenticación", "Costo / modo"],
  [
    ["Supabase", "Base de datos de toda la app", "PostgREST (supabase-js)", "Clave secreta", "Plan gratis"],
    ["Serper", "LinkedIn del lead y datos de su empresa", "google.serper.dev/search · /places", "X-API-KEY", "Por consulta (modo híbrido)"],
    ["SignalHire", "Identidad, cargo, historial y habilidades; revelar celular", "/api/v1/candidate/searchByQuery (gratis) · /candidate/search + webhook (1 crédito) · /credits", "apikey", "Revelar solo manual"],
    ["Apollo.io", "Empresa, vacantes y noticias; persona en plan pago", "/organizations/enrich · /organizations/{id}/job_postings · /news_articles/search · /people/match · /usage_stats", "x-api-key", "Plan gratis: empresa"],
    ["Hunter", "Correo profesional", "api.hunter.io/v2/email-finder", "api_key", "Plan gratis"],
    ["Anthropic (Claude)", "Homónimos en LinkedIn y análisis del reporte", "api.anthropic.com/v1/messages (claude-haiku-5-5)", "x-api-key", "aprox. USD 0,003 por reporte"],
    ["Vapi", "Agente de voz: guion, herramientas y fin de llamada", "api.vapi.ai/call · /call/{id} · webhook /api/webhooks/vapi", "Bearer", "Por minuto"],
    ["Twilio", "Número y salida telefónica (a través de Vapi)", "Configurado en Vapi (VAPI_PHONE_NUMBER_ID)", "Vapi", "Por minuto"],
    ["ElevenLabs / Azure", "Voz del agente (Marcela, respaldo Salomé)", "A través de Vapi (fallbackPlan)", "Vapi", "Incluido en Vapi"],
    ["Google Calendar", "Horarios libres, eventos con Meet, invitación y confirmación del lead", "oauth2.googleapis.com/token · calendar/v3/freeBusy · calendars/{id}/events", "OAuth (refresh token)", "Gratis"],
    ["Gmail", "Confirmación, seguimiento y resumen al comercial", "smtp.gmail.com:465 (nodemailer) · gmail/v1/users/me/messages/send", "Contraseña de aplicación / OAuth", "Gratis"],
    ["n8n Cloud", "Orquesta el reporte programado", "capricorne.app.n8n.cloud/webhook/capricorne-reporte › /api/report/*", "x-report-key", "Prueba de 14 días"],
    ["Vercel", "Hosting y despliegue desde GitHub", "attack-poc-bot.vercel.app", "Cuenta kyo6996", "Plan Hobby"],
  ],
);

// ------------------------------------------------------------------ 9. rutas y seguridad

doc.addPage();
header("8 · Rutas internas, pantallas y seguridad");
ty = table(
  M,
  70,
  [190, 190, 400],
  ["Grupo", "Rutas", "Para qué"],
  [
    ["Sesión", "/api/auth/login · logout · me", "Inicio de sesión del panel (cookie firmada cp_session)."],
    ["Leads", "/api/contacts · /[id] · /import · /bulk-delete", "Crear, editar, importar, borrar."],
    ["Acciones del lead", "/[id]/linkedin · /phone · /signalhire · /hangup", "Elegir perfil, elegir número, buscar o revelar en SignalHire, colgar."],
    ["Flujo", "/api/pipeline/run · /api/state", "Avanzar la cola de leads y estado del panel."],
    ["Agenda y correo", "/api/emails/send · /api/emails/[id] · /api/reps", "Reenviar correos, comerciales."],
    ["Configuración", "/api/settings · /api/integrations · /api/voice/preview · /api/demo/reset", "Llamadas reales, números, voz, integraciones."],
    ["Reporte", "/api/report/config · data · pdf · send · due · log · history", "Configurar, generar, enviar y consultar envíos."],
    ["Públicas", "/api/public/lead · /api/public/book", "Formulario QR y agendamiento por el lead."],
    ["Webhooks", "/api/webhooks/vapi · signalhire · apollo", "Respuestas asíncronas de los proveedores."],
  ],
);
doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text("Pantallas", M, ty + 12);
doc
  .fillColor(C.muted)
  .font("Helvetica")
  .fontSize(8)
  .text(
    "Prospección: Leads (/), Agenda, Bitácora, Formulario QR · Análisis: Desempeño y SLA, Reporte diario y Calendario de envíos · Equipo: Comerciales · Configuración: Voz del agente, Llamadas y números, Integraciones, Datos sandbox · Públicas: /registro, /agendar/[token], /login.",
    M,
    ty + 28,
    { width: 780 },
  );
doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text("Seguridad", M, ty + 56);
doc
  .fillColor(C.muted)
  .font("Helvetica")
  .fontSize(8)
  .text(
    "• Proxy de Next.js: toda ruta del panel exige sesión; las APIs responden 401 sin ella. • Webhooks validan WEBHOOK_SECRET; n8n usa REPORT_API_KEY y solo en 4 rutas del reporte. • Las claves de los proveedores viven en variables de entorno de Vercel y nunca llegan al navegador. • Supabase con RLS y sin políticas públicas. • Llamadas reales solo a números con consentimiento (Ley 1581 de 2012). • Créditos de pago solo con confirmación manual.",
    M,
    ty + 72,
    { width: 780, lineGap: 2 },
  );
doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text("Variables de entorno (solo nombres)", M, ty + 120);
doc
  .fillColor(C.muted)
  .font("Helvetica")
  .fontSize(7.5)
  .text(
    "SUPABASE_URL · SUPABASE_SECRET_KEY · APP_URL · WEBHOOK_SECRET · DASHBOARD_PASSWORD · AUTH_SECRET · PROVIDER_LINKEDIN · PROVIDER_ENRICHMENT · PROVIDER_VOICE · PROVIDER_CALENDAR · PROVIDER_EMAIL · SERPER_API_KEY · SIGNALHIRE_API_KEY · APOLLO_API_KEY · HUNTER_API_KEY · ANTHROPIC_API_KEY · ANTHROPIC_MODEL · VAPI_API_KEY · VAPI_PUBLIC_KEY · VAPI_PHONE_NUMBER_ID · VAPI_MODEL_PROVIDER · VAPI_MODEL · VAPI_VOICE_PROVIDER · VAPI_VOICE_ID · VOICE_LIVE_NUMBERS · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN · GOOGLE_CALENDAR_ID · SMTP_USER · SMTP_PASS · REPORT_API_KEY · SENDER_* · COMPANY_NAME · BRAND_NAME · EVENT_NAME · AGENT_NAME · MEETING_MINUTES · BUSINESS_TZ · BUSINESS_HOUR_START/END.",
    M,
    ty + 136,
    { width: 780, lineGap: 2 },
  );

footer();
doc.end();
console.log("PDF generado en", OUT);
