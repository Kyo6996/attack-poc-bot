import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

// Panel protegido por sesión (login). Los webhooks y las páginas públicas quedan fuera del matcher.
// La cabecera Basic con la clave del panel sigue sirviendo para scripts y pruebas automáticas.
export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  if (await readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // n8n entra solo a las rutas del reporte con su propia clave.
  const reportKey = process.env.REPORT_API_KEY?.trim();
  if (reportKey && /^\/api\/report\/(data|pdf|log|due)$/.test(pathname) && req.headers.get("x-report-key") === reportKey) return NextResponse.next();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (pass === password) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api/webhooks|api/public|agendar|registro|email/|voces/|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
