import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

export type ControllerLayout = "auto" | "playstation" | "xbox";

export type ControllerPrefs = {
  layout: ControllerLayout;
  preferredDeviceGuid: string | null;
};

const STORE_FILE = "controller-prefs.json";
const PREFS_KEY = "prefs";

const DEFAULTS: ControllerPrefs = {
  layout: "auto",
  preferredDeviceGuid: null,
};

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: false });
  }
  return storePromise;
}

function normalize(raw: unknown): ControllerPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const o = raw as Record<string, unknown>;
  const layout =
    o.layout === "playstation" || o.layout === "xbox" || o.layout === "auto"
      ? o.layout
      : "auto";
  const guid =
    typeof o.preferredDeviceGuid === "string" && o.preferredDeviceGuid.trim()
      ? o.preferredDeviceGuid.trim()
      : null;
  return { layout, preferredDeviceGuid: guid };
}

async function syncRustFile(prefs: ControllerPrefs): Promise<void> {
  await invoke("save_controller_prefs_file", {
    prefs: {
      layout: prefs.layout,
      preferredDeviceGuid: prefs.preferredDeviceGuid,
    },
  });
}

export const controllerPrefsService = {
  async get(): Promise<ControllerPrefs> {
    try {
      const store = await getStore();
      return normalize(await store.get(PREFS_KEY));
    } catch {
      return { ...DEFAULTS };
    }
  },

  async set(prefs: ControllerPrefs): Promise<void> {
    const next = normalize(prefs);
    const store = await getStore();
    await store.set(PREFS_KEY, next);
    await store.save();
    await syncRustFile(next);
  },

  /** Escucha input unos segundos; true si el mando reaccionó. */
  async testPad(preferredDeviceGuid?: string | null): Promise<boolean> {
    return invoke<boolean>("test_game_controller", {
      preferredGuid: preferredDeviceGuid?.trim() || null,
      timeoutMs: 4000,
    });
  },
};
