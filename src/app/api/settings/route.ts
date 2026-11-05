import { NextResponse, type NextRequest } from "next/server";
import { logEvent } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/settings";

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { live_calls?: boolean };
  try {
    if (typeof body.live_calls === "boolean") {
      await setSetting("live_calls", body.live_calls);
      await logEvent(null, "system", body.live_calls ? "Llamadas reales activadas" : "Llamadas reales desactivadas: se simulan");
    }
    return NextResponse.json(await getSettings());
  } catch (e) {
    return NextResponse.json({ error: `${(e as Error).message}. ¿Corriste la migración 0003?` }, { status: 500 });
  }
}
