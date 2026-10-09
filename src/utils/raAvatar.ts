/** Avatar público de RetroAchievements para un username. */
export function raAvatarUrl(username: string): string {
  const name = username.trim();
  return `https://media.retroachievements.org/UserPic/${encodeURIComponent(name)}.png`;
}
