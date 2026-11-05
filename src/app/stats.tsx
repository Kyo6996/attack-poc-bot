export function Tile({ label, value, unit, sub, status }: { label: string; value: string; unit?: string; sub: string; status?: "good" | "critical" }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">
        {value}
        {unit && <span className="stat-u"> {unit}</span>}
        {status && <span className={`stat-badge ${status}`}>{status === "good" ? "✓ En meta" : "! Bajo meta"}</span>}
      </div>
      <div className="stat-s">{sub}</div>
    </div>
  );
}
