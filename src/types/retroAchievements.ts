export type Pcsx2RaStatusCode =
  | "unavailable"
  | "not_configured"
  | "disabled"
  | "ready";

export type EmulatorRaStatusCode = Pcsx2RaStatusCode | "unsupported";

export interface Pcsx2RaStatus {
  executableFound: boolean;
  executablePath: string | null;
  configDir: string | null;
  iniPath: string | null;
  iniFound: boolean;
  secretsFound: boolean;
  achievementsEnabled: boolean;
  hasUsername: boolean;
  hasToken: boolean;
  username: string | null;
  loginTimestamp: string | null;
  status: Pcsx2RaStatusCode;
  statusLabel: string;
  notes: string[];
}

export interface EmulatorRaStatus {
  emulatorKind: string;
  executableFound: boolean;
  executablePath: string | null;
  configDir: string | null;
  configPath: string | null;
  configFound: boolean;
  secretsFound: boolean;
  achievementsEnabled: boolean;
  hasUsername: boolean;
  hasToken: boolean;
  username: string | null;
  loginTimestamp: string | null;
  status: EmulatorRaStatusCode;
  statusLabel: string;
  notes: string[];
}

export type LaunchCheckId =
  | "CHECKING_USER"
  | "CHECKING_RUNTIME"
  | "CHECKING_CONTENT"
  | "CHECKING_EMULATOR"
  | "CHECKING_RETROACHIEVEMENTS"
  | "IDENTIFY_CONTENT"
  | "LAUNCHING";

export type RaIdentifyLookup = {
  found: boolean;
  console: string;
  consoleId: number;
  hash: string;
  raGameId: number | null;
  title: string | null;
  consoleName: string | null;
  imageIcon: string | null;
  message?: string;
};

export type LaunchCheckState = "pending" | "running" | "ok" | "warn" | "error";

export interface LaunchCheckItem {
  id: LaunchCheckId;
  label: string;
  detail?: string;
  state: LaunchCheckState;
}

/** Estado de datos de logros (distinto del login en el emulador). */
export type RaProgressUiState =
  | "idle"
  | "loading"
  | "available"
  | "not_configured"
  | "api_not_configured"
  | "not_mapped"
  | "not_found"
  | "api_error";

export interface RaAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  displayOrder: number;
  type: string | null;
  unlocked: boolean;
  unlockedHardcore: boolean;
  unlockedAt: string | null;
  unlockedAtHardcore: string | null;
  badgeName: string | null;
}

export interface RaGameProgress {
  raGameId: number;
  title: string;
  consoleName: string | null;
  imageIcon: string | null;
  totalAchievements: number;
  unlockedAchievements: number;
  unlockedAchievementsHardcore: number;
  completionPercentage: number;
  hardcoreCompletionPercentage: number;
  pointsTotal: number;
  achievements: RaAchievement[];
  cached: boolean;
  fetchedAt: string;
}

export interface RaGameCandidate {
  raGameId: number;
  title: string;
  consoleId: number;
  consoleName: string | null;
  numAchievements: number;
  imageIcon: string | null;
}

export interface RaApiStatus {
  apiConfigured: boolean;
}

export interface RaCachedProgressItem {
  raGameId: number;
  progress: RaGameProgress | null;
}

export interface RaCachedProgressResponse {
  items: RaCachedProgressItem[];
}

export interface RaRecentGame {
  raGameId: number;
  title: string;
  consoleName: string | null;
  imageIcon: string | null;
  lastPlayed: string | null;
  achievementsTotal: number;
}

export interface RaUserProfile {
  username: string;
  avatarUrl: string | null;
  motto: string | null;
  points: number;
  softcorePoints: number;
  truePoints: number;
  siteRank: number | null;
  totalRanked: number | null;
  rankRequiresPoints: number;
  memberSince: string | null;
  lastActivityAt: string | null;
  status: string | null;
  richPresence: string | null;
  userWallActive: boolean;
  retroRatio: number | null;
  gamesBeaten: number;
  masteryAwards: number;
  recentGames: RaRecentGame[];
  cached: boolean;
  fetchedAt: string;
}
