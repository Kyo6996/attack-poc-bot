"use client";

import { PageHeader } from "@/app/ui";
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
    <div className="page">
      <PageHeader eyebrow="Configuración" title="Voz del agente" subtitle="Elige cómo suena el agente en las llamadas y pruébalo desde el navegador" />

      <section className="card pad">
        <h2 className="h">Voz para las llamadas</h2>
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
      <h2 className="h">Probar el agente en el navegador</h2>
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
