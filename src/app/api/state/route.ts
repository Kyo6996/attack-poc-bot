import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { reconcileStuckCalls } from "@/lib/reconcile";
import { computeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  // Revisa en segundo plano llamadas que quedaron abiertas porque el aviso de Vapi no llegó.
  after(() => reconcileStuckCalls().catch(() => undefined));
  try {
    const [contacts, meetings, events, sandbox, reps, emails, calls, stats] = await Promise.all([
      db().from("contacts").select("*").order("created_at").order("id"),
      db().from("meetings").select("*").order("starts_at"),
      db().from("events").select("*").order("id", { ascending: false }).limit(120),
      db().from("sandbox_profiles").select("*").order("created_at").order("id"),
      db().from("sales_reps").select("*").order("area").order("name"),
      db()
        .from("emails")
        .select("id, contact_id, meeting_id, kind, to_email, subject, provider, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(300),
      db().from("calls").select("*").order("started_at", { ascending: false }).limit(300),
      computeStats(),
    ]);
    const settings = await getSettings();
    const err = [contacts, meetings, events, sandbox, reps, emails, calls].find((r) => r.error)?.error;
    if (err) throw new Error(err.message);
    return NextResponse.json(
      {
        contacts: contacts.data,
        meetings: meetings.data,
        events: events.data,
        sandbox: sandbox.data,
        reps: reps.data,
        emails: emails.data,
        calls: calls.data,
        stats,
        settings,
        providers: env.providers,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
