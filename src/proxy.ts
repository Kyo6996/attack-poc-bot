import { NextResponse, type NextRequest } from "next/server";

// Los webhooks quedan fuera porque se validan con WEBHOOK_SECRET.
export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Attack POC"' },
  });
}

export const config = {
  matcher: ["/((?!api/webhooks|api/public|agendar|registro|email/|_next/static|_next/image|favicon.ico).*)"],
};
