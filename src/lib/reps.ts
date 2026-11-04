import "server-only";
import { db } from "./db";
import type { SalesRep } from "./types";

// Comercial del área de interés con menos reuniones próximas; si no hay, uno "general".
export async function assignRep(area?: string | null): Promise<SalesRep | null> {
  const { data: reps } = await db().from("sales_reps").select("*").eq("active", true);
  if (!reps?.length) return null;
  const norm = (s?: string | null) => (s ?? "").toLowerCase();
  let pool = reps.filter((r) => norm(r.area) === norm(area));
  if (!pool.length) pool = reps.filter((r) => r.area === "general");
  if (!pool.length) pool = reps;

  const { data: upcoming } = await db()
    .from("meetings")
    .select("sales_rep_id")
    .gte("starts_at", new Date().toISOString())
    .in("sales_rep_id", pool.map((r) => r.id));
  const load = (id: string) => (upcoming ?? []).filter((m) => m.sales_rep_id === id).length;
  return [...pool].sort((a, b) => load(a.id) - load(b.id))[0] as SalesRep;
}
