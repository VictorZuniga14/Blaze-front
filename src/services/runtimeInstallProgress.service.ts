import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type RuntimeInstallProgressEvent = {
  operationId: string;
  phase: string;
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

export async function listenRuntimeInstallProgress(
  operationId: string,
  onProgress: (p: RuntimeInstallProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeInstallProgressEvent>("runtime-install-progress", (event) => {
    const p = event.payload;
    if (p.operationId !== operationId) return;
    onProgress(p);
  });
}
