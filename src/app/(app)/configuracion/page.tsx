"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/app/ui";

interface Settings {
  live_calls: boolean;
  live_numbers: string[];
}

async function post(body: unknown): Promise<{ ok: boolean; json: Settings & { error?: string } }> {
  const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, json: await res.json() };
}

export default function ConfiguracionPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then(setS);
  }, []);

  async function update(body: unknown, ok: string) {
    const r = await post(body);
    if (!r.ok) setMsg(r.json.error ?? "No se pudo guardar");
    else {
      setS(r.json);
      setMsg(ok);
      setInput("");
    }
  }

  async function reset() {
    if (!confirm("¿Reiniciar la demo? Se cancelan las reuniones (también en Google Calendar), se borran correos, llamadas y bitácora, y todos los contactos vuelven a 'Pendiente'.")) return;
    const res = await fetch("/api/demo/reset", { method: "POST" });
    setMsg(res.ok ? "Demo reiniciada" : "No se pudo reiniciar");
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Configuración" title="Llamadas y números" subtitle="Controla cuándo el bot llama de verdad y a quién" />
      {msg && (
        <div className="toast" onClick={() => setMsg("")}>
          {msg}
        </div>
      )}
      {!s ? (
        <p className="s">Cargando…</p>
      ) : (
        <div className="settings-grid">
          <section className="card pad">
            <h2 className="h">Llamadas reales</h2>
            <p className="s">
              Apágalas para probar el flujo completo sin gastar saldo de Twilio ni de Vapi: el bot simula las llamadas con el mismo guion y la misma
              agenda.
            </p>
            <label className="switch">
              <input type="checkbox" checked={s.live_calls} onChange={(e) => update({ live_calls: e.target.checked }, e.target.checked ? "Llamadas reales activadas" : "Llamadas simuladas")} />
              <span className="track">
                <span className="thumb" />
              </span>
              <b>{s.live_calls ? "Activadas" : "Simuladas"}</b>
            </label>
          </section>

          <section className="card pad">
            <h2 className="h">Números autorizados</h2>
            <p className="s">
              Solo estos números reciben una llamada real; a los demás el bot los llama en modo simulado. Agrega únicamente personas que dieron su
              consentimiento (Ley 1581). Los registros por QR que eligen llamada se autorizan solos.
            </p>
            <ul className="num-list">
              {s.live_numbers.length === 0 && <li className="s">Ninguno: todas las llamadas son simuladas.</li>}
              {s.live_numbers.map((n) => (
                <li key={n}>
                  <span className="mono">{n}</span>
                  <button className="sm" onClick={() => update({ revoke: n }, `${n} vuelve a llamada simulada`)}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
            <div className="btnrow">
              <input className="inline-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="+57 300 000 0000" />
              <button className="sm primary" disabled={!input.trim()} onClick={() => update({ authorize: input }, `${input} autorizado`)}>
                Autorizar número
              </button>
            </div>
          </section>

          <section className="card pad danger-zone">
            <h2 className="h">Reiniciar demo</h2>
            <p className="s">Deja todo listo para volver a grabar o presentar. No borra contactos ni comerciales.</p>
            <button className="danger" onClick={reset}>
              Reiniciar demo
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
