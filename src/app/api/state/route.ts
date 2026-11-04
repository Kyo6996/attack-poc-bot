import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [contacts, meetings, events, sandbox] = await Promise.all([
      db().from("contacts").select("*").order("created_at").order("id"),
      db().from("meetings").select("*").order("starts_at"),
      db().from("events").select("*").order("id", { ascending: false }).limit(120),
      db().from("sandbox_profiles").select("*").order("created_at").order("id"),
    ]);
    const err = contacts.error ?? meetings.error ?? events.error ?? sandbox.error;
    if (err) throw new Error(err.message);
    return NextResponse.json(
      {
        contacts: contacts.data,
        meetings: meetings.data,
        events: events.data,
        sandbox: sandbox.data,
        providers: env.providers,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
