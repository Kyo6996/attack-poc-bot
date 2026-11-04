import { toE164 } from "./util";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function req(name: string): string {
  const v = opt(name);
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export type LinkedInProvider = "sandbox" | "serper";
export type EnrichmentProvider = "sandbox" | "signalhire";
export type VoiceProvider = "simulated" | "vapi";
export type CalendarProvider = "sandbox" | "google";
export type EmailProvider = "sandbox" | "gmail" | "smtp";

export const env = {
  supabaseUrl: () => req("SUPABASE_URL"),
  supabaseKey: () => opt("SUPABASE_SECRET_KEY") ?? req("SUPABASE_SERVICE_ROLE_KEY"),

  // en Vercel se toma del dominio de producción
  appUrl: () =>
    opt("APP_URL") ??
    (opt("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${opt("VERCEL_PROJECT_PRODUCTION_URL")}` : undefined) ??
    "http://localhost:3000",
  webhookSecret: () => req("WEBHOOK_SECRET"),

  providers: {
    linkedin: (opt("PROVIDER_LINKEDIN") ?? "sandbox") as LinkedInProvider,
    enrichment: (opt("PROVIDER_ENRICHMENT") ?? "sandbox") as EnrichmentProvider,
    voice: (opt("PROVIDER_VOICE") ?? "simulated") as VoiceProvider,
    calendar: (opt("PROVIDER_CALENDAR") ?? "sandbox") as CalendarProvider,
    email: (opt("PROVIDER_EMAIL") ?? "sandbox") as EmailProvider,
  },

  // Firma del correo de seguimiento (el remitente es la cuenta de Google conectada)
  sender: () => ({
    name: opt("SENDER_NAME") ?? "Equipo Attack",
    title: opt("SENDER_TITLE") ?? "Ejecutivo de cuenta",
    phone: opt("SENDER_PHONE") ?? "",
    email: opt("SENDER_EMAIL") ?? "",
  }),

  serperKey: () => req("SERPER_API_KEY"),
  anthropicKey: () => opt("ANTHROPIC_API_KEY"),
  anthropicModel: () => opt("ANTHROPIC_MODEL") ?? "claude-haiku-5-5",
  signalhireKey: () => req("SIGNALHIRE_API_KEY"),

  vapiKey: () => req("VAPI_API_KEY"),
  vapiPhoneNumberId: () => req("VAPI_PHONE_NUMBER_ID"),
  voiceLiveNumbers: () =>
    (opt("VOICE_LIVE_NUMBERS") ?? "")
      .split(",")
      .map((n) => toE164(n))
      .filter((n): n is string => !!n),
  vapiModelProvider: () => opt("VAPI_MODEL_PROVIDER") ?? "openai",
  vapiModel: () => opt("VAPI_MODEL") ?? "gpt-4o",
  vapiVoiceProvider: () => opt("VAPI_VOICE_PROVIDER") ?? "azure",
  vapiVoiceId: () => opt("VAPI_VOICE_ID") ?? "es-CO-SalomeNeural",

  googleClientId: () => req("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => req("GOOGLE_CLIENT_SECRET"),
  googleRefreshToken: () => req("GOOGLE_REFRESH_TOKEN"),
  googleCalendarId: () => opt("GOOGLE_CALENDAR_ID") ?? "primary",

  // "Empresa X" en el guion
  companyName: () => opt("COMPANY_NAME") ?? "Attack",
  brandName: () => opt("BRAND_NAME") ?? "Lenovo",
  eventName: () => opt("EVENT_NAME") ?? "ANDICOM",
  agentName: () => opt("AGENT_NAME") ?? "Sofía",
  meetingMinutes: () => Number(opt("MEETING_MINUTES") ?? 15),
  // Bogotá no tiene horario de verano
  tzOffset: () => opt("BUSINESS_TZ_OFFSET") ?? "-05:00",
  timeZone: () => opt("BUSINESS_TZ") ?? "America/Bogota",
  businessHours: () => ({
    start: Number(opt("BUSINESS_HOUR_START") ?? 9),
    end: Number(opt("BUSINESS_HOUR_END") ?? 17),
  }),

  dashboardPassword: () => opt("DASHBOARD_PASSWORD"),

  // Gmail por SMTP con contraseña de aplicación (Google la muestra con espacios)
  smtpUser: () => req("SMTP_USER"),
  smtpPass: () => req("SMTP_PASS").replace(/\s+/g, ""),
  // Sala de Meet fija para cuando el calendario no es Google (no se puede crear Meet sin OAuth)
  meetRoomUrl: () => opt("MEET_ROOM_URL"),
};
