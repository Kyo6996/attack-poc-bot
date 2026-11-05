"use client";

import { PageHeader } from "@/app/ui";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

const BRAND = "Lenovo";
const EVENT = "ANDICOM 2026";
const COMPANY = "Attack";

export default function QrPage() {
  const [origin, setOrigin] = useState("stand");
  const [layout, setLayout] = useState<"afiche" | "tarjetas">("afiche");
  const [svg, setSvg] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    const u = `${window.location.origin}/registro?origen=${encodeURIComponent(origin.trim() || "qr")}`;
    setUrl(u);
    QRCode.toString(u, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#161616", light: "#ffffff" } }).then(setSvg);
  }, [origin]);

  const short = url.replace(/^https?:\/\//, "");

  const Card = ({ big }: { big: boolean }) => (
    <div className={big ? "flyer big" : "flyer"}>
      <div className="fl-head">
        <span className="fl-brand">{BRAND}</span>
        <span className="fl-chip">{EVENT}</span>
      </div>
      <div className="fl-bar" />
      <div className="fl-body">
        <p className="fl-eyebrow">Hablemos de tu proyecto</p>
        <h2>Escanea y un especialista te contacta</h2>
        <div className="fl-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="fl-url">{short}</p>
        {big && (
          <ul>
            <li>Conversación de 15 minutos con un especialista de {BRAND}</li>
            <li>Dispositivos · Infraestructura · Servicios · Inteligencia artificial</li>
            <li>Solo tu nombre y un celular o correo; el resto es opcional</li>
          </ul>
        )}
      </div>
      <div className="fl-foot">
        Equipo {COMPANY} · en nombre de {BRAND}. Tus datos se usan solo para contactarte (Ley 1581 de 2012).
      </div>
    </div>
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Prospección"
        title="Formulario QR"
        subtitle="Imprime el afiche o las tarjetas: quien escanea deja sus datos y el bot inicia su ciclo"
        actions={
          <>
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              Ver formulario
            </a>
            <button className="primary" onClick={() => window.print()}>
              🖨 Imprimir
            </button>
          </>
        }
      />

      <section className="card pad no-print">
        <div className="btnrow" style={{ marginTop: 0 }}>
          <label className="check">
            Origen:
            <input className="inline-input" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <span className="s">Se guarda en cada registro (p. ej. stand, volante, charla) para saber de dónde llegó.</span>
        </div>
        <div className="btnrow">
          <button className={layout === "afiche" ? "sm on" : "sm"} onClick={() => setLayout("afiche")}>
            Afiche A4
          </button>
          <button className={layout === "tarjetas" ? "sm on" : "sm"} onClick={() => setLayout("tarjetas")}>
            4 tarjetas por hoja
          </button>
        </div>
      </section>

      <div className={`sheet ${layout}`}>
        {layout === "afiche" ? (
          <Card big />
        ) : (
          <>
            <Card big={false} />
            <Card big={false} />
            <Card big={false} />
            <Card big={false} />
          </>
        )}
      </div>
    </div>
  );
}
