export type {
  RaAdapterKind,
  RaContentPlatform,
  RetroAchievementsAdapter,
  RetroAchievementsIdentification,
  RetroAchievementsState,
} from "./types";
export {
  adapterSupportsContentIdentification,
  isPcsx2Runtime,
  isRaCapableRuntime,
  isRetroArchRuntime,
  resolveRaAdapter,
  resolveRaAdapterKind,
} from "./resolveAdapter";
export { pcsx2Adapter } from "./pcsx2Adapter";
export { retroArchAdapter } from "./retroArchAdapter";
