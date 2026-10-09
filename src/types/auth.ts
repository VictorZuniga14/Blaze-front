export type UserRole = "user" | "dev";

export type PublicUser = {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
};

export type AuthResponse = {
  user: PublicUser;
  token: string;
  expiresAt: string;
};

export type LoginInput = {
  username: string;
  password: string;
};
