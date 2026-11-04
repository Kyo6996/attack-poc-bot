"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Contact, ContactStatus, EventRow, Meeting, SandboxProfile } from "@/lib/types";
import { maskEmail, maskPhone } from "@/lib/util";
import { Editor, type Field } from "./editor";

interface State {
  contacts: Contact[];
  meetings: Meeting[];
  events: EventRow[];
  sandbox: SandboxProfile[];
  providers: Record<string, string>;
}

type Editing =
  | { kind: "contact"; row: Partial<Contact> }
  | { kind: "sandbox"; row: Partial<SandboxProfile> }
  | null;

const STATUS: Record<ContactStatus, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "b-neutral" },
  linkedin_found: { label: "Perfil ubicado", cls: "b-info" },
  enriching: { label: "Enriqueciendo…", cls: "b-info pulse" },
  phone_found: { label: "Celular encontrado", cls: "b-info" },
  calling: { label: "En llamada…", cls: "b-info pulse" },
  meeting_scheduled: { label: "Reunión agendada", cls: "b-ok" },
  declined: { label: "No aceptó", cls: "b-warn" },
  no_answer: { label: "No contestó", cls: "b-warn" },
  call_failed: { label: "Error en llamada", cls: "b-err" },
  skipped: { label: "Omitido", cls: "b-neutral" },
};

const OUTCOME_LABEL: Record<string, string> = { accept: "Acepta", decline: "No acepta", no_answer: "No contesta" };

const CONTACT_FORM: Field[] = [
  { name: "first_name", label: "Nombre", required: true },
  { name: "last_name", label: "Apellidos", required: true },
  { name: "company", label: "Empresa" },
  { name: "title", label: "Cargo" },
  { name: "city", label: "Ciudad" },
  { name: "email", label: "Correo", type: "email", hint: "Si se deja vacío, se toma del enriquecimiento" },
  { name: "event_notes", label: "Qué vio o preguntó en el stand", type: "textarea", placeholder: "Ej.: las soluciones de infraestructura híbrida" },
  { name: "consent", label: "Tiene consentimiento para ser contactado", type: "checkbox", wide: true },
];

const SANDBOX_FORM: Field[] = [
  { name: "full_name", label: "Nombre completo", required: true, hint: "Como aparecería en LinkedIn" },
  { name: "company", label: "Empresa" },
  { name: "headline", label: "Titular de LinkedIn", wide: true, placeholder: "Ej.: Gerente de Tecnología en Andino Software" },
  { name: "linkedin_url", label: "URL del perfil", type: "url", required: true, wide: true, placeholder: "https://www.linkedin.com/in/…" },
  { name: "mobile_phone", label: "Celular", type: "tel", placeholder: "+573001234567", hint: "Vacío = el proveedor no encuentra celular" },
  { name: "email", label: "Correo", type: "email" },
  {
    name: "mock_call_outcome",
    label: "Resultado si la llamada es simulada",
    type: "select",
    options: Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label })),
  },
];

const PROVIDER_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  enrichment: "Enriquecimiento",
  voice: "Voz",
  calendar: "Calendario",
};
const SANDBOX = ["sandbox", "simulated"];
const RUNNABLE: ContactStatus[] = ["pending", "linkedin_found", "phone_found"];

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.error ?? `Error ${res.status}`;
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"contacts" | "sandbox">("contacts");
  const [editing, setEditing] = useState<Editing>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Error cargando estado");
    else {
      setError(null);
      setState(json);
    }
  }, []);

  const run = useCallback(
    async (contactId?: string) => {
      setBusy(true);
      setMsg(contactId ? "Procesando contacto…" : "Ejecutando pipeline…");
      try {
        const res = await fetch("/api/pipeline/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contactId ? { contactId } : {}),
        });
        const json = await res.json();
        if (!res.ok) setMsg(`Error: ${json.error}`);
        else setMsg(json.waiting ?? (json.processed.length ? `${json.processed.length} contacto(s) avanzados` : "No hay contactos pendientes"));
      } finally {
        setBusy(false);
        load();
      }
    },
    [load],
  );

  // Refresco continuo: los cambios hechos directamente en Supabase aparecen en ~2 s.
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 2000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => !busy && run(), 8000);
    return () => clearInterval(t);
  }, [auto, busy, run]);

  async function reset() {
    if (!confirm("¿Reiniciar la demo? Se borran reuniones y bitácora y todos los contactos vuelven a 'Pendiente'.")) return;
    await fetch("/api/demo/reset", { method: "POST" });
    setMsg("Demo reiniciada");
    load();
  }

  async function reprocess(c: Contact) {
    const err = await send(`/api/contacts/${c.id}`, "PATCH", { reprocess: true });
    setMsg(err ?? `${c.first_name} vuelve a pendiente`);
    load();
  }

  async function importCsv(file: File) {
    const csv = await file.text();
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    const json = await res.json();
    setMsg(res.ok ? `Importados ${json.inserted} contactos` : `Error: ${json.error}`);
    load();
  }

  const contacts = state?.contacts ?? [];
  const sandbox = state?.sandbox ?? [];
  const meetingOf = (id: string) => state?.meetings.find((m) => m.contact_id === id);
  const nameOf = (id: string | null) => {
    const c = contacts.find((x) => x.id === id);
    return c ? `${c.first_name} ${c.last_name}` : null;
  };
  const count = (pred: (c: Contact) => boolean) => contacts.filter(pred).length;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>
            Bot de prospección <span>· Attack POC</span>
          </h1>
          <div className="sub">LinkedIn → enriquecimiento → llamada de voz con IA → reunión agendada</div>
        </div>
        <div className="chips">
          {state &&
            Object.entries(state.providers).map(([k, v]) => (
              <span key={k} className={`chip ${SANDBOX.includes(v) ? "" : "live"}`}>
                {PROVIDER_LABEL[k] ?? k}: <b>{v}</b>
              </span>
            ))}
        </div>
      </header>

      {error && (
        <div className="err">
          {error}. Revisa las variables de entorno y que hayas corrido la migración en Supabase.
        </div>
      )}

      <div className="kpis">
        <Kpi n={contacts.length} l="Contactos" />
        <Kpi n={count((c) => !!c.linkedin_url)} l="Perfil de LinkedIn ubicado" />
        <Kpi n={count((c) => !!c.phone)} l="Con celular" />
        <Kpi n={count((c) => !!c.call_id)} l="Llamados" />
        <Kpi n={state?.meetings.length ?? 0} l="Reuniones agendadas" />
        <Kpi n={count((c) => c.status === "skipped")} l="Omitidos" />
      </div>

      <div className="bar">
        <button className="primary" onClick={() => run()} disabled={busy}>
          ▶ Ejecutar pipeline
        </button>
        <button className={auto ? "on" : ""} onClick={() => setAuto((a) => !a)}>
          {auto ? "● Automático activo" : "Automático"}
        </button>
        <button onClick={() => fileRef.current?.click()}>Importar CSV</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importCsv(f);
            e.target.value = "";
          }}
        />
        <button onClick={reset}>Reiniciar demo</button>
        <span className="msg">{msg}</span>
      </div>

      <div className="grid">
        <section className="card">
          <div className="cardhead">
            <div className="tabs">
              <button className={tab === "contacts" ? "active" : ""} onClick={() => setTab("contacts")}>
                Contactos <span className="s">{contacts.length}</span>
              </button>
              <button className={tab === "sandbox" ? "active" : ""} onClick={() => setTab("sandbox")}>
                Datos sandbox <span className="s">{sandbox.length}</span>
              </button>
            </div>
            <button
              className="sm"
              onClick={() =>
                setEditing(
                  tab === "contacts"
                    ? { kind: "contact", row: { consent: true } }
                    : { kind: "sandbox", row: { mock_call_outcome: "accept" } },
                )
              }
            >
              + Nuevo
            </button>
          </div>

          {tab === "contacts" ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>LinkedIn</th>
                    <th>Celular</th>
                    <th>Estado</th>
                    <th>Reunión</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => {
                    const st = STATUS[c.status];
                    const m = meetingOf(c.id);
                    return (
                      <Fragment key={c.id}>
                        <tr>
                          <td>
                            <div>
                              <b>
                                {c.first_name} {c.last_name}
                              </b>
                            </div>
                            <div className="s">
                              {c.title} · {c.company}
                              {!c.consent && " · sin consentimiento"}
                            </div>
                          </td>
                          <td>
                            {c.linkedin_url ? (
                              <>
                                <a href={c.linkedin_url} target="_blank" rel="noreferrer">
                                  Ver perfil
                                </a>
                                <div className="s">
                                  {Math.round((c.linkedin_confidence ?? 0) * 100)}% · {c.linkedin_source}
                                </div>
                              </>
                            ) : (
                              <span className="s">—</span>
                            )}
                          </td>
                          <td className="mono">
                            {maskPhone(c.phone)}
                            {c.enrichment_source && <div className="s">{c.enrichment_source}</div>}
                          </td>
                          <td>
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                            {c.skip_reason && <div className="s">{c.skip_reason}</div>}
                          </td>
                          <td>
                            {m ? (
                              <>
                                <div>{fmtDate(m.starts_at)}</div>
                                <div className="s">
                                  {m.meet_url?.startsWith("http") ? (
                                    <a href={m.meet_url.split(" ")[0]} target="_blank" rel="noreferrer">
                                      Meet
                                    </a>
                                  ) : null}{" "}
                                  · {m.calendar_provider}
                                </div>
                              </>
                            ) : (
                              <span className="s">—</span>
                            )}
                          </td>
                          <td className="rowactions">
                            {RUNNABLE.includes(c.status) && (
                              <button className="sm" onClick={() => run(c.id)} disabled={busy} title="Procesar solo este contacto">
                                ▶
                              </button>
                            )}
                            {!RUNNABLE.includes(c.status) && c.status !== "calling" && (
                              <button className="sm" onClick={() => reprocess(c)} title="Volver a procesar desde cero">
                                ↺
                              </button>
                            )}
                            <button className="sm" onClick={() => setEditing({ kind: "contact", row: c })} disabled={c.status === "calling"}>
                              Editar
                            </button>
                            {(c.call_transcript || c.call_summary) && (
                              <button className="sm" onClick={() => setOpen(open === c.id ? null : c.id)}>
                                {open === c.id ? "Ocultar" : "Llamada"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {open === c.id && (
                          <tr className="detail">
                            <td colSpan={6}>
                              {c.call_summary && (
                                <div>
                                  <b>Resumen:</b> {c.call_summary}
                                </div>
                              )}
                              {c.qualification && Object.keys(c.qualification).length > 0 && (
                                <div style={{ marginTop: 6 }}>
                                  <b>Calificación:</b>{" "}
                                  {Object.entries(c.qualification)
                                    .map(([k, v]) => `${k.replace("_", " ")}: ${v}`)
                                    .join(" · ")}
                                </div>
                              )}
                              {c.recording_url && (
                                <div style={{ marginTop: 6 }}>
                                  <audio controls src={c.recording_url} />
                                </div>
                              )}
                              {c.call_transcript && <pre>{c.call_transcript}</pre>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {contacts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="s">
                        Sin contactos. Crea uno con “+ Nuevo” o importa un CSV.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <p className="s" style={{ padding: "10px 14px 0", margin: 0 }}>
                Simulan lo que LinkedIn y SignalHire saben de cada persona cuando esos pasos están en modo sandbox.
                Al editar un perfil, los contactos que lo usaron vuelven a pendiente.
              </p>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Perfil</th>
                      <th>LinkedIn</th>
                      <th>Celular</th>
                      <th>Correo</th>
                      <th>Llamada simulada</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sandbox.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <b>{p.full_name}</b>
                          <div className="s">{p.headline ?? p.company}</div>
                        </td>
                        <td>
                          <a href={p.linkedin_url} target="_blank" rel="noreferrer">
                            {p.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "in/")}
                          </a>
                        </td>
                        <td className="mono">{p.mobile_phone ? maskPhone(p.mobile_phone) : <span className="s">sin celular</span>}</td>
                        <td className="mono">{maskEmail(p.email)}</td>
                        <td>{OUTCOME_LABEL[p.mock_call_outcome]}</td>
                        <td className="rowactions">
                          <button className="sm" onClick={() => setEditing({ kind: "sandbox", row: p })}>
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <aside className="card">
          <h2>Bitácora en vivo</h2>
          <div className="log">
            {(state?.events ?? []).map((e) => (
              <div key={e.id} className={`ev ${e.level}`}>
                <span className="t">{fmtTime(e.created_at)}</span>
                <span className="step">{e.step}</span>
                {nameOf(e.contact_id) && <b>{nameOf(e.contact_id)}: </b>}
                {e.message}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {editing?.kind === "contact" && (
        <Editor
          title={editing.row.id ? "Editar contacto" : "Nuevo contacto"}
          fields={CONTACT_FORM}
          initial={editing.row}
          note={
            editing.row.id && editing.row.status !== "pending"
              ? "Si cambias nombre, apellidos, empresa, cargo o consentimiento, el contacto vuelve a procesarse desde LinkedIn."
              : undefined
          }
          extraAction={editing.row.id && editing.row.status !== "pending" ? { label: "Volver a procesar aunque no cambie nada del flujo", value: false } : undefined}
          onSave={async (data, reprocessFlag) => {
            const err = editing.row.id
              ? await send(`/api/contacts/${editing.row.id}`, "PATCH", { data, reprocess: reprocessFlag })
              : await send("/api/contacts", "POST", data);
            if (!err) setMsg("Contacto guardado");
            load();
            return err;
          }}
          onDelete={editing.row.id ? async () => {
            const err = await send(`/api/contacts/${editing.row.id}`, "DELETE");
            load();
            return err;
          } : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === "sandbox" && (
        <Editor
          title={editing.row.id ? "Editar perfil sandbox" : "Nuevo perfil sandbox"}
          fields={SANDBOX_FORM}
          initial={editing.row}
          note="Para que el bot encuentre a un contacto, el nombre y la empresa deben coincidir con los de la pestaña Contactos."
          onSave={async (data) => {
            const err = editing.row.id
              ? await send(`/api/sandbox/${editing.row.id}`, "PATCH", data)
              : await send("/api/sandbox", "POST", data);
            if (!err) setMsg("Perfil sandbox guardado");
            load();
            return err;
          }}
          onDelete={editing.row.id ? async () => {
            const err = await send(`/api/sandbox/${editing.row.id}`, "DELETE");
            load();
            return err;
          } : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Kpi({ n, l }: { n: number; l: string }) {
  return (
    <div className="kpi">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
