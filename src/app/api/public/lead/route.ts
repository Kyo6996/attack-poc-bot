import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { prepareContacts, runPipeline } from "@/lib/pipeline";
import { clientIp, countRecent, recordHit } from "@/lib/security";
import { getSettings, setSetting } from "@/lib/settings";
import { toE164 } from "@/lib/util";

export const maxDuration = 60;

const AREAS = ["dispositivos", "infraestructura", "servicios", "IA"];
// Topes para que nadie use el formulario para llenar la base o hacer que el bot llame a terceros.
const PER_IP_10MIN = 3;
const PER_IP_DAY = 10;
const ALL_PER_HOUR = 60;
const AUTO_CALLS_PER_DAY = 25;

const clean = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;

// Formulario público (QR). Pide lo necesario para contactar sin obligar a llenarlo todo.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const tooMany =
    (await countRecent("lead", 600, ip)) >= PER_IP_10MIN || (await countRecent("lead", 86400, ip)) >= PER_IP_DAY || (await countRecent("lead", 3600)) >= ALL_PER_HOUR;
  if (tooMany) return NextResponse.json({ error: "Demasiados intentos. Intenta de nuevo en unos minutos." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > 8000) return NextResponse.json({ error: "Solicitud demasiado grande" }, { status: 413 });
  await recordHit("lead", ip);

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.website) return NextResponse.json({ ok: true }); // campo trampa: lo llenan los bots, no las personas

  const firstName = clean(b.first_name, 60);
  const email = clean(b.email, 120)?.toLowerCase() ?? null;
  const rawPhone = clean(b.phone, 30);
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (!firstName) return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
  if (!phone && !email) return NextResponse.json({ error: "Déjanos al menos un celular o un correo para contactarte." }, { status: 400 });
  if (rawPhone && !phone) return NextResponse.json({ error: "Revisa el celular: escríbelo con 10 dígitos, por ejemplo 300 123 4567." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Revisa el correo." }, { status: 400 });
  if (b.consent !== true) return NextResponse.json({ error: "Necesitamos tu autorización para contactarte." }, { status: 400 });

  const interests = Array.isArray(b.interests) ? (b.interests as string[]).filter((i) => AREAS.includes(i)) : [];
  const preference = b.preference === "correo" || !phone ? "correo" : "llamada";
  const origin = clean(b.origin, 30)?.replace(/[^\w-]/g, "") || "qr";
  const notes = [interests.length ? `Le interesa: ${interests.join(", ")}` : null, clean(b.notes, 400)].filter(Boolean).join(". ");

  const { data: row, error } = await db()
    .from("contacts")
    .insert({
      first_name: firstName,
      last_name: clean(b.last_name, 80) ?? "",
      company: clean(b.company),
      title: clean(b.title),
      city: clean(b.city, 60),
      email,
      phone,
      enrichment_source: phone ? "manual · formulario QR" : null,
      consent: true,
      event_notes: notes || null,
      qualification: interests.length ? { area_interes: interests[0] } : null,
      source: `qr:${origin}`,
      contact_preference: preference,
    })
    .select("id, booking_token")
    .single();
  if (error) return NextResponse.json({ error: "No pudimos guardar tus datos. Intenta de nuevo." }, { status: 500 });

  await logEvent(row.id, "system", `Nuevo registro por QR (${origin}) · prefiere ${preference}`, "success");

  // Quien deja su celular colombiano y autoriza el contacto puede recibir la llamada real del bot (con tope diario).
  const autoCall = !!phone && preference === "llamada" && /^\+573\d{9}$/.test(phone) && (await countRecent("auto-call", 86400)) < AUTO_CALLS_PER_DAY;
  if (autoCall) {
    const s = await getSettings();
    if (!s.live_numbers.includes(phone!)) await setSetting("live_numbers", [...s.live_numbers, phone!]);
    await recordHit("auto-call");
  } else if (phone && preference === "llamada") {
    await logEvent(row.id, "system", "Celular no autorizado para llamada automática (no es celular colombiano o se alcanzó el tope diario): lo revisa el equipo", "warn");
  }

  after(async () => {
    try {
      await prepareContacts([row.id]);
      if (preference === "llamada") await runPipeline({ contactId: row.id });
      else if (email) await sendEmail("seguimiento", row.id);
    } catch (e) {
      await logEvent(row.id, "system", `Error al procesar el registro: ${(e as Error).message}`, "error");
    }
  });

  return NextResponse.json({ ok: true, preference, bookingToken: row.booking_token });
}
