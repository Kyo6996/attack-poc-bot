import type { Contact, Profile, Provenance } from "./types";

export type ProvInput = Omit<Provenance, "at">;

function emptyProfile(): Profile {
  return { headline: null, location: null, summary: null, sources: [], company: null, searched_at: new Date().toISOString(), queries: 0 };
}

// Devuelve la ficha con la procedencia de los campos indicados (conserva la de los demás).
export function withProvenance(profile: Profile | null | undefined, entries: Record<string, ProvInput>): Profile {
  const base = profile ?? emptyProfile();
  const at = new Date().toISOString();
  const stamped = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { ...v, at }]));
  return { ...base, provenance: { ...(base.provenance ?? {}), ...stamped } };
}

// Fuente por defecto de los datos que vinieron en la base de entrada.
export function baseSource(c: Pick<Contact, "source">): string {
  if (c.source?.startsWith("qr")) return `Formulario QR (${c.source.slice(3) || "qr"})`;
  if (c.source === "csv") return "Base importada (CSV / Excel)";
  return "Base de entrada (registro en el panel)";
}

export interface ProvRow {
  field: string;
  value: string;
  source: string;
  detail?: string | null;
  url?: string | null;
  at?: string | null;
}

// Arma la tabla de procedencia: registro del bot si existe; si no, el origen de la base de entrada.
export function provenanceRows(c: Contact): ProvRow[] {
  const prov = c.profile?.provenance ?? {};
  const base = baseSource(c);
  const created = c.created_at;
  const rows: ProvRow[] = [];
  const person: [string, string, string | null | undefined][] = [
    ["first_name", "Nombre", `${c.first_name} ${c.last_name}`.trim()],
    ["company", "Empresa", c.company],
    ["title", "Cargo", c.title],
    ["city", "Ciudad", c.city],
    ["email", "Correo", c.email],
    ["phone", "Teléfono para llamar", c.phone],
    ["linkedin_url", "Perfil de LinkedIn", c.linkedin_url],
    ["event_notes", "Qué vio en el stand / interés", c.event_notes],
  ];
  for (const [key, label, value] of person) {
    if (!value) continue;
    const p = prov[key] ?? (key === "last_name" ? prov.first_name : undefined);
    if (p) rows.push({ field: label, value, source: p.source, detail: p.detail, url: p.url, at: p.at });
    else if (key === "phone" && c.enrichment_source) rows.push({ field: label, value, source: c.enrichment_source });
    else if (key === "linkedin_url") rows.push({ field: label, value, source: c.linkedin_source ?? "—", detail: c.linkedin_confidence ? `${Math.round(c.linkedin_confidence * 100)}%` : null });
    else rows.push({ field: label, value, source: base, at: created });
  }
  rows.push({ field: "Consentimiento", value: c.consent ? "Sí" : "No", source: base, at: created });

  const co = c.profile?.company;
  if (co) {
    const fs = co.field_sources ?? {};
    const company: [string, string, string | null | undefined][] = [
      ["website", "Web de la empresa", co.website],
      ["address", "Dirección", co.address],
      ["category", "Categoría", co.category],
      ["linkedin", "LinkedIn de la empresa", co.linkedin],
      ["description", "Descripción", co.description?.slice(0, 120)],
      ["emails", "Correos de la empresa", (co.emails ?? []).join(", ")],
    ];
    for (const [key, label, value] of company) {
      if (!value) continue;
      rows.push({ field: label, value, source: fs[key]?.source ?? "Google vía Serper", url: fs[key]?.url, at: c.profile?.searched_at });
    }
    for (const ph of co.phones ?? []) rows.push({ field: "Teléfono de la empresa", value: `${ph.value} (${ph.type})`, source: ph.source, at: c.profile?.searched_at });
  }
  for (const ph of c.profile?.phones ?? []) rows.push({ field: "Teléfono de la persona", value: `${ph.value} (${ph.type})`, source: ph.source, at: c.profile?.searched_at });
  if (c.profile?.email && c.profile.email.value !== c.email) {
    rows.push({ field: "Correo probable (no usado)", value: c.profile.email.value, source: c.profile.email.source, detail: `confianza ${c.profile.email.score}%` });
  }
  return rows;
}
