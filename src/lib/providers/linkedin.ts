import "server-only";
import { askClaudeJson } from "../ai";
import { db } from "../db";
import { env } from "../env";
import { fullName, type CompanyInfo, type Contact, type LinkedInCandidate, type Profile } from "../types";
import { normalize } from "../util";

export interface LinkedInResult {
  decision: "found" | "review" | "not_found";
  best: LinkedInCandidate | null;
  candidates: LinkedInCandidate[];
  profile: Profile;
}

const AUTO = 0.65; // desde aquí se acepta solo
const REVIEW = 0.35; // entre REVIEW y AUTO lo confirma una persona

// Paso 1: búsqueda pública en Google vía Serper (sin scraping ni login en LinkedIn).
// En modo "hybrid" los datos de prueba de Supabase cubren a los contactos ficticios.
export async function findLinkedInProfile(contact: Contact): Promise<LinkedInResult> {
  const provider = env.providers.linkedin;
  const live = provider !== "sandbox" && !!process.env.SERPER_API_KEY;

  const real = live ? await searchSerper(contact) : { candidates: [], queries: 0 };
  const scored = await score(contact, real.candidates);
  const company = live && contact.company ? await companyInfo(contact.company) : null;
  const top = scored[0] ?? null;

  let decision: LinkedInResult["decision"] = "not_found";
  let best: LinkedInCandidate | null = null;
  if (top && top.confidence >= AUTO) {
    decision = "found";
    best = top;
  } else if (provider !== "serper") {
    const sb = await sandboxMatch(contact);
    if (sb) {
      decision = "found";
      best = sb;
    }
  }
  if (decision === "not_found" && top && top.confidence >= REVIEW) decision = "review";

  return {
    decision,
    best,
    candidates: scored.slice(0, 5),
    profile: buildProfile(best ?? (decision === "review" ? null : top), company, real.queries),
  };
}

export function buildProfile(c: LinkedInCandidate | null, company: CompanyInfo | null, queries = 0): Profile {
  return {
    headline: c?.headline ?? null,
    location: c?.location ?? null,
    summary: c?.snippet ?? null,
    sources: c ? c.sources : [],
    company,
    searched_at: new Date().toISOString(),
    queries,
  };
}

// ----------------------------------------------------------------- búsqueda

interface SerperResult {
  organic?: { link: string; title: string; snippet?: string }[];
  knowledgeGraph?: { title?: string; type?: string; website?: string; description?: string; attributes?: Record<string, string> };
}

async function serper(q: string): Promise<SerperResult> {
  const call = async (query: string) => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": env.serperKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "co", hl: "es", num: 10 }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
    return (await res.json()) as SerperResult;
  };
  const r = await call(q);
  // Con comillas Google a veces no devuelve nada; se reintenta sin ellas.
  if (!r.organic?.length && q.includes('"')) return call(q.replace(/"/g, ""));
  return r;
}

// /in/slug y /posts/slug_… apuntan al mismo perfil; se normalizan a www.linkedin.com/in/slug
function profileSlug(link: string): string | null {
  const m = link.match(/linkedin\.com\/(?:in|posts)\/([^/?#_]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

function parseTitle(title: string) {
  // "Nombre - Cargo - Empresa | LinkedIn" o "Nombre’s Post - LinkedIn"
  const clean = title.replace(/\s*[|·-]\s*LinkedIn.*$/i, "").replace(/’s Post$|'s Post$/i, "").trim();
  const [name, ...rest] = clean.split(/\s+[-–]\s+/);
  return { name: name?.trim() ?? "", headline: rest.join(" - ").trim() || null };
}

function parseLocation(text: string): string | null {
  const m =
    text.match(/Ubicaci[oó]n:\s*([^·\n.]+)/i) ??
    text.match(/\b(Bogot[aá][^·\n.]*|Medell[ií]n[^·\n.]*|Cali[^·\n.]*|Barranquilla[^·\n.]*|Bucaramanga[^·\n.]*|Cartagena[^·\n.]*|Colombia)\b/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

async function searchSerper(c: Contact) {
  const name = fullName(c);
  const first = `${c.first_name} ${c.last_name.split(/\s+/)[0]}`;
  const queries = [
    c.company ? `site:linkedin.com/in "${name}" "${c.company}"` : null,
    `site:linkedin.com/in "${first}"${c.title ? ` ${c.title}` : ""}`,
    `"${first}" linkedin`,
  ].filter(Boolean) as string[];

  const bySlug = new Map<string, LinkedInCandidate>();
  let used = 0;
  for (const q of queries) {
    used++;
    const r = await serper(q);
    for (const o of r.organic ?? []) {
      const slug = profileSlug(o.link);
      if (!slug) continue;
      const t = parseTitle(o.title);
      // En publicaciones el título puede ser "Tema | Nombre": se toma el tramo que contiene el nombre.
      if (!normalize(t.name).includes(normalize(c.first_name))) {
        const part = o.title.split(/\s*[|·–-]\s*/).find((x) => normalize(x).includes(normalize(c.first_name)));
        if (part) t.name = part.trim();
      }
      const prev = bySlug.get(slug);
      const snippet = o.snippet ?? "";
      const cand: LinkedInCandidate = prev ?? {
        url: `https://www.linkedin.com/in/${slug}`,
        name: t.name,
        headline: null,
        location: null,
        snippet: "",
        sources: [],
        confidence: 0,
        reason: "",
        origin: "serper",
      };
      if (!cand.headline && t.headline) cand.headline = t.headline;
      if (!cand.headline && /\/posts\//.test(o.link) && snippet) cand.headline = snippet.replace(new RegExp(`^${t.name}\\s*`, "i"), "").split(/\s{2,}|\.\s/)[0].slice(0, 120) || null;
      cand.location ??= parseLocation(snippet);
      if (snippet && !cand.snippet.includes(snippet)) cand.snippet = `${cand.snippet} ${snippet}`.trim().slice(0, 600);
      if (!cand.sources.some((s) => s.url === o.link)) cand.sources.push({ url: o.link, title: o.title });
      bySlug.set(slug, cand);
    }
    // Si ya hay un candidato muy bueno no se gastan más búsquedas.
    const scored = await score(c, [...bySlug.values()], false);
    if (scored[0] && scored[0].confidence >= 0.8) break;
  }
  return { candidates: [...bySlug.values()], queries: used };
}

// ----------------------------------------------------------------- puntuación

const STOP = new Set(["sas", "s", "a", "ltda", "sa", "inc", "corp", "de", "del", "la", "el", "y", "group", "grupo", "co", "colombia"]);
const tokens = (s: string | null | undefined) => normalize(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));

function heuristic(c: Contact, cand: LinkedInCandidate) {
  const hay = normalize(`${cand.name} ${cand.headline ?? ""} ${cand.snippet} ${cand.url.replace(/[-/]/g, " ")}`);
  const first = tokens(c.first_name);
  const last = tokens(c.last_name);
  const firstHit = first.length ? first.filter((t) => hay.includes(t)).length / first.length : 0;
  const lastHit = last.length ? last.filter((t) => hay.includes(t)).length / last.length : 0;
  if (firstHit === 0 || lastHit === 0) return { confidence: 0, reason: "el nombre no coincide" };

  const comp = tokens(c.company);
  const compHit = comp.length ? comp.filter((t) => hay.includes(t)).length / comp.length : 0;
  const title = tokens(c.title).filter((t) => t.length > 3);
  const titleHit = title.length ? title.filter((t) => hay.includes(t)).length / title.length : 0;
  const co = /colombia|bogot|medell|cali\b|barranquilla|co\.linkedin/.test(hay) ? 1 : 0;

  let conf = Math.min(1, 0.3 * firstHit + 0.25 * lastHit + 0.3 * (compHit >= 0.6 ? 1 : compHit / 2) + 0.1 * titleHit + 0.05 * co);
  // Homónimo probable: ni la empresa ni los apellidos completos coinciden.
  if (comp.length && compHit === 0 && lastHit < 1) conf *= 0.6;
  return {
    confidence: Math.round(conf * 100) / 100,
    reason: `nombre ${Math.round(firstHit * 100)}% · apellidos ${Math.round(lastHit * 100)}% · empresa ${Math.round(compHit * 100)}% · cargo ${Math.round(titleHit * 100)}%${co ? " · Colombia" : ""}`,
  };
}

async function score(c: Contact, cands: LinkedInCandidate[], useAi = true): Promise<LinkedInCandidate[]> {
  const out = cands.map((cand) => ({ ...cand, ...heuristic(c, cand) })).sort((a, b) => b.confidence - a.confidence);
  if (!useAi || !env.anthropicKey() || out.length === 0) return out;

  const list = out.slice(0, 5).map((x, i) => `${i}. ${x.name} — ${x.headline ?? ""} — ${x.snippet.slice(0, 200)} (${x.url})`).join("\n");
  const ai = await askClaudeJson<{ index: number; confidence: number; reason: string }>(
    `Decide cuál de estos perfiles de LinkedIn corresponde a la persona.
Persona: ${fullName(c)} · Empresa: ${c.company ?? "?"} · Cargo: ${c.title ?? "?"} · Ciudad: ${c.city ?? "?"}
Candidatos:
${list}
Un homónimo en otra empresa NO es la persona, salvo evidencia de cambio de empleo. Si ninguno corresponde usa index -1.
Responde SOLO JSON: {"index": n, "confidence": 0..1, "reason": "máx. 20 palabras"}`,
  );
  if (ai && ai.index >= 0 && ai.index < out.length) {
    out[ai.index] = { ...out[ai.index], confidence: Math.max(0, Math.min(1, ai.confidence)), reason: `IA: ${ai.reason}` };
    out.sort((a, b) => b.confidence - a.confidence);
  }
  return out;
}

// ----------------------------------------------------------------- empresa

const SKIP_DOMAINS = /linkedin|facebook|instagram|twitter|x\.com|youtube|wikipedia|connectamericas|empresite|informacolombia|einforma|dnb\.com|computrabajo|elempleo|glassdoor|indeed|directorio|datacredito|guia|paginasamarillas|rues|emis|opencorporates|zoominfo|crunchbase|bloomberg/i;
const companyCache = new Map<string, CompanyInfo | null>();

export async function companyInfo(name: string): Promise<CompanyInfo | null> {
  const key = normalize(name);
  if (companyCache.has(key)) return companyCache.get(key)!;
  const comp = tokens(name);
  const matches = (text: string) => {
    const hay = normalize(text);
    return comp.length > 0 && comp.filter((t) => hay.includes(t)).length / comp.length >= 0.75;
  };

  const r = await serper(`"${name}" Colombia empresa`);
  const kg = r.knowledgeGraph;
  // La web oficial debe tener el nombre de la empresa en el dominio (descarta directorios y homónimos).
  const strong = comp.filter((t) => t.length >= 4);
  const abroad = (text: string) => /\b(ecuador|quito|guayaquil|per[uú]|lima|m[eé]xico|chile|argentina|venezuela|panam[aá]|espa[nñ]a)\b/i.test(text) && !/colombia/i.test(text);
  const site = (r.organic ?? []).find((o) => {
    if (SKIP_DOMAINS.test(o.link) || !matches(o.title) || abroad(`${o.title} ${o.snippet ?? ""} ${o.link}`)) return false;
    const host = normalize(new URL(o.link).hostname.replace(/^www\./, "")).replace(/ /g, "");
    return strong.length > 0 && strong.every((t) => host.includes(t));
  });
  const li = (r.organic ?? []).find(
    (o) => /linkedin\.com\/company\//i.test(o.link) && matches(o.title) && !abroad(`${o.title} ${o.snippet ?? ""}`),
  );
  const kgOk = !!(kg?.title && matches(kg.title) && !abroad(`${kg.description ?? ""} ${JSON.stringify(kg.attributes ?? {})}`));

  let info: CompanyInfo | null = null;
  if (kgOk || site || li) {
    const website = (kgOk ? kg!.website : undefined) ?? (site ? new URL(site.link).origin : undefined);
    info = {
      name: kgOk ? kg!.title! : name,
      website: website ?? null,
      domain: website ? new URL(website).hostname.replace(/^www\./, "") : null,
      description: (kgOk ? kg!.description : null) ?? site?.snippet ?? null,
      type: kgOk ? (kg!.type ?? null) : null,
      linkedin: li ? li.link.split("?")[0] : null,
      attributes: kgOk ? (kg!.attributes ?? null) : null,
    };
  }
  companyCache.set(key, info);
  return info;
}

// ----------------------------------------------------------------- sandbox

async function sandboxMatch(c: Contact): Promise<LinkedInCandidate | null> {
  const { data } = await db().from("sandbox_profiles").select("full_name, company, headline, linkedin_url").ilike("full_name", `%${c.first_name}%`);
  const want = tokens(fullName(c));
  const comp = tokens(c.company);
  for (const p of data ?? []) {
    const have = normalize(`${p.full_name} ${p.company ?? ""} ${p.headline ?? ""}`);
    const nameOk = want.filter((t) => have.includes(t)).length / Math.max(want.length, 1) >= 0.67;
    const compOk = !comp.length || comp.filter((t) => have.includes(t)).length / comp.length >= 0.6;
    if (nameOk && compOk) {
      return {
        url: p.linkedin_url,
        name: p.full_name,
        headline: p.headline,
        location: null,
        snippet: p.headline ?? "",
        sources: [],
        confidence: 1,
        reason: "datos de prueba (sandbox)",
        origin: "sandbox",
      };
    }
  }
  return null;
}
