import "server-only";
import { checkMobile } from "./enrichment";
import { env } from "../env";
import { extractPhones } from "../contactinfo";
import type { ApolloInfo, CompanyInfo, Contact, ContactPhone } from "../types";

const API = "https://api.apollo.io/api/v1";
const key = () => process.env.APOLLO_API_KEY?.trim();
export const apolloEnabled = () => !!key();

const headers = () => ({ "x-api-key": key()!, "Content-Type": "application/json", accept: "application/json", "Cache-Control": "no-cache" });

export class ApolloPlanError extends Error {}

async function call<T>(path: string, method: "GET" | "POST", params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { method, headers: headers(), signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (res.status === 403 && text.includes("API_INACCESSIBLE")) throw new ApolloPlanError("tu plan de Apollo no incluye este servicio");
  if (res.status === 429) throw new Error("límite de consultas de Apollo alcanzado; intenta más tarde");
  if (res.status === 422 && /credit/i.test(text)) throw new Error("Apollo sin créditos");
  if (!res.ok) throw new Error(`Apollo ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------- empresa (incluido en el plan gratis)

interface ApolloOrg {
  name?: string;
  website_url?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  primary_phone?: { sanitized_number?: string | null; number?: string | null } | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  raw_address?: string | null;
  short_description?: string | null;
  founded_year?: number | null;
  country?: string | null;
}

const orgCache = new Map<string, ApolloOrg | null>();

async function enrichOrg(domain: string): Promise<ApolloOrg | null> {
  if (orgCache.has(domain)) return orgCache.get(domain)!;
  const r = await call<{ organization?: ApolloOrg }>("organizations/enrich", "GET", { domain });
  const org = r.organization?.name ? r.organization : null;
  orgCache.set(domain, org);
  return org;
}

const FREE_MAIL = /@(gmail|hotmail|outlook|yahoo|live|icloud|msn|aol|protonmail)\./i;

// Completa la ficha de empresa con Apollo; solo llena lo que Google y el sitio web no trajeron.
export async function withApolloOrg(company: CompanyInfo | null, contact: Contact): Promise<CompanyInfo | null> {
  if (!apolloEnabled()) return company;
  const domain = company?.domain ?? (contact.email && !FREE_MAIL.test(contact.email) ? contact.email.split("@")[1] : null);
  if (!domain) return company;
  let org: ApolloOrg | null;
  try {
    org = await enrichOrg(domain);
  } catch {
    return company;
  }
  if (!org) return company;

  const base: CompanyInfo = company ?? {
    name: org.name ?? contact.company ?? domain,
    website: org.website_url ?? `https://${domain}`,
    domain,
    description: null,
    type: null,
    linkedin: null,
    attributes: null,
    phones: [],
    emails: [],
    field_sources: { website: { source: "Apollo" } },
  };
  const src = { source: "Apollo" };
  const fs = { ...(base.field_sources ?? {}) };
  const out: CompanyInfo = { ...base, field_sources: fs };

  if (!out.linkedin && org.linkedin_url) ((out.linkedin = org.linkedin_url), (fs.linkedin = src));
  if (!out.description && org.short_description) ((out.description = org.short_description.slice(0, 400)), (fs.description = src));
  if (!out.category && org.industry) ((out.category = org.industry), (fs.category = src));
  if (!out.address && org.raw_address) ((out.address = org.raw_address), (fs.address = src));
  const attrs: Record<string, string> = { ...(out.attributes ?? {}) };
  if (org.estimated_num_employees) attrs["Empleados (aprox.)"] = String(org.estimated_num_employees);
  if (org.founded_year) attrs["Fundada"] = String(org.founded_year);
  if (Object.keys(attrs).length) out.attributes = attrs;

  const raw = org.primary_phone?.sanitized_number ?? org.primary_phone?.number ?? org.phone;
  if (raw) {
    const phones = out.phones ?? [];
    const found: ContactPhone[] = extractPhones(raw, "Apollo", "empresa");
    out.phones = [...phones, ...found.filter((p) => !phones.some((x) => x.value === p.value))].slice(0, 6);
  }
  return out;
}

// ---------------------------------------------------------------- persona (gasta créditos; requiere plan pago)

interface ApolloPerson {
  id: string;
  name?: string;
  title?: string | null;
  headline?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: string | null;
  city?: string | null;
  country?: string | null;
  phone_numbers?: { sanitized_number?: string | null; raw_number?: string | null; type_cd?: string | null }[];
  employment_history?: { title?: string | null; organization_name?: string | null; current?: boolean }[];
}

// Gasta solo lo necesario para contactar: correo de trabajo siempre; celular solo si aún no hay teléfono.
export async function enrichPerson(contact: Contact, wantPhone: boolean): Promise<ApolloInfo> {
  const params: Record<string, string> = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    reveal_personal_emails: "false",
    reveal_phone_number: wantPhone ? "true" : "false",
  };
  if (contact.company) params.organization_name = contact.company;
  const domain = contact.profile?.company?.domain;
  if (domain) params.domain = domain;
  if (contact.linkedin_url) params.linkedin_url = contact.linkedin_url;
  if (wantPhone) params.webhook_url = `${env.appUrl()}/api/webhooks/apollo?token=${encodeURIComponent(env.webhookSecret())}&contact=${contact.id}`;

  const now = new Date().toISOString();
  const r = await call<{ person?: ApolloPerson | null }>("people/match", "POST", params);
  const p = r.person;
  if (!p) return { searched_at: now, status: "sin coincidencia" };
  const job = p.employment_history?.find((e) => e.current) ?? p.employment_history?.[0];
  return {
    searched_at: now,
    status: "ok",
    person: {
      id: p.id,
      name: p.name ?? null,
      title: p.title ?? job?.title ?? null,
      company: job?.organization_name ?? null,
      linkedin: p.linkedin_url ?? null,
      email: p.email && !/email_not_unlocked/.test(p.email) ? p.email.toLowerCase() : null,
      email_status: p.email_status ?? null,
      city: [p.city, p.country].filter(Boolean).join(", ") || null,
    },
    phone: wantPhone ? { status: "pendiente", phones: [] } : undefined,
  };
}

// Celulares que Apollo entrega por webhook (formato tolerante: busca phone_numbers en cualquier nivel).
export function parseApolloPhones(payload: unknown): { phones: string[]; mobiles: string[] } {
  const raw: { value: string; type: string }[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.phone_numbers)) {
      for (const n of o.phone_numbers as Record<string, unknown>[]) {
        const v = (n.sanitized_number ?? n.raw_number ?? n.number) as string | undefined;
        if (v) raw.push({ value: v, type: String(n.type_cd ?? n.type ?? "") });
      }
    }
    Object.values(o).forEach((v) => typeof v === "object" && v !== null && walk(v));
  };
  walk(payload);
  const phones = [...new Set(raw.map((r) => r.value))];
  const mobiles = phones.map((p) => checkMobile(p)).flatMap((c) => ("phone" in c ? [c.phone] : []));
  return { phones, mobiles: [...new Set(mobiles)] };
}

// ---------------------------------------------------------------- estado para Integraciones

export async function apolloStatus(): Promise<{ org: boolean; person: boolean; usedToday: number | null; dayLimit: number | null } | null> {
  if (!key()) return null;
  const probe = async (path: string, method: "GET" | "POST", params: Record<string, string>) => {
    const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { method, headers: headers(), signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!res) return false;
    const t = await res.text();
    return !(res.status === 403 && t.includes("API_INACCESSIBLE")) && res.status !== 401;
  };
  // people/match sin parámetros no consume créditos: solo revela si el plan lo permite.
  const [person, usage] = await Promise.all([
    probe("people/match", "POST", {}),
    fetch(`${API}/usage_stats/api_usage_stats`, { method: "POST", headers: headers(), signal: AbortSignal.timeout(10000) })
      .then((r) => r.json() as Promise<Record<string, { day?: { consumed: number; limit: number } }>>)
      .catch(() => null),
  ]);
  const enrich = usage ? usage[JSON.stringify(["api/v1/organizations", "enrich"]).replace(",", ", ")] : undefined;
  const pm = usage ? usage[JSON.stringify(["api/v1/people", "match"]).replace(",", ", ")] : undefined;
  return {
    org: !!usage,
    person,
    usedToday: enrich?.day || pm?.day ? (enrich?.day?.consumed ?? 0) + (pm?.day?.consumed ?? 0) : null,
    dayLimit: enrich?.day?.limit ?? null,
  };
}
