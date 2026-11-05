"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Stats } from "@/lib/stats";
import type { CallRow, Contact, ContactStatus, EmailKind, EmailRow, EventRow, Meeting, SalesRep, SandboxProfile } from "@/lib/types";
import { maskEmail, maskPhone } from "@/lib/util";
import { provenanceRows } from "@/lib/provenance";
import { Editor, type Field } from "./editor";
import { PageHeader } from "./ui";
import { downloadTemplate, exportContacts, xlsxToCsv } from "./xlsx";

interface State {
  contacts: Contact[];
  meetings: Meeting[];
  events: EventRow[];
  sandbox: SandboxProfile[];
  reps: SalesRep[];
  emails: EmailRow[];
  calls: CallRow[];
  stats: Stats;
  settings: { live_calls: boolean; live_numbers: string[] };
  providers: Record<string, string>;
}

export type Section = "contacts" | "agenda" | "reps" | "sandbox" | "activity";
type Editing =
  | { kind: "contact"; row: Partial<Contact> }
  | { kind: "sandbox"; row: Partial<SandboxProfile> }
  | { kind: "rep"; row: Partial<SalesRep> }
  | null;

const STATUS: Record<ContactStatus, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "b-neutral" },
  linkedin_found: { label: "Perfil ubicado", cls: "b-info" },
  needs_review: { label: "Por revisar", cls: "b-warn" },
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
  { name: "phone", label: "Teléfono (opcional)", type: "tel", placeholder: "+57 300 000 0000", hint: "Si lo pones, el bot llama a este número y no lo busca" },
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

export function Dashboard({ section }: { section: Section }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const tab = section;
  const [editing, setEditing] = useState<Editing>(null);
  const [reviewing, setReviewing] = useState<Contact | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function bulkDelete() {
    if (!selected.size || !confirm(`¿Eliminar ${selected.size} contacto(s)? Se cancelan sus reuniones y se borra su historial.`)) return;
    const res = await fetch("/api/contacts/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const json = await res.json();
    setMsg(res.ok ? `${json.deleted} contacto(s) eliminados${json.skipped ? ` · ${json.skipped} en llamada no se tocaron` : ""}` : `Error: ${json.error}`);
    setSelected(new Set());
    load();
  }

  async function hangup(c: Contact) {
    if (!confirm(`¿Liberar la llamada de ${c.first_name}? Si sigue activa se cortará.`)) return;
    const res = await fetch(`/api/contacts/${c.id}/hangup`, { method: "POST" });
    const json = await res.json();
    setMsg(res.ok ? `${c.first_name}: ${json.result}` : `Error: ${json.error}`);
    load();
  }

  async function authorizeNumber(phone: string, allow: boolean) {
    if (allow && !confirm(`¿Esta persona dio su consentimiento para recibir una llamada real al ${phone}?`)) return;
    const err = await send("/api/settings", "POST", allow ? { authorize: phone } : { revoke: phone });
    setMsg(err ?? (allow ? `${phone} autorizado para llamada real` : `${phone} vuelve a llamada simulada`));
    load();
  }
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


  async function runExport(kind: "base" | "plantilla") {
    try {
      if (kind === "plantilla") await downloadTemplate();
      else if (state) await exportContacts(state);
      setMsg(kind === "plantilla" ? "Plantilla descargada" : "Base descargada");
    } catch (e) {
      setMsg(`No se pudo descargar: ${(e as Error).message}`);
    }
  }

  async function importFile(file: File) {
    let csv: string;
    try {
      csv = /.xlsx$/i.test(file.name) ? await xlsxToCsv(file) : await file.text();
    } catch (e) {
      setMsg(`No se pudo leer el archivo: ${(e as Error).message}`);
      return;
    }
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
    <div className="page">
      {tab === "contacts" && (
        <PageHeader
          eyebrow="Prospección"
          title="Contactos"
          subtitle="LinkedIn → enriquecimiento → llamada de voz con IA → reunión agendada"
          actions={
            <>
              <details className="menu">
                <summary className="btn">Base de clientes ▾</summary>
                <div className="menu-list">
                  <button onClick={() => runExport("base")}>⬇ Descargar base (.xlsx)</button>
                  <button onClick={() => fileRef.current?.click()}>⬆ Importar (.xlsx o .csv)</button>
                  <button onClick={() => runExport("plantilla")}>Plantilla de importación</button>
                </div>
              </details>
              <button className={auto ? "on" : ""} onClick={() => setAuto((a) => !a)} title="Ejecuta el pipeline cada 8 segundos">
                {auto ? "● Automático" : "Automático"}
              </button>
              <button onClick={() => setEditing({ kind: "contact", row: { consent: true } })}>+ Nuevo contacto</button>
              <button className="primary" onClick={() => run()} disabled={busy}>
                ▶ Ejecutar pipeline
              </button>
            </>
          }
        />
      )}
      {tab === "agenda" && <PageHeader eyebrow="Prospección" title="Agenda" subtitle="Reuniones agendadas por el bot, con su comercial, Meet e invitaciones" />}
      {tab === "activity" && <PageHeader eyebrow="Prospección" title="Bitácora" subtitle="Cada paso del bot en tiempo real: búsquedas, llamadas, agenda y correos" />}
      {tab === "reps" && (
        <PageHeader
          eyebrow="Equipo"
          title="Comerciales"
          subtitle="Cada reunión se asigna al comercial activo del área con menos reuniones próximas"
          actions={
            <button className="primary" onClick={() => setEditing({ kind: "rep", row: { area: "infraestructura", active: true } })}>
              + Nuevo comercial
            </button>
          }
        />
      )}
      {tab === "sandbox" && (
        <PageHeader
          eyebrow="Configuración"
          title="Datos sandbox"
          subtitle="Lo que LinkedIn y SignalHire saben de cada persona cuando esos pasos están en modo de prueba"
          actions={
            <button className="primary" onClick={() => setEditing({ kind: "sandbox", row: { mock_call_outcome: "accept" } })}>
              + Nuevo perfil
            </button>
          }
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = "";
        }}
      />

      {error && <div className="err">{error}. Revisa las variables de entorno y que hayas corrido las migraciones en Supabase.</div>}
      {msg && <div className="toast" onClick={() => setMsg("")}>{msg}</div>}

      {tab === "contacts" && (
        <div className="kpis">
          <Kpi n={contacts.length} l="Contactos" />
          <Kpi n={count((c) => !!c.linkedin_url)} l="Con LinkedIn" />
          <Kpi n={count((c) => !!c.phone)} l="Con teléfono" />
          <Kpi n={count((c) => !!c.call_id)} l="Llamados" />
          <Kpi n={meetings.length} l="Reuniones" accent />
          <Kpi n={count((c) => c.status === "needs_review")} l="Por revisar" />
          <Kpi n={count((c) => c.status === "skipped")} l="Omitidos" />
        </div>
      )}

      <div className={tab === "contacts" ? "grid" : "single"}>
        {tab !== "activity" && <section className="card">
          <div className="cardhead">
            <div className="card-title">
              {{ contacts: "Base de contactos", agenda: "Próximas reuniones", reps: "Equipo comercial", sandbox: "Perfiles de prueba", activity: "" }[tab]}
              <span className="count">{{ contacts: contacts.length, agenda: meetings.length, reps: reps.length, sandbox: sandbox.length, activity: 0 }[tab]}</span>
            </div>
            {tab === "contacts" && selected.size > 0 && (
              <button className="sm danger" onClick={bulkDelete}>
                Eliminar seleccionados ({selected.size})
              </button>
            )}
          </div>

          {tab === "contacts" && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos"
                        checked={contacts.length > 0 && selected.size === contacts.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())}
                      />
                    </th>
                    <th>Persona</th>
                    <th>LinkedIn</th>
                    <th>Teléfono</th>
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
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar a ${c.first_name}`}
                              checked={selected.has(c.id)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td>
                            <div>
                              <b>
                                {c.first_name} {c.last_name}
                              </b>
                            </div>
                            <div className="s">
                              {c.title} · {c.company}
                              {!c.consent && " · sin consentimiento"}
                              {c.source?.startsWith("qr") && (
                                <span className="badge b-info" style={{ marginLeft: 6 }}>
                                  QR · {c.source.slice(3)}
                                  {c.contact_preference ? ` · prefiere ${c.contact_preference}` : ""}
                                </span>
                              )}
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
                            ) : c.linkedin_source === "signalhire" ? (
                              <>
                                <span className="badge b-info">SignalHire</span>
                                <div className="s">identidad {Math.round((c.linkedin_confidence ?? 0) * 100)}%</div>
                              </>
                            ) : (
                              <span className="s">—</span>
                            )}
                          </td>
                          <td className="mono">
                            {maskPhone(c.phone)}
                            {c.enrichment_source && <div className="s">{c.enrichment_source}</div>}
                            {c.phone && state?.settings?.live_numbers?.includes(c.phone) && <div className="s ok-text">✓ llamada real</div>}
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
                            {c.status === "needs_review" && (
                              <button className="sm primary" onClick={() => setReviewing(c)}>
                                Revisar
                              </button>
                            )}
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
                            {c.status === "calling" && Date.now() - Date.parse(c.updated_at) > 60_000 && (
                              <button className="sm" onClick={() => hangup(c)} title="La llamada ya terminó pero sigue marcada: ciérrala">
                                Liberar llamada
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
                            <td colSpan={7}>
                              <ProfileCard c={c} onChange={() => setReviewing(c)} />
                              <SignalHireCard
                                c={c}
                                onDone={(m) => {
                                  setMsg(m);
                                  load();
                                }}
                              />
                              <ProvenanceTable c={c} />
                              <PhoneChooser
                                c={c}
                                live={state?.settings?.live_numbers ?? []}
                                onDone={(m) => {
                                  setMsg(m);
                                  load();
                                }}
                              />
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
                                    {c.phone &&
                                      (state?.settings?.live_numbers?.includes(c.phone) ? (
                                        <button className="sm" onClick={() => authorizeNumber(c.phone!, false)}>
                                          Quitar llamada real
                                        </button>
                                      ) : (
                                        <button className="sm" onClick={() => authorizeNumber(c.phone!, true)}>
                                          Autorizar llamada real
                                        </button>
                                      ))}
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
                      <td colSpan={7} className="s">
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
        </section>}

        {(tab === "contacts" || tab === "activity") && <aside className={tab === "activity" ? "card" : "card side-log"}>
          <h2>{tab === "activity" ? "Eventos" : "Actividad en vivo"}</h2>
          <div className={tab === "activity" ? "log full" : "log"}>
            {(state?.events ?? []).map((e) => (
              <div key={e.id} className={`ev ${e.level}`}>
                <span className="t">{fmtTime(e.created_at)}</span>
                <span className="step">{e.step}</span>
                {nameOf(e.contact_id) && <b>{nameOf(e.contact_id)}: </b>}
                {e.message}
              </div>
            ))}
          </div>
        </aside>}
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

      {reviewing && (
        <ReviewDialog
          c={contacts.find((x) => x.id === reviewing.id) ?? reviewing}
          onDone={(m) => {
            setReviewing(null);
            setMsg(m);
            load();
          }}
          onClose={() => setReviewing(null)}
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

function Kpi({ n, l, accent }: { n: number; l: string; accent?: boolean }) {
  return (
    <div className={accent ? "kpi accent" : "kpi"}>
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function ProfileCard({ c, onChange }: { c: Contact; onChange: () => void }) {
  const p = c.profile;
  const co = p?.company;
  return (
    <div className="ficha">
      <div className="ficha-head">
        <h4>Ficha encontrada en la web</h4>
        <button className="sm" onClick={onChange} disabled={c.status === "calling"}>
          {c.linkedin_url ? "Cambiar perfil" : "Elegir perfil"}
        </button>
      </div>
      {!p ? (
        <p className="s">Aún no se ha buscado. Se completa en el paso de LinkedIn.</p>
      ) : (
        <div className="ficha-grid">
          <div>
            <div className="s">Persona</div>
            <b>{p.headline ?? "Sin titular público"}</b>
            {p.location && <div className="s">{p.location}</div>}
            {(p.phones ?? []).map((ph) => (
              <div key={ph.value} className="mono">
                ☎ {ph.value} <span className="s">· {ph.type} · {ph.source}</span>
              </div>
            ))}
            {p.email && (
              <div>
                ✉ {p.email.value}{" "}
                <span className={p.email.score >= 70 || p.email.status === "valid" ? "s ok-text" : "s warn-text"}>
                  · {p.email.source} {p.email.score}%{p.email.status ? ` · ${p.email.status}` : ""}
                </span>
              </div>
            )}
            {c.linkedin_url && (
              <div>
                <a href={c.linkedin_url} target="_blank" rel="noreferrer">
                  {c.linkedin_url.replace("https://www.linkedin.com", "")}
                </a>{" "}
                <span className="s">· {c.linkedin_source}</span>
              </div>
            )}
            {!c.linkedin_url && c.linkedin_source === "signalhire" && (
              <div className="s ok-text">Identidad confirmada con SignalHire: {p.signalhire?.best?.fullName}</div>
            )}
          </div>
          <div>
            <div className="s">Empresa</div>
            {co ? (
              <>
                <b>{co.name}</b>
                {co.type && <span className="s"> · {co.type}</span>}
                {co.category && <span className="s"> · {co.category}</span>}
                {co.description && <div className="s">{co.description.slice(0, 220)}</div>}
                {co.address && <div className="s">📍 {co.address}</div>}
                {(co.phones ?? []).map((ph) => (
                  <div key={ph.value} className="mono">
                    ☎ {ph.value} <span className="s">· {ph.type} · {ph.source}</span>
                  </div>
                ))}
                {(co.emails ?? []).length > 0 && <div className="s">✉ {co.emails!.join(", ")}</div>}
                <div>
                  {co.website && (
                    <a href={co.website} target="_blank" rel="noreferrer">
                      {co.domain ?? co.website}
                    </a>
                  )}
                  {co.linkedin && (
                    <>
                      {co.website ? " · " : ""}
                      <a href={co.linkedin} target="_blank" rel="noreferrer">
                        LinkedIn de la empresa
                      </a>
                    </>
                  )}
                </div>
              </>
            ) : (
              <span className="s">No se encontró información confiable de la empresa.</span>
            )}
          </div>
          {p.sources.length > 0 && (
            <div className="wide s">
              Fuentes:{" "}
              {p.sources.slice(0, 3).map((x, i) => (
                <span key={x.url}>
                  {i > 0 && " · "}
                  <a href={x.url} target="_blank" rel="noreferrer">
                    {x.title.slice(0, 50)}
                  </a>
                </span>
              ))}
              <span> · {p.queries} búsquedas</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewDialog({ c, onDone, onClose }: { c: Contact; onDone: (msg: string) => void; onClose: () => void }) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cands = c.linkedin_candidates ?? [];

  async function choose(url: string | null) {
    setBusy(true);
    const err = await send(`/api/contacts/${c.id}/linkedin`, "POST", { url });
    setBusy(false);
    if (err) setError(err);
    else onDone(url ? `Perfil confirmado para ${c.first_name}: ya puede continuar con ▶` : `${c.first_name} queda omitido`);
  }

  async function chooseSignalHire(uid: string) {
    setBusy(true);
    const err = await send(`/api/contacts/${c.id}/linkedin`, "POST", { signalhireUid: uid });
    setBusy(false);
    if (err) setError(err);
    else onDone(`Identidad de ${c.first_name} confirmada con SignalHire (sin gastar créditos)`);
  }

  const sh = c.profile?.signalhire;
  const shOptions = [sh?.best, ...(sh?.others ?? [])].filter((x): x is NonNullable<typeof x> => !!x && (x.score ?? 0) >= 0.5);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(720px, 100%)" }}>
        <h3>
          ¿Cuál es el perfil de {c.first_name} {c.last_name}?
        </h3>
        <p className="s">
          {c.title} · {c.company}. La búsqueda encontró estos perfiles públicos; confirma el correcto o descártalos.
        </p>
        {shOptions.length > 0 && (
          <>
            <div className="s" style={{ fontWeight: 600, marginTop: 8 }}>Encontrado en SignalHire (perfil actualizado · elegirlo no gasta créditos)</div>
            <div className="cands">
              {shOptions.map((p) => {
                const job = p.experience?.[0];
                const chosen = c.linkedin_source === "signalhire" && sh?.best?.uid === p.uid;
                return (
                  <div key={p.uid} className={`cand sh-cand ${chosen ? "on" : ""}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{p.fullName}</b>{" "}
                      <span className={`badge ${(p.score ?? 0) >= 0.8 ? "b-ok" : "b-warn"}`}>{Math.round((p.score ?? 0) * 100)}%</span>{" "}
                      <span className="badge b-info">SignalHire</span>
                      {job && (
                        <div>
                          {job.title || "Cargo no indicado"} @ {job.company}
                        </div>
                      )}
                      <div className="s">
                        {p.location ?? "Ubicación no indicada"}
                        {p.experience?.length > 1 && ` · antes: ${p.experience.slice(1, 3).map((e) => e.company).join(", ")}`}
                      </div>
                    </div>
                    <button className="sm primary" disabled={busy} onClick={() => chooseSignalHire(p.uid)}>
                      Es esta persona · sin créditos
                    </button>
                  </div>
                );
              })}
            </div>
            {cands.length > 0 && <div className="s" style={{ fontWeight: 600, marginTop: 8 }}>Candidatos de LinkedIn (búsqueda pública)</div>}
          </>
        )}
        {cands.length === 0 && shOptions.length === 0 && <p className="s">No hay candidatos guardados. Puedes pegar la URL del perfil.</p>}
        <div className="cands">
          {cands.map((k) => (
            <div key={k.url} className={`cand ${c.linkedin_url === k.url ? "on" : ""}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{k.name}</b>{" "}
                <span className={`badge ${k.confidence >= 0.65 ? "b-ok" : k.confidence >= 0.35 ? "b-warn" : "b-neutral"}`}>
                  {Math.round(k.confidence * 100)}%
                </span>
                {k.origin === "sandbox" && <span className="s"> · sandbox</span>}
                {k.headline && <div>{k.headline}</div>}
                {k.fromPost && (
                  <div className="s warn-text">
                    Detectado desde una{" "}
                    <a href={k.sources[0]?.url} target="_blank" rel="noreferrer">
                      publicación
                    </a>
                    : la URL del perfil puede no ser exacta. Si al abrirla no existe, pega la URL real abajo.
                  </div>
                )}
                <div className="s">{k.snippet.slice(0, 200)}</div>
                <div className="s">
                  {k.reason} ·{" "}
                  <a href={k.url} target="_blank" rel="noreferrer">
                    abrir en LinkedIn
                  </a>
                </div>
              </div>
              <button className="sm" disabled={busy} onClick={() => choose(k.url)}>
                Es esta persona
              </button>
            </div>
          ))}
        </div>
        <div className="form" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
          <label>
            <span>O pega la URL del perfil</span>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://www.linkedin.com/in/…" />
          </label>
          <button className="sm" disabled={busy || !manual.trim()} onClick={() => choose(manual)}>
            Usar esta URL
          </button>
        </div>
        {error && (
          <div className="err" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </div>
        )}
        <div className="actions">
          <button className="danger" disabled={busy} onClick={() => choose(null)}>
            Ninguno corresponde
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function PhoneChooser({ c, live, onDone }: { c: Contact; live: string[]; onDone: (msg: string) => void }) {
  const options: { value: string; label: string }[] = [];
  const add = (value: string | null | undefined, label: string) => {
    if (value && !options.some((o) => o.value === value)) options.push({ value, label });
  };
  add(c.phone, `actual · ${c.enrichment_source ?? "sin origen"}`);
  (c.profile?.phones ?? []).forEach((p) => add(p.value, `persona · ${p.type} · ${p.source}`));
  (c.profile?.company?.phones ?? []).forEach((p) => add(p.value, `empresa · ${p.type} · ${p.source}`));

  const [choice, setChoice] = useState<string>(c.phone ?? (options[0]?.value ?? "otro"));
  const [other, setOther] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = choice === "otro" ? other : choice;
  const pickedLabel = choice === "otro" ? null : options.find((o) => o.value === choice)?.label.replace(/^actual · /, "") ?? null;
  const unchanged = choice !== "otro" && choice === c.phone && (!consent || live.includes(choice));

  async function save() {
    setBusy(true);
    setError(null);
    const err = await send(`/api/contacts/${c.id}/phone`, "POST", { phone: picked, source: pickedLabel, authorize: consent });
    setBusy(false);
    if (err) setError(err);
    else onDone(`Teléfono para llamar a ${c.first_name} actualizado${consent ? " y autorizado para llamada real" : ""}. Usa ▶ para llamar.`);
  }

  return (
    <div className="ficha">
      <div className="ficha-head">
        <h4>Teléfono para llamar</h4>
      </div>
      <div className="phone-options">
        {options.map((o) => (
          <label key={o.value} className="check">
            <input type="radio" name={`ph-${c.id}`} checked={choice === o.value} onChange={() => setChoice(o.value)} />
            <span className="mono">{o.value}</span>
            <span className="s">{o.label}</span>
            {live.includes(o.value) && <span className="s ok-text">✓ llamada real</span>}
          </label>
        ))}
        <label className="check">
          <input type="radio" name={`ph-${c.id}`} checked={choice === "otro"} onChange={() => setChoice("otro")} />
          <span>Otro número:</span>
          <input className="inline-input" value={other} placeholder="+57 300 000 0000" onFocus={() => setChoice("otro")} onChange={(e) => setOther(e.target.value)} />
        </label>
      </div>
      <label className="check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        La persona dio su consentimiento: autorizar llamada real a este número
      </label>
      {error && <div className="err" style={{ marginTop: 8, marginBottom: 0 }}>{error}</div>}
      <div className="btnrow">
        <button className="sm primary" disabled={busy || !picked?.trim() || unchanged || c.status === "calling"} onClick={save}>
          Usar este número
        </button>
      </div>
    </div>
  );
}

function ProvenanceTable({ c }: { c: Contact }) {
  const rows = provenanceRows(c);
  const fmt = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
  return (
    <details className="ficha prov">
      <summary>
        <b>Origen de los datos</b> <span className="s">· {rows.length} campos · de dónde salió cada dato y cuándo</span>
      </summary>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Campo</th>
              <th>Valor</th>
              <th>Fuente</th>
              <th>Detalle</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="s">{r.field}</td>
                <td>{r.value.length > 60 ? `${r.value.slice(0, 60)}…` : r.value}</td>
                <td>{r.source}</td>
                <td className="s">
                  {r.detail}
                  {r.url && (
                    <>
                      {r.detail ? " · " : ""}
                      <a href={r.url} target="_blank" rel="noreferrer">
                        ver fuente
                      </a>
                    </>
                  )}
                </td>
                <td className="s" style={{ whiteSpace: "nowrap" }}>
                  {fmt(r.at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SignalHireCard({ c, onDone }: { c: Contact; onDone: (msg: string) => void }) {
  const sh = c.profile?.signalhire;
  const [credits, setCredits] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/signalhire/credits")
      .then((r) => r.json())
      .then((j) => {
        setEnabled(j.enabled);
        setCredits(j.credits);
      })
      .catch(() => undefined);
  }, [sh?.reveal?.status]);

  if (!enabled) return null;

  async function act(action: "search" | "reveal", uid?: string) {
    if (action === "reveal" && !confirm(`Revelar el celular y el correo gasta 1 crédito de SignalHire (te quedan ${credits ?? "?"}). ¿Continuar?`)) return;
    setBusy(true);
    setError(null);
    const err = await send(`/api/contacts/${c.id}/signalhire`, "POST", action === "reveal" ? { action, confirm: true, uid } : { action });
    setBusy(false);
    if (err) setError(err);
    else onDone(action === "reveal" ? "Revelado solicitado: SignalHire responde en unos segundos" : "Búsqueda gratuita en SignalHire actualizada");
  }

  const b = sh?.best;
  const reveal = sh?.reveal;
  return (
    <div className="ficha sh-card">
      <div className="ficha-head">
        <h4>SignalHire</h4>
        <span className="sh-credits" title="Créditos estándar: solo los gasta 'Revelar'">
          {credits === null ? "créditos: —" : `${credits} crédito${credits === 1 ? "" : "s"}`}
        </span>
      </div>
      {!sh ? (
        <p className="s">Aún no se ha buscado en SignalHire. La búsqueda es gratuita (no gasta créditos).</p>
      ) : sh.error ? (
        <p className="s warn-text">No disponible: {sh.error}</p>
      ) : !b ? (
        <p className="s">{sh.total} resultado(s) en SignalHire, ninguno coincide con seguridad.</p>
      ) : (
        <div className="sh-body">
          <div className="sh-who">
            <b>{b.fullName}</b>
            <span className={`badge ${(b.score ?? 0) >= 0.8 ? "b-ok" : "b-warn"}`}>{Math.round((b.score ?? 0) * 100)}% coincidencia</span>
            {b.openToWork && <span className="badge b-info">Busca empleo</span>}
            {b.location && <div className="s">📍 {b.location}</div>}
          </div>
          {b.experience?.length > 0 && (
            <ul className="sh-jobs">
              {b.experience.slice(0, 5).map((e, i) => (
                <li key={i}>
                  <span className={i === 0 ? "sh-dot now" : "sh-dot"} />
                  <div>
                    <b>{e.title || "Cargo no indicado"}</b>
                    <div className="s">{e.company}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {b.skills?.length > 0 && (
            <div className="sh-skills">
              {b.skills.slice(0, 14).map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}
          {b.contactsFetched && <p className="s">Sus contactos ya se habían revelado en SignalHire ({b.contactsFetched}).</p>}
        </div>
      )}

      {sh && sh.others.length > 0 && (
        <details className="sh-others">
          <summary>Otros {sh.others.length} resultado(s)</summary>
          <ul className="list">
            {sh.others.map((o) => (
              <li key={o.uid}>
                <b>{o.fullName}</b>
                <span className="s">
                  {" "}
                  · {o.experience?.[0] ? `${o.experience[0].title} @ ${o.experience[0].company}` : "sin historial"} · {o.location ?? ""} · {Math.round((o.score ?? 0) * 100)}%
                </span>{" "}
                {!reveal && (
                  <button className="sm" disabled={busy || credits === 0} onClick={() => act("reveal", o.uid)}>
                    Revelar este · 1 crédito
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {reveal && (
        <div className={`sh-reveal ${reveal.status}`}>
          {reveal.status === "pendiente" && <span className="pulse">Esperando respuesta de SignalHire…</span>}
          {reveal.status === "sin datos" && <span>SignalHire no tenía contactos para esta persona (el crédito solo se descuenta si hay resultado).</span>}
          {reveal.status === "listo" && (
            <>
              <b>Contactos revelados</b>
              {(reveal.phones ?? []).map((p) => (
                <div key={p.value} className="mono">
                  ☎ {p.value} <span className="s">{p.subType ?? ""}</span>
                </div>
              ))}
              {(reveal.emails ?? []).map((e) => (
                <div key={e.value}>
                  ✉ {e.value} <span className="s">{e.subType ?? ""}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {error && <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
      <div className="btnrow">
        <button className="sm" disabled={busy} onClick={() => act("search")}>
          {sh ? "Buscar de nuevo (gratis)" : "Buscar gratis"}
        </button>
        {!reveal && (
          <button className="sm primary" disabled={busy || credits === 0 || (!b && !c.linkedin_url)} onClick={() => act("reveal")}>
            Revelar celular y correo · 1 crédito
          </button>
        )}
      </div>
    </div>
  );
}
