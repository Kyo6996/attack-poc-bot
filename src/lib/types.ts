export type ContactStatus =
  | "pending"
  | "linkedin_found"
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
