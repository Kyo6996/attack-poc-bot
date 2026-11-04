"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Stats } from "@/lib/stats";
import type { CallRow, Contact, ContactStatus, EmailKind, EmailRow, EventRow, Meeting, SalesRep, SandboxProfile } from "@/lib/types";
import { maskEmail, maskPhone } from "@/lib/util";
import { Editor, type Field } from "./editor";
import { StatsPanel } from "./stats";

interface State {
  contacts: Contact[];
  meetings: Meeting[];
  events: EventRow[];
  sandbox: SandboxProfile[];
  reps: SalesRep[];
  emails: EmailRow[];
  calls: CallRow[];
  stats: Stats;
  providers: Record<string, string>;
}

type Tab = "contacts" | "agenda" | "reps" | "sandbox";
type Editing =
  | { kind: "contact"; row: Partial<Contact> }
  | { kind: "sandbox"; row: Partial<SandboxProfile> }
  | { kind: "rep"; row: Partial<SalesRep> }
  | null;

const STATUS: Record<ContactStatus, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "b-neutral" },
  linkedin_found: { label: "Perfil ubicado", cls: "b-info" },
  enriching: { label: "Enriqueciendo…", cls: "b-info pulse" },
  phone_found: { label: "Celular encontrado", cls: "b-info" },
  calling: { label: "En llamada…", cls: "b-info pulse" },
  meeting_scheduled: { label: "✓ Reunión agendada", cls: "b-ok" },
  declined: { label: "No agendó", cls: "b-warn" },
  no_answer: { label: "Llamada perdida", cls: "b-warn" },
  call_failed: { label: "Llamada fallida", cls: "b-err" },
  skipped: { label: "Omitido", cls: "b-neutral" },
};

const CALL_STATUS: Record<CallRow["status"], string> = {
  in_progress: "En curso",
  answered: "Contestada",
  missed: "Perdida",
  failed: "Fallida",
};

const EMAIL_KIND: Record<EmailKind, string> = {
  confirmacion: "Confirmación de reunión",
  seguimiento: "Seguimiento post-ANDICOM",
  brief_comercial: "Brief al comercial",
};

const OUTCOME_LABEL: Record<string, string> = { accept: "Acepta", decline: "No acepta", no_answer: "No contesta" };
const AREAS = ["infraestructura", "dispositivos", "servicios", "IA", "general"];

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

const REP_FORM: Field[] = [
  { name: "name", label: "Nombre", required: true },
  { name: "title", label: "Cargo", placeholder: "Especialista en Infraestructura" },
  { name: "email", label: "Correo", type: "email", hint: "Recibe la invitación y el brief del lead" },
  { name: "phone", label: "Teléfono", type: "tel" },
  { name: "area", label: "Área que atiende", type: "select", options: AREAS.map((a) => ({ value: a, label: a })) },
  { name: "active", label: "Activo (recibe nuevas reuniones)", type: "checkbox", wide: true },
];

const PROVIDER_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  enrichment: "Enriquecimiento",
  voice: "Voz",
  calendar: "Calendario",
  email: "Correo",
};
const SANDBOX = ["sandbox", "simulated"];
const RUNNABLE: ContactStatus[] = ["pending", "linkedin_found", "phone_found"];

const tz = { timeZone: "America/Bogota" } as const;
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { ...tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { ...tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const fmtHour = (iso: string) => new Intl.DateTimeFormat("es-CO", { ...tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { ...tz, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
const fmtShort = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { ...tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const meetLink = (m: Meeting) => (m.meet_url?.startsWith("http") ? m.meet_url.split(" ")[0] : null);

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
  const [tab, setTab] = useState<Tab>("contacts");
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
    if (!confirm("¿Reiniciar la demo? Se borran reuniones, correos, llamadas y bitácora, y todos los contactos vuelven a 'Pendiente'.")) return;
    await fetch("/api/demo/reset", { method: "POST" });
    setMsg("Demo reiniciada");
    load();
  }

  async function reprocess(c: Contact) {
    const err = await send(`/api/contacts/${c.id}`, "PATCH", { reprocess: true });
    setMsg(err ?? `${c.first_name} vuelve a pendiente`);
    load();
  }

  async function sendMail(contactId: string, kind: EmailKind) {
    setMsg("Enviando correo…");
    const err = await send("/api/emails/send", "POST", { contactId, kind });
    setMsg(err ? `No se pudo enviar: ${err}` : `${EMAIL_KIND[kind]} enviado`);
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
  const reps = state?.reps ?? [];
  const meetings = state?.meetings ?? [];
  const emails = state?.emails ?? [];
  const calls = state?.calls ?? [];
  const meetingOf = (id: string) => meetings.find((m) => m.contact_id === id);
  const repOf = (id: string | null) => reps.find((r) => r.id === id);
  const contactOf = (id: string) => contacts.find((c) => c.id === id);
  const lastEmail = (contactId: string, kind: EmailKind) => emails.find((e) => e.contact_id === contactId && e.kind === kind);
  const nameOf = (id: string | null) => {
    const c = contacts.find((x) => x.id === id);
    return c ? `${c.first_name} ${c.last_name}` : null;
  };
  const count = (pred: (c: Contact) => boolean) => contacts.filter(pred).length;

  const emailChip = (contactId: string, kind: EmailKind) => {
    const e = lastEmail(contactId, kind);
    if (!e) return <span className="chip-mail none">✉ sin enviar</span>;
    return e.status === "sent" ? (
      <span className="chip-mail ok" title={`${e.to_email} · ${fmtShort(e.created_at)}`}>
        ✓ correo enviado{e.provider === "sandbox" ? " (sandbox)" : ""}
      </span>
    ) : (
      <span className="chip-mail fail" title={e.error ?? ""}>
        ✗ correo falló
      </span>
    );
  };

  const upcoming = [...meetings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const byDay = new Map<string, Meeting[]>();
  for (const m of upcoming) {
    const k = fmtDay(m.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }

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
          {error}. Revisa las variables de entorno y que hayas corrido las migraciones en Supabase.
        </div>
      )}

      {state?.stats && <StatsPanel stats={state.stats} />}

      <div className="kpis">
        <Kpi n={contacts.length} l="Contactos" />
        <Kpi n={count((c) => !!c.linkedin_url)} l="Perfil de LinkedIn ubicado" />
        <Kpi n={count((c) => !!c.phone)} l="Con celular" />
        <Kpi n={count((c) => !!c.call_id)} l="Llamados" />
        <Kpi n={meetings.length} l="Reuniones agendadas" />
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
              {(
                [
                  ["contacts", "Contactos", contacts.length],
                  ["agenda", "Agenda", meetings.length],
                  ["reps", "Comerciales", reps.length],
                  ["sandbox", "Datos sandbox", sandbox.length],
                ] as [Tab, string, number][]
              ).map(([k, label, n]) => (
                <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {label} <span className="s">{n}</span>
                </button>
              ))}
            </div>
            {tab !== "agenda" && (
              <button
                className="sm"
                onClick={() =>
                  setEditing(
                    tab === "contacts"
                      ? { kind: "contact", row: { consent: true } }
                      : tab === "reps"
                        ? { kind: "rep", row: { area: "infraestructura", active: true } }
                        : { kind: "sandbox", row: { mock_call_outcome: "accept" } },
                  )
                }
              >
                + Nuevo
              </button>
            )}
          </div>

          {tab === "contacts" && (
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
                    const rep = m ? repOf(m.sales_rep_id) : undefined;
                    const cCalls = calls.filter((x) => x.contact_id === c.id);
                    const cEmails = emails.filter((x) => x.contact_id === c.id);
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
                            {cCalls.length > 1 && <div className="s">{cCalls.length} intentos</div>}
                          </td>
                          <td>
                            {m ? (
                              <>
                                <div>{fmtDate(m.starts_at)}</div>
                                {rep && <div className="s">con {rep.name}</div>}
                                <div style={{ marginTop: 3 }}>{emailChip(c.id, "confirmacion")}</div>
                              </>
                            ) : c.call_outcome === "enviar_info_correo" ? (
                              <div>{emailChip(c.id, "seguimiento")}</div>
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
                            <button className="sm" onClick={() => setOpen(open === c.id ? null : c.id)}>
                              {open === c.id ? "Cerrar" : "Detalle"}
                            </button>
                          </td>
                        </tr>
                        {open === c.id && (
                          <tr className="detail">
                            <td colSpan={6}>
                              <div className="detail-grid">
                                <div>
                                  <h4>Reunión y agenda</h4>
                                  {m ? (
                                    <MeetingCard
                                      m={m}
                                      rep={rep}
                                      chip={emailChip(c.id, "confirmacion")}
                                      onResend={() => sendMail(c.id, "confirmacion")}
                                    />
                                  ) : (
                                    <p className="s">Sin reunión agendada.</p>
                                  )}
                                  <h4>Correos</h4>
                                  {cEmails.length ? (
                                    <ul className="list">
                                      {cEmails.map((e) => (
                                        <li key={e.id}>
                                          <span className={e.status === "sent" ? "dot ok" : "dot fail"} aria-hidden />
                                          <b>{EMAIL_KIND[e.kind]}</b> → {e.to_email}
                                          <span className="s"> · {fmtShort(e.created_at)}{e.provider === "sandbox" ? " · sandbox" : ""}</span>
                                          {e.status === "failed" && <div className="s err-text">{e.error}</div>}{" "}
                                          <a href={`/api/emails/${e.id}`} target="_blank" rel="noreferrer">
                                            Ver correo
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="s">Aún no se ha enviado ningún correo.</p>
                                  )}
                                  <div className="btnrow">
                                    {m && (
                                      <button className="sm" onClick={() => sendMail(c.id, "confirmacion")}>
                                        {lastEmail(c.id, "confirmacion") ? "Reenviar confirmación" : "Enviar confirmación"}
                                      </button>
                                    )}
                                    <button className="sm" onClick={() => sendMail(c.id, "seguimiento")} disabled={!c.email}>
                                      {lastEmail(c.id, "seguimiento") ? "Reenviar seguimiento" : "Enviar correo de seguimiento"}
                                    </button>
                                  </div>
                                </div>
                                <div>
                                  <h4>Llamadas</h4>
                                  {cCalls.length ? (
                                    <ul className="list">
                                      {cCalls.map((x) => (
                                        <li key={x.id}>
                                          <span className={`dot ${x.status === "answered" ? "ok" : x.status === "in_progress" ? "info" : "fail"}`} aria-hidden />
                                          <b>{CALL_STATUS[x.status]}</b>
                                          <span className="s">
                                            {" "}
                                            · {fmtShort(x.started_at)}
                                            {x.duration_sec ? ` · ${Math.floor(x.duration_sec / 60)}:${String(x.duration_sec % 60).padStart(2, "0")} min` : ""}
                                            {x.ended_reason ? ` · ${x.ended_reason}` : ""} · {x.provider}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="s">Sin intentos de llamada.</p>
                                  )}
                                  {c.call_summary && (
                                    <p>
                                      <b>Resumen:</b> {c.call_summary}
                                    </p>
                                  )}
                                  {c.qualification && Object.keys(c.qualification).length > 0 && (
                                    <p>
                                      <b>Calificación:</b>{" "}
                                      {Object.entries(c.qualification)
                                        .map(([k, v]) => `${k.replace("_", " ")}: ${v}`)
                                        .join(" · ")}
                                    </p>
                                  )}
                                  {c.recording_url && <audio controls src={c.recording_url} />}
                                </div>
                              </div>
                              {c.call_transcript && (
                                <details>
                                  <summary>Transcripción</summary>
                                  <pre>{c.call_transcript}</pre>
                                </details>
                              )}
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
          )}

          {tab === "agenda" && (
            <div className="agenda">
              {byDay.size === 0 && <p className="s">Todavía no hay reuniones agendadas.</p>}
              {[...byDay.entries()].map(([day, ms]) => (
                <div key={day} className="agenda-day">
                  <h3>{cap(day)}</h3>
                  {ms.map((m) => {
                    const c = contactOf(m.contact_id);
                    const rep = repOf(m.sales_rep_id);
                    return (
                      <div key={m.id} className="agenda-item">
                        <div className="agenda-time">
                          {fmtHour(m.starts_at)}
                          <span className="s">{fmtHour(m.ends_at)}</span>
                        </div>
                        <div className="agenda-main">
                          <b>{c ? `${c.first_name} ${c.last_name}` : "Contacto eliminado"}</b>
                          <span className="s"> · {c?.company}</span>
                          <div className="s">
                            {rep ? `Atiende ${rep.name}${rep.title ? ` (${rep.title})` : ""}` : "Sin comercial asignado"}
                            {c?.qualification?.area_interes ? ` · ${c.qualification.area_interes}` : ""}
                          </div>
                          <div className="btnrow">
                            {meetLink(m) && (
                              <a className="btn sm" href={meetLink(m)!} target="_blank" rel="noreferrer">
                                Google Meet
                              </a>
                            )}
                            {m.calendar_link && (
                              <a className="btn sm" href={m.calendar_link} target="_blank" rel="noreferrer">
                                Ver en Google Calendar
                              </a>
                            )}
                            <span className={`chip-mail ${m.calendar_provider === "google" ? "ok" : "none"}`}>
                              {m.calendar_provider === "google" ? "✓ invitación de calendario enviada" : "invitación (sandbox)"}
                            </span>
                            {c && emailChip(c.id, "confirmacion")}
                            {c && (
                              <button className="sm" onClick={() => sendMail(c.id, "confirmacion")}>
                                Reenviar correo
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {tab === "reps" && (
            <div className="tablewrap">
              <p className="s" style={{ padding: "10px 14px 0", margin: 0 }}>
                Cada reunión se asigna al comercial activo del área de interés con menos reuniones próximas. Si tiene correo, recibe la
                invitación y un brief del lead para darle atención previa.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Comercial</th>
                    <th>Área</th>
                    <th>Correo</th>
                    <th>Próximas reuniones</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.name}</b>
                        <div className="s">
                          {r.title}
                          {!r.active && " · inactivo"}
                        </div>
                      </td>
                      <td>{r.area}</td>
                      <td className="mono">{r.email ? maskEmail(r.email) : <span className="s">sin correo</span>}</td>
                      <td>{meetings.filter((m) => m.sales_rep_id === r.id && m.starts_at >= new Date().toISOString()).length}</td>
                      <td className="rowactions">
                        <button className="sm" onClick={() => setEditing({ kind: "rep", row: r })}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "sandbox" && (
            <>
              <p className="s" style={{ padding: "10px 14px 0", margin: 0 }}>
                Simulan lo que LinkedIn y SignalHire saben de cada persona cuando esos pasos están en modo sandbox. Al editar un perfil, los
                contactos que lo usaron vuelven a pendiente.
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
          onDelete={
            editing.row.id
              ? async () => {
                  const err = await send(`/api/contacts/${editing.row.id}`, "DELETE");
                  load();
                  return err;
                }
              : undefined
          }
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
            const err = editing.row.id ? await send(`/api/sandbox/${editing.row.id}`, "PATCH", data) : await send("/api/sandbox", "POST", data);
            if (!err) setMsg("Perfil sandbox guardado");
            load();
            return err;
          }}
          onDelete={
            editing.row.id
              ? async () => {
                  const err = await send(`/api/sandbox/${editing.row.id}`, "DELETE");
                  load();
                  return err;
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === "rep" && (
        <Editor
          title={editing.row.id ? "Editar comercial" : "Nuevo comercial"}
          fields={REP_FORM}
          initial={editing.row}
          onSave={async (data) => {
            const err = editing.row.id ? await send(`/api/reps/${editing.row.id}`, "PATCH", data) : await send("/api/reps", "POST", data);
            if (!err) setMsg("Comercial guardado");
            load();
            return err;
          }}
          onDelete={
            editing.row.id
              ? async () => {
                  const err = await send(`/api/reps/${editing.row.id}`, "DELETE");
                  load();
                  return err;
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MeetingCard({ m, rep, chip, onResend }: { m: Meeting; rep?: SalesRep; chip: React.ReactNode; onResend: () => void }) {
  const link = meetLink(m);
  return (
    <div className="meeting">
      <div>
        <b>{cap(fmtDay(m.starts_at))}</b> · {fmtHour(m.starts_at)} – {fmtHour(m.ends_at)}
      </div>
      <div className="s">
        Invitado: {m.attendee_email} · {rep ? `atiende ${rep.name}` : "sin comercial"}
      </div>
      <div className="btnrow">
        {link && (
          <a className="btn sm" href={link} target="_blank" rel="noreferrer">
            Google Meet
          </a>
        )}
        {m.calendar_link && (
          <a className="btn sm" href={m.calendar_link} target="_blank" rel="noreferrer">
            Google Calendar
          </a>
        )}
        {chip}
        <button className="sm" onClick={onResend}>
          Reenviar
        </button>
      </div>
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
