import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSlot, getAvailableSlots } from "@/lib/providers/calendar";
import { SlotPicker } from "./picker";

export const dynamic = "force-dynamic";

export default async function AgendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data: contact } = valid
    ? await db().from("contacts").select("id, first_name").eq("booking_token", token).maybeSingle()
    : { data: null };

  const brand = env.brandName();
  const event = env.eventName();

  let body: React.ReactNode;
  if (!contact) {
    body = <p className="bk-text">Este enlace no es válido o ya expiró. Responde el correo y con gusto te ayudamos.</p>;
  } else {
    const { data: meeting } = await db()
      .from("meetings")
      .select("starts_at, meet_url")
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (meeting) {
      body = (
        <>
          <p className="bk-text">
            Hola, {contact.first_name}. Tu conversación ya está agendada para el <strong>{formatSlot(meeting.starts_at)}</strong> (hora
            Colombia). Revisa tu correo: ahí está la invitación con el enlace de Google Meet.
          </p>
        </>
      );
    } else {
      const slots = await getAvailableSlots(6);
      body = (
        <>
          <p className="bk-text">
            Hola, {contact.first_name}. Elige el horario que mejor te quede para una conversación de {env.meetingMinutes()} minutos con
            el especialista de {brand}. Todos los horarios están en hora Colombia.
          </p>
          <SlotPicker token={token} slots={slots.map((s) => ({ start: s.start, label: s.label }))} />
        </>
      );
    }
  }

  return (
    <main className="bk">
      <div className="bk-card">
        <div className="bk-head">
          <span className="bk-brand">{brand}</span>
          <span className="bk-chip">{event.toUpperCase()}</span>
        </div>
        <div className="bk-bar" />
        <div className="bk-body">
          <p className="bk-eyebrow">Agendar conversación</p>
          <h1 className="bk-title">Hablemos de tu proyecto</h1>
          {body}
        </div>
        <p className="bk-foot">
          Equipo {env.companyName()} · en nombre de {brand}
        </p>
      </div>
    </main>
  );
}
