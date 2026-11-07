// Genera docs/Documento-Capricorne.pdf: arquitectura, herramientas y por qué, limitaciones y siguientes pasos (1 página).
// Uso: node docs/generar-documento.mjs
import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";

const OUT = "docs/Documento-Capricorne.pdf";
const M = 38;
const W = 595.28;
const H = 841.89;
const TW = W - M * 2;

const TITLE = "Capricorne Project";
const SUBTITLE = "Arquitectura, herramientas elegidas, limitaciones y siguientes pasos";

// Cada bloque: [tipo, contenido]. "h" título de sección, "p" párrafo, "t" herramienta (nombre, texto), "b" viñeta.
const BLOCKS = [
  ["p", "Capricorne es el bot que construimos para el seguimiento de los contactos de ANDICOM 2026: toma la base de leads, identifica a cada persona, consigue un celular para contactarla, la llama con un agente de voz que sigue el guion comercial y, si acepta, agenda una reunión de 15 minutos con un especialista de Lenovo y le envía la invitación. Al cierre del día envía a gerencia un reporte con los resultados."],

  ["h", "Arquitectura"],
  ["p", "Es una sola aplicación Next.js (panel, API y webhooks) desplegada en Vercel, con la base de datos en Supabase. Cada lead avanza por un flujo de estados: pendiente, identificación, enriquecimiento, listo para llamar, en llamada y resultado (reunión agendada, no interesado, no contestó o llamada fallida). Las respuestas que llegan después, como el fin de una llamada o un celular revelado, entran por webhooks firmados. Todo paso queda en una bitácora y cada dato guarda de dónde salió. El reporte lo orquesta n8n: consulta cada hora si toca enviarlo, pide los datos a Capricorne, los manda a Claude para el análisis, recibe el PDF y lo envía por correo. Las claves de los servicios viven solo en el servidor, el panel exige inicio de sesión y las llamadas reales solo salen a números con consentimiento."],

  ["h", "Herramientas y por qué las elegimos"],
  ["t", "GitHub y Vercel", "El repositorio privado en GitHub y el despliegue en Vercel nos dieron producción con HTTPS en minutos, sin administrar servidores. Next.js nos deja tener panel, API y webhooks en un mismo proyecto, y cada cambio queda versionado."],
  ["t", "Supabase", "PostgreSQL administrado, con plan gratuito y seguridad por filas. Ahí guardamos leads, llamadas, reuniones, correos, ajustes y la bitácora completa."],
  ["t", "Serper", "Nos da resultados de Google por API a bajo costo. Con eso encontramos el perfil público de LinkedIn y los datos de la empresa sin hacer scraping de LinkedIn ni romper sus términos."],
  ["t", "SignalHire", "Su búsqueda gratuita confirma cargo, empresa actual e historial, lo que resuelve homónimos y perfiles viejos. Los créditos para revelar un celular solo se gastan cuando alguien del equipo lo aprueba."],
  ["t", "Apollo", "En el plan gratuito completa la empresa: sector, tamaño, teléfono, vacantes abiertas y noticias. Sirve para preparar la conversación. La parte de personas quedó lista para cuando haya un plan pago."],
  ["t", "Hunter", "Encuentra el correo profesional con el nombre y el dominio de la empresa, y nos dice qué tan seguro es para decidir si lo usamos."],
  ["t", "Claude (API de Anthropic)", "Lo usamos donde hace falta criterio: desempatar homónimos y escribir el análisis del reporte, con decisiones operativas y qué ofrecer a cada lead. Con Haiku cada reporte cuesta menos de un centavo de dólar."],
  ["t", "Vapi", "Maneja la conversación de voz en tiempo real (transcripción con Deepgram, modelo y voz) y permite herramientas en vivo. Eso es lo que deja al agente consultar horarios y agendar durante la llamada."],
  ["t", "Twilio", "Pone el número y la salida a la red telefónica. Se conecta directo con Vapi y nos permitió llamar a celulares de Colombia desde la prueba."],
  ["t", "ElevenLabs y Azure", "Buscábamos una voz colombiana que no sonara a robot. Si ElevenLabs falla, Azure toma la llamada con otra voz para no perderla."],
  ["t", "Google Calendar y Gmail", "Es donde ya trabajan el comercial y el lead. La invitación con Meet llega como cualquier reunión y podemos saber si el lead la aceptó."],
  ["t", "n8n", "El reporte es un proceso de negocio que conviene ver y cambiar sin tocar código. n8n lo programa, llama a Claude, arma el envío y deja registro de cada ejecución."],

  ["h", "Limitaciones actuales"],
  ["b", "LinkedIn no se consulta directamente: dependemos de lo que Google muestra, y cuando hay dudas una persona confirma el perfil."],
  ["b", "Conseguir celulares en Colombia es difícil y cuesta créditos. SignalHire tiene pocos créditos y Apollo no entrega personas en su plan gratuito."],
  ["b", "Llamamos de a un lead a la vez y desde un número de Twilio, no desde un número local, lo que baja la tasa de respuesta."],
  ["b", "El correo dictado por voz puede transcribirse mal. Lo corregimos contra el registrado y el agente lo deletrea, pero sigue siendo un punto débil."],
  ["b", "Varios servicios están en planes de prueba: n8n (14 días), la app de Google en modo prueba (el permiso vence cada 7 días) y Vercel Hobby."],

  ["h", "Siguientes pasos"],
  ["t", "Telefonía local y multicanal", "Conectar un DID colombiano o un proveedor local de telefonía IP por troncal SIP, con bolsas de minutos y SMS. Montar una PBX con varios canales simultáneos para que varios agentes hagan llamadas previas al mismo tiempo, en campañas outbound para precalificar y agendar más leads o grupos específicos, e inbound para que el lead que devuelve la llamada sea atendido por el agente."],
  ["t", "CRM completo y WhatsApp", "Llevar el seguimiento del lead a un CRM completo e integrar la API de WhatsApp Business de Meta, con plantillas oficiales aprobadas y pensadas para el perfil de cada usuario. Gestionar las conexiones con clientes desde Meta Business (portafolios comerciales) y lanzar campañas masivas segmentadas, con autorización del usuario, para ofrecer servicios y controlar cada lead de punta a punta."],
  ["t", "Producción", "Dominio propio, app de Google publicada, un plan de pago en los proveedores de datos que mejor rindan y métricas por campaña y por comercial."],
];

const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `${TITLE} · Documento`, Author: "Capricorne Project" } });
doc.pipe(createWriteStream(OUT));

// Busca el tamaño de letra más grande con el que todo cabe en una página.
function layout(fs, draw) {
  let y = M;
  const t = (font, size, text, x, opts) => {
    doc.font(font).fontSize(size);
    const h = doc.heightOfString(text, { width: TW - (x - M), lineGap: 1.2, ...opts });
    if (draw) doc.text(text, x, y, { width: TW - (x - M), lineGap: 1.2, ...opts });
    return h;
  };
  if (draw) doc.fillColor("#111");
  y += t("Helvetica-Bold", fs + 9, TITLE, M) + 1;
  if (draw) doc.fillColor("#555");
  y += t("Helvetica", fs + 1.5, SUBTITLE, M) + 6;
  if (draw) doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor("#999").stroke();
  y += 7;
  for (const [kind, a, b] of BLOCKS) {
    if (kind === "h") {
      y += 4;
      if (draw) doc.fillColor("#111");
      y += t("Helvetica-Bold", fs + 2, a, M) + 3;
    } else if (kind === "p") {
      if (draw) doc.fillColor("#222");
      y += t("Helvetica", fs, a, M, { align: "justify" }) + 3;
    } else if (kind === "t") {
      doc.font("Helvetica-Bold").fontSize(fs);
      const label = `${a}. `;
      const h = doc.heightOfString(label + b, { width: TW, lineGap: 1.2 });
      if (draw) {
        doc.fillColor("#111").font("Helvetica-Bold").text(label, M, y, { width: TW, lineGap: 1.2, continued: true });
        doc.fillColor("#222").font("Helvetica").text(b, { lineGap: 1.2, align: "justify" });
        y = doc.y + 2.5;
      } else y += h + 2.5;
    } else if (kind === "b") {
      if (draw) {
        doc.fillColor("#222").font("Helvetica").fontSize(fs).text("–", M + 2, y);
      }
      y += t("Helvetica", fs, a, M + 12) + 2;
    }
  }
  return y;
}

let fs = 9.2;
while (layout(fs, false) > H - M - 10 && fs > 6.5) fs -= 0.1;
layout(fs, true);
doc.end();
console.log(`PDF generado en ${OUT} (letra ${fs.toFixed(1)} pt)`);
