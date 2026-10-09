export type RuntimeSource = "manual" | "managed";

export type Runtime = {
  id: string;
  name: string;
  type: string;
  executablePath: string;
  /** null/undefined = legacy (tratar como manual). */
  source?: RuntimeSource | null;
  version?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeInput = {
  name: string;
  type?: string;
  executablePath: string;
  source?: RuntimeSource | null;
  version?: string | null;
};

export type InstalledRuntimeInfo = {
  id: string;
  version: string;
  executablePath: string;
  rootPath: string;
};

export type RuntimeManifestInfo = {
  id: string;
  version: string;
  exe: string;
};
