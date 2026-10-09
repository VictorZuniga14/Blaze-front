import type { Runtime } from "../../types/runtime";
import { pcsx2Adapter } from "./pcsx2Adapter";
import { retroArchAdapter } from "./retroArchAdapter";
import {
  adapterSupportsContentIdentification,
  isPcsx2Runtime,
  isRaCapableRuntime,
  isRetroArchRuntime,
  resolveRaAdapterKind,
} from "./adapterKind";
import type { RaAdapterKind, RetroAchievementsAdapter } from "./types";

export {
  adapterSupportsContentIdentification,
  isPcsx2Runtime,
  isRaCapableRuntime,
  isRetroArchRuntime,
  resolveRaAdapterKind,
};

const ADAPTERS: Record<RaAdapterKind, RetroAchievementsAdapter> = {
  pcsx2: pcsx2Adapter,
  retroarch: retroArchAdapter,
};

export function resolveRaAdapter(
  runtime: Runtime | null | undefined,
): RetroAchievementsAdapter | null {
  const kind = resolveRaAdapterKind(runtime);
  if (!kind) return null;
  return ADAPTERS[kind];
}
