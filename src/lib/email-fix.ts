import "server-only";
import { resolveMx } from "node:dns/promises";
import type { Contact } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Errores típicos al transcribir dominios dictados por voz.
const DOMAIN_FIX: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.es": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yahooo.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
};

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// "hans punto manjarrez arroba gmail punto com" o con espacios → hans.manjarrez@gmail.com
const DIGITS: Record<string, string> = { cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9" };

export function normalizeDictated(raw: string): string {
  // Solo en dictado ("… arroba …") los números vienen en palabras; en un correo escrito "uno" puede ser parte del nombre.
  const spoken = /\sarroba\s/i.test(raw);
  return strip(raw)
    .replace(/(^|\s)(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)(?=\s|$)/g, (m, sp: string, w: string) => (spoken ? sp + DIGITS[w] : m))
    .replace(/\s+arroba\s+|\s*\(at\)\s*/g, "@")
    .replace(/\s+punto\s+/g, ".")
    .replace(/\s+guion bajo\s+/g, "_")
    .replace(/\s+guion\s+/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "");
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Correos que ya conocemos del lead (base, Hunter, SignalHire, Apollo).
function knownEmails(c: Contact): string[] {
  const p = c.profile;
  const list = [c.email, p?.email?.value, p?.apollo?.person?.email, ...(p?.signalhire?.reveal?.emails ?? []).map((e) => e.value)];
  return [...new Set(list.filter((e): e is string => !!e && EMAIL.test(e)).map((e) => e.trim().toLowerCase()))];
}

// Corrige en la parte local los nombres o apellidos que el transcriptor escribió parecido (Manjarres → Manjarrez).
function fixNames(local: string, c: Contact): string {
  const names = strip(`${c.first_name} ${c.last_name}`)
    .split(/\s+/)
    .filter((t) => t.length >= 5);
  let out = local;
  for (const name of names) {
    if (out.includes(name)) continue;
    let best: { at: number; len: number; dist: number } | null = null;
    for (const len of [name.length, name.length + 1, name.length - 1]) {
      for (let at = 0; at + len <= out.length; at++) {
        const piece = out.slice(at, at + len);
        if (piece[0] !== name[0] || /[^a-z]/.test(piece)) continue;
        const dist = lev(piece, name);
        if (dist <= 2 && (!best || dist < best.dist)) best = { at, len, dist }; // en empate gana la longitud exacta
      }
    }
    if (best && best.dist > 0) out = out.slice(0, best.at) + name + out.slice(best.at + best.len);
  }
  return out;
}

export interface EmailCheck {
  email: string | null;
  corrected: boolean;
  note: string | null;
  error: string | null;
}

// Reconcilia el correo dictado en la llamada con lo que ya sabemos del lead antes de usarlo.
export async function reconcileEmail(dictated: string | null | undefined, c: Contact): Promise<EmailCheck> {
  const known = knownEmails(c);
  if (!dictated?.trim()) {
    return known[0] ? { email: known[0], corrected: false, note: null, error: null } : { email: null, corrected: false, note: null, error: "sin correo" };
  }
  const original = normalizeDictated(dictated);
  if (!EMAIL.test(original)) return { email: null, corrected: false, note: null, error: `"${dictated}" no es un correo válido` };

  let [local, domain] = original.split("@");
  domain = DOMAIN_FIX[domain] ?? domain;
  let email = `${local}@${domain}`;
  if (known.includes(email)) return { email, corrected: email !== original, note: email !== original ? `se corrigió a ${email}` : null, error: null };

  // Muy parecido a uno que ya tenemos: casi seguro es el mismo mal transcrito.
  const close = known.map((k) => ({ k, d: lev(k, email) })).sort((a, b) => a.d - b.d)[0];
  if (close && close.d <= Math.max(2, Math.round(close.k.length * 0.12))) {
    return { email: close.k, corrected: true, note: `el dictado "${original}" coincide con el correo registrado ${close.k}`, error: null };
  }

  local = fixNames(local, c);
  email = `${local}@${domain}`;

  try {
    const mx = await Promise.race([resolveMx(domain), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    if (!mx.length) return { email: null, corrected: false, note: null, error: `el dominio ${domain} no recibe correos` };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return { email: null, corrected: false, note: null, error: `el dominio ${domain} no existe` };
  }

  const corrected = email !== original;
  return { email, corrected, note: corrected ? `se corrigió "${original}" a ${email} (ortografía del nombre registrado)` : null, error: null };
}

const DIGIT_WORDS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];

// Parte el usuario del correo en palabras pronunciables: nombres del lead, números en palabras y el resto como viene.
// "hansdavidmanjarrez1" → "hans david manjarrez uno", para que la voz no lo lea como una sola palabra.
export function spokenEmailFor(email: string, c: Pick<Contact, "first_name" | "last_name">): string {
  const [local, domain = ""] = email.split("@");
  const names = `${c.first_name} ${c.last_name}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((n) => n.length > 1)
    .sort((a, b) => b.length - a.length);
  const parts: string[] = [];
  let rest = "";
  const flush = () => {
    if (rest) parts.push(rest);
    rest = "";
  };
  for (let i = 0; i < local.length; ) {
    const ch = local[i];
    const name = names.find((n) => local.startsWith(n, i));
    if (name) {
      flush();
      parts.push(name);
      i += name.length;
    } else if (/\d/.test(ch)) {
      flush();
      parts.push(DIGIT_WORDS[Number(ch)]);
      i++;
    } else if (ch === ".") {
      flush();
      parts.push("punto");
      i++;
    } else if (ch === "_" || ch === "-") {
      flush();
      parts.push(ch === "_" ? "guion bajo" : "guion");
      i++;
    } else {
      rest += ch;
      i++;
    }
  }
  flush();
  return `${parts.join(" ")} arroba ${domain.replace(/\./g, " punto ")}`.replace(/\s+/g, " ").trim();
}

// Cómo debe pronunciar el agente un correo para confirmarlo.
export function spokenEmail(email: string): string {
  return email.replace(/@/g, " arroba ").replace(/\./g, " punto ").replace(/_/g, " guion bajo ").replace(/-/g, " guion ");
}
