"use client";

import { useState } from "react";

export function SlotPicker({ token, slots }: { token: string; slots: { start: string; label: string }[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [result, setResult] = useState<{ when?: string; rep?: string | null; error?: string }>({});

  async function confirm() {
    if (!chosen) return;
    setState("saving");
    const res = await fetch("/api/public/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, start: chosen }),
    });
    const json = await res.json();
    if (res.ok) {
      setResult({ when: json.when, rep: json.rep });
      setState("done");
    } else {
      setResult({ error: json.error });
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="bk-ok">
        <strong>¡Listo! Quedó agendada para el {result.when}.</strong>
        {result.rep && <p>Te atenderá {result.rep}, que te escribirá antes de la reunión para preparar la conversación.</p>}
        <p>En unos minutos te llega la invitación con el enlace de Google Meet.</p>
      </div>
    );
  }

  if (slots.length === 0) return <p className="bk-text">Por ahora no hay horarios disponibles. Responde el correo y te contactamos.</p>;

  return (
    <>
      <div className="bk-slots">
        {slots.map((s) => (
          <button key={s.start} className={chosen === s.start ? "bk-slot on" : "bk-slot"} onClick={() => setChosen(s.start)}>
            {s.label.charAt(0).toUpperCase() + s.label.slice(1)}
          </button>
        ))}
      </div>
      {result.error && <p className="bk-err">{result.error}</p>}
      <button className="bk-cta" disabled={!chosen || state === "saving"} onClick={confirm}>
        {state === "saving" ? "Agendando…" : "Confirmar horario"}
      </button>
    </>
  );
}
