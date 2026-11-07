// Sesión firmada con HMAC (Web Crypto: sirve en el proxy y en las rutas).
export const SESSION_COOKIE = "cp_session";
export const SESSION_DAYS = 7;

const enc = new TextEncoder();

// En producción las sesiones se firman solo con AUTH_SECRET (nunca con el secreto que viaja en las URLs de webhooks).
function secret() {
  const s = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? process.env.WEBHOOK_SECRET || "dev-secret" : "");
  if (!s) throw new Error("Falta AUTH_SECRET");
  return s;
}

// Comparación en tiempo constante (también funciona en el proxy, sin node:crypto).
export function ctEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function createSession(user: string) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Date.now() + SESSION_DAYS * 86400_000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function readSession(token: string | undefined | null): Promise<{ u: string } | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    if (!ctEqual(await hmac(payload), sig)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; exp: number };
    return data.exp > Date.now() ? { u: data.u } : null;
  } catch {
    return null;
  }
}
