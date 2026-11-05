"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/app/ui";
import { ReportTabs } from "../tabs";

interface Send {
  message: string;
  level: "success" | "error";
  created_at: string;
  data: { via?: string; trigger?: string; recipients?: number; analysis?: string; frequency?: string } | null;
}
interface History {
  month: string;
  sends: Send[];
  next: string[];
  schedule: { frequency: string; hour: number };
}

const TZ = "America/Bogota";
const WEEK = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const localTime = (iso: string) => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(new Date(iso));
const shift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function CalendarioPage() {
  const [month, setMonth] = useState(() => localDay(new Date().toISOString()).slice(0, 7));
  const [h, setH] = useState<History | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    setH(null);
    fetch(`/api/report/history?month=${month}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setH);
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of h?.sends ?? []) {
      const k = localDay(s.created_at);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [h]);

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const today = localDay(new Date().toISOString());
  const title = first.toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
  const ok = (h?.sends ?? []).filter((s) => s.level === "success");
  const sentDays = new Set(ok.map((s) => localDay(s.created_at))).size;
  const selected = day ? (byDay.get(day) ?? []) : [];

  return (
    <div className="page">
      <PageHeader eyebrow="Análisis" title="Reporte diario" subtitle="Días en que se envió el reporte y próximos envíos programados" />
      <ReportTabs />

      <div className="cal-layout">
        <section className="card pad">
          <div className="cal-head">
            <button className="sm" onClick={() => setMonth(shift(month, -1))} aria-label="Mes anterior">
              ‹
            </button>
            <h2 className="h" style={{ margin: 0, textTransform: "capitalize" }}>
              {title}
            </h2>
            <button className="sm" onClick={() => setMonth(shift(month, 1))} aria-label="Mes siguiente">
              ›
            </button>
          </div>
          <div className="cal-grid">
            {WEEK.map((w) => (
              <div key={w} className="cal-dow">
                {w}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`e${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = `${month}-${String(i + 1).padStart(2, "0")}`;
              const list = byDay.get(d) ?? [];
              const sent = list.filter((s) => s.level === "success").length;
              const failed = list.some((s) => s.level === "error");
              const planned = h?.next.includes(d);
              return (
                <button key={d} className={`cal-day${sent ? " sent" : ""}${failed && !sent ? " fail" : ""}${planned ? " planned" : ""}${d === today ? " today" : ""}${d === day ? " on" : ""}`} onClick={() => setDay(d)}>
                  <span className="n">{i + 1}</span>
                  {sent > 0 && <span className="dot">{sent > 1 ? `✓ ${sent}` : "✓"}</span>}
                  {failed && !sent && <span className="dot">!</span>}
                  {planned && !sent && <span className="dot">⏱</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-legend s">
            <span>
              <i className="lg sent" /> Enviado
            </span>
            <span>
              <i className="lg planned" /> Programado
            </span>
            <span>
              <i className="lg fail" /> Falló
            </span>
          </div>
        </section>

        <section className="card pad">
          {!h ? (
            <p className="s">Cargando…</p>
          ) : day ? (
            <>
              <h2 className="h" style={{ textTransform: "capitalize" }}>
                {new Date(`${day}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              {selected.length === 0 ? (
                <p className="s">{h.next.includes(day) ? `Envío programado a las ${h.schedule.hour % 12 || 12}:00 ${h.schedule.hour < 12 ? "a. m." : "p. m."}` : "No se envió reporte este día."}</p>
              ) : (
                <ul className="num-list">
                  {selected.map((s, i) => (
                    <li key={i} style={{ display: "block" }}>
                      <b className={s.level === "error" ? "err-text" : "ok-text"}>{localTime(s.created_at)}</b> · {s.message}
                      {s.data && (
                        <div className="s">
                          {[s.data.via === "n8n" ? "vía n8n" : s.data.via === "app" ? "desde la app" : null, s.data.trigger, s.data.frequency && `reporte ${s.data.frequency}`, s.data.analysis && `análisis: ${s.data.analysis}`].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h2 className="h">Resumen del mes</h2>
              <div className="cal-kpis">
                <div>
                  <b>{ok.length}</b>
                  <span>reportes enviados</span>
                </div>
                <div>
                  <b>{sentDays}</b>
                  <span>días con envío</span>
                </div>
                <div>
                  <b>{ok.filter((s) => s.data?.trigger === "manual" || s.message.includes("manual")).length}</b>
                  <span>envíos manuales</span>
                </div>
              </div>
              <p className="s">
                Frecuencia actual: <b>{h.schedule.frequency}</b>. Próximos envíos:{" "}
                {h.next.length ? h.next.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })).join(" · ") : "—"}
              </p>
              <p className="s">Toca un día para ver el detalle de cada envío.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
