import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDue } from "@/lib/report";
import { getSettings } from "@/lib/settings";

// n8n pregunta cada hora si toca el envío programado; la frecuencia y la hora se configuran en Capricorne.
export async function GET() {
  const { schedule } = (await getSettings()).report;
  let due = isDue(schedule.frequency, schedule.hour);
  if (due) {
    // Evita un doble envío programado en la misma hora si n8n reintenta.
    const since = new Date(Date.now() - 50 * 60_000).toISOString();
    const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("step", "report").eq("level", "success").like("message", "%programado%").gte("created_at", since);
    if (count) due = false;
  }
  return NextResponse.json({ due, frequency: schedule.frequency, hour: schedule.hour });
}
