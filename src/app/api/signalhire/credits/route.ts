import { NextResponse } from "next/server";
import { signalHireCredits, signalHireEnabled } from "@/lib/providers/signalhire";

export async function GET() {
  return NextResponse.json({ enabled: signalHireEnabled(), credits: await signalHireCredits() });
}
