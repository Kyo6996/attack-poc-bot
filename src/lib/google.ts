import "server-only";
import { env } from "./env";

let cached: { value: string; exp: number } | null = null;

// Un solo refresh token sirve para Calendar y Gmail (scopes pedidos juntos en el script).
export async function googleAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60000) return cached.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      refresh_token: env.googleRefreshToken(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}
