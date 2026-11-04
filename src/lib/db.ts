import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import type { Contact, ContactStatus, EventRow } from "./types";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function logEvent(
  contactId: string | null,
  step: string,
  message: string,
  level: EventRow["level"] = "info",
  data?: unknown,
) {
  const { error } = await db()
    .from("events")
    .insert({ contact_id: contactId, step, level, message, data: data ?? null });
  if (error) console.error("logEvent", error.message);
}

export async function getContact(id: string): Promise<Contact> {
  const { data, error } = await db().from("contacts").select("*").eq("id", id).single();
  if (error) throw new Error(`Contacto ${id}: ${error.message}`);
  return data as Contact;
}

export async function updateContact(id: string, patch: Partial<Contact>): Promise<Contact> {
  const { data, error } = await db().from("contacts").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(`No se pudo actualizar ${id}: ${error.message}`);
  return data as Contact;
}

// Lock optimista para que el botón y el modo automático no procesen el mismo contacto.
export async function claimContact(id: string, expected: ContactStatus, seconds = 120): Promise<Contact | null> {
  const now = new Date();
  const { data, error } = await db()
    .from("contacts")
    .update({ locked_until: new Date(now.getTime() + seconds * 1000).toISOString() })
    .eq("id", id)
    .eq("status", expected)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("*");
  if (error) throw new Error(error.message);
  return (data?.[0] as Contact) ?? null;
}

export async function releaseContact(id: string) {
  await db().from("contacts").update({ locked_until: null }).eq("id", id);
}
