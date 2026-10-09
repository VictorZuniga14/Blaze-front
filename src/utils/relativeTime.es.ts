const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export function formatMemberSince(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS_ES[date.getUTCMonth()] ?? "";
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function formatRelativeTimeEs(value: string | null | undefined): string {
  if (!value) return "sin actividad reciente";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return value;

  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) {
    return diffSec <= 1 ? "hace 1 segundo" : `hace ${diffSec} segundos`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? "hace 1 minuto" : `hace ${diffMin} minutos`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 48) {
    return diffHour === 1 ? "hace 1 hora" : `hace ${diffHour} horas`;
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    return diffDay === 1 ? "hace 1 día" : `hace ${diffDay} días`;
  }
  return formatMemberSince(value);
}
