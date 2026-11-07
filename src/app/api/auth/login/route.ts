import { NextResponse, type NextRequest } from "next/server";
import { clientIp, countRecent, recordHit, safeEqual } from "@/lib/security";
import { createSession, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

// Cualquier usuario con la clave del panel (DASHBOARD_PASSWORD).
// Tras 8 intentos fallidos desde la misma IP en 15 minutos se bloquea esa IP por ese tiempo.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if ((await countRecent("login-fail", 900, ip)) >= 8) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }

  const { user, password } = (await req.json().catch(() => ({}))) as { user?: string; password?: string };
  const expected = process.env.DASHBOARD_PASSWORD;
  const name = (user ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Escribe tu usuario" }, { status: 400 });
  if (!expected && process.env.NODE_ENV === "production") return NextResponse.json({ error: "Acceso no configurado" }, { status: 503 });
  if (expected && !safeEqual(password ?? "", expected)) {
    await recordHit("login-fail", ip);
    await new Promise((r) => setTimeout(r, 600));
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
