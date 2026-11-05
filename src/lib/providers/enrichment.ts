import "server-only";
import { db } from "../db";
import { env } from "../env";
import type { Contact } from "../types";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { fullName } from "../types";
import { normalize, toE164 } from "../util";

// Solo se llama a celulares válidos: evita gastar llamadas en fijos o números mal formados.
export function checkMobile(raw: string | null | undefined): { phone: string } | { reason: string } {
  const e164 = toE164(raw);
  if (!e164) return { reason: "número mal formado" };
  const p = parsePhoneNumberFromString(e164);
  if (!p?.isValid()) return { reason: `número inválido (${e164})` };
  const type = p.getType();
  if (type && type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return { reason: `no es celular (${type === "FIXED_LINE" ? "fijo" : type})` };
  return { phone: p.number };
}

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

  // Por URL o, si el perfil vino de la búsqueda real, por nombre completo.
  const { data, error } = await db().from("sandbox_profiles").select("full_name, linkedin_url, mobile_phone, email");
  if (error) throw new Error(`sandbox_profiles: ${error.message}`);
  const want = normalize(fullName(contact));
  const row =
    (data ?? []).find((p) => p.linkedin_url === contact.linkedin_url) ??
    (data ?? []).find((p) => normalize(p.full_name) === want || normalize(p.full_name).startsWith(want) || want.startsWith(normalize(p.full_name)));
  if (!row?.mobile_phone) return { kind: "not_found", reason: "el proveedor no tiene celular", source: "sandbox" };
  const check = checkMobile(row.mobile_phone);
  if ("reason" in check) return { kind: "not_found", reason: `celular descartado: ${check.reason}`, source: "sandbox" };
  return { kind: "found", phone: check.phone, email: row.email ?? null, source: "sandbox" };
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
  if (!mobile) return { kind: "not_found", reason: "SignalHire no devolvió celular", source: "signalhire" };
  const check = checkMobile(mobile.value);
  if ("reason" in check) return { kind: "not_found", reason: `celular descartado: ${check.reason}`, source: "signalhire" };
  return { kind: "found", phone: check.phone, email, source: "signalhire" };
}

export interface SignalHireCallbackItem {
  item: string;
  status: string;
  candidate?: {
    fullName?: string;
    contacts?: { type: string; value: string; subType?: string }[];
  };
}
