import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { InputError, pick, REP_FIELDS, validateRep } from "@/lib/records";

export async function POST(req: NextRequest) {
  try {
    const data = pick(await req.json(), REP_FIELDS);
    validateRep(data, true);
    const { data: row, error } = await db().from("sales_reps").insert(data).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });
  }
}
