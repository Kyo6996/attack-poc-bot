// Voces disponibles para las llamadas en vivo (Vapi). El nombre del agente acompaña al género de la voz.
export interface VoiceOption {
  id: string;
  provider: string;
  voiceId: string;
  label: string;
  accent: string;
  agentName: string;
  model?: string;
  sample?: string; // muestra pública de la voz (no es el guion)
  group: "Azure" | "ElevenLabs";
}

export interface AgentVoice {
  provider: string;
  voiceId: string;
  speed: number;
  agentName: string;
  model?: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "salome", provider: "azure", voiceId: "es-CO-SalomeNeural", label: "Salomé", accent: "Colombia · mujer", agentName: "Sofía", group: "Azure" },
  { id: "gonzalo", provider: "azure", voiceId: "es-CO-GonzaloNeural", label: "Gonzalo", accent: "Colombia · hombre", agentName: "Santiago", group: "Azure" },
  { id: "dalia", provider: "azure", voiceId: "es-MX-DaliaNeural", label: "Dalia", accent: "México · mujer", agentName: "Sofía", group: "Azure" },
  { id: "jorge", provider: "azure", voiceId: "es-MX-JorgeNeural", label: "Jorge", accent: "México · hombre", agentName: "Santiago", group: "Azure" },
  { id: "paloma", provider: "azure", voiceId: "es-US-PalomaNeural", label: "Paloma", accent: "Latino neutro · mujer", agentName: "Sofía", group: "Azure" },
  { id: "alonso", provider: "azure", voiceId: "es-US-AlonsoNeural", label: "Alonso", accent: "Latino neutro · hombre", agentName: "Santiago", group: "Azure" },
  // ElevenLabs (biblioteca de voces), modelo rápido apto para llamadas en tiempo real
  { id: "diana", provider: "11labs", voiceId: "irla3teuChAApguKnzms", label: "Diana García", accent: "Colombia · mujer · ventas", agentName: "Sofía", model: "eleven_flash_v2_5", sample: "/voces/diana.mp3", group: "ElevenLabs" },
  { id: "lina", provider: "11labs", voiceId: "VmejBeYhbrcTPwDniox7", label: "Lina", accent: "Colombia · mujer · cálida", agentName: "Sofía", model: "eleven_flash_v2_5", sample: "/voces/lina.mp3", group: "ElevenLabs" },
  { id: "marcela", provider: "11labs", voiceId: "86V9x9hrQds83qf7zaGn", label: "Marcela", accent: "Colombia · mujer · natural", agentName: "Sofía", model: "eleven_flash_v2_5", sample: "/voces/marcela.mp3", group: "ElevenLabs" },
  { id: "anamaria", provider: "11labs", voiceId: "m7yTemJqdIqrcNleANfX", label: "Ana María", accent: "México · mujer · agentes", agentName: "Sofía", model: "eleven_flash_v2_5", sample: "/voces/anamaria.mp3", group: "ElevenLabs" },
  { id: "daniel", provider: "11labs", voiceId: "PltXjU3hWkDRqpu9TowY", label: "Daniel", accent: "Colombia neutro · hombre", agentName: "Santiago", model: "eleven_flash_v2_5", sample: "/voces/daniel.mp3", group: "ElevenLabs" },
  { id: "antonio", provider: "11labs", voiceId: "htFfPSZGJwjBv1CL0aMD", label: "Antonio", accent: "Latino · hombre", agentName: "Santiago", model: "eleven_flash_v2_5", sample: "/voces/antonio.mp3", group: "ElevenLabs" },
];

// Ajustes de ElevenLabs pensados para conversación: algo de variación natural sin perder claridad.
export function vapiVoice(v: AgentVoice) {
  if (v.provider === "11labs") {
    return {
      provider: "11labs",
      voiceId: v.voiceId,
      model: v.model ?? "eleven_flash_v2_5",
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.2,
      useSpeakerBoost: true,
      speed: v.speed,
      // Si ElevenLabs falla (plan, cuota o caída), Vapi sigue la llamada con Salomé en vez de quedar en silencio.
      fallbackPlan: { voices: [{ provider: "azure", voiceId: "es-CO-SalomeNeural" }] },
    };
  }
  return { provider: v.provider, voiceId: v.voiceId, speed: v.speed };
}
