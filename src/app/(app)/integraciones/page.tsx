"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/app/ui";

interface Item {
  name: string;
  purpose: string;
  status: "activo" | "prueba" | "inactivo";
  detail: string;
}

const LABEL = { activo: "Activa", prueba: "Modo prueba", inactivo: "Sin configurar" };

export default function IntegracionesPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setItems(j.items));
  }, []);

  return (
    <div className="page">
      <PageHeader eyebrow="Configuración" title="Integraciones" subtitle="Servicios conectados al flujo y en qué modo está cada uno" />
      {!items ? (
        <p className="s">Cargando…</p>
      ) : (
        <div className="int-grid">
          {items.map((it) => (
            <div key={it.name} className="card int-card">
              <div className="int-top">
                <b>{it.name}</b>
                <span className={`status-pill ${it.status}`}>
                  <i />
                  {LABEL[it.status]}
                </span>
              </div>
              <p>{it.purpose}</p>
              <small className="s">{it.detail}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
