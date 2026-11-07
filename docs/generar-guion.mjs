// Genera docs/Guion-Capricorne.pdf: guion de una página para presentar la app módulo por módulo.
// Uso: node docs/generar-guion.mjs
import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";

const OUT = "docs/Guion-Capricorne.pdf";
const W = 841.89;
const H = 595.28;
const M = 22;
const C = { accent: "#5b4bdb", soft: "#eeecfd", ink: "#141826", muted: "#5f667d", border: "#d9dce7", tech: "#2f6fd6", time: "#1f9d5c" };

// [tiempo, título, qué mostrar, qué decir, detalles técnicos]
const MODULES = [
  ["0:00", "Apertura", "Panel de Leads con KPIs.", "Después de ANDICOM quedan cientos de contactos fríos. Capricorne los convierte en reuniones con Lenovo sin trabajo manual.", ["Next.js 16 + React 19 en Vercel; Supabase (PostgreSQL con RLS).", "Flujo por lead: identificar › enriquecer › llamar › agendar › reportar."]],
  ["0:20", "Captura de leads", "Formulario QR impreso, importar Excel y registro manual.", "El lead entra por el QR del stand o por la base del evento, siempre con consentimiento.", ["Consentimiento obligatorio (Ley 1581); origen guardado (panel, csv, qr).", "Al registrar, after() lo prepara en segundo plano sin llamar todavía."]],
  ["0:45", "Identificación", "Ficha del lead y ventana 'Por revisar'.", "Primero confirmamos que es la persona correcta: su LinkedIn y su cargo actual.", ["Serper (Google) + puntaje por nombre, empresa y homónimos; Claude desempata.", "SignalHire gratis confirma cargo e historial; desde 90 % se acepta solo; si duda, decide una persona."]],
  ["1:15", "Enriquecimiento", "Resumen del cliente con etiquetas de origen.", "Completamos lo necesario para contactarlo y entender su empresa, y cada dato dice de dónde salió.", ["Empresa: Google Maps, sitio web y Apollo (sector, tamaño, vacantes, noticias). Correo: Hunter.", "Celular validado con libphonenumber; revelar con crédito solo manual y con confirmación."]],
  ["1:45", "Llamada con IA", "Llamada en vivo o prueba de voz desde el panel.", "Una asistente con voz natural lo llama, califica su proyecto con cuatro preguntas y ofrece horarios.", ["Vapi (gpt-4o) + Twilio; voz ElevenLabs con respaldo Azure; transcripción Deepgram nova-3 con nombre del lead.", "Herramientas en vivo: disponibilidad y agendar. Correo dictado corregido contra el registrado. Solo números autorizados."]],
  ["2:30", "Agenda y correos", "Agenda, invitación de Meet y correos enviados.", "Si acepta, la reunión queda en el calendario con Meet y un especialista de Lenovo asignado por área.", ["Google Calendar: freeBusy, evento con Meet, invitación y lectura de la confirmación (RSVP).", "Gmail: confirmación al lead, resumen al comercial y seguimiento si no contesta, con enlace para agendar."]],
  ["3:00", "Bitácora y SLA", "Bitácora en vivo y pantalla Desempeño y SLA.", "Todo queda trazado y medimos que cada lead reciba su primera llamada en menos de 24 horas.", ["Tabla events por paso; webhooks de Vapi, SignalHire y Apollo; conciliación de llamadas trabadas.", "Contacto = contestadas ÷ terminadas; aceptación = reuniones ÷ contestadas; SLA = a tiempo ÷ (a tiempo + vencidos)."]],
  ["3:30", "Reporte con IA", "Reporte diario, PDF y calendario de envíos.", "Al cierre llega a gerencia un PDF con gráficos, decisiones operativas y qué ofrecer a cada lead.", ["n8n consulta cada hora si toca enviar (diario, semanal, quincenal o mensual) y orquesta 8 pasos.", "Claude Haiku 5.5 con esfuerzo bajo: aprox. USD 0,003 por reporte; si falla, análisis por reglas. PDF con pdfkit."]],
  ["4:15", "Integraciones y seguridad", "Pantalla Integraciones y Arquitectura en PDF.", "Doce servicios conectados, cada uno con su estado, y ninguna clave sale del servidor.", ["Sesión con cookie firmada; webhooks con secreto; n8n con clave propia y solo 4 rutas.", "Créditos de pago solo con confirmación; RLS en Supabase; llamadas reales solo con consentimiento."]],
  ["4:40", "Cierre", "Volver al lead con reunión agendada.", "De un contacto frío a una reunión confirmada, con datos verificables y un reporte que dice qué hacer mañana.", ["Repo privado Kyo6996/attack-poc-bot; producción en attack-poc-bot.vercel.app.", "Ampliable: WhatsApp, CRM y más proveedores de datos desde n8n."]],
];

const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M, info: { Title: "Capricorne Project · Guion de presentación", Author: "Capricorne Project" } });
doc.pipe(createWriteStream(OUT));

// Encabezado
doc.rect(0, 0, W, 50).fill(C.accent);
doc.fillColor("#fff").font("Helvetica-Bold").fontSize(7.5).text("CAPRICORNE PROJECT · GUION DE PRESENTACIÓN", M, 10, { characterSpacing: 1 });
doc.font("Helvetica-Bold").fontSize(15).text("Del contacto de ANDICOM a la reunión con Lenovo, módulo por módulo", M, 22);
doc.font("Helvetica").fontSize(8).text("Duración sugerida: 5 minutos · Mostrar › Decir › Detalle técnico", W - M - 260, 27, { width: 260, align: "right" });

// Tarjetas: 2 columnas × 5 filas
const cols = 2;
const gap = 8;
const top = 60;
const cw = (W - M * 2 - gap) / cols;
const ch = (H - top - 26 - gap * 4) / 5;

function card(i, [time, title, show, say, tech]) {
  const x = M + (i % cols) * (cw + gap);
  const y = top + Math.floor(i / cols) * (ch + gap);
  doc.roundedRect(x, y, cw, ch, 7).lineWidth(0.8).fillAndStroke("#fff", C.border);
  doc.rect(x, y + 8, 3, ch - 16).fill(C.accent);

  // Número, título y tiempo
  doc.circle(x + 16, y + 14, 8).fill(C.accent);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8).text(String(i + 1), x + 8, y + 10.5, { width: 16, align: "center" });
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text(title, x + 30, y + 9);
  doc.font("Helvetica-Bold").fontSize(7.5);
  const tw = doc.widthOfString(time) + 12;
  doc.roundedRect(x + cw - tw - 8, y + 7, tw, 13, 6.5).fill("#e8f5ee");
  doc.fillColor(C.time).text(time, x + cw - tw - 8, y + 10.3, { width: tw, align: "center" });

  // Contenido con tamaño que se ajusta al alto de la tarjeta
  const inner = cw - 30;
  const lx = x + 12;
  for (let fs = 7.6; fs >= 6; fs -= 0.2) {
    const parts = [
      ["MOSTRAR", show, "Helvetica", C.muted],
      ["DECIR", `“${say}”`, "Helvetica-Oblique", C.ink],
    ];
    doc.font("Helvetica").fontSize(fs);
    const h1 = parts.reduce((a, [, t, f]) => a + doc.font(f).heightOfString(t, { width: inner - 48 }) + 2, 0);
    const h2 = tech.reduce((a, t) => a + doc.font("Helvetica").heightOfString(t, { width: inner - 10 }) + 1.5, 0);
    if (h1 + h2 + 30 > ch && fs > 6.1) continue;

    let cy = y + 27;
    for (const [label, text, font, color] of parts) {
      doc.fillColor(C.accent).font("Helvetica-Bold").fontSize(fs - 0.6).text(label, lx, cy + 0.6, { width: 44 });
      doc.fillColor(color).font(font).fontSize(fs).text(text, lx + 48, cy, { width: inner - 48 });
      cy = doc.y + 2;
    }
    doc.moveTo(lx, cy + 1).lineTo(x + cw - 12, cy + 1).lineWidth(0.4).strokeColor(C.border).stroke();
    cy += 4;
    for (const t of tech) {
      doc.circle(lx + 2.5, cy + fs / 2, 1.6).fill(C.tech);
      doc.fillColor(C.ink).font("Helvetica").fontSize(fs).text(t, lx + 9, cy, { width: inner - 10 });
      cy = doc.y + 1.5;
    }
    break;
  }
}

MODULES.forEach((m, i) => card(i, m));

doc.page.margins.bottom = 0;
doc
  .fillColor(C.muted)
  .font("Helvetica")
  .fontSize(7)
  .text("Consejo: grabar con un lead de prueba propio (número autorizado) para mostrar la llamada real, la invitación de Meet y el reporte el mismo día. Documento complementario: Arquitectura-Capricorne.pdf.", M, H - 18, { width: W - M * 2, align: "center", lineBreak: false });

doc.end();
console.log("PDF generado en", OUT);
