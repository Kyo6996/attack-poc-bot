"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "No se pudo iniciar sesión");
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Usuario
        <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus placeholder="Tu nombre" required />
      </label>
      <label>
        Contraseña
        <span className="pw">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••••••"
            required
          />
          <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {show ? "Ocultar" : "Ver"}
          </button>
        </span>
      </label>
      {error && <p className="login-error">{error}</p>}
      <button className="primary login-btn" disabled={busy || !user.trim() || !password}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
