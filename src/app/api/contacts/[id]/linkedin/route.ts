import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { fillFromProfile, prepareContacts } from "@/lib/pipeline";
import { withProvenance } from "@/lib/provenance";
import { buildProfile } from "@/lib/providers/linkedin";
import type { Contact, LinkedInCandidate, Profile } from "@/lib/types";

const EARLY = ["pending", "needs_review", "skipped", "linkedin_found"];

// Revisión humana: confirma un candidato de LinkedIn, una URL pegada a mano, un perfil de SignalHire
// (gratis, sin URL de LinkedIn) o descarta todos.
// Body: { url: string | null } | { signalhireUid: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { url?: string | null; signalhireUid?: string };
  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  const c = data as Contact | null;
  if (!c) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (c.status === "calling") return NextResponse.json({ error: "El contacto está en llamada" }, { status: 409 });
  const ready = EARLY.includes(c.status);

  if (body.signalhireUid) {
    const sh = c.profile?.signalhire;
    const p = [sh?.best, ...(sh?.others ?? [])].find((x) => x?.uid === body.signalhireUid);
    if (!sh || !p) return NextResponse.json({ error: "Ese perfil de SignalHire ya no está en la ficha; búscalo de nuevo" }, { status: 400 });
    const job = p.experience?.[0];
    const fill = fillFromProfile(c, job ? job.title : null, p.location);
    const profile = withProvenance(
      { ...(c.profile as Profile), signalhire: { ...sh, best: p, others: [sh.best, ...sh.others].filter((x): x is NonNullable<typeof x> => !!x && x.uid !== p.uid) }, headline: c.profile?.headline ?? (job ? `${job.title} @ ${job.company}` : null), location: c.profile?.location ?? p.location },
      {
        identity: { source: "SignalHire (elegido a mano, sin créditos)", detail: `${p.fullName}${job ? ` · ${job.title} @ ${job.company}` : ""}` },
        ...Object.fromEntries(Object.keys(fill).map((k) => [k, { source: "SignalHire (búsqueda gratuita)" }])),
      },
    );
    await updateContact(id, {
      linkedin_url: null,
      linkedin_source: "signalhire",
      linkedin_confidence: 1,
      profile,
      skip_reason: null,
      ...(ready ? { status: "linkedin_found" as const } : {}),
      ...fill,
    });
    await logEvent(id, "linkedin", `Identidad confirmada a mano con SignalHire: ${p.fullName}${job ? ` · ${job.title} @ ${job.company}` : ""}`, "success");
    if (ready) after(() => prepareContacts([id]));
    return NextResponse.json({ ok: true });
  }

  if (!body.url) {
    await updateContact(id, { status: "skipped", skip_reason: "Sin perfil de LinkedIn (revisión manual)" });
    await logEvent(id, "linkedin", "Revisión manual: ningún perfil corresponde → siguiente registro", "warn");
    return NextResponse.json({ ok: true });
  }

  const m = body.url.trim().match(/linkedin\.com\/(?:in|posts)\/([^/?#_]+)/i);
  if (!m) return NextResponse.json({ error: "Debe ser un perfil: https://www.linkedin.com/in/…" }, { status: 400 });
  const canonical = `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}`;
  const cand: LinkedInCandidate = (c.linkedin_candidates ?? []).find((x) => x.url === canonical) ?? {
    url: canonical,
    name: `${c.first_name} ${c.last_name}`,
    headline: null,
    location: null,
    snippet: "",
    sources: [],
    confidence: 1,
    reason: "ingresado a mano",
  };
  // Se reemplaza solo lo que viene del perfil elegido; SignalHire, empresa y teléfonos se conservan.
  const built = buildProfile(cand, c.profile?.company ?? null, c.profile?.queries ?? 0);
  const keptPhones = (c.profile?.phones ?? []).filter((p) => !(built.phones ?? []).some((x) => x.value === p.value));
  const profile = withProvenance(
    { ...(c.profile ?? {}), ...built, phones: [...(built.phones ?? []), ...keptPhones], signalhire: c.profile?.signalhire, provenance: c.profile?.provenance },
    { linkedin_url: { source: "Confirmado a mano en el panel", detail: cand.reason || null, url: canonical } },
  );

  await updateContact(id, {
    linkedin_url: canonical,
    linkedin_confidence: 1,
    linkedin_source: "manual",
    profile,
    skip_reason: null,
    ...(ready ? { status: "linkedin_found" as const } : {}),
    ...fillFromProfile(c, cand.headline, cand.location),
  });
  await logEvent(id, "linkedin", `Perfil confirmado a mano: ${canonical}`, "success");
  if (ready) after(() => prepareContacts([id]));
  return NextResponse.json({ ok: true });
}
