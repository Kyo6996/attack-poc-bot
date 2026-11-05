import "server-only";
import { extractPhones } from "../contactinfo";
import type { ContactPhone } from "../types";

export interface FoundEmail {
  email: string;
  score: number;
  status: string | null; // valid | accept_all | unknown…
  position: string | null;
  phones: ContactPhone[];
}

export const MIN_SCORE = 70;

// Correo profesional con nombre + dominio de la empresa (Hunter Email Finder).
export async function findWorkEmail(first: string, last: string, domain: string): Promise<{ found: FoundEmail | null; error?: string }> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { found: null, error: "sin HUNTER_API_KEY" };
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.search = new URLSearchParams({ domain, first_name: first, last_name: last.split(/\s+/)[0], api_key: key }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as {
      data?: { email: string | null; score: number | null; position: string | null; phone_number: string | null; verification?: { status: string | null } };
      errors?: { id: string; details: string }[];
    };
    if (json.errors?.length) return { found: null, error: `Hunter: ${json.errors[0].details}` };
    const d = json.data;
    if (!d?.email) return { found: null };
    return {
      found: {
        email: d.email.toLowerCase(),
        score: d.score ?? 0,
        status: d.verification?.status ?? null,
        position: d.position,
        phones: d.phone_number ? extractPhones(d.phone_number, "Hunter", "persona") : [],
      },
    };
  } catch (e) {
    return { found: null, error: `Hunter: ${(e as Error).message}` };
  }
}
