import "server-only";
import { db } from "../db";
import { env } from "../env";
import type { Contact } from "../types";
import { toE164 } from "../util";

export type EnrichmentResult =
  | { kind: "found"; phone: string; email: string | null; source: string }
  | { kind: "not_found"; reason: string; source: string }
  | { kind: "pending"; source: string }; // llega por webhook

// SignalHire es asíncrono: el resultado llega a /api/webhooks/signalhire.
export async function enrichContact(contact: Contact): Promise<EnrichmentResult> {
  if (!contact.linkedin_url) return { kind: "not_found", reason: "sin perfil de LinkedIn", source: "-" };

  if (env.providers.enrichment === "signalhire") {
    const callbackUrl = `${env.appUrl()}/api/webhooks/signalhire?token=${encodeURIComponent(env.webhookSecret())}&contact=${contact.id}`;
    const res = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
      method: "POST",
      headers: { apikey: env.signalhireKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ items: [contact.linkedin_url], callbackUrl }),
    });
    if (res.status === 402) return { kind: "not_found", reason: "SignalHire sin créditos", source: "signalhire" };
    if (!res.ok) throw new Error(`SignalHire ${res.status}: ${await res.text()}`);
    return { kind: "pending", source: "signalhire" };
  }

  const { data, error } = await db()
    .from("sandbox_profiles")
    .select("mobile_phone, email")
    .eq("linkedin_url", contact.linkedin_url)
    .maybeSingle();
  if (error) throw new Error(`sandbox_profiles: ${error.message}`);
  const phone = toE164(data?.mobile_phone);
  if (!phone) return { kind: "not_found", reason: "el proveedor no tiene celular", source: "sandbox" };
  return { kind: "found", phone, email: data?.email ?? null, source: "sandbox" };
}

export function parseSignalHireItem(item: SignalHireCallbackItem): EnrichmentResult {
  if (item.status !== "success" || !item.candidate) {
    return { kind: "not_found", reason: `SignalHire: ${item.status}`, source: "signalhire" };
  }
  const contacts = item.candidate.contacts ?? [];
  const phones = contacts.filter((c) => c.type === "phone");
  const mobile = phones.find((p) => /mobile|cell/i.test(p.subType ?? "")) ?? phones[0];
  const email =
    contacts.find((c) => c.type === "email" && /work/i.test(c.subType ?? ""))?.value ??
    contacts.find((c) => c.type === "email")?.value ??
    null;
  const phone = toE164(mobile?.value);
  if (!phone) return { kind: "not_found", reason: "SignalHire no devolvió celular", source: "signalhire" };
  return { kind: "found", phone, email, source: "signalhire" };
}

export interface SignalHireCallbackItem {
  item: string;
  status: string;
  candidate?: {
    fullName?: string;
    contacts?: { type: string; value: string; subType?: string }[];
  };
}
