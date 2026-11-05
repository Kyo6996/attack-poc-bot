import "server-only";
import { findPhoneNumbersInText } from "libphonenumber-js/max";

export interface FoundPhone {
  value: string; // E.164
  type: "celular" | "fijo";
  source: string; // de dónde salió: "Google Maps", "sitio web", "resultado de búsqueda"
  owner: "persona" | "empresa";
}

// Formato anterior a 2021: "+57 1 3078000" → "601 3078000"
function modernize(text: string) {
  return text.replace(/(?:\+?57[\s.-]*)?\(?\b0?([1-8])\)?[\s.-]+(\d{3})[\s.-]?(\d{4})\b/g, (m, a, b, c) =>
    /\+?57/.test(m) || /\(/.test(m) ? `60${a}${b}${c}` : m,
  );
}

export function extractPhones(text: string, source: string, owner: FoundPhone["owner"]): FoundPhone[] {
  const out: FoundPhone[] = [];
  for (const f of findPhoneNumbersInText(modernize(text), "CO")) {
    const t = f.number.getType();
    if (f.number.country !== "CO" || !f.number.isValid()) continue;
    if (t !== "MOBILE" && t !== "FIXED_LINE" && t !== "FIXED_LINE_OR_MOBILE") continue;
    if (!out.some((p) => p.value === f.number.number)) {
      out.push({ value: f.number.number, type: t === "MOBILE" ? "celular" : "fijo", source, owner });
    }
  }
  return out;
}

const NOREPLY = /no-?reply|example|sentry|wixpress|@2x|\.png|\.jpg|\.webp/i;

export function extractEmails(text: string): string[] {
  const found = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()).filter((e) => !NOREPLY.test(e)))].slice(0, 5);
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AttackPOC/1.0)", Accept: "text/html" },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 400_000);
    // Los enlaces tel: y mailto: son la fuente más limpia; el texto visible complementa.
    const links = [...html.matchAll(/(?:tel|mailto):([^"'>\s]+)/gi)].map((m) => decodeURIComponent(m[1])).join(" \n ");
    const visible = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    return `${links}\n${visible}`;
  } catch {
    return null;
  }
}

// Lee la página de inicio y la de contacto de la web pública de la empresa.
export async function crawlCompanySite(website: string): Promise<{ phones: FoundPhone[]; emails: string[]; pages: string[] }> {
  const base = new URL(website);
  const pages: string[] = [];
  let text = "";
  for (const path of ["/", "/contacto", "/contactenos", "/contact"]) {
    const url = new URL(path, base).toString();
    const t = await getText(url);
    if (!t) continue;
    pages.push(url);
    text += `\n${t}`;
    if (pages.length >= 2) break;
  }
  return { phones: extractPhones(text, "sitio web", "empresa").slice(0, 4), emails: extractEmails(text), pages };
}
