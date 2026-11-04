import { env } from "./env";

// Texto pensado para voz: el TTS lee "9:00 a. m." como "nueve cero cero a punto eme".
const HOURS = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];

function localParts(iso: string) {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: env.timeZone(),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    day: Number(get("day")),
    month: get("month"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

const UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta"];

function numberWords(n: number): string {
  if (n < 30) return UNITS[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t} y ${UNITS[n % 10]}` : t;
}

export function spokenTime(iso: string): string {
  const { hour, minute } = localParts(iso);
  const h12 = hour % 12;
  const word = HOURS[h12];
  const article = h12 === 1 ? "a la" : "a las";
  const mins = minute === 0 ? "" : minute === 15 ? " y cuarto" : minute === 30 ? " y media" : ` y ${numberWords(minute)}`;
  const period =
    hour === 12 && minute === 0 ? " del mediodía" : hour < 12 ? " de la mañana" : hour < 19 ? " de la tarde" : " de la noche";
  return `${article} ${word}${mins}${period}`;
}

export function spokenDay(iso: string): string {
  const { weekday, day, month } = localParts(iso);
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone() });
  const diff = Math.round((Date.parse(dayFmt.format(new Date(iso))) - Date.parse(dayFmt.format(new Date()))) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return `mañana ${weekday}`;
  return `el ${weekday} ${day} de ${month}`;
}

/** "el jueves 5 de noviembre a las nueve de la mañana" */
export function spokenSlot(iso: string): string {
  return `${spokenDay(iso)} ${spokenTime(iso)}`;
}
