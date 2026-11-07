import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { db } from "./db";

// Comparación de secretos en tiempo constante (no revela cuántos caracteres coinciden).
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

// La IP se guarda resumida (hash con secreto), nunca en claro.
const ipKey = (ip: string) =>
  createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? process.env.WEBHOOK_SECRET ?? ""}:${ip}`)
    .digest("hex")
    .slice(0, 16);

// Registros en la tabla events (step "security"): persisten entre instancias de Vercel y no salen en la bitácora.
export async function recordHit(bucket: string, ip?: string) {
  await db().from("events").insert({ contact_id: null, step: "security", level: "info", message: bucket, data: ip ? { bucket, ip: ipKey(ip) } : { bucket } });
}

// Cuántos registros hubo en la ventana; con ip, solo los de esa IP.
export async function countRecent(bucket: string, windowSec: number, ip?: string): Promise<number> {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { count } = await db()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("step", "security")
    .contains("data", ip ? { bucket, ip: ipKey(ip) } : { bucket })
    .gte("created_at", since);
  return count ?? 0;
}

// true si todavía está dentro del límite (y cuenta este intento).
export async function rateLimit(bucket: string, ip: string, max: number, windowSec: number): Promise<boolean> {
  if ((await countRecent(bucket, windowSec, ip)) >= max) return false;
  await recordHit(bucket, ip);
  return true;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const isPrivate = (ip: string) =>
  isIP(ip) === 4 ? PRIVATE_V4.some((r) => r.test(ip)) : /^(::1|::|fc|fd|fe80|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);

// Solo se descargan páginas públicas: nada de localhost, redes privadas ni metadatos de la nube.
export async function isPublicUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return false;
  if (u.port && !["80", "443"].includes(u.port)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return false;
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivate(a.address));
  } catch {
    return false;
  }
}

// fetch que revisa cada redirección para no terminar en una dirección interna.
export async function safeFetch(url: string, init: RequestInit = {}, hops = 3): Promise<Response | null> {
  let current = url;
  for (let i = 0; i <= hops; i++) {
    if (!(await isPublicUrl(current))) return null;
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const next = res.headers.get("location");
    if (!next) return res;
    current = new URL(next, current).toString();
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
