export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 10 dígitos que empiezan por 3 = celular colombiano
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return /^\+\d{8,15}$/.test(digits) ? digits : null;
  if (/^3\d{9}$/.test(digits)) return `+57${digits}`;
  if (/^57\d{10}$/.test(digits)) return `+${digits}`;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

export function maskPhone(p: string | null): string {
  if (!p) return "—";
  return p.length > 6 ? `${p.slice(0, 6)}•••••${p.slice(-2)}` : p;
}

export function maskEmail(e: string | null): string {
  if (!e) return "—";
  const [u, d] = e.split("@");
  return d ? `${u.slice(0, 2)}•••@${d}` : e;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
