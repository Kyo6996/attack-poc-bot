import { Logo } from "../sidebar";
import { LoginForm } from "./form";

export const metadata = { title: "Iniciar sesión · Capricorne Project" };

const STEPS = [
  ["Identifica", "Perfil de LinkedIn y ficha de la empresa"],
  ["Enriquece", "Teléfono y correo profesional"],
  ["Llama", "Agente de voz con IA que sigue el guion"],
  ["Agenda", "Reunión con Meet e invitación al cliente"],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="login">
      <section className="login-brand">
        <div className="login-logo">
          <Logo size={44} />
          <div>
            <b>Capricorne</b>
            <span>Project</span>
          </div>
        </div>
        <h1>Prospección B2B que trabaja sola, de punta a punta.</h1>
        <ol className="login-steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="n">{i + 1}</span>
              <div>
                <b>{t}</b>
                <small>{d}</small>
              </div>
            </li>
          ))}
        </ol>
        <p className="login-foot">Attack · seguimiento de ANDICOM 2026</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>Inicia sesión</h2>
          <p className="s">Accede al panel de operación del bot.</p>
          <LoginForm next={safeNext} />
        </div>
      </section>
    </main>
  );
}
