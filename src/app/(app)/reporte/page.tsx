"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/app/ui";

interface Recipient {
  email: string;
  name: string | null;
  area: string;
}
interface Config {
  areas: string[];
  recipients: Recipient[];
  n8n_webhook: string | null;
  history: { message: string; level: string; created_at: string }[];
  key_set: boolean;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default function ReportePage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState("");
  const [rec, setRec] = useState<Recipient>({ email: "", name: "", area: "" });
  const [hook, setHook] = useState("");

  async function load() {
    const j = (await (await fetch("/api/report/config", { cache: "no-store" })).json()) as Config;
    setCfg(j);
    setHook(j.n8n_webhook ?? "");
    setRec((r) => ({ ...r, area: r.area || j.areas[0] || "" }));
  }
  useEffect(() => {
    load();
  }, []);

  async function save(patch: Partial<Config>, ok: string) {
    setBusy(true);
    const res = await fetch("/api/report/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? "No se pudo guardar");
    setMsg(ok);
    await load();
    return true;
  }

  async function sendNow() {
    if (!confirm("¿Enviar el reporte ahora con los datos que hay hasta este momento?")) return;
    setBusy(true);
    const res = await fetch("/api/report/send", { method: "POST" });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? (j.via === "n8n" ? "Reporte solicitado a n8n: llega al correo en un minuto" : `Reporte enviado a ${j.recipients} destinatario(s)`) : (j.error ?? "No se pudo enviar"));
    load();
  }

  if (!cfg) return <div className="page"><p className="s">Cargando…</p></div>;

  const byArea = cfg.areas.map((a) => ({ area: a, list: cfg.recipients.filter((r) => r.area === a) }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Análisis"
        title="Reporte diario"
        subtitle="PDF con indicadores, gráficos y decisiones operativas · lunes a viernes a las 6:00 p. m. vía n8n"
        actions={
          <>
            <a className="btn" href="/api/report/pdf" target="_blank" rel="noreferrer">
              Ver PDF de hoy
            </a>
            <button className="primary" disabled={busy || !cfg.recipients.length} onClick={sendNow}>
              Enviar ahora
            </button>
          </>
        }
      />
      {msg && (
        <div className="toast" onClick={() => setMsg("")}>
          {msg}
        </div>
      )}

      <div className="settings-grid">
        <section className="card pad">
          <h2 className="h">Destinatarios</h2>
          <p className="s">Reciben el PDF al cierre de la jornada y cada vez que se pulsa "Enviar ahora".</p>
          {byArea.map(({ area: a, list }) => (
            <div key={a} className="rep-area">
              <div className="rep-area-h">
                <b>{a}</b> <span className="s">{list.length} destinatario(s)</span>
              </div>
              <ul className="num-list">
                {list.length === 0 && <li className="s">Sin destinatarios en esta área.</li>}
                {list.map((r) => (
                  <li key={r.email}>
                    <span>
                      {r.name && <b>{r.name} · </b>}
                      {r.email}
                    </span>
                    <button className="sm" disabled={busy} onClick={() => save({ recipients: cfg.recipients.filter((x) => x.email !== r.email) }, `${r.email} ya no recibe el reporte`)}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="form rep-form">
            <label>
              <span>Correo</span>
              <input type="email" value={rec.email} onChange={(e) => setRec({ ...rec, email: e.target.value })} placeholder="gerencia@empresa.com" />
            </label>
            <label>
              <span>Nombre (opcional)</span>
              <input value={rec.name ?? ""} onChange={(e) => setRec({ ...rec, name: e.target.value })} placeholder="Ana Gómez" />
            </label>
            <label>
              <span>Área</span>
              <select value={rec.area} onChange={(e) => setRec({ ...rec, area: e.target.value })}>
                {cfg.areas.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="btnrow">
            <button
              className="sm primary"
              disabled={busy || !rec.email.trim() || !rec.area}
              onClick={async () => {
                if (await save({ recipients: [...cfg.recipients, { ...rec, name: rec.name || null }] }, `${rec.email} agregado a ${rec.area}`)) setRec({ email: "", name: "", area: rec.area });
              }}
            >
              Agregar destinatario
            </button>
          </div>
        </section>

        <section className="card pad">
          <h2 className="h">Áreas</h2>
          <p className="s">Agrupan a los destinatarios. Solo se puede quitar un área sin destinatarios.</p>
          <div className="chips">
            {cfg.areas.map((a) => {
              const used = cfg.recipients.some((r) => r.area === a);
              return (
                <span key={a} className="chip">
                  {a}
                  <button
                    title={used ? "Tiene destinatarios" : "Quitar área"}
                    disabled={busy || used}
                    onClick={() => save({ areas: cfg.areas.filter((x) => x !== a) }, `Área ${a} eliminada`)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <div className="btnrow">
            <input className="inline-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Nueva área (ej. Finanzas)" />
            <button
              className="sm primary"
              disabled={busy || !area.trim()}
              onClick={async () => {
                if (await save({ areas: [...cfg.areas, area] }, `Área ${area} creada`)) setArea("");
              }}
            >
              Agregar área
            </button>
          </div>

          <h2 className="h" style={{ marginTop: 22 }}>
            Conexión con n8n
          </h2>
          <p className="s">
            URL del webhook "Enviar ahora" del flujo en n8n. Si está vacía o n8n no responde, la app envía el reporte por su cuenta.
            {!cfg.key_set && <b className="warn-text"> Falta configurar REPORT_API_KEY en el servidor.</b>}
          </p>
          <div className="btnrow">
            <input className="inline-input" style={{ flex: 1 }} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://capricorne.app.n8n.cloud/webhook/capricorne-reporte" />
            <button className="sm" disabled={busy || hook === (cfg.n8n_webhook ?? "")} onClick={() => save({ n8n_webhook: hook || null }, hook ? "Webhook de n8n guardado" : "Webhook quitado: la app enviará el reporte")}>
              Guardar
            </button>
          </div>

          <h2 className="h" style={{ marginTop: 22 }}>
            Últimos envíos
          </h2>
          <ul className="num-list">
            {cfg.history.length === 0 && <li className="s">Aún no se ha enviado ningún reporte.</li>}
            {cfg.history.map((h, i) => (
              <li key={i} style={{ display: "block" }}>
                <span className={h.level === "error" ? "err-text" : h.level === "warn" ? "warn-text" : h.level === "success" ? "ok-text" : ""}>{h.message}</span>
                <div className="s">{fmt(h.created_at)}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
