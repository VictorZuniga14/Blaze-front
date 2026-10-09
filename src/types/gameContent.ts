export type GameContent = {
  id: string;
  gameId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type GameContentInput = {
  gameId: string;
  path: string;
};
