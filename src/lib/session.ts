// Sesión firmada con HMAC (Web Crypto: sirve en el proxy y en las rutas).
export const SESSION_COOKIE = "cp_session";
export const SESSION_DAYS = 7;

const enc = new TextEncoder();

function secret() {
  return process.env.AUTH_SECRET || process.env.WEBHOOK_SECRET || process.env.DASHBOARD_PASSWORD || "dev-secret";
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
  if (!payload || !sig || (await hmac(payload)) !== sig) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; exp: number };
    return data.exp > Date.now() ? { u: data.u } : null;
  } catch {
    return null;
  }
}
