import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nextSends } from "@/lib/report";
import { getSettings } from "@/lib/settings";

// Envíos del reporte en un mes (para el calendario) y próximas fechas programadas.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 5)).toISOString();
  const to = new Date(Date.UTC(y, m, 1, 5)).toISOString();
  const { data } = await db()
    .from("events")
    .select("message, level, created_at, data")
    .eq("step", "report")
    .in("level", ["success", "error"])
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at");
  const { schedule } = (await getSettings()).report;
  return NextResponse.json({ month, sends: data ?? [], next: nextSends(schedule.frequency, schedule.hour), schedule });
}
