import { env } from "@/lib/env";
import { LeadForm } from "./form";

export const dynamic = "force-dynamic";

export default async function RegistroPage({ searchParams }: { searchParams: Promise<{ origen?: string }> }) {
  const { origen } = await searchParams;
  return (
    <main className="bk">
      <div className="bk-card">
        <div className="bk-head">
          <span className="bk-brand">{env.brandName()}</span>
          <span className="bk-chip">{env.eventName().toUpperCase()}</span>
        </div>
        <div className="bk-bar" />
        <div className="bk-body">
          <p className="bk-eyebrow">Hablemos de tu proyecto</p>
          <h1 className="bk-title">Déjanos tus datos y un especialista te contacta</h1>
          <p className="bk-text">
            Una conversación de {env.meetingMinutes()} minutos sobre dispositivos, infraestructura, servicios o inteligencia artificial. Solo te pedimos lo
            necesario para contactarte.
          </p>
          <LeadForm origin={origen ?? "qr"} company={env.companyName()} brand={env.brandName()} />
        </div>
        <p className="bk-foot">
          Equipo {env.companyName()} · en nombre de {env.brandName()}
        </p>
      </div>
    </main>
  );
}
