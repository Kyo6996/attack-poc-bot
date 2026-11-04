import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { env } from "@/lib/env";
import { applyEnrichment, runPipeline } from "@/lib/pipeline";
import { parseSignalHireItem, type SignalHireCallbackItem } from "@/lib/providers/enrichment";
import type { Contact } from "@/lib/types";

// SignalHire exige un 200 en menos de 10 s, por eso la llamada se dispara con after().
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== env.webhookSecret()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const contactId = req.nextUrl.searchParams.get("contact");
  const items = (await req.json()) as SignalHireCallbackItem[];

  for (const item of items) {
    let q = db().from("contacts").select("*").eq("status", "enriching");
    q = contactId ? q.eq("id", contactId) : q.eq("linkedin_url", item.item);
    const { data } = await q.maybeSingle();
    if (!data) continue;
    await applyEnrichment(data as Contact, parseSignalHireItem(item));
  }

  after(async () => {
    try {
      await runPipeline({ contactId: contactId ?? undefined });
    } catch (e) {
      await logEvent(contactId, "system", `Error tras callback: ${(e as Error).message}`, "error");
    }
  });

  return NextResponse.json({ ok: true });
}
