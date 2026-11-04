import { type NextRequest } from "next/server";
import { db } from "@/lib/db";

// Vista previa del HTML tal como se envió.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db().from("emails").select("html").eq("id", id).maybeSingle();
  if (!data) return new Response("Correo no encontrado", { status: 404 });
  return new Response(data.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
