import { env } from "../env";
import type { Contact, Meeting, SalesRep } from "../types";

const RED = "#E2231A";
const INK = "#161616";
const MUTED = "#5f6368";
const LINE = "#e6e6e6";
const SOFT = "#f6f6f7";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function fmt(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: env.timeZone(), ...opts }).format(new Date(iso));
}

function button(href: string, label: string, primary = true) {
  return `<a href="${esc(href)}" style="display:inline-block;padding:13px 26px;border-radius:6px;font:600 15px/1 Arial,Helvetica,sans-serif;text-decoration:none;${
    primary ? `background:${RED};color:#ffffff;` : `background:#ffffff;color:${INK};border:1px solid ${LINE};`
  }">${esc(label)}</a>`;
}

function signature() {
  const s = env.sender();
  const contact = [s.phone, s.email].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  return `
    <p style="margin:28px 0 0;font:15px/1.6 Arial,Helvetica,sans-serif;color:${INK}">Saludos,</p>
    <p style="margin:6px 0 0;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
      <strong>${esc(s.name)}</strong> – ${esc(s.title)}, equipo ${esc(env.companyName())}<br>
      <span style="color:${MUTED};font-size:13px">${contact}</span>
    </p>`;
}

function pillars() {
  const items = ["Dispositivos", "Infraestructura", "Servicios", "Inteligencia artificial"];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0">
      <tr>${items
        .map(
          (i) => `<td align="center" style="padding:12px 6px;border-top:3px solid ${RED};background:${SOFT};font:600 12px/1.3 Arial,Helvetica,sans-serif;color:${INK};letter-spacing:.02em">${i}</td>`,
        )
        .join('<td width="6" style="font-size:0">&nbsp;</td>')}</tr>
    </table>`;
}

function layout(opts: { preheader: string; eyebrow: string; title: string; body: string }) {
  const brand = esc(env.brandName());
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#eeeeef">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeef">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
    <tr><td style="background:${INK};padding:22px 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:700 22px/1 Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:-.01em">${brand}</td>
        <td align="right"><span style="display:inline-block;padding:6px 10px;border:1px solid ${RED};border-radius:4px;font:700 11px/1 Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:.08em">${esc(env.eventName().toUpperCase())}</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;background:${RED};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:34px 32px 8px">
      <p style="margin:0 0 8px;font:700 12px/1 Arial,Helvetica,sans-serif;color:${RED};letter-spacing:.12em;text-transform:uppercase">${esc(opts.eyebrow)}</p>
      <h1 style="margin:0;font:700 26px/1.25 Arial,Helvetica,sans-serif;color:${INK}">${esc(opts.title)}</h1>
    </td></tr>
    <tr><td style="padding:12px 32px 34px">${opts.body}</td></tr>
    <tr><td style="background:${SOFT};padding:18px 32px;border-top:1px solid ${LINE}">
      <p style="margin:0;font:12px/1.6 Arial,Helvetica,sans-serif;color:${MUTED}">
        Recibes este correo porque nos visitaste en ${esc(env.eventName())} y autorizaste ser contactado.
        Si prefieres no recibir más comunicaciones, responde a este mensaje con la palabra <strong>BAJA</strong>.
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;font:15px/1.65 Arial,Helvetica,sans-serif;color:${INK}">${html}</p>`;

// Los enlaces "(sandbox)" son de ejemplo: no se muestran al cliente.
export function meetUrlOf(m: Pick<Meeting, "meet_url">) {
  return m.meet_url?.startsWith("http") && !m.meet_url.includes("(sandbox)") ? m.meet_url.split(" ")[0] : null;
}

export function googleCalendarTemplateUrl(m: Meeting, title: string, details: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", title);
  u.searchParams.set("dates", `${f(m.starts_at)}/${f(m.ends_at)}`);
  u.searchParams.set("details", details);
  const meet = meetUrlOf(m);
  if (meet) u.searchParams.set("location", meet);
  return u.toString();
}

export function confirmationEmail(c: Contact, m: Meeting, rep: SalesRep | null) {
  const brand = env.brandName();
  const date = fmt(m.starts_at, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = `${fmt(m.starts_at, { hour: "numeric", minute: "2-digit" })} – ${fmt(m.ends_at, { hour: "numeric", minute: "2-digit" })}`;
  const meet = meetUrlOf(m);
  const q = c.qualification ?? {};
  const subject = `Confirmada: tu conversación con ${brand} · ${fmt(m.starts_at, { day: "numeric", month: "long" })}`;
  const calUrl = googleCalendarTemplateUrl(m, `${brand} · Conversación con especialista`, meet ? `Google Meet: ${meet}` : "");

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED};width:120px">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font:600 15px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${value}</td>
    </tr>`;

  const repBlock = rep
    ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border:1px solid ${LINE};border-left:4px solid ${RED};border-radius:6px">
      <tr><td style="padding:16px 18px">
        <p style="margin:0 0 4px;font:700 11px/1 Arial,Helvetica,sans-serif;color:${MUTED};letter-spacing:.1em;text-transform:uppercase">Te atenderá</p>
        <p style="margin:0;font:700 17px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${esc(rep.name)}</p>
        <p style="margin:0 0 10px;font:14px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">${esc(rep.title ?? "")}${rep.email ? ` · ${esc(rep.email)}` : ""}${rep.phone ? ` · ${esc(rep.phone)}` : ""}</p>
        <p style="margin:0;font:14px/1.6 Arial,Helvetica,sans-serif;color:${INK}">Antes de la reunión, ${esc(rep.name.split(" ")[0])} se pondrá en contacto contigo para conocer mejor tu iniciativa y preparar una conversación a la medida.</p>
      </td></tr>
    </table>`
    : "";

  const learned = [
    q.proyecto && `<li style="margin:0 0 6px"><strong>Iniciativa:</strong> ${esc(q.proyecto)}</li>`,
    q.etapa && `<li style="margin:0 0 6px"><strong>Etapa:</strong> ${esc(q.etapa)}</li>`,
    q.fecha_meta && `<li style="margin:0 0 6px"><strong>Meta:</strong> ${esc(q.fecha_meta)}</li>`,
  ].filter(Boolean);

  const body = `
    ${p(`Hola, ${esc(c.first_name)}:`)}
    ${p(`Gracias por acompañarnos en ${esc(env.eventName())} y por tu tiempo en la llamada. Confirmamos tu conversación de <strong>${env.meetingMinutes()} minutos</strong> con el especialista de ${esc(brand)}${q.area_interes ? ` en <strong>${esc(q.area_interes)}</strong>` : ""}, para entender mejor tu iniciativa y ver cómo podemos aportar.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px">
      ${row("Fecha", esc(date.charAt(0).toUpperCase() + date.slice(1)))}
      ${row("Hora", `${esc(time)} <span style="font-weight:400;color:${MUTED}">(hora Colombia)</span>`)}
      ${row("Modalidad", meet ? "Videollamada por Google Meet" : "Videollamada · el especialista te compartirá el enlace")}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${meet ? `<td style="padding:0 10px 0 0">${button(meet, "Unirme a Google Meet")}</td>` : ""}
      <td>${button(calUrl, "Agregar a mi calendario", !meet)}</td>
    </tr></table>
    ${repBlock}
    ${learned.length ? `<p style="margin:24px 0 8px;font:700 14px/1.4 Arial,Helvetica,sans-serif;color:${INK}">Lo que nos contaste</p><ul style="margin:0;padding-left:18px;font:14px/1.6 Arial,Helvetica,sans-serif;color:${INK}">${learned.join("")}</ul>` : ""}
    ${pillars()}
    ${signature()}`;

  return {
    subject,
    html: layout({ preheader: `${date}, ${time} · Google Meet`, eyebrow: "Reunión confirmada", title: "Tu conversación está agendada", body }),
  };
}

// Texto del Word: "Correo de seguimiento post-ANDICOM"
export function followupEmail(c: Contact, bookingUrl: string) {
  const brand = env.brandName();
  const event = env.eventName().replace(/\s*\d{4}$/, "");
  const subject = `Gracias por acompañarnos en ${event} – ${env.companyName()}`;
  const body = `
    ${p(`Hola, ${esc(c.first_name)}:`)}
    ${p(`Gracias por visitarnos en ${esc(event)}. En ${esc(brand)} estamos acompañando a empresas e instituciones en proyectos de transformación tecnológica que integran dispositivos, infraestructura, servicios e inteligencia artificial.`)}
    ${pillars()}
    <div style="height:22px"></div>
    ${p(`Si tu organización tiene alguna iniciativa de modernización en evaluación o planeación para los próximos 6 a 12 meses, nos encantaría coordinar una conversación de ${env.meetingMinutes()} minutos con el especialista de ${esc(brand)} más relacionado con ese tema.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 16px"><tr><td>${button(bookingUrl, "Agendar conversación")}</td></tr></table>
    ${p(`<span style="color:${MUTED}">O, si lo prefieres, responde a este correo con el tema y el horario que te queden mejor.</span>`)}
    ${signature()}`;
  return {
    subject,
    html: layout({ preheader: `Agenda ${env.meetingMinutes()} minutos con un especialista de ${brand}`, eyebrow: `Gracias por visitarnos`, title: `Fue un gusto verte en ${event}`, body }),
  };
}

export function repBriefEmail(c: Contact, m: Meeting, rep: SalesRep) {
  const q = c.qualification ?? {};
  const when = fmt(m.starts_at, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
  const subject = `Nuevo lead agendado: ${c.first_name} ${c.last_name} (${c.company ?? "sin empresa"}) · ${when}`;
  const rows = [
    ["Contacto", `${c.first_name} ${c.last_name}`],
    ["Cargo", q.cargo ?? c.title],
    ["Empresa", c.company],
    ["Correo", c.email],
    ["Celular", q.celular ?? c.phone],
    ["En el stand", c.event_notes],
    ["Área de interés", q.area_interes],
    ["Iniciativa", q.proyecto],
    ["Etapa", q.etapa],
    ["Fecha meta", q.fecha_meta],
    ["Decisores", q.decisores],
    ["Meet", meetUrlOf(m)],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font:13px Arial,sans-serif;color:${MUTED};width:130px">${k}</td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font:14px Arial,sans-serif;color:${INK}">${esc(v)}</td></tr>`,
    )
    .join("");
  const body = `
    ${p(`Hola, ${esc(rep.name.split(" ")[0])}:`)}
    ${p(`El asistente agendó una conversación de ${env.meetingMinutes()} minutos para el <strong>${esc(when)}</strong>. Por favor contacta al cliente antes de la reunión para darle atención previa.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0">${rows}</table>`;
  return { subject, html: layout({ preheader: `Lead de ${env.eventName()} para ${when}`, eyebrow: "Atención previa", title: "Tienes un nuevo lead agendado", body }) };
}

export function htmlToText(html: string) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<span style="display:none[\s\S]*?<\/span>/i, "")
    .replace(/<(br|\/p|\/tr|\/h1|\/li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
