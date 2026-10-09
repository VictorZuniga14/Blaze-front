import { load, type Store } from "@tauri-apps/plugin-store";

const TOKEN_KEY = "sessionToken";

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("auth.json", { autoSave: false });
  }
  return storePromise;
}

export const sessionStorage = {
  async getToken(): Promise<string | null> {
    try {
      const store = await getStore();
      const value = await store.get(TOKEN_KEY);
      return typeof value === "string" && value.trim() ? value : null;
    } catch {
      return null;
    }
  },

  async setToken(token: string): Promise<void> {
    const store = await getStore();
    await store.set(TOKEN_KEY, token);
    await store.save();
  },

  async clearToken(): Promise<void> {
    try {
      const store = await getStore();
      await store.delete(TOKEN_KEY);
      await store.save();
    } catch {
      // ignore
    }
  },
};
