import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { contactId?: string; limit?: number };
  try {
    return NextResponse.json(await runPipeline(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
