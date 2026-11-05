"use client";

import { useState } from "react";
import type { FunnelStep, HourBucket, SlaRow } from "@/lib/stats";

// Colores explícitos (no variables CSS) para que la exportación a imagen salga igual.
export const C = {
  blue: "#2a78d6",
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
  neutral: "#9aa0a6",
};

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <figure className="ccard" data-chart={id}>
      <figcaption>
        <b>{title}</b>
        {sub && <span className="s"> · {sub}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

export function HourlyStacked({ buckets }: { buckets: HourBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = 240;
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const bw = (W - pad.l - pad.r) / buckets.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const series = [
    { key: "answered" as const, label: "Contestadas", color: C.good },
    { key: "missed" as const, label: "Perdidas", color: C.warning },
    { key: "failed" as const, label: "Fallidas", color: C.critical },
  ];
  const h = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart-box">
      <Legend items={series} />
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vchart" onMouseLeave={() => setHover(null)} role="img" aria-label="Llamadas por hora por resultado">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
              <text className="axis" x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10">
                {t}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = pad.l + i * bw + 2;
            let acc = 0;
            const segs = series
              .map((s) => ({ ...s, v: b[s.key] }))
              .filter((s) => s.v > 0)
              .map((s) => {
                const y0 = y(acc);
                acc += s.v;
                return { ...s, y0, y1: y(acc) };
              });
            return (
              <g key={b.start} onMouseEnter={() => setHover(i)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {segs.map((sg, k) => (
                  <rect
                    key={sg.key}
                    x={x}
                    width={Math.max(1, bw - 4)}
                    y={sg.y1 + (k > 0 ? 0 : 0)}
                    height={Math.max(0, sg.y0 - sg.y1 - (k < segs.length - 1 ? 2 : 0))}
                    rx={k === segs.length - 1 ? 3 : 0}
                    fill={sg.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                ))}
                {i % 3 === 0 && (
                  <text className="axis" x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="10">
                    {b.hour}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#9aa0a6" />
        </svg>
        {h && (
          <div className="tip" style={{ left: `${((pad.l + (hover! + 0.5) * bw) / W) * 100}%` }}>
            <b>{h.hour}</b> · {h.total} llamadas
            <div className="s">
              {h.answered} contestadas · {h.missed} perdidas · {h.failed} fallidas
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const W = 760;
  const rowH = 30;
  const labelW = 190;
  const H = steps.length * rowH + 10;
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vchart" role="img" aria-label="Embudo de conversión">
        {steps.map((s, i) => {
          const w = ((W - labelW - 120) * s.value) / max;
          const prev = i > 0 ? steps[i - 1].value : null;
          const conv = prev ? Math.round((s.value / prev) * 100) : null;
          const yy = 5 + i * rowH;
          return (
            <g key={s.label}>
              <text className="axis-strong" x={labelW - 10} y={yy + 18} textAnchor="end" fontSize="12">
                {s.label}
              </text>
              <rect x={labelW} y={yy + 4} width={Math.max(2, w)} height={rowH - 10} rx={3} fill={C.blue} opacity={1 - i * 0.07} />
              <text className="axis-strong" x={labelW + Math.max(2, w) + 8} y={yy + 18} fontSize="12" fontWeight="600">
                {s.value}
                {conv !== null && (
                  <tspan className="axis" fontWeight="400">
                    {"  "}({conv}% del paso anterior)
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SlaBar({ met, breached, pending }: { met: number; breached: number; pending: number }) {
  const W = 760;
  const H = 70;
  const total = Math.max(1, met + breached + pending);
  const parts = [
    { label: "A tiempo", v: met, color: C.good },
    { label: "Vencidos", v: breached, color: C.critical },
    { label: "En plazo (aún sin llamar)", v: pending, color: C.neutral },
  ];
  let x = 10;
  return (
    <div className="chart-box">
      <Legend items={parts.map((p) => ({ label: `${p.label}: ${p.v}`, color: p.color }))} />
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vchart" role="img" aria-label="Cumplimiento de SLA">
        {met + breached + pending === 0 ? (
          <text className="axis" x={W / 2} y={38} textAnchor="middle" fontSize="12">
            Sin contactos aplicables al SLA
          </text>
        ) : (
          parts.map((p) => {
            const w = ((W - 20) * p.v) / total;
            const r = (
              <g key={p.label}>
                {w > 0 && <rect x={x} y={14} width={Math.max(0, w - 2)} height={34} rx={3} fill={p.color} />}
                {w > 46 && (
                  <text x={x + w / 2} y={36} textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff">
                    {Math.round((p.v / total) * 100)}%
                  </text>
                )}
              </g>
            );
            x += w;
            return r;
          })
        )}
      </svg>
    </div>
  );
}

export function FirstCallBars({ rows, slaHours }: { rows: SlaRow[]; slaHours: number }) {
  const data = rows.filter((r) => r.minutesToFirstCall !== null);
  const W = 760;
  const rowH = 26;
  const labelW = 190;
  const H = Math.max(60, data.length * rowH + 30);
  const limit = slaHours * 60;
  const max = Math.max(limit * 1.1, ...data.map((r) => r.minutesToFirstCall!));
  const sx = (v: number) => labelW + ((W - labelW - 70) * v) / max;
  const fmt = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vchart" role="img" aria-label="Tiempo hasta el primer intento de llamada">
        {data.length === 0 && (
          <text className="axis" x={W / 2} y={34} textAnchor="middle" fontSize="12">
            Aún no hay llamadas
          </text>
        )}
        {data.map((r, i) => {
          const yy = 6 + i * rowH;
          const over = r.minutesToFirstCall! > limit;
          return (
            <g key={r.contactId}>
              <text className="axis-strong" x={labelW - 10} y={yy + 15} textAnchor="end" fontSize="12">
                {r.name}
              </text>
              <rect x={labelW} y={yy + 4} width={Math.max(2, sx(r.minutesToFirstCall!) - labelW)} height={rowH - 10} rx={3} fill={over ? C.critical : C.blue} />
              <text className="axis" x={sx(r.minutesToFirstCall!) + 6} y={yy + 15} fontSize="11">
                {fmt(r.minutesToFirstCall!)}
              </text>
            </g>
          );
        })}
        {data.length > 0 && (
          <g>
            <line x1={sx(limit)} x2={sx(limit)} y1={2} y2={H - 18} stroke={C.critical} strokeDasharray="4 3" strokeWidth={1.5} />
            <text x={sx(limit)} y={H - 6} textAnchor="middle" fontSize="10" fill={C.critical} fontWeight="700">
              Límite SLA {slaHours} h
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
