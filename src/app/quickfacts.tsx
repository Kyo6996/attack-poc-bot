"use client";

import { useState } from "react";
import { baseSource } from "@/lib/provenance";
import type { Contact } from "@/lib/types";

// Fuente resumida para la etiqueta de color junto a cada dato.
function srcTag(source: string | null | undefined): { label: string; cls: string } {
  const t = (source ?? "").toLowerCase();
  if (!t || t === "—") return { label: "sin origen", cls: "src-none" };
  if (t.includes("signalhire")) return { label: t.includes("crédito") ? "SignalHire · crédito" : "SignalHire", cls: "src-sh" };
  if (t.includes("apollo")) return { label: t.includes("crédito") ? "Apollo · crédito" : "Apollo", cls: "src-apollo" };
  if (t.includes("hunter")) return { label: "Hunter", cls: "src-hunter" };
  if (t.includes("sandbox") || t.includes("prueba")) return { label: "Prueba", cls: "src-none" };
  if (t.includes("mano") || t.includes("manual") || t.includes("panel")) return { label: "Manual", cls: "src-manual" };
  if (t.includes("formulario") || t.includes("qr")) return { label: "Formulario QR", cls: "src-base" };
  if (t.includes("base") || t.includes("csv")) return { label: "Base del cliente", cls: "src-base" };
  if (t.includes("sitio web")) return { label: "Sitio web", cls: "src-web" };
  if (t.includes("maps")) return { label: "Google Maps", cls: "src-google" };
  if (t.includes("google") || t.includes("serper") || t.includes("búsqueda") || t === "real" || t === "hybrid") return { label: "Google", cls: "src-google" };
  return { label: source!.slice(0, 22), cls: "src-none" };
}

interface Fact {
  k: string;
  v: string | null | undefined;
  src?: string | null;
  href?: string | null;
  note?: string | null;
  copy?: boolean;
  wide?: boolean;
}

const SH = "SignalHire (búsqueda gratuita)";
const KEY_FIELDS = ["Teléfono para llamar", "Correo", "LinkedIn", "Cargo actual"];

// Resumen a la mano: lo esencial para contactar al cliente y de dónde salió cada dato.
export function QuickFacts({ c }: { c: Contact }) {
  const [copied, setCopied] = useState<string | null>(null);
  const p = c.profile;
  const prov = p?.provenance ?? {};
  const base = baseSource(c);
  const from = (key: string) => prov[key]?.source ?? base;
  const sh = p?.signalhire?.best;
  const ap = p?.apollo?.person;
  const co = p?.company;
  const fsrc = co?.field_sources ?? {};

  const jobs = sh?.experience ?? [];
  const nowJob = jobs[0];
  const prevJob = jobs.find((j, i) => i > 0 && j.company && j.company !== nowJob?.company);
  const otherPhones = [...(p?.phones ?? []), ...(co?.phones ?? [])].filter((x) => x.value !== c.phone);
  const firstWord = (c.company ?? "").toLowerCase().split(" ")[0];
  const employees = co?.attributes?.["Empleados (aprox.)"];
  const founded = co?.attributes?.["Fundada"];
  const news = co?.signals?.news[0];

  const linkedin: Fact = c.linkedin_url
    ? {
        k: "LinkedIn",
        v: c.linkedin_url.replace("https://www.linkedin.com/in/", "in/"),
        href: c.linkedin_url,
        src: prov.linkedin_url?.source ?? (c.linkedin_source === "manual" ? "Confirmado a mano" : "Google"),
        note: c.linkedin_confidence ? `${Math.round(c.linkedin_confidence * 100)}% coincidencia` : null,
      }
    : c.linkedin_source === "signalhire"
      ? { k: "LinkedIn", v: "Identidad confirmada (sin URL)", src: prov.identity?.source ?? SH }
      : { k: "LinkedIn", v: null };

  const email: Fact = c.email
    ? { k: "Correo", v: c.email, src: from("email"), note: prov.email?.detail ?? (p?.email?.value === c.email ? `confianza ${p.email.score}%` : null), copy: true }
    : p?.email
      ? { k: "Correo (probable, sin usar)", v: p.email.value, src: p.email.source, note: `confianza ${p.email.score}%`, copy: true }
      : { k: "Correo", v: null };

  const facts: Fact[] = [
    { k: "Teléfono para llamar", v: c.phone, src: prov.phone?.source ?? c.enrichment_source ?? base, copy: true, note: otherPhones.length ? `+${otherPhones.length} número(s) en la ficha` : null },
    email,
    linkedin,
    { k: "Cargo actual", v: c.title ?? nowJob?.title ?? ap?.title, src: c.title ? from("title") : nowJob?.title ? SH : "Apollo" },
    {
      k: "Empresa actual",
      v: nowJob?.company ?? ap?.company ?? c.company,
      src: nowJob?.company ? SH : ap?.company ? "Apollo" : from("company"),
      note: nowJob?.company && c.company && firstWord && !nowJob.company.toLowerCase().includes(firstWord) ? `En la base: ${c.company}` : null,
    },
    { k: "Empresa anterior", v: prevJob ? `${prevJob.company}${prevJob.title ? ` · ${prevJob.title}` : ""}` : null, src: SH },
    { k: "Ubicación", v: c.city ?? p?.location ?? sh?.location, src: c.city ? from("city") : p?.location ? "Google" : SH },
    { k: "Habilidades", v: sh?.skills?.length ? sh.skills.slice(0, 6).join(", ") : null, src: SH, wide: true },
    { k: "Web de la empresa", v: co?.domain ?? co?.website, href: co?.website, src: fsrc.website?.source ?? "Google" },
    { k: "Teléfono de la empresa", v: co?.phones?.[0]?.value, src: co?.phones?.[0]?.source, copy: true },
    { k: "Sector", v: co?.category, src: fsrc.category?.source ?? "Google Maps" },
    { k: "Tamaño", v: employees ? `${employees} empleados` : null, src: "Apollo", note: founded ? `fundada en ${founded}` : null },
    { k: "LinkedIn de la empresa", v: co?.linkedin ? "Abrir perfil" : null, href: co?.linkedin, src: fsrc.linkedin?.source ?? "Google" },
    { k: "Contratando", v: co?.signals?.jobs_total ? `${co.signals.jobs_total} vacante(s)` : null, src: "Apollo", note: co?.signals?.jobs[0]?.title ?? null },
    { k: "Última noticia", v: news?.title, href: news?.url, src: "Apollo", note: news?.published_at?.slice(0, 10) ?? null, wide: true },
  ];
  const shown = facts.filter((f) => f.v);
  const missing = facts.filter((f) => !f.v && KEY_FIELDS.includes(f.k)).map((f) => f.k.toLowerCase());

  function copy(v: string) {
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(v);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="ficha facts-card">
      <div className="ficha-head">
        <h4>Resumen del cliente</h4>
        {missing.length > 0 && <span className="s warn-text">Falta: {missing.join(", ")}</span>}
      </div>
      <div className="facts">
        {shown.map((f) => {
          const tag = srcTag(f.src);
          return (
            <div key={f.k} className={`fact ${f.wide ? "wide" : ""}`}>
              <div className="fk">{f.k}</div>
              <div className="fv">
                {f.href ? (
                  <a href={f.href} target="_blank" rel="noreferrer">
                    {f.v}
                  </a>
                ) : (
                  <span className={f.copy ? "mono" : ""}>{f.v}</span>
                )}
                {f.copy && (
                  <button className="copy" title="Copiar" onClick={() => copy(f.v!)}>
                    {copied === f.v ? "✓" : "⧉"}
                  </button>
                )}
              </div>
              <div className="fs">
                <span className={`src ${tag.cls}`} title={f.src ?? ""}>
                  {tag.label}
                </span>
                {f.note && <span className="s"> {f.note}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
