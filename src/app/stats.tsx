"use client";

import { useState } from "react";
import type { Stats } from "@/lib/stats";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function timeLeft(iso: string | null) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "vencido";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function StatsPanel({ stats }: { stats: Stats }) {
  const s = stats.sla;
  const slaOk = s.compliance === null || s.compliance >= 0.9;
  return (
    <section className="card stats">
      <h2>
        Desempeño del bot · SLA {stats.windowHours} h
        <span className="s" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          {" "}
          · meta: primer intento de llamada antes de {stats.windowHours} h desde la carga del contacto
        </span>
      </h2>
      <div className="stat-grid">
        <Tile label="Llamadas (24 h)" value={String(stats.calls)} sub={`${stats.answered} contestadas · ${stats.missed} perdidas · ${stats.failed} fallidas`} />
        <Tile
          label="Ritmo de llamadas"
          value={`${stats.callsPerMinuteLastHour.toLocaleString("es-CO")}`}
          unit="llamadas/min"
          sub={`última hora · pico ${stats.peakPerMinute}/min`}
        />
        <Tile label="Tasa de contacto" value={pct(stats.contactRate)} sub="contestadas sobre llamadas terminadas" />
        <Tile label="Aceptación de citas" value={pct(stats.acceptanceRate)} sub={`${stats.meetings} reuniones de ${stats.answered} contestadas`} />
        <Tile
          label="Cumplimiento SLA"
          value={pct(s.compliance)}
          status={s.compliance === null ? undefined : slaOk ? "good" : "critical"}
          sub={`${s.met} a tiempo · ${s.breached} vencidos · ${s.pendingInSla} en plazo${s.nextDeadline ? ` (vence en ${timeLeft(s.nextDeadline)})` : ""}`}
        />
        <Tile
          label="Minutos al teléfono"
          value={stats.talkMinutes.toLocaleString("es-CO")}
          unit="min"
          sub={`duración promedio ${Math.floor(stats.avgDurationSec / 60)}:${String(stats.avgDurationSec % 60).padStart(2, "0")}${s.avgMinutesToFirstCall !== null ? ` · 1.ª llamada en ${s.avgMinutesToFirstCall} min` : ""}`}
        />
      </div>
      <HourlyChart buckets={stats.hourly} />
    </section>
  );
}

function Tile({ label, value, unit, sub, status }: { label: string; value: string; unit?: string; sub: string; status?: "good" | "critical" }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">
        {value}
        {unit && <span className="stat-u"> {unit}</span>}
        {status && (
          <span className={`stat-badge ${status}`}>
            {status === "good" ? "✓ En meta" : "! Bajo meta"}
          </span>
        )}
      </div>
      <div className="stat-s">{sub}</div>
    </div>
  );
}

function HourlyChart({ buckets }: { buckets: Stats["hourly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const W = 720;
  const H = 120;
  const pad = { l: 28, r: 8, t: 8, b: 22 };
  const bw = (W - pad.l - pad.r) / buckets.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const empty = buckets.every((b) => b.total === 0);
  const h = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart">
      <div className="chart-title">Llamadas por hora · últimas 24 h</div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Llamadas por hora en las últimas 24 horas" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = pad.l + i * bw;
            const top = y(b.total);
            const barH = H - pad.b - top;
            return (
              <g key={b.start} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {b.total > 0 && (
                  <path
                    className={hover === i ? "bar on" : "bar"}
                    d={`M${x + 2},${H - pad.b} V${top + Math.min(4, barH)} q0,-4 4,-4 H${x + bw - 6} q4,0 4,4 V${H - pad.b} Z`}
                  />
                )}
                {i % 6 === 0 && (
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="axis">
                    {b.hour}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {empty && <div className="chart-empty">Sin llamadas en las últimas 24 horas</div>}
        {h && (
          <div className="tip" style={{ left: `${((pad.l + (hover! + 0.5) * bw) / W) * 100}%` }}>
            <b>{h.hour}</b>
            <div>{h.total} llamadas</div>
            <div className="s">
              {h.answered} contestadas · {h.missed} perdidas · {h.failed} fallidas
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
