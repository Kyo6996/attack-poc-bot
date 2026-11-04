import "server-only";
import { db } from "../db";
import { env } from "../env";
import { askClaudeJson } from "../ai";
import { fullName, type Contact } from "../types";
import { normalize } from "../util";

export interface LinkedInCandidate {
  url: string;
  title: string;
  snippet: string;
}

export interface LinkedInMatch {
  url: string;
  confidence: number;
  source: string;
  reason: string;
  candidates: number;
}

const MIN_CONFIDENCE = 0.6;

// Solo resultados públicos de buscador, sin scraping ni login en LinkedIn.
// Con ANTHROPIC_API_KEY, Claude elige entre candidatos; si no, scoring por nombre, empresa y cargo.
export async function findLinkedInProfile(contact: Contact): Promise<LinkedInMatch | null> {
  const provider = env.providers.linkedin;
  const candidates = provider === "serper" ? await searchSerper(contact) : await searchSandbox(contact);
  if (candidates.length === 0) return null;

  const pick = (await pickWithClaude(contact, candidates)) ?? pickHeuristic(contact, candidates);
  if (!pick || pick.confidence < MIN_CONFIDENCE) return null;
  return { ...pick, source: pick.source.replace("$", provider), candidates: candidates.length };
}

async function searchSandbox(c: Contact): Promise<LinkedInCandidate[]> {
  const { data, error } = await db()
    .from("sandbox_profiles")
    .select("full_name, company, headline, linkedin_url")
    .ilike("full_name", `%${c.first_name}%`);
  if (error) throw new Error(`sandbox_profiles: ${error.message}`);
  return (data ?? []).map((p) => ({
    url: p.linkedin_url,
    title: `${p.full_name} - ${p.company ?? ""} | LinkedIn`,
    snippet: p.headline ?? "",
  }));
}

async function searchSerper(c: Contact): Promise<LinkedInCandidate[]> {
  const queries = [
    `site:linkedin.com/in "${fullName(c)}" "${c.company ?? ""}"`,
    `site:linkedin.com/in ${fullName(c)} ${c.title ?? ""}`,
  ];
  const seen = new Map<string, LinkedInCandidate>();
  for (const q of queries) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": env.serperKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "co", hl: "es", num: 10 }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { organic?: { link: string; title: string; snippet?: string }[] };
    for (const r of json.organic ?? []) {
      if (!/linkedin\.com\/in\//.test(r.link)) continue;
      const url = r.link.split("?")[0].replace(/\/$/, "");
      if (!seen.has(url)) seen.set(url, { url, title: r.title, snippet: r.snippet ?? "" });
    }
    if (seen.size >= 3) break;
  }
  return [...seen.values()].slice(0, 8);
}

function pickHeuristic(c: Contact, cands: LinkedInCandidate[]) {
  const nameTokens = normalize(fullName(c)).split(" ").filter((t) => t.length > 1);
  const company = normalize(c.company);
  const titleTokens = normalize(c.title).split(" ").filter((t) => t.length > 3);

  let best: { url: string; confidence: number; source: string; reason: string } | null = null;
  for (const cand of cands) {
    const hay = normalize(`${cand.title} ${cand.snippet}`);
    const nameHit = nameTokens.filter((t) => hay.includes(t)).length / Math.max(nameTokens.length, 1);
    const companyHit = company && hay.includes(company) ? 1 : 0;
    const titleHit = titleTokens.length
      ? titleTokens.filter((t) => hay.includes(t)).length / titleTokens.length
      : 0;
    const score = Math.min(1, nameHit * 0.55 + companyHit * 0.35 + titleHit * 0.1);
    if (!best || score > best.confidence) {
      best = {
        url: cand.url,
        confidence: Math.round(score * 100) / 100,
        source: "$",
        reason: `nombre ${Math.round(nameHit * 100)}% · empresa ${companyHit ? "sí" : "no"} · cargo ${Math.round(titleHit * 100)}%`,
      };
    }
  }
  return best;
}

async function pickWithClaude(c: Contact, cands: LinkedInCandidate[]) {
  if (!env.anthropicKey()) return null;
  const list = cands.map((x, i) => `${i}. ${x.title} — ${x.snippet} (${x.url})`).join("\n");
  const out = await askClaudeJson<{ index: number; confidence: number; reason: string }>(
    `Eres un analista de prospección B2B. Debes decidir cuál de los resultados de búsqueda corresponde a esta persona.

Persona buscada:
- Nombre: ${fullName(c)}
- Empresa: ${c.company ?? "desconocida"}
- Cargo: ${c.title ?? "desconocido"}
- Ciudad: ${c.city ?? "desconocida"}

Candidatos:
${list}

Reglas: un homónimo en otra empresa NO es la persona, salvo evidencia de que cambió de empleo. Si ninguno corresponde, usa index -1.
Responde SOLO un JSON: {"index": <número>, "confidence": <0..1>, "reason": "<máx. 20 palabras>"}`,
  );
  if (!out) return null;
  if (out.index < 0 || out.index >= cands.length) {
    return { url: "", confidence: 0, source: "$+claude", reason: out.reason };
  }
  return {
    url: cands[out.index].url,
    confidence: Math.max(0, Math.min(1, out.confidence)),
    source: "$+claude",
    reason: out.reason,
  };
}
