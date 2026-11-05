import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { fillFromProfile } from "@/lib/pipeline";
import { withProvenance } from "@/lib/provenance";
import { buildProfile } from "@/lib/providers/linkedin";
import type { Contact, LinkedInCandidate } from "@/lib/types";

const EARLY = ["pending", "needs_review", "skipped", "linkedin_found"];

// Revisión humana: confirma un candidato (o una URL pegada a mano) o descarta todos.
// Body: { url: string | null }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { url } = (await req.json()) as { url: string | null };
  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  const c = data as Contact | null;
  if (!c) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (c.status === "calling") return NextResponse.json({ error: "El contacto está en llamada" }, { status: 409 });

  if (!url) {
    await updateContact(id, { status: "skipped", skip_reason: "Sin perfil de LinkedIn (revisión manual)" });
    await logEvent(id, "linkedin", "Revisión manual: ningún perfil corresponde → siguiente registro", "warn");
    return NextResponse.json({ ok: true });
  }

  const m = url.trim().match(/linkedin\.com\/(?:in|posts)\/([^/?#_]+)/i);
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
  const profile = withProvenance(
    { ...buildProfile(cand, c.profile?.company ?? null, c.profile?.queries ?? 0), provenance: c.profile?.provenance },
    { linkedin_url: { source: "Confirmado a mano en el panel", detail: cand.reason || null, url: canonical } },
  );

  await updateContact(id, {
    linkedin_url: canonical,
    linkedin_confidence: 1,
    linkedin_source: "manual",
    profile,
    skip_reason: null,
    ...(EARLY.includes(c.status) ? { status: "linkedin_found" as const } : {}),
    ...fillFromProfile(c, cand.headline, cand.location),
  });
  await logEvent(id, "linkedin", `Perfil confirmado a mano: ${canonical}`, "success");
  return NextResponse.json({ ok: true });
}
