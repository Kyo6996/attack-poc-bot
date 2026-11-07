import type { NextConfig } from "next";

// Cabeceras de seguridad para todas las páginas y APIs.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdfkit lee sus fuentes (.afm) desde node_modules en tiempo de ejecución.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/report/**": ["./node_modules/pdfkit/js/data/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
