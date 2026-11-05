import { NextResponse, type NextRequest } from "next/server";
import { logEvent } from "@/lib/db";

// n8n confirma aquí el envío (o el error) para que quede en la bitácora de Capricorne.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { ok?: boolean; recipients?: number | string; trigger?: string; analysis?: string; error?: string };
  const n = typeof b.recipients === "string" ? b.recipients.split(",").filter(Boolean).length : (b.recipients ?? 0);
  await logEvent(
    null,
    "report",
    b.ok === false
      ? `n8n no pudo enviar el reporte: ${b.error ?? "error desconocido"}`
      : `Reporte enviado por n8n a ${n} destinatario(s) (${b.trigger ?? "programado"}; análisis: ${b.analysis ?? "Claude"})`,
    b.ok === false ? "error" : "success",
  );
  return NextResponse.json({ ok: true });
}
