"use client";

import { useState } from "react";

const AREAS = [
  { id: "dispositivos", label: "Dispositivos" },
  { id: "infraestructura", label: "Infraestructura" },
  { id: "servicios", label: "Servicios" },
  { id: "IA", label: "Inteligencia artificial" },
];

export function LeadForm({ origin, company, brand }: { origin: string; company: string; brand: string }) {
  const [f, setF] = useState({ first_name: "", last_name: "", company: "", title: "", phone: "", email: "", city: "", notes: "", website: "" });
  const [interests, setInterests] = useState<string[]>([]);
  const [preference, setPreference] = useState<"llamada" | "correo">("llamada");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ preference: string; bookingToken?: string } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const canSend = f.first_name.trim() && (f.phone.trim() || f.email.trim()) && consent;
  const pref = f.phone.trim() ? preference : "correo";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const res = await fetch("/api/public/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, interests, preference: pref, consent, origin }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No pudimos enviar tus datos.");
      setState("idle");
      return;
    }
    setResult(json);
    setState("done");
  }

  if (state === "done") {
    return (
      <div className="bk-ok">
        <strong>¡Gracias, {f.first_name}! Recibimos tus datos.</strong>
        <p>
          {result?.preference === "llamada"
            ? "En unos minutos te llamará nuestra asistente para entender tu proyecto y coordinar la conversación con el especialista."
            : "Te enviamos un correo con la información y el enlace para agendar cuando quieras."}
        </p>
        {result?.bookingToken && (
          <p>
            ¿Prefieres elegir el horario ya?{" "}
            <a href={`/agendar/${result.bookingToken}`} style={{ color: "#E2231A", fontWeight: 700 }}>
              Agendar ahora →
            </a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="lead" onSubmit={submit} noValidate>
      <div className="lead-grid">
        <label>
          Nombre *
          <input value={f.first_name} onChange={set("first_name")} autoComplete="given-name" required />
        </label>
        <label>
          Apellidos
          <input value={f.last_name} onChange={set("last_name")} autoComplete="family-name" />
        </label>
        <label>
          Celular
          <input value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="300 123 4567" />
        </label>
        <label>
          Correo
          <input value={f.email} onChange={set("email")} inputMode="email" autoComplete="email" placeholder="nombre@empresa.com" />
        </label>
        <label>
          Empresa
          <input value={f.company} onChange={set("company")} autoComplete="organization" />
        </label>
        <label>
          Cargo
          <input value={f.title} onChange={set("title")} autoComplete="organization-title" />
        </label>
        <label>
          Ciudad
          <input value={f.city} onChange={set("city")} autoComplete="address-level2" />
        </label>
      </div>
      <p className="lead-hint">* Solo el nombre y un celular o un correo son necesarios.</p>

      <fieldset>
        <legend>¿Qué temas te interesan?</legend>
        <div className="chips-pick">
          {AREAS.map((a) => (
            <button
              type="button"
              key={a.id}
              className={interests.includes(a.id) ? "pick on" : "pick"}
              onClick={() => setInterests((xs) => (xs.includes(a.id) ? xs.filter((x) => x !== a.id) : [...xs, a.id]))}
            >
              {a.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="full">
        Cuéntanos brevemente qué te gustaría resolver (opcional)
        <textarea rows={2} value={f.notes} onChange={set("notes")} />
      </label>

      <fieldset>
        <legend>¿Cómo prefieres que te contactemos?</legend>
        <div className="chips-pick">
          <button type="button" className={pref === "llamada" ? "pick on" : "pick"} onClick={() => setPreference("llamada")} disabled={!f.phone.trim()}>
            Llamada
          </button>
          <button type="button" className={pref === "correo" ? "pick on" : "pick"} onClick={() => setPreference("correo")}>
            Correo
          </button>
        </div>
      </fieldset>

      {/* Campo trampa: los bots lo llenan, las personas no lo ven */}
      <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} aria-hidden="true" />

      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          Autorizo a {company} a contactarme en nombre de {brand} y a tratar estos datos solo para este fin, conforme a la Ley 1581 de 2012. Puedo pedir
          que los eliminen cuando quiera.
        </span>
      </label>

      {error && <p className="bk-err">{error}</p>}
      <button className="bk-cta" disabled={!canSend || state === "sending"}>
        {state === "sending" ? "Enviando…" : "Quiero que me contacten"}
      </button>
    </form>
  );
}
