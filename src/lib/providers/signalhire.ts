import "server-only";
import { env } from "../env";
import { fullName, type Contact, type SignalHireInfo, type SignalHireProfile } from "../types";
import { normalize } from "../util";

const API = "https://www.signalhire.com/api/v1";
const key = () => process.env.SIGNALHIRE_API_KEY?.trim();
export const signalHireEnabled = () => !!key();

const headers = () => ({ apikey: key()!, "Content-Type": "application/json" });

// Créditos estándar (los que gasta revelar contactos). Consultar no cuesta.
export async function signalHireCredits(): Promise<number | null> {
  if (!key()) return null;
  try {
    const res = await fetch(`${API}/credits`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return ((await res.json()) as { credits: number }).credits;
  } catch {
    return null;
  }
}

async function searchByQuery(body: Record<string, unknown>) {
  const res = await fetch(`${API}/candidate/searchByQuery`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ size: 5, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 402) throw new Error("se agotó el cupo diario de búsquedas gratuitas");
  if (res.status === 429) throw new Error("demasiadas búsquedas a la vez; intenta en unos segundos");
  if (!res.ok) throw new Error(`SignalHire ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as { total: number; profiles: SignalHireProfile[] };
}

function score(c: Contact, p: SignalHireProfile) {
  const want = normalize(fullName(c)).split(" ").filter((t) => t.length > 1);
  const have = normalize(p.fullName);
  const name = want.filter((t) => have.includes(t)).length / Math.max(want.length, 1);
  const comp = normalize(c.company).split(" ").filter((t) => t.length > 3);
  const jobs = normalize((p.experience ?? []).map((e) => `${e.company} ${e.title}`).join(" "));
  const company = comp.length ? comp.filter((t) => jobs.includes(t)).length / comp.length : 0;
  const co = /colombia|bogota|medellin|cali|barranquilla/.test(normalize(p.location)) ? 0.05 : 0;
  return Math.round(Math.min(1, name * 0.6 + company * 0.35 + co) * 100) / 100;
}

// Búsqueda gratuita (cupo diario, no créditos): historial laboral, habilidades y ubicación.
export async function searchSignalHire(c: Contact): Promise<SignalHireInfo> {
  const name = fullName(c);
  let r = c.company ? await searchByQuery({ fullName: name, currentPastCompany: c.company }) : null;
  if (!r || !r.profiles?.length) r = await searchByQuery({ fullName: name, location: "Colombia" });
  if (!r.profiles?.length) r = await searchByQuery({ fullName: name });
  const ranked = (r.profiles ?? []).map((p) => ({ ...p, score: score(c, p) })).sort((a, b) => b.score - a.score);
  const best = ranked[0] && ranked[0].score >= 0.6 ? ranked[0] : null;
  return { searched_at: new Date().toISOString(), total: r.total ?? ranked.length, best, others: ranked.filter((p) => p !== best).slice(0, 3) };
}

// Revelar contactos: gasta 1 crédito estándar. Solo se llama desde una acción manual confirmada.
export async function revealContacts(contactId: string, item: string): Promise<{ requestId: number }> {
  const callbackUrl = `${env.appUrl()}/api/webhooks/signalhire?token=${encodeURIComponent(env.webhookSecret())}&contact=${contactId}&mode=reveal`;
  const res = await fetch(`${API}/candidate/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ items: [item], callbackUrl }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 402) throw new Error("No quedan créditos en SignalHire");
  if (!res.ok) throw new Error(`SignalHire ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as { requestId: number };
}
