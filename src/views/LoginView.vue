<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuthStore } from "../stores/auth";

const RA_SIGNUP_URL = "https://retroachievements.org/createaccount.php";

const router = useRouter();
const auth = useAuthStore();

const username = ref("");
const password = ref("");
const formError = ref<string | null>(null);

async function submit() {
  formError.value = null;
  if (!username.value.trim() || !password.value) {
    formError.value =
      "Usuario y contraseña de RetroAchievements son obligatorios.";
    return;
  }
  try {
    await auth.login({
      username: username.value.trim(),
      password: password.value,
    });
    await router.push("/");
  } catch (err) {
    formError.value =
      err instanceof Error ? err.message : "No se pudo iniciar sesión.";
  }
}

async function openRetroAchievementsSignup() {
  try {
    await openUrl(RA_SIGNUP_URL);
  } catch {
    window.open(RA_SIGNUP_URL, "_blank", "noopener,noreferrer");
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-6 py-10">
    <div class="w-full max-w-md">
      <p class="mb-2 text-xs uppercase tracking-[0.3em] text-sky-300/80">Blaze</p>
      <h1 class="mb-2 text-3xl font-semibold text-white">Iniciar sesión</h1>
      <p class="mb-6 text-sm text-slate-400">
        Entrá con tu usuario de RetroAchievements. Al iniciar sesión se
        configura solo en los emuladores de Blaze; la contraseña no se guarda en
        el servidor.
      </p>

      <p
        v-if="formError || auth.error"
        class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      >
        {{ formError || auth.error }}
      </p>

      <form class="space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Usuario</span>
          <input
            v-model="username"
            autocomplete="username"
            required
            maxlength="50"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Contraseña</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <button
          type="submit"
          :disabled="auth.isLoading"
          class="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          {{ auth.isLoading ? "Entrando..." : "Iniciar sesión" }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-slate-400">
        ¿No tienes cuenta?
        <button
          type="button"
          class="text-sky-300 hover:text-sky-200"
          @click="openRetroAchievementsSignup"
        >
          Crearla en RetroAchievements
        </button>
      </p>
    </div>
  </div>
</template>
