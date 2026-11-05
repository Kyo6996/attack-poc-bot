"use client";

import { PageHeader } from "@/app/ui";
import { useCallback, useEffect, useState } from "react";
import type { Stats } from "@/lib/stats";
import type { CallRow, Contact } from "@/lib/types";
import { Tile } from "@/app/stats";
import { exportSlaReport } from "@/app/xlsx";
import { ChartCard, FirstCallBars, Funnel, HourlyStacked, SlaBar } from "./charts";

interface Data {
  stats: Stats;
  calls: CallRow[];
  contacts: Contact[];
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const SLA_LABEL: Record<string, string> = { "A tiempo": "b-ok", Vencido: "b-err", "En plazo": "b-warn", "No aplica": "b-neutral" };
const tz = { timeZone: "America/Bogota" } as const;
const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-CO", { ...tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

export default function SlaPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function download() {
    if (!data) return;
    setBusy(true);
    setMsg("Generando reporte…");
    try {
      await exportSlaReport(data.stats, data.calls, data.contacts);
      setMsg("Reporte descargado");
    } catch (e) {
      setMsg(`No se pudo generar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.stats;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Análisis"
        title="Desempeño y SLA"
        subtitle={`Ventana de ${s?.windowHours ?? 24} h · meta: primer intento de llamada antes de ${s?.windowHours ?? 24} h desde que el contacto se carga`}
        actions={
          <button className="primary" onClick={download} disabled={!data || busy}>
            ⬇ Descargar reporte (.xlsx)
          </button>
        }
      />
      {msg && <p className="msg">{msg}</p>}

      {!s ? (
        <p className="s">Cargando…</p>
      ) : (
        <>
          <section className="card stats">
            <div className="stat-grid">
              <Tile label="Llamadas (24 h)" value={String(s.calls)} sub={`${s.answered} contestadas · ${s.missed} perdidas · ${s.failed} fallidas`} />
              <Tile label="Ritmo de llamadas" value={s.callsPerMinuteLastHour.toLocaleString("es-CO")} unit="llamadas/min" sub={`última hora · pico ${s.peakPerMinute}/min`} />
              <Tile label="Tasa de contacto" value={pct(s.contactRate)} sub="contestadas / terminadas" />
              <Tile label="Aceptación de citas" value={pct(s.acceptanceRate)} sub={`${s.meetings} reuniones de ${s.answered} contestadas`} />
              <Tile
                label="Cumplimiento SLA"
                value={pct(s.sla.compliance)}
                status={s.sla.compliance === null ? undefined : s.sla.compliance >= 0.9 ? "good" : "critical"}
                sub={`${s.sla.met} a tiempo · ${s.sla.breached} vencidos · ${s.sla.pendingInSla} en plazo`}
              />
              <Tile
                label="Minutos al teléfono"
                value={s.talkMinutes.toLocaleString("es-CO")}
                unit="min"
                sub={`1.ª llamada en ${s.sla.avgMinutesToFirstCall ?? "—"} min promedio`}
              />
            </div>
          </section>

          <div className="charts">
            <ChartCard id="hourly" title="Llamadas por hora y resultado" sub="últimas 24 h, hora Colombia">
              <HourlyStacked buckets={s.hourly} />
            </ChartCard>
            <ChartCard id="sla" title="Cumplimiento del SLA" sub={`primer intento antes de ${s.windowHours} h`}>
              <SlaBar met={s.sla.met} breached={s.sla.breached} pending={s.sla.pendingInSla} />
            </ChartCard>
            <ChartCard id="funnel" title="Embudo de conversión" sub="base actual">
              <Funnel steps={s.funnel} />
            </ChartCard>
            <ChartCard id="first-call" title="Tiempo hasta el primer intento de llamada" sub="por contacto">
              <FirstCallBars rows={s.slaRows} slaHours={s.windowHours} />
            </ChartCard>
          </div>

          <section className="card">
            <h2>Detalle de SLA por contacto</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Cargado</th>
                    <th>Primer intento</th>
                    <th>Tiempo</th>
                    <th>SLA</th>
                    <th>Intentos</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {s.slaRows.map((r) => (
                    <tr key={r.contactId}>
                      <td>
                        <b>{r.name}</b>
                        <div className="s">{r.company}</div>
                      </td>
                      <td>{fmt(r.loadedAt)}</td>
                      <td>{fmt(r.firstCallAt)}</td>
                      <td className="mono">{r.minutesToFirstCall === null ? "—" : `${r.minutesToFirstCall} min`}</td>
                      <td>
                        <span className={`badge ${SLA_LABEL[r.sla]}`}>{r.sla}</span>
                      </td>
                      <td>{r.attempts}</td>
                      <td className="s">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
