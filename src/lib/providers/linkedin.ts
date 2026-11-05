import "server-only";
import { askClaudeJson } from "../ai";
import { db } from "../db";
import { env } from "../env";
import { crawlCompanySite, extractPhones } from "../contactinfo";
import { fullName, type CompanyInfo, type Contact, type ContactPhone, type LinkedInCandidate, type Profile } from "../types";
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
  const company = live && contact.company ? await companyInfo(contact.company, contact.city) : null;
  const top = scored[0] ?? null;

  let decision: LinkedInResult["decision"] = "not_found";
  let best: LinkedInCandidate | null = null;
  // Dos candidatos casi empatados = homónimos: decide una persona.
  const tied = !!scored[1] && top!.confidence - scored[1].confidence < 0.1;
  if (top && top.confidence >= AUTO && !top.fromPost && !tied) {
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
    candidates: scored.filter((c) => c.confidence > 0).slice(0, 5),
    // Los datos de persona solo salen del perfil elegido, nunca de un homónimo.
    profile: buildProfile(best, company, real.queries),
  };
}

export function buildProfile(c: LinkedInCandidate | null, company: CompanyInfo | null, queries = 0): Profile {
  return {
    headline: c?.headline ?? null,
    location: c?.location ?? null,
    summary: c?.snippet ?? null,
    sources: c ? c.sources : [],
    company,
    // Teléfonos que aparecen junto al perfil elegido (poco común, pero se aprovecha si está).
    phones: c ? extractPhones(c.snippet, "resultado de búsqueda", "persona") : [],
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
  // En Colombia es común tener dos nombres y dos apellidos repartidos de cualquier forma entre los campos:
  // se busca primero el nombre completo y luego combinaciones del primer nombre con cada apellido.
  const words = name.split(/\s+/).filter(Boolean);
  const variants = [...new Set([`${words[0]} ${words[words.length - 1]}`, words.length >= 4 ? `${words[0]} ${words[words.length - 2]}` : null].filter(Boolean))] as string[];
  const queries = [
    `site:linkedin.com/in "${name}"`,
    c.company ? `site:linkedin.com/in "${name}" "${c.company}"` : null,
    `"${name}" linkedin`,
    ...variants.filter((v) => v !== name).map((v) => `site:linkedin.com/in "${v}"${c.company ? ` ${c.company}` : ""}`),
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
      // El identificador final (p. ej. 62495b207) es estable; el resto del slug cambia entre publicaciones y perfil.
      const key = slug.match(/-([a-z0-9]*\d[a-z0-9]{5,})$/)?.[1] ?? slug;
      const isProfile = /linkedin\.com\/in\//i.test(o.link);
      const prev = bySlug.get(key);
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
        fromPost: !isProfile,
      };
      if (isProfile && cand.fromPost) {
        cand.url = `https://www.linkedin.com/in/${slug}`;
        cand.fromPost = false;
      }
      if (!cand.headline && t.headline) cand.headline = t.headline;
      if (!cand.headline && /\/posts\//.test(o.link) && snippet) cand.headline = snippet.replace(new RegExp(`^${t.name}\\s*`, "i"), "").split(/\s{2,}|\.\s/)[0].slice(0, 120) || null;
      cand.location ??= parseLocation(snippet);
      if (snippet && !cand.snippet.includes(snippet)) cand.snippet = `${cand.snippet} ${snippet}`.trim().slice(0, 600);
      if (!cand.sources.some((s) => s.url === o.link)) cand.sources.push({ url: o.link, title: o.title });
      bySlug.set(key, cand);
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
  // Un nombre completo largo (3+ palabras) que coincide entero rara vez es un homónimo.
  const allName = [...first, ...last];
  if (allName.length >= 3 && firstHit === 1 && lastHit === 1) conf = Math.min(1, conf + 0.1);
  // Homónimo probable: ni la empresa ni los apellidos completos coinciden.
  if (comp.length && compHit === 0 && lastHit < 1) conf *= 0.6;
  if (cand.fromPost) conf *= 0.85;
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

const SKIP_DOMAINS = /linkedin|facebook|instagram|twitter|x\.com|youtube|wikipedia|connectamericas|empresite|informacolombia|einforma|dnb\.com|computrabajo|elempleo|glassdoor|indeed|directorio|datacredito|guia|paginasamarillas|rues|emis|opencorporates|zoominfo|crunchbase|bloomberg|rocketreach|aeroleads|cylex|peaku|apollo|lusha|signalhire/i;
const FOREIGN_TLD = /\.(ec|pe|mx|cl|ar|ve|es|pa|bo|uy|py|br)(\/|$)/i;
const companyCache = new Map<string, CompanyInfo | null>();

interface Place {
  title: string;
  address?: string;
  phoneNumber?: string;
  website?: string;
  category?: string;
}

async function serperPlaces(q: string): Promise<Place[]> {
  const res = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "X-API-KEY": env.serperKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl: "co", hl: "es" }),
  });
  if (!res.ok) return [];
  return ((await res.json()) as { places?: Place[] }).places ?? [];
}

// Empresa: Google Maps (teléfono, web, dirección) + búsqueda web (descripción, LinkedIn) + página de contacto del sitio.
export async function companyInfo(name: string, city?: string | null): Promise<CompanyInfo | null> {
  const key = normalize(`${name} ${city ?? ""}`);
  if (companyCache.has(key)) return companyCache.get(key)!;

  const comp = tokens(name);
  const brand = comp.find((t) => t.length >= 4) ?? comp[0];
  const hasAll = (text: string) => {
    const hay = normalize(text);
    return comp.length > 0 && comp.filter((t) => hay.includes(t)).length / comp.length >= 0.75;
  };
  const hasBrand = (text: string) => !!brand && normalize(text).includes(brand);
  const abroad = (text: string) =>
    FOREIGN_TLD.test(text) || (/\b(ecuador|quito|guayaquil|per[uú]|lima|m[eé]xico|chile|argentina|venezuela|panam[aá]|espa[nñ]a)\b/i.test(text) && !/colombia/i.test(text));

  const [places, r] = await Promise.all([serperPlaces(`${name} ${city ?? "Colombia"}`), serper(`"${name}" Colombia empresa`)]);

  const place = places.find((p) => hasAll(p.title) && !abroad(`${p.address ?? ""} ${p.website ?? ""}`));
  const kg = r.knowledgeGraph;
  const kgOk = !!(kg?.title && hasAll(kg.title) && !abroad(`${kg.description ?? ""} ${kg.website ?? ""} ${JSON.stringify(kg.attributes ?? {})}`));
  // La web oficial lleva la marca en el dominio (descarta directorios, agregadores y homónimos de otros países).
  const site = (r.organic ?? []).find((o) => {
    if (SKIP_DOMAINS.test(o.link) || abroad(`${o.title} ${o.snippet ?? ""} ${o.link}`)) return false;
    const host = normalize(new URL(o.link).hostname.replace(/^www\./, "")).replace(/ /g, "");
    return !!brand && host.includes(brand) && hasBrand(o.title);
  });
  const li = (r.organic ?? []).find(
    (o) => /linkedin\.com\/company\//i.test(o.link) && hasBrand(o.title) && hasAll(`${o.title} ${o.snippet ?? ""}`) && !abroad(`${o.title} ${o.snippet ?? ""}`),
  );

  if (!place && !kgOk && !site && !li) {
    companyCache.set(key, null);
    return null;
  }

  const rawSite = place?.website ?? (kgOk ? kg!.website : undefined) ?? (site ? new URL(site.link).origin : undefined);
  const website = rawSite ? new URL(rawSite).origin : null;

  const phones: ContactPhone[] = [];
  const add = (list: ContactPhone[]) => list.forEach((p) => !phones.some((x) => x.value === p.value) && phones.push(p));
  if (place?.phoneNumber) add(extractPhones(place.phoneNumber, "Google Maps", "empresa"));
  if (kgOk) add(extractPhones(JSON.stringify(kg!.attributes ?? {}), "Google", "empresa"));
  let emails: string[] = [];
  if (website && !abroad(website)) {
    const crawl = await crawlCompanySite(website);
    add(crawl.phones);
    const domain = new URL(website).hostname.replace(/^www./, "");
    emails = crawl.emails.filter((e) => e.endsWith(`@${domain}`) || (!!brand && e.split("@")[1].includes(brand)));
  }
  // Teléfonos sueltos en resultados de búsqueda: último recurso (pueden ser de distribuidores).
  if (!phones.length) {
    for (const o of r.organic ?? []) {
      if (hasAll(`${o.title} ${o.snippet ?? ""}`) && !abroad(o.link)) add(extractPhones(o.snippet ?? "", "resultado de búsqueda", "empresa"));
    }
  }

  const info: CompanyInfo = {
    name: kgOk ? kg!.title! : (place?.title ?? name),
    website,
    domain: website ? new URL(website).hostname.replace(/^www\./, "") : null,
    description: (kgOk ? kg!.description : null) ?? site?.snippet ?? null,
    type: kgOk ? (kg!.type ?? null) : null,
    linkedin: li ? li.link.split("?")[0].replace(/^https:\/\/[a-z]{2}\./, "https://www.") : null,
    attributes: kgOk ? (kg!.attributes ?? null) : null,
    address: place?.address ?? null,
    category: place?.category ?? null,
    phones: phones.slice(0, 5),
    emails,
    field_sources: {
      ...(website ? { website: place?.website ? { source: "Google Maps" } : kgOk && kg!.website ? { source: "Google (ficha de empresa)" } : { source: "Google (resultado de búsqueda)", url: site?.link } } : {}),
      ...(place?.address ? { address: { source: "Google Maps" } } : {}),
      ...(place?.category ? { category: { source: "Google Maps" } } : {}),
      ...((kgOk && kg!.description) || site?.snippet ? { description: kgOk && kg!.description ? { source: "Google (ficha de empresa)" } : { source: "Google (resultado de búsqueda)", url: site?.link } } : {}),
      ...(li ? { linkedin: { source: "Google (resultado de búsqueda)", url: li.link } } : {}),
      ...(emails.length && website ? { emails: { source: "Sitio web de la empresa", url: website } } : {}),
    },
  };
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
