/** Tiempo de juego de Blaze. Independiente de RetroAchievements. */

export function formatPlaytime(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

export function formatLastPlayed(
  iso: string,
  now = new Date(),
  withTime = false,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const day = startOf(date);
  const today = startOf(now);
  const yesterday = today - 24 * 60 * 60 * 1000;

  let label: string;
  if (day === today) label = "Hoy";
  else if (day === yesterday) label = "Ayer";
  else {
    label = new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }
  return withTime ? `${label}, ${time}` : label;
}

export type PlayCardModel =
  | { kind: "never" }
  | { kind: "played"; playtimeLabel: string; lastPlayedLabel: string };

export function playCardModel(
  stats: {
    playCount: number;
    totalPlaytimeSeconds: number;
    lastPlayedAt: string;
  } | null,
  now = new Date(),
): PlayCardModel {
  if (!stats || stats.playCount <= 0) return { kind: "never" };
  return {
    kind: "played",
    playtimeLabel: formatPlaytime(stats.totalPlaytimeSeconds),
    lastPlayedLabel: formatLastPlayed(stats.lastPlayedAt, now),
  };
}

/** Solo un proceso realmente en marcha cuenta como sesión. */
export function shouldRecordPlaySession(
  status: string,
  pid: number | null,
): boolean {
  return status === "RUNNING" && typeof pid === "number" && pid > 0;
}
