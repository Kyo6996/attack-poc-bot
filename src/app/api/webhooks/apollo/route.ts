import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { env } from "@/lib/env";
import { parseApolloPhones } from "@/lib/providers/apollo";
import { withProvenance } from "@/lib/provenance";
import type { Contact, ContactPhone, ContactStatus } from "@/lib/types";
import { maskPhone } from "@/lib/util";

const READY_FROM: ContactStatus[] = ["pending", "linkedin_found", "needs_review", "skipped", "no_answer", "call_failed", "phone_found"];

// Apollo entrega los celulares de forma asíncrona aquí; se usan salvo que ya haya un número elegido a mano.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== env.webhookSecret()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("contact");
  const payload = await req.json().catch(() => null);
  const { data } = id ? await db().from("contacts").select("*").eq("id", id).maybeSingle() : { data: null };
  const c = data as Contact | null;
  if (!c?.profile) return NextResponse.json({ ok: true });

  const { phones, mobiles } = parseApolloPhones(payload);
  const valid: ContactPhone[] = mobiles.map((value) => ({ value, type: "celular", source: "Apollo (crédito)", owner: "persona" }));
  const manual = !!c.enrichment_source?.startsWith("manual") && !!c.phone;
  const usePhone = !manual && valid[0] ? valid[0].value : null;
  const prev = c.profile.phones ?? [];

  const profile = withProvenance(
    {
      ...c.profile,
      apollo: { ...(c.profile.apollo ?? { searched_at: new Date().toISOString(), status: "ok" }), phone: { status: phones.length ? "listo" : "sin datos", phones, received_at: new Date().toISOString() } },
      phones: [...prev, ...valid.filter((p) => !prev.some((x) => x.value === p.value))],
    },
    usePhone ? { phone: { source: "Apollo (crédito)" } } : {},
  );
  await updateContact(c.id, {
    profile,
    ...(usePhone ? { phone: usePhone, enrichment_source: "Apollo (crédito)", ...(READY_FROM.includes(c.status) ? { status: "phone_found" as const, skip_reason: null } : {}) } : {}),
  });
  await logEvent(
    c.id,
    "enrichment",
    phones.length ? `Apollo entregó ${phones.length} teléfono(s)${usePhone ? ` · se usará ${maskPhone(usePhone)}` : mobiles.length ? "" : " (ninguno es celular)"}` : "Apollo no tenía celular para esta persona",
    usePhone ? "success" : "warn",
  );
  return NextResponse.json({ ok: true });
}
