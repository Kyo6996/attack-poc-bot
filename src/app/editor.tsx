"use client";

import { useState } from "react";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "url" | "textarea" | "checkbox" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  wide?: boolean;
}

interface Props {
  title: string;
  fields: Field[];
  initial: Record<string, unknown>;
  note?: string;
  extraAction?: { label: string; value: boolean };
  onSave: (data: Record<string, unknown>, extra: boolean) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onClose: () => void;
}

export function Editor({ title, fields, initial, note, extraAction, onSave, onDelete, onClose }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? (f.type === "checkbox" ? false : "")])),
  );
  const [extra, setExtra] = useState(extraAction?.value ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const err = await onSave(values, extra);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  async function remove() {
    if (!onDelete || !confirm("¿Eliminar este registro?")) return;
    setSaving(true);
    const err = await onDelete();
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h3>{title}</h3>
        {note && <p className="s">{note}</p>}
        <div className="form">
          {fields.map((f) => (
            <label key={f.name} className={f.wide || f.type === "textarea" ? "wide" : ""}>
              {f.type === "checkbox" ? (
                <span className="check">
                  <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
                  {f.label}
                </span>
              ) : (
                <>
                  <span>
                    {f.label}
                    {f.required && " *"}
                  </span>
                  {f.type === "textarea" ? (
                    <textarea rows={2} value={String(values[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                  ) : f.type === "select" ? (
                    <select value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type ?? "text"}
                      value={String(values[f.name] ?? "")}
                      placeholder={f.placeholder}
                      required={f.required}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                </>
              )}
              {f.hint && <small className="s">{f.hint}</small>}
            </label>
          ))}
        </div>
        {extraAction && (
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
            {extraAction.label}
          </label>
        )}
        {error && <div className="err" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
        <div className="actions">
          {onDelete && (
            <button type="button" className="danger" onClick={remove} disabled={saving}>
              Eliminar
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
