export type LaunchType = "native" | "runtime";

export type ProcessStatus =
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "EXITED"
  | "ERROR";

export type LaunchConfig = {
  id: string;
  gameId: string;
  type: LaunchType;
  executablePath: string | null;
  runtimeId: string | null;
  contentPath: string | null;
  workingDirectory: string | null;
  arguments: string[];
  createdAt: string;
  updatedAt: string;
};

export type LaunchConfigInput = {
  gameId: string;
  type: LaunchType;
  executablePath?: string | null;
  runtimeId?: string | null;
  contentPath?: string | null;
  workingDirectory?: string | null;
  arguments?: string[];
};

export type ActiveProcess = {
  status: ProcessStatus;
  pid: number | null;
  gameId: string | null;
  exitCode: number | null;
};

export type LastProcessResult = {
  pid: number;
  gameId: string;
  exitCode: number | null;
};

export type ProcessExitedEvent = {
  gameId: string;
  pid: number;
  exitCode: number | null;
};
