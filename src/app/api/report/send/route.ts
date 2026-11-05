import { NextResponse } from "next/server";
import { triggerReport } from "@/lib/report-send";

export const maxDuration = 60;

// Botón "Enviar ahora": manda el reporte con los datos que haya en este momento.
export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await triggerReport("manual")) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
