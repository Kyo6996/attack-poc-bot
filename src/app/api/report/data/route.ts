import { NextResponse } from "next/server";
import { buildReport, claudePrompt, rulesAnalysis } from "@/lib/report";
import { reportFileName, reportSubject } from "@/lib/report-send";

// Datos del período para n8n: incluye la instrucción lista para Claude y el análisis por reglas de respaldo.
export async function GET() {
  const data = await buildReport();
  return NextResponse.json({
    ...data,
    subject: reportSubject(data),
    filename: reportFileName(data),
    analysis_rules: rulesAnalysis(data),
    claude_prompt: claudePrompt(data),
  });
}
