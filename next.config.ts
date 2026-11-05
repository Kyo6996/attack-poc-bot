import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lee sus fuentes (.afm) desde node_modules en tiempo de ejecución.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/report/**": ["./node_modules/pdfkit/js/data/**"],
  },
};

export default nextConfig;
