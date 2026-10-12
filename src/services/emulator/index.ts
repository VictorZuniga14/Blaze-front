export type {
  EmulatorAdapter,
  EmulatorCapabilities,
  EmulatorControlErrorCode,
  EmulatorControlKind,
  EmulatorControlResult,
  EmulatorStatus,
  ProcessHandle,
  ResolveCapabilitiesInput,
} from "./types";
export {
  EMPTY_CAPABILITIES,
  FULL_RA_CAPABILITIES,
  PCSX2_MANAGED_CAPABILITIES,
} from "./types";

export {
  PINNED_PCSX2_VERSION,
  PINNED_RETROARCH_VERSION,
  controlKindFromType,
  degradedControlMessage,
  resolveCapabilities,
} from "./capabilities";

export type {
  AllowlistedCommand,
  EmulatorTransport,
  TransportDelivery,
  TransportKind,
  TransportResult,
} from "./transport";
export { createFakeTransport } from "./transport";

export {
  createFakeAdapter,
  createLaunchOnlyFakeAdapter,
} from "./fakeAdapter";
export type { FakeAdapterOptions } from "./fakeAdapter";

export { resolveControlAdapter } from "./resolveControlAdapter";
export type { ControlAdapterResolution } from "./resolveControlAdapter";
