export type ContactStatus =
  | "pending"
  | "linkedin_found"
  | "needs_review"
  | "enriching"
  | "phone_found"
  | "calling"
  | "meeting_scheduled"
  | "declined"
  | "no_answer"
  | "call_failed"
  | "skipped";

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  consent: boolean;
  event_notes: string | null;
  qualification: Qualification | null;
  profile: Profile | null;
  linkedin_candidates: LinkedInCandidate[] | null;
  linkedin_url: string | null;
  linkedin_confidence: number | null;
  linkedin_source: string | null;
  enrichment_source: string | null;
  status: ContactStatus;
  skip_reason: string | null;
  call_id: string | null;
  call_outcome: string | null;
  call_summary: string | null;
  call_transcript: string | null;
  recording_url: string | null;
  locked_until: string | null;
  booking_token: string;
  source: string; // panel | csv | qr:<origen>
  contact_preference: string | null;
  created_at: string;
  updated_at: string;
}

export interface Qualification {
  area_interes?: string;
  proyecto?: string;
  etapa?: string;
  fecha_meta?: string;
  decisores?: string;
  cargo?: string;
  celular?: string;
  referido?: string;
  notas?: string;
}

export interface LinkedInCandidate {
  url: string;
  name: string;
  headline: string | null;
  location: string | null;
  snippet: string;
  sources: { url: string; title: string }[];
  confidence: number;
  reason: string;
  origin?: "serper" | "sandbox" | "manual";
  // Solo se vio en publicaciones: la URL del perfil se dedujo y puede no ser exacta.
  fromPost?: boolean;
}

export interface CompanyInfo {
  name: string;
  website: string | null;
  domain: string | null;
  description: string | null;
  type: string | null;
  linkedin: string | null;
  attributes: Record<string, string> | null;
  address?: string | null;
  category?: string | null;
  phones?: ContactPhone[];
  emails?: string[];
  // De qué servicio salió cada campo de la empresa, con el enlace de respaldo.
  field_sources?: Record<string, { source: string; url?: string | null }>;
}

// Registro de procedencia de cada dato del contacto (se escribe cuando el bot llena el campo).
export interface Provenance {
  source: string;
  detail?: string | null;
  url?: string | null;
  at: string;
}

export interface ContactPhone {
  value: string;
  type: "celular" | "fijo";
  source: string;
  owner: "persona" | "empresa";
}

// Lo que se encontró en la web sobre la persona y su empresa.
export interface Profile {
  headline: string | null;
  location: string | null;
  summary: string | null;
  sources: { url: string; title: string }[];
  company: CompanyInfo | null;
  phones?: ContactPhone[];
  email?: { value: string; score: number; status: string | null; source: string };
  provenance?: Record<string, Provenance>;
  signalhire?: SignalHireInfo;
  searched_at: string;
  queries: number;
}

export interface SalesRep {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  area: string;
  active: boolean;
  created_at: string;
}

export interface CallRow {
  id: string;
  contact_id: string;
  provider: string;
  provider_call_id: string | null;
  status: "in_progress" | "answered" | "missed" | "failed";
  ended_reason: string | null;
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
}

export type EmailKind = "confirmacion" | "seguimiento" | "brief_comercial";

export interface EmailRow {
  id: number;
  contact_id: string | null;
  meeting_id: string | null;
  kind: EmailKind;
  to_email: string;
  subject: string;
  provider: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
}

export interface SandboxProfile {
  id: string;
  full_name: string;
  company: string | null;
  headline: string | null;
  linkedin_url: string;
  mobile_phone: string | null;
  email: string | null;
  mock_call_outcome: "accept" | "decline" | "no_answer";
  created_at: string;
}

export interface Meeting {
  id: string;
  contact_id: string;
  starts_at: string;
  ends_at: string;
  attendee_email: string;
  meet_url: string | null;
  calendar_event_id: string | null;
  calendar_provider: string;
  calendar_link: string | null;
  sales_rep_id: string | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  contact_id: string | null;
  step: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  data: unknown;
  created_at: string;
}

export const fullName = (c: Pick<Contact, "first_name" | "last_name">) =>
  `${c.first_name} ${c.last_name}`.trim();

export interface SignalHireProfile {
  uid: string;
  fullName: string;
  location: string | null;
  experience: { company: string; title: string }[];
  skills: string[];
  contactsFetched: string | null;
  openToWork: boolean;
  score?: number;
}

// Lo que SignalHire aporta gratis (búsqueda) y, si se autoriza, los contactos revelados con crédito.
export interface SignalHireInfo {
  searched_at: string;
  total: number;
  best: SignalHireProfile | null;
  others: SignalHireProfile[];
  error?: string;
  reveal?: {
    requested_at: string;
    status: "pendiente" | "listo" | "sin datos";
    phones?: { value: string; subType?: string | null }[];
    emails?: { value: string; subType?: string | null }[];
    received_at?: string;
  };
}
