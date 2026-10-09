/** Badge RetroAchievements (media CDN). */
export function raBadgeUrl(
  badgeName: string | null | undefined,
  unlocked: boolean,
): string | null {
  if (!badgeName?.trim()) return null;
  const name = badgeName.trim().replace(/_lock$/i, "");
  const file = unlocked ? `${name}.png` : `${name}_lock.png`;
  return `https://media.retroachievements.org/Badge/${encodeURIComponent(file)}`;
}

/** Etiquetas tipo Steam desde género + plataforma. */
export function gameTagLabels(input: {
  genre?: string | null;
  platform?: string | null;
}): string[] {
  const tags: string[] = [];
  if (input.platform?.trim()) tags.push(input.platform.trim());
  if (input.genre?.trim()) {
    for (const part of input.genre.split(/[/|,·]/)) {
      const t = part.trim();
      if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
        tags.push(t);
      }
    }
  }
  return tags;
}
