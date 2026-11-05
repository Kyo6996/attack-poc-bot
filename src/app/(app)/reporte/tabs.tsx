"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/reporte", label: "Configuración" },
  { href: "/reporte/calendario", label: "Calendario de envíos" },
];

export function ReportTabs() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? "tab on" : "tab"}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
