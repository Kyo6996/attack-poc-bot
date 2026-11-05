"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Contact } from "@/lib/types";
import { VOICE_OPTIONS, type AgentVoice } from "@/lib/voices";

type VapiClient = {
  start: (assistant: unknown) => Promise<unknown>;
  stop: () => Promise<void>;
  on: (event: string, cb: (...args: never[]) => void) => void;
};

interface Line {
  role: "assistant" | "user";
  text: string;
}

const PRESETS = [
  "¡Hola! ¿Hablo con Hans? Soy Sofía, del equipo que apoya a Attack. Te contacto porque estuviste con nosotros en ANDICOM.",
  "Uy, qué buen proyecto. Tiene todo el sentido. ¿Y en qué etapa están: explorando, evaluando opciones o ya en ejecución?",
  "Te entiendo perfectamente. Son solo quince minutos y lo agendamos cuando te quede cómodo. ¿Esta semana o la próxima?",
  "¡Listo! Quedó agendada para mañana jueves a las nueve de la mañana. Te va a atender Carolina, y antes te escribe para conocer tu proyecto.",
];

export default function VocesPage() {
  const [saved, setSaved] = useState<AgentVoice | null>(null);
  const [draft, setDraft] = useState<AgentVoice | null>(null);
  const [custom, setCustom] = useState(false);
  const [msg, setMsg] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const v = j.settings?.agent_voice as AgentVoice;
        setSaved(v);
        setDraft(v);
        setCustom(!VOICE_OPTIONS.some((o) => o.voiceId === v?.voiceId && o.provider === v?.provider));
        setContacts((j.contacts ?? []).filter((c: Contact) => c.consent));
      });
  }, []);

  async function save() {
    if (!draft) return;
    setMsg("Validando la voz con Vapi…");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_voice: draft }),
    });
    const json = await res.json();
    if (!res.ok) setMsg(json.error);
    else {
      setSaved(json.agent_voice);
      setMsg("Voz guardada: las próximas llamadas y la prueba en el navegador la usan.");
    }
  }

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>
            Voces del agente <span>· Attack POC</span>
          </h1>
          <div className="sub">Elige cómo suena el agente en las llamadas, pruébalo en el navegador y compara con Chatterbox</div>
        </div>
        <nav className="nav">
          <Link className="btn" href="/">
            ← Operación
          </Link>
          <Link className="btn" href="/sla">
            Desempeño y SLA
          </Link>
        </nav>
      </header>

      <section className="card pad">
        <h2 className="h">1 · Voz del agente en las llamadas</h2>
        {!draft ? (
          <p className="s">Cargando…</p>
        ) : (
          <>
            {(["ElevenLabs", "Azure"] as const).map((group) => (
              <div key={group}>
                <div className="voice-group">
                  {group === "ElevenLabs" ? "ElevenLabs · más naturales (escucha la muestra de cada voz)" : "Azure · voces actuales"}
                </div>
                <div className="voice-grid">
                  {VOICE_OPTIONS.filter((o) => o.group === group).map((o) => {
                    const on = !custom && draft.voiceId === o.voiceId && draft.provider === o.provider;
                    return (
                      <div key={o.id} className={on ? "voice on" : "voice"}>
                        <button
                          className="voice-pick"
                          onClick={() => {
                            setCustom(false);
                            setDraft({ ...draft, provider: o.provider, voiceId: o.voiceId, agentName: o.agentName, model: o.model });
                          }}
                        >
                          <b>{o.label}</b>
                          <span className="s">{o.accent}</span>
                        </button>
                        {o.sample && <SamplePlayer src={o.sample} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="voice-grid">
              <button className={custom ? "voice on" : "voice"} onClick={() => setCustom(true)}>
                <b>Otra voz</b>
                <span className="s">ElevenLabs, Cartesia, Vapi…</span>
                <span className="s">proveedor + ID de voz</span>
              </button>
            </div>
            <div className="form" style={{ maxWidth: 640 }}>
              {custom && (
                <>
                  <label>
                    <span>Proveedor (Vapi)</span>
                    <input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} placeholder="11labs" />
                  </label>
                  <label>
                    <span>ID de voz</span>
                    <input value={draft.voiceId} onChange={(e) => setDraft({ ...draft, voiceId: e.target.value })} placeholder="ID de la voz" />
                  </label>
                </>
              )}
              <label>
                <span>Nombre con el que se presenta</span>
                <input value={draft.agentName} onChange={(e) => setDraft({ ...draft, agentName: e.target.value })} />
              </label>
              <label>
                <span>Velocidad: {draft.speed.toFixed(2)}×</span>
                <input type="range" min={0.8} max={1.2} step={0.05} value={draft.speed} onChange={(e) => setDraft({ ...draft, speed: Number(e.target.value) })} />
              </label>
            </div>
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button className="primary" onClick={save} disabled={!dirty}>
                Guardar voz
              </button>
              <span className="msg">{msg || (saved ? `Actual: ${saved.voiceId} · ${saved.agentName} · ${saved.speed}×` : "")}</span>
            </div>
          </>
        )}
      </section>

      <BrowserTest contacts={contacts} disabled={dirty} />
      <ChatterboxLab />
      <LiveNumbers />
    </div>
  );
}

function BrowserTest({ contacts, disabled }: { contacts: Contact[]; disabled: boolean }) {
  const vapi = useRef<VapiClient | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [contactId, setContactId] = useState("");
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setLines([]);
    setState("connecting");
    try {
      const res = await fetch(`/api/voice/preview${contactId ? `?contactId=${contactId}` : ""}`);
      const cfg = await res.json();
      if (!res.ok) throw new Error(cfg.error);
      if (!vapi.current) {
        const { default: Vapi } = await import("@vapi-ai/web");
        const client = new Vapi(cfg.publicKey) as unknown as VapiClient;
        client.on("call-start", () => setState("live"));
        client.on("call-end", () => {
          setState("idle");
          setSpeaking(false);
        });
        client.on("speech-start", () => setSpeaking(true));
        client.on("speech-end", () => setSpeaking(false));
        client.on("error", ((e: unknown) => {
          setError(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Error en la llamada");
          setState("idle");
        }) as never);
        client.on("message", ((m: { type?: string; transcriptType?: string; role?: "assistant" | "user"; transcript?: string }) => {
          if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
            setLines((ls) => [...ls, { role: m.role ?? "assistant", text: m.transcript! }]);
          }
        }) as never);
        vapi.current = client;
      }
      await vapi.current.start(cfg.assistant);
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  return (
    <section className="card pad">
      <h2 className="h">2 · Probar el agente en el navegador</h2>
      <p className="s" style={{ marginTop: 0 }}>
        Habla con el agente usando tu micrófono, con la voz guardada y el guion de ANDICOM. No pasa por Twilio (solo consume créditos de Vapi) y no agenda
        de verdad: en esta prueba simula los horarios.
      </p>
      <div className="btnrow">
        <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={state !== "idle"}>
          <option value="">Contacto de ejemplo</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              Como si llamara a {c.first_name} {c.last_name}
            </option>
          ))}
        </select>
        {state === "idle" ? (
          <button className="primary" onClick={start} disabled={disabled} title={disabled ? "Guarda la voz antes de probarla" : ""}>
            🎙 Iniciar prueba
          </button>
        ) : (
          <button onClick={() => vapi.current?.stop()}>■ Terminar</button>
        )}
        {state === "connecting" && <span className="msg">Conectando… (acepta el permiso del micrófono)</span>}
        {state === "live" && <span className={`live-dot ${speaking ? "on" : ""}`}>{speaking ? "El agente está hablando" : "Escuchando…"}</span>}
        {disabled && <span className="msg">Guarda la voz para probarla.</span>}
      </div>
      {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      {lines.length > 0 && (
        <div className="transcript">
          {lines.map((l, i) => (
            <p key={i} className={l.role}>
              <b>{l.role === "assistant" ? "Agente" : "Tú"}:</b> {l.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function ChatterboxLab() {
  const [text, setText] = useState(PRESETS[0]);
  const [exaggeration, setExaggeration] = useState(0.6);
  const [cfg, setCfg] = useState(0.4);
  const [temperature, setTemperature] = useState(0.8);
  const [reference, setReference] = useState<{ name: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clips, setClips] = useState<{ url: string; text: string; seconds: number; settings: string }[]>([]);

  async function pickReference(f: File | undefined) {
    if (!f) return;
    if (f.size > 3_000_000) {
      setError("El audio de referencia debe pesar menos de 3 MB (3 a 10 segundos es suficiente).");
      return;
    }
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(f);
    });
    setReference({ name: f.name, data });
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/voice/chatterbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, exaggeration, cfg, temperature, reference: reference?.data ?? null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setClips((c) => [
        { url: json.url, text, seconds: json.seconds, settings: `expresividad ${exaggeration} · cfg ${cfg} · temp ${temperature}${reference ? " · voz clonada" : ""}` },
        ...c,
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad">
      <h2 className="h">3 · Laboratorio Chatterbox (Resemble AI)</h2>
      <p className="s" style={{ marginTop: 0 }}>
        Modelo abierto <b>Chatterbox Multilingual</b> en español, alojado en Replicate. Sirve para comparar cómo suena. Para usarlo en llamadas en vivo
        haría falta un servidor con GPU: hoy tarda unos segundos por frase. Las etiquetas de suspiros y risas (<span className="mono">[sigh]</span>,{" "}
        <span className="mono">[laugh]</span>) solo existen en sus versiones en inglés; en español la emoción se controla con la expresividad.
      </p>
      <div className="btnrow">
        {PRESETS.map((p, i) => (
          <button key={i} className="sm" onClick={() => setText(p)}>
            Frase {i + 1}
          </button>
        ))}
      </div>
      <div className="form">
        <label className="wide">
          <span>Texto ({text.length}/300)</span>
          <textarea rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label>
          <span>Expresividad: {exaggeration}</span>
          <input type="range" min={0.25} max={1.5} step={0.05} value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))} />
          <small className="s">0,5 neutral · más alto = más emoción</small>
        </label>
        <label>
          <span>Ritmo (cfg): {cfg}</span>
          <input type="range" min={0.2} max={1} step={0.05} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} />
          <small className="s">más bajo = más pausado y natural</small>
        </label>
        <label>
          <span>Variación (temperatura): {temperature}</span>
          <input type="range" min={0.3} max={1.5} step={0.05} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
        </label>
        <label>
          <span>Clonar una voz (opcional)</span>
          <input type="file" accept="audio/*" onChange={(e) => pickReference(e.target.files?.[0])} />
          <small className="s">{reference ? `Usando ${reference.name}` : "3 a 10 segundos de audio limpio. Solo voces con permiso de su dueño."}</small>
        </label>
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="primary" onClick={generate} disabled={busy || !text.trim()}>
          {busy ? "Generando… (unos segundos)" : "▶ Generar y escuchar"}
        </button>
        {reference && (
          <button className="sm" onClick={() => setReference(null)}>
            Quitar voz clonada
          </button>
        )}
      </div>
      {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      {clips.map((c, i) => (
        <div key={c.url + i} className="clip">
          <audio controls src={c.url} autoPlay={i === 0} />
          <div>
            <div>{c.text}</div>
            <div className="s">
              {c.settings} · generado en {c.seconds} s
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function LiveNumbers() {
  const [numbers, setNumbers] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setNumbers(j.live_numbers ?? []));
  useEffect(() => {
    load();
  }, []);

  async function update(body: Record<string, string>) {
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) setMsg(json.error);
    else {
      setNumbers(json.live_numbers);
      setMsg("Lista actualizada");
      setInput("");
    }
  }

  return (
    <section className="card pad">
      <h2 className="h">4 · Números autorizados para llamada real</h2>
      <p className="s" style={{ marginTop: 0 }}>
        Solo estos números reciben una llamada real; al resto el bot los llama en modo simulado. Agrega únicamente números de personas que dieron su
        consentimiento (Ley 1581). También puedes autorizarlos desde el detalle de cada contacto.
      </p>
      {numbers === null ? (
        <p className="s">Cargando…</p>
      ) : (
        <ul className="list">
          {numbers.length === 0 && <li className="s">Ninguno: todas las llamadas son simuladas.</li>}
          {numbers.map((n) => (
            <li key={n} className="mono">
              {n}{" "}
              <button className="sm" onClick={() => update({ revoke: n })}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="btnrow">
        <input className="inline-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="+57 300 000 0000" />
        <button className="sm" disabled={!input.trim()} onClick={() => update({ authorize: input })}>
          Autorizar número
        </button>
        <span className="msg">{msg}</span>
      </div>
    </section>
  );
}

function SamplePlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <button
        className="sm sample-btn"
        onClick={() => {
          const a = ref.current;
          if (!a) return;
          if (playing) a.pause();
          else {
            document.querySelectorAll("audio").forEach((x) => x !== a && x.pause());
            a.currentTime = 0;
            a.play();
          }
        }}
      >
        {playing ? "■ Detener" : "▶ Escuchar muestra"}
      </button>
      <audio ref={ref} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </>
  );
}
