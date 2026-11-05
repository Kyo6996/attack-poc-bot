"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const I = {
  contacts: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3 3 0 0 1 0 5.8",
  agenda: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 13h3M8 16h6",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  team: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  voice: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM19 11a7 7 0 0 1-14 0M12 18v3",
  phone: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  plug: "M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8ZM12 17v5",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11",
  menu: "M4 6h16M4 12h16M4 18h16",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const NAV: { title: string; items: { href: string; label: string; icon: keyof typeof I }[] }[] = [
  {
    title: "Prospección",
    items: [
      { href: "/", label: "Contactos", icon: "contacts" },
      { href: "/agenda", label: "Agenda", icon: "agenda" },
      { href: "/bitacora", label: "Bitácora", icon: "activity" },
      { href: "/qr", label: "Formulario QR", icon: "qr" },
    ],
  },
  { title: "Análisis", items: [{ href: "/sla", label: "Desempeño y SLA", icon: "chart" }] },
  { title: "Equipo", items: [{ href: "/comerciales", label: "Comerciales", icon: "team" }] },
  {
    title: "Configuración",
    items: [
      { href: "/voces", label: "Voz del agente", icon: "voice" },
      { href: "/configuracion", label: "Llamadas y números", icon: "phone" },
      { href: "/integraciones", label: "Integraciones", icon: "plug" },
      { href: "/sandbox", label: "Datos sandbox", icon: "db" },
    ],
  },
];

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7dff" />
          <stop offset="1" stopColor="#4f3fd6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#cp-g)" />
      <path d="M27.5 13.5a9 9 0 1 0 0 13" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M22 9c2.5-2.6 6.8-2.3 8.2.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".75" />
      <circle cx="29.5" cy="20" r="2" fill="#fff" />
    </svg>
  );
}

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setUser(j.user))
      .catch(() => undefined);
  }, []);
  useEffect(() => setOpen(false), [path]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <button className="sb-toggle no-print" onClick={() => setOpen((o) => !o)} aria-label="Abrir menú">
        <Icon d={I.menu} />
      </button>
      <aside className={`sidebar no-print ${open ? "open" : ""}`}>
        <Link href="/" className="sb-brand">
          <Logo />
          <span>
            <b>Capricorne</b>
            <small>Project</small>
          </span>
        </Link>
        <nav>
          {NAV.map((g) => (
            <div key={g.title} className="sb-group">
              <div className="sb-title">{g.title}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={active(it.href) ? "sb-link on" : "sb-link"}>
                  <Icon d={I[it.icon]} />
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <span className="sb-avatar">{(user ?? "?").slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{user ?? "Usuario"}</b>
              <small>Attack · ANDICOM 2026</small>
            </span>
          </div>
          <button className="sb-link sb-logout" onClick={logout}>
            <Icon d={I.logout} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {open && <div className="sb-scrim no-print" onClick={() => setOpen(false)} />}
    </>
  );
}
