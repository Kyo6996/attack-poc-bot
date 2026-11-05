import { NextResponse, type NextRequest } from "next/server";
import { parseAnalysis, type Analysis } from "@/lib/report";
import { generateReport, reportFileName } from "@/lib/report-send";

export const maxDuration = 60;

function pdfResponse(pdf: Buffer, name: string, inline: boolean, extra: Record<string, string> = {}) {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

// Vista previa desde el panel (?ai=1 usa Claude si hay clave).
export async function GET(req: NextRequest) {
  const { data, pdf } = await generateReport({ useClaude: req.nextUrl.searchParams.get("ai") === "1" });
  return pdfResponse(pdf, reportFileName(data), true);
}

// n8n envía el análisis de Claude (objeto o texto crudo de la respuesta); si no sirve, se usan las reglas.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { analysis?: Analysis | string | null; source?: string };
  const analysis = body.analysis ? parseAnalysis(typeof body.analysis === "string" ? body.analysis : JSON.stringify(body.analysis)) : null;
  const { data, source, pdf } = await generateReport({ analysis, source: body.source ?? "Claude Haiku 5.5" });
  return pdfResponse(pdf, reportFileName(data), false, { "X-Report-Analysis": encodeURIComponent(source) });
}
