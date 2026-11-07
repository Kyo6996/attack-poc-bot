import { NextResponse, type NextRequest } from "next/server";
import { ctEqual, readSession, SESSION_COOKIE } from "@/lib/session";

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Panel protegido por sesión (login). Los webhooks y las páginas públicas quedan fuera del matcher.
export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const prod = process.env.NODE_ENV === "production";
  if (!password) return prod ? new NextResponse("Acceso no configurado", { status: 503 }) : NextResponse.next();
  const { pathname, search } = req.nextUrl;

  // Una escritura que viene de otro sitio con la sesión del usuario se rechaza (CSRF).
  const origin = req.headers.get("origin");
  if (WRITE.has(req.method) && origin && new URL(origin).host !== req.nextUrl.host) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (await readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // n8n entra solo a las rutas del reporte con su propia clave.
  const reportKey = process.env.REPORT_API_KEY?.trim();
  if (reportKey && /^\/api\/report\/(data|pdf|log|due)$/.test(pathname) && ctEqual(req.headers.get("x-report-key") ?? "", reportKey)) return NextResponse.next();

  // La cabecera Basic con la clave del panel solo se acepta fuera de producción (pruebas locales).
  const auth = req.headers.get("authorization");
  if (!prod && auth?.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (ctEqual(pass ?? "", password)) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api/webhooks|api/public|agendar|registro|email/|voces/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
