export type GamePlayAggregate = {
  gameId: string;
  totalPlaytimeSeconds: number;
  playCount: number;
  lastPlayedAt: string;
  firstPlayedAt: string;
  averageSessionSeconds: number;
};

export type PlayStats = {
  memberSince: string;
  totalPlaytimeSeconds: number;
  sessionCount: number;
  playedGameCount: number;
  lastPlayed: { gameId: string; lastPlayedAt: string } | null;
  mostPlayed: { gameId: string; totalPlaytimeSeconds: number } | null;
  recent: { gameId: string; lastPlayedAt: string }[];
  games: GamePlayAggregate[];
};

export type PlaySessionStart = {
  id: string;
  gameId: string;
  startedAt: string;
};
