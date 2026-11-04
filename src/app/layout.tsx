import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot de prospección · Attack POC",
  description: "LinkedIn → enriquecimiento → llamada de voz con IA → reunión agendada",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
