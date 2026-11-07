import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security";
import { applyEnrichment, runPipeline } from "@/lib/pipeline";
import { checkMobile, parseSignalHireItem, type SignalHireCallbackItem } from "@/lib/providers/enrichment";
import { withProvenance } from "@/lib/provenance";
import type { Contact, ContactPhone, ContactStatus } from "@/lib/types";
import { maskPhone } from "@/lib/util";

const READY_FROM: ContactStatus[] = ["pending", "linkedin_found", "needs_review", "skipped", "no_answer", "call_failed", "declined", "phone_found"];

// SignalHire exige un 200 en menos de 10 s, por eso la llamada se dispara con after().
export async function POST(req: NextRequest) {
  if (!safeEqual(req.nextUrl.searchParams.get("token"), env.webhookSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const contactId = req.nextUrl.searchParams.get("contact");
  const items = (await req.json()) as SignalHireCallbackItem[];

  if (req.nextUrl.searchParams.get("mode") === "reveal" && contactId) {
    await saveReveal(contactId, items[0]);
    return NextResponse.json({ ok: true });
  }

  for (const item of items) {
    let q = db().from("contacts").select("*").eq("status", "enriching");
    q = contactId ? q.eq("id", contactId) : q.eq("linkedin_url", item.item);
    const { data } = await q.maybeSingle();
    if (!data) continue;
    await applyEnrichment(data as Contact, parseSignalHireItem(item));
  }

  after(async () => {
    try {
      await runPipeline({ contactId: contactId ?? undefined });
    } catch (e) {
      await logEvent(contactId, "system", `Error tras callback: ${(e as Error).message}`, "error");
    }
  });

  return NextResponse.json({ ok: true });
}

// Revelado manual (con crédito): se guarda todo y el celular pasa a ser el número para llamar
// salvo que ya haya uno elegido a mano.
async function saveReveal(contactId: string, item: SignalHireCallbackItem | undefined) {
  const { data } = await db().from("contacts").select("*").eq("id", contactId).single();
  const c = data as Contact | null;
  if (!c?.profile?.signalhire) return;

  const contacts = item?.status === "success" ? (item.candidate?.contacts ?? []) : [];
  const phones = contacts.filter((x) => x.type === "phone").map((x) => ({ value: x.value, subType: x.subType ?? null }));
  const emails = contacts.filter((x) => x.type === "email").map((x) => ({ value: x.value, subType: x.subType ?? null }));
  const now = new Date().toISOString();

  const valid: ContactPhone[] = [];
  for (const p of phones) {
    const ok = checkMobile(p.value);
    if ("phone" in ok) valid.push({ value: ok.phone, type: "celular", source: `SignalHire (crédito${p.subType ? `, ${p.subType}` : ""})`, owner: "persona" });
  }
  const workEmail = emails.find((e) => e.subType === "work")?.value ?? emails[0]?.value ?? null;

  const manual = !!c.enrichment_source?.startsWith("manual") && !!c.phone;
  const usePhone = !manual && valid[0] ? valid[0].value : null;
  const profile = withProvenance(
    {
      ...c.profile,
      signalhire: {
        ...c.profile.signalhire,
        reveal: { ...c.profile.signalhire.reveal!, status: phones.length || emails.length ? "listo" : "sin datos", phones, emails, received_at: now },
      },
      phones: [...(c.profile.phones ?? []), ...valid.filter((p) => !(c.profile!.phones ?? []).some((x) => x.value === p.value))],
    },
    {
      ...(usePhone ? { phone: { source: "SignalHire (crédito autorizado)" } } : {}),
      ...(!c.email && workEmail ? { email: { source: "SignalHire (crédito autorizado)" } } : {}),
    },
  );

  await updateContact(contactId, {
    profile,
    ...(usePhone ? { phone: usePhone, enrichment_source: "SignalHire (crédito)", ...(READY_FROM.includes(c.status) ? { status: "phone_found" as const, skip_reason: null } : {}) } : {}),
    ...(!c.email && workEmail ? { email: workEmail.toLowerCase() } : {}),
  });
  await logEvent(
    contactId,
    "enrichment",
    phones.length || emails.length
      ? `SignalHire reveló ${phones.length} teléfono(s) y ${emails.length} correo(s)${usePhone ? ` · se usará ${maskPhone(usePhone)}` : ""}`
      : `SignalHire no tenía contactos para esta persona (${item?.status ?? "sin respuesta"})`,
    phones.length || emails.length ? "success" : "warn",
  );
}
