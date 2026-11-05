// Voces disponibles para las llamadas en vivo (Vapi). El nombre del agente acompaña al género de la voz.
export interface VoiceOption {
  id: string;
  provider: string;
  voiceId: string;
  label: string;
  accent: string;
  agentName: string;
}

export interface AgentVoice {
  provider: string;
  voiceId: string;
  speed: number;
  agentName: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "salome", provider: "azure", voiceId: "es-CO-SalomeNeural", label: "Salomé", accent: "Colombia · mujer", agentName: "Sofía" },
  { id: "gonzalo", provider: "azure", voiceId: "es-CO-GonzaloNeural", label: "Gonzalo", accent: "Colombia · hombre", agentName: "Santiago" },
  { id: "dalia", provider: "azure", voiceId: "es-MX-DaliaNeural", label: "Dalia", accent: "México · mujer", agentName: "Sofía" },
  { id: "jorge", provider: "azure", voiceId: "es-MX-JorgeNeural", label: "Jorge", accent: "México · hombre", agentName: "Santiago" },
  { id: "paloma", provider: "azure", voiceId: "es-US-PalomaNeural", label: "Paloma", accent: "Latino neutro · mujer", agentName: "Sofía" },
  { id: "alonso", provider: "azure", voiceId: "es-US-AlonsoNeural", label: "Alonso", accent: "Latino neutro · hombre", agentName: "Santiago" },
];
