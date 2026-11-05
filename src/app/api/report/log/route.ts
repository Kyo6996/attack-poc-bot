import { NextResponse, type NextRequest } from "next/server";
import { logEvent } from "@/lib/db";
import { getSettings } from "@/lib/settings";

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
    { via: "n8n", trigger: b.trigger ?? "programado", recipients: n, analysis: b.analysis ?? "Claude", frequency: (await getSettings()).report.schedule.frequency },
  );
  return NextResponse.json({ ok: true });
}
