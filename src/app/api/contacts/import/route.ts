import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { prepareContacts } from "@/lib/pipeline";

export const maxDuration = 60;
// Los primeros se enriquecen al instante; el resto con "Ejecutar pipeline".
const PREPARE_NOW = 10;

// Acepta encabezados en español o inglés; el separador puede ser coma o punto y coma.
const ALIASES: Record<string, string> = {
  nombre: "first_name", first_name: "first_name",
  apellidos: "last_name", apellido: "last_name", last_name: "last_name",
  empresa: "company", company: "company",
  cargo: "title", title: "title",
  ciudad: "city", city: "city",
  email: "email", correo: "email",
  consentimiento: "consent", consent: "consent",
  stand: "event_notes", event_notes: "event_notes", notas_stand: "event_notes",
  telefono: "phone", teléfono: "phone", celular: "phone", phone: "phone", movil: "phone", móvil: "phone",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

export async function POST(req: NextRequest) {
  const { csv } = (await req.json()) as { csv: string };
  const [header, ...rows] = parseCsv(csv ?? "");
  if (!header) return NextResponse.json({ error: "CSV vacío" }, { status: 400 });
  const cols = header.map((h) => ALIASES[h.toLowerCase().trim()] ?? null);
  if (!cols.includes("first_name") || !cols.includes("last_name")) {
    return NextResponse.json({ error: "El CSV debe tener columnas nombre y apellidos" }, { status: 400 });
  }

  const records = rows.map((r) => {
    const o: Record<string, unknown> = {};
    cols.forEach((k, i) => {
      if (!k) return;
      o[k] = k === "consent" ? /^(1|true|si|sí|yes|x)$/i.test(r[i] ?? "") : r[i] || null;
    });
    return o;
  });

  const { data: inserted, error } = await db().from("contacts").insert(records).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const count = inserted?.length ?? 0;
  await logEvent(null, "system", `Importados ${count} contactos: buscando su información…`, "success");
  after(() => prepareContacts((inserted ?? []).slice(0, PREPARE_NOW).map((r) => r.id)));
  return NextResponse.json({ inserted: count });
}
