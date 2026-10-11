import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import UpdaterApp from "./UpdaterApp.vue";
import { router } from "./router";
import "./style.css";

async function mount(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label === "updater") {
      createApp(UpdaterApp).mount("#app");
      return;
    }
  } catch {
    /* vite en navegador / fuera de Tauri */
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount("#app");
}

void mount();
