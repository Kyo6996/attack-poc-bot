import { NextResponse } from "next/server";
import { db, logEvent } from "@/lib/db";
import { resetAllContacts } from "@/lib/records";

export async function POST() {
  try {
    await db().from("events").delete().gte("id", 0);
    await resetAllContacts();
    await logEvent(null, "system", "Demo reiniciada");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
