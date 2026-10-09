<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { usePcsx2RaStore } from "../stores/pcsx2Ra";
import { useAuthStore } from "../stores/auth";
import { retroAchievementsApiService } from "../services/retroAchievementsApi.service";
import {
  isPcsx2Runtime,
  isRetroArchRuntime,
} from "../services/raEmulator.service";

const router = useRouter();
const ra = usePcsx2RaStore();
const auth = useAuthStore();
const { entries, status, loading, opening, error, indicator } = storeToRefs(ra);
const { user } = storeToRefs(auth);

const apiConfigured = ref<boolean | null>(null);
const apiStatusError = ref<string | null>(null);

onMounted(() => {
  void ra.refresh();
  void loadApiStatus();
});

async function loadApiStatus() {
  apiStatusError.value = null;
  try {
    const s = await retroAchievementsApiService.getStatus();
    apiConfigured.value = s.apiConfigured;
  } catch {
    apiConfigured.value = null;
    apiStatusError.value =
      "No se pudo consultar el estado de la Web API (¿backend en marcha?).";
  }
}

async function refresh() {
  await Promise.all([ra.refresh(), loadApiStatus()]);
}

function kindLabel(kind: string): string {
  if (kind === "pcsx2") return "PCSX2";
  if (kind === "retroarch") return "RetroArch";
  return kind;
}

function dotClass(color: string): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-400";
    case "rose":
      return "bg-rose-400";
    default:
      return "bg-slate-500";
  }
}

function entryDot(statusCode: string): string {
  switch (statusCode) {
    case "ready":
      return "bg-emerald-400";
    case "disabled":
      return "bg-amber-400";
    case "not_configured":
      return "bg-rose-400";
    default:
      return "bg-slate-500";
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-10">
    <button
      type="button"
      class="mb-6 text-sm text-slate-400 hover:text-white"
      @click="router.push('/')"
    >
      ← Biblioteca
    </button>

    <h1 class="mb-2 text-3xl font-semibold text-white">Configuración</h1>
    <p class="mb-8 text-sm text-slate-400">
      La sesión de Blaze es tu cuenta de RetroAchievements. Los logros dentro
      del juego siguen pidiendo login en el emulador (una vez).
    </p>

    <section class="mb-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <h2 class="mb-1 text-lg font-medium text-white">Blaze</h2>
      <p class="mb-4 text-sm text-slate-400">Sesión de la aplicación.</p>
      <p v-if="user" class="text-sm text-slate-200">
        Conectado como:
        <span class="font-medium text-white">{{ user.username }}</span>
        <span v-if="user.email" class="text-slate-500"> ({{ user.email }})</span>
      </p>
      <p v-else class="text-sm text-slate-400">Sin sesión.</p>
    </section>

    <section class="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-medium text-white">RetroAchievements</h2>
          <p class="mt-1 text-sm text-slate-400">
            Login en el emulador · progreso vía Web API (backend local)
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="loading"
          @click="refresh"
        >
          Actualizar
        </button>
      </div>

      <p
        v-if="error"
        class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      >
        {{ error }}
      </p>

      <div v-if="loading && entries.length === 0" class="py-8 text-center text-slate-400">
        Consultando emuladores...
      </div>

      <template v-else>
        <div class="mb-4 flex items-center gap-3">
          <span
            class="inline-block h-2.5 w-2.5 rounded-full"
            :class="dotClass(indicator.color)"
          />
          <div>
            <p class="text-sm text-slate-300">Mejor estado detectado</p>
            <p class="text-base font-medium text-white">{{ indicator.label }}</p>
          </div>
        </div>

        <ul v-if="entries.length" class="mb-6 space-y-3">
          <li
            v-for="entry in entries"
            :key="entry.runtime.id"
            class="rounded-lg border border-white/10 bg-black/20 px-4 py-3"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="entryDot(entry.status.status)"
                />
                <p class="text-sm font-medium text-white">
                  {{ entry.runtime.name }}
                  <span class="text-xs font-normal text-slate-500">
                    ({{ kindLabel(entry.status.emulatorKind) }})
                  </span>
                </p>
              </div>
              <button
                type="button"
                class="text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50"
                :disabled="opening"
                @click="ra.openEmulator(entry.runtime)"
              >
                Abrir
              </button>
            </div>
            <p class="text-xs text-slate-400">{{ entry.status.statusLabel }}</p>
            <p v-if="entry.status.username" class="text-xs text-slate-300">
              Usuario: {{ entry.status.username }}
            </p>
            <p class="truncate text-xs text-slate-600">
              {{ entry.runtime.executablePath }}
            </p>
          </li>
        </ul>

        <dl class="mb-6 grid gap-3 text-sm text-slate-300">
          <div v-if="status?.username">
            <dt class="text-slate-500">Usuario RA (activo)</dt>
            <dd class="text-white">{{ status.username }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Web API (backend)</dt>
            <dd>
              <template v-if="apiConfigured === true">Configurada</template>
              <template v-else-if="apiConfigured === false">
                Sin API Key en el servidor
              </template>
              <template v-else>Desconocido</template>
            </dd>
          </div>
        </dl>

        <p v-if="apiStatusError" class="mb-4 text-xs text-amber-200/90">
          {{ apiStatusError }}
        </p>

        <div
          class="mb-6 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400"
        >
          <p class="mb-2 font-medium text-slate-300">Cómo configurar</p>
          <ol class="list-decimal space-y-1 pl-4">
            <li>
              Login RA en <strong class="text-slate-300">PCSX2</strong> (Logros) y/o
              <strong class="text-slate-300">RetroArch</strong> (Ajustes → Logros).
            </li>
            <li>
              Web API Key solo en
              <code class="text-slate-300">back/.env</code>
              (<code class="text-slate-300">RETROACHIEVEMENTS_API_KEY</code>).
            </li>
            <li>En cada juego, vinculá el ID oficial de RetroAchievements.</li>
          </ol>
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            :disabled="opening || !entries.some((e) => isPcsx2Runtime(e.runtime))"
            @click="ra.openPcsx2()"
          >
            Abrir PCSX2
          </button>
          <button
            type="button"
            class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            :disabled="
              opening || !entries.some((e) => isRetroArchRuntime(e.runtime))
            "
            @click="ra.openRetroArch()"
          >
            Abrir RetroArch
          </button>
          <button
            type="button"
            class="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
            @click="router.push('/runtimes')"
          >
            Ir a Runtimes
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
