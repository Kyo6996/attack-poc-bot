import { NextResponse, type NextRequest } from "next/server";
import { createSession, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

// Cualquier usuario con la clave del panel (DASHBOARD_PASSWORD).
export async function POST(req: NextRequest) {
  const { user, password } = (await req.json().catch(() => ({}))) as { user?: string; password?: string };
  const expected = process.env.DASHBOARD_PASSWORD;
  const name = (user ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Escribe tu usuario" }, { status: 400 });
  if (expected && password !== expected) {
    await new Promise((r) => setTimeout(r, 600)); // frena intentos por fuerza bruta
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, user: name });
  res.cookies.set(SESSION_COOKIE, await createSession(name), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
