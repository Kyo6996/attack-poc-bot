import { NextResponse } from "next/server";
import { db, logEvent } from "@/lib/db";

export async function POST() {
  const d = db();
  await d.from("meetings").delete().not("id", "is", null);
  await d.from("events").delete().gte("id", 0);
  const { error } = await d
    .from("contacts")
    .update({
      status: "pending",
      skip_reason: null,
      linkedin_url: null,
      linkedin_confidence: null,
      linkedin_source: null,
      enrichment_source: null,
      phone: null,
      call_id: null,
      call_outcome: null,
      qualification: null,
      call_summary: null,
      call_transcript: null,
      recording_url: null,
      locked_until: null,
    })
    .not("id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(null, "system", "Demo reiniciada");
  return NextResponse.json({ ok: true });
}
