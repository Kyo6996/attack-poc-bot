// Genera el flujo de n8n del reporte diario.
// Uso: node n8n/build-workflow.mjs <APP_URL> <REPORT_API_KEY> <REMITENTE> <salida.json>
import { writeFileSync } from "node:fs";

const [APP = "https://TU-APP.vercel.app", KEY = "REEMPLAZAR_REPORT_API_KEY", FROM = "remitente@gmail.com", OUT = "n8n/reporte-diario.template.json"] = process.argv.slice(2);
const capricorne = [{ name: "x-report-key", value: KEY }];

const prepare = String.raw`const data = $('1 · Datos del día').first().json;
const claude = $input.first().json;
let analysis = null;
let source = 'Claude Haiku 5.5';
try {
  const text = (claude.content || []).find((b) => b.type === 'text')?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    const j = JSON.parse(m[0]);
    if (j.summary && Array.isArray(j.decisions)) analysis = j;
  }
} catch (e) {}
if (!analysis) {
  analysis = data.analysis_rules;
  source = 'reglas de operación (Claude no disponible)';
}
const to = (data.recipients || []).map((r) => r.email);
if (!to.length) throw new Error('No hay destinatarios configurados en Capricorne → Reporte diario');
let trigger = 'programado';
try { if ($('Enviar ahora (Capricorne)').isExecuted) trigger = 'manual'; } catch (e) {}
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const top = analysis.decisions.slice(0, 4).map((d) => '<li style="margin:0 0 6px"><b>[' + esc(d.priority) + ']</b> ' + esc(d.action) + '</li>').join('');
const offers = (analysis.prospects || []).slice(0, 4).map((p) => '<li style="margin:0 0 6px"><b>' + esc(p.name) + (p.company ? ' (' + esc(p.company) + ')' : '') + ':</b> ' + esc(p.offer) + '</li>').join('');
const html = '<div style="font-family:Arial,sans-serif;color:#141826;max-width:620px">'
  + '<h2 style="color:#5b4bdb;margin:0 0 4px">Reporte operativo diario</h2>'
  + '<p style="color:#646b82;margin:0 0 14px">' + esc(data.label) + (data.partial ? ' · corte parcial' : '') + '</p>'
  + '<p style="line-height:1.5">' + esc(analysis.summary) + '</p>'
  + (top ? '<h3 style="margin:18px 0 8px">Decisiones prioritarias</h3><ul style="padding-left:18px">' + top + '</ul>' : '')
  + (offers ? '<h3 style="margin:18px 0 8px">Qué ofrecer a cada prospecto</h3><ul style="padding-left:18px">' + offers + '</ul>' : '')
  + '<p style="color:#646b82;font-size:12px;margin-top:18px">Análisis: ' + esc(source) + '. El PDF adjunto trae los gráficos, la agenda de mañana y el detalle por comercial.</p></div>';
return [{ json: { analysis, source, trigger, to: to.join(', '), recipients: to.length, subject: data.subject, html } }];`;

const prep = (field) => `$('3 · Preparar análisis').item.json.${field}`;

const nodes = [
  {
    id: "n-note",
    name: "Nota",
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [-80, -280],
    parameters: {
      width: 1600,
      height: 190,
      color: 5,
      content:
        "## Capricorne · Reporte operativo diario\nLunes a viernes 6:00 p. m. (Bogotá) o al pulsar **Enviar ahora** en Capricorne → Reporte diario.\n1 Capricorne entrega los datos del día · 2 Claude los analiza y propone decisiones · 3 se arma el análisis (si Claude falla se usan las reglas de operación) · 4 Capricorne genera el PDF con gráficos · 5 se envía a los destinatarios configurados por área · 6 el envío queda en la bitácora.",
    },
  },
  {
    id: "n-cron",
    name: "Lunes a viernes 6:00 p. m.",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [0, 0],
    parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 18 * * 1-5" }] } },
  },
  {
    id: "n-hook",
    name: "Enviar ahora (Capricorne)",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 200],
    webhookId: "8d3f6a52-1c4e-4b7a-9f0e-capricorne01",
    parameters: { httpMethod: "POST", path: "capricorne-reporte", responseMode: "onReceived", options: {} },
  },
  {
    id: "n-data",
    name: "1 · Datos del día",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [260, 100],
    parameters: { url: `${APP}/api/report/data`, sendHeaders: true, headerParameters: { parameters: capricorne }, options: { timeout: 60000 } },
  },
  {
    id: "n-claude",
    name: "2 · Claude analiza",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [500, 100],
    onError: "continueRegularOutput",
    parameters: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "anthropic-version", value: "2023-06-01" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 8000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: $json.claude_prompt }] }) }}",
      options: { timeout: 60000 },
    },
  },
  {
    id: "n-prep",
    name: "3 · Preparar análisis",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [740, 100],
    parameters: { jsCode: prepare },
  },
  {
    id: "n-pdf",
    name: "4 · Generar PDF",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [980, 100],
    parameters: {
      method: "POST",
      url: `${APP}/api/report/pdf`,
      sendHeaders: true,
      headerParameters: { parameters: capricorne },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ analysis: $json.analysis, source: $json.source }) }}",
      options: { timeout: 60000, response: { response: { responseFormat: "file", outputPropertyName: "data" } } },
    },
  },
  {
    id: "n-mail",
    name: "5 · Enviar a destinatarios",
    type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1,
    position: [1220, 100],
    parameters: {
      fromEmail: `Capricorne Project <${FROM}>`,
      toEmail: `={{ ${prep("to")} }}`,
      subject: `={{ ${prep("subject")} }}`,
      emailFormat: "html",
      html: `={{ ${prep("html")} }}`,
      options: { attachments: "data" },
    },
  },
  {
    id: "n-log",
    name: "6 · Registrar en Capricorne",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1460, 100],
    parameters: {
      method: "POST",
      url: `${APP}/api/report/log`,
      sendHeaders: true,
      headerParameters: { parameters: capricorne },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ ok: true, recipients: ${prep("recipients")}, trigger: ${prep("trigger")}, analysis: ${prep("source")} }) }}`,
      options: {},
    },
  },
];

const link = (to) => ({ main: [[{ node: to, type: "main", index: 0 }]] });
const workflow = {
  name: "Capricorne · Reporte operativo diario",
  nodes,
  connections: {
    "Lunes a viernes 6:00 p. m.": link("1 · Datos del día"),
    "Enviar ahora (Capricorne)": link("1 · Datos del día"),
    "1 · Datos del día": link("2 · Claude analiza"),
    "2 · Claude analiza": link("3 · Preparar análisis"),
    "3 · Preparar análisis": link("4 · Generar PDF"),
    "4 · Generar PDF": link("5 · Enviar a destinatarios"),
    "5 · Enviar a destinatarios": link("6 · Registrar en Capricorne"),
  },
  settings: { executionOrder: "v1", timezone: "America/Bogota" },
  pinData: {},
};

writeFileSync(OUT, JSON.stringify(workflow, null, 2));
console.log("Flujo escrito en", OUT);
