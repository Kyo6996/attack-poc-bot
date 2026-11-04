import { NextResponse, type NextRequest } from "next/server";
import { sendEmail } from "@/lib/email/send";
import type { EmailKind } from "@/lib/types";

const KINDS: EmailKind[] = ["confirmacion", "seguimiento", "brief_comercial"];

// Envío o reenvío manual desde el panel. Body: { contactId, kind }
export async function POST(req: NextRequest) {
  const { contactId, kind } = (await req.json()) as { contactId?: string; kind?: EmailKind };
  if (!contactId || !kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "contactId y kind son obligatorios" }, { status: 400 });
  }
  const r = await sendEmail(kind, contactId);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
