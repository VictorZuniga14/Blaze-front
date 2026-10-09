<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../stores/auth";
import { retroAchievementsApiService } from "../services/retroAchievementsApi.service";
import { raAvatarUrl } from "../utils/raAvatar";
import {
  formatMemberSince,
  formatRelativeTimeEs,
} from "../utils/relativeTime.es";
import type { RaUserProfile } from "../types/retroAchievements";

const PROFILE_POLL_MS = 45_000;

const auth = useAuthStore();
const { user } = storeToRefs(auth);

const profile = ref<RaUserProfile | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const avatarBroken = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const avatarSrc = computed(() => {
  if (profile.value?.avatarUrl) return profile.value.avatarUrl;
  if (user.value?.username) return raAvatarUrl(user.value.username);
  return "";
});

const displayName = computed(
  () => profile.value?.username || user.value?.username || "",
);

const isOnline = computed(() => {
  const status = profile.value?.status?.trim().toLowerCase() ?? "";
  return status === "online";
});

/** RA deja el último RichPresence aunque estés Offline; solo mostrar si Online. */
const livePresence = computed(() => {
  if (!isOnline.value) return null;
  const msg = profile.value?.richPresence?.trim();
  return msg || null;
});

const rankLabel = computed(() => {
  if (!profile.value) return "—";
  if (
    profile.value.siteRank == null ||
    profile.value.points < profile.value.rankRequiresPoints
  ) {
    return `Se requieren al menos ${profile.value.rankRequiresPoints} puntos.`;
  }
  return `#${profile.value.siteRank.toLocaleString("es-CL")}`;
});

const retroRatioLabel = computed(() => {
  if (profile.value?.retroRatio == null) return "ninguno";
  return profile.value.retroRatio.toFixed(2);
});

async function load(refresh = false, silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = null;
  }
  try {
    profile.value = await retroAchievementsApiService.getProfile(refresh);
  } catch (err) {
    if (!silent) {
      error.value =
        err instanceof Error ? err.message : "No se pudo cargar el perfil.";
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    void load(true, true);
  }
}

onMounted(() => {
  void load();
  pollTimer = setInterval(() => {
    void load(true, true);
  }, PROFILE_POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <main class="profile-page">
    <p v-if="error" class="profile-error">{{ error }}</p>
    <p v-else-if="loading" class="profile-muted">Cargando perfil...</p>

    <template v-else-if="profile">
      <section class="profile-hero">
        <img
          v-if="avatarSrc && !avatarBroken"
          class="profile-hero__avatar"
          :src="avatarSrc"
          :alt="displayName"
          @error="avatarBroken = true"
        />
        <div v-else class="profile-hero__avatar profile-hero__avatar--fallback">
          {{ displayName.charAt(0).toUpperCase() || "?" }}
        </div>

        <div class="profile-hero__meta">
          <h1 class="profile-hero__name">{{ displayName }}</h1>
          <p v-if="profile.motto" class="profile-hero__motto">{{ profile.motto }}</p>
          <ul class="profile-hero__stats">
            <li>
              <span>Puntos:</span>
              {{ profile.points.toLocaleString("es-CL") }}
            </li>
            <li>
              <span>Ranking del sitio:</span>
              <em>{{ rankLabel }}</em>
            </li>
            <li>
              <span>Última actividad:</span>
              {{ formatRelativeTimeEs(profile.lastActivityAt) }}
            </li>
            <li>
              <span>Miembro desde:</span>
              {{ formatMemberSince(profile.memberSince) }}
            </li>
          </ul>
        </div>
      </section>

      <div class="profile-layout">
        <div class="profile-main">
          <section class="profile-panel">
            <header class="profile-panel__head">
              <h2>Estadísticas del usuario</h2>
            </header>

            <h3 class="profile-panel__sub">Estadísticas del jugador</h3>
            <div class="profile-grid">
              <div class="stat-row">
                <span>Logros desbloqueados</span>
                <span class="stat-row__dots" />
                <strong>—</strong>
              </div>
              <div class="stat-row">
                <span>Total de juegos completados</span>
                <span class="stat-row__dots" />
                <strong>{{ profile.gamesBeaten }}</strong>
              </div>
              <div class="stat-row">
                <span>RetroRatio</span>
                <span class="stat-row__dots" />
                <strong>{{ retroRatioLabel }}</strong>
              </div>
              <div class="stat-row">
                <span>Maestrías</span>
                <span class="stat-row__dots" />
                <strong>{{ profile.masteryAwards }}</strong>
              </div>
              <div class="stat-row">
                <span>Puntos softcore</span>
                <span class="stat-row__dots" />
                <strong>{{ profile.softcorePoints.toLocaleString("es-CL") }}</strong>
              </div>
              <div class="stat-row">
                <span>RetroPoints</span>
                <span class="stat-row__dots" />
                <strong>{{ profile.truePoints.toLocaleString("es-CL") }}</strong>
              </div>
            </div>

            <h3 class="profile-panel__sub">Social</h3>
            <div class="profile-grid">
              <div class="stat-row">
                <span>Publicaciones en el foro</span>
                <span class="stat-row__dots" />
                <strong>—</strong>
              </div>
              <div class="stat-row">
                <span>Sets de logros solicitados</span>
                <span class="stat-row__dots" />
                <strong>—</strong>
              </div>
            </div>
            <p class="profile-note">
              Algunos datos sociales no los entrega la API pública de RetroAchievements.
            </p>
          </section>

          <section class="profile-panel">
            <header class="profile-panel__head">
              <h2>
                Últimos {{ profile.recentGames.length }} juegos jugados
              </h2>
            </header>

            <ul v-if="profile.recentGames.length" class="recent-games">
              <li
                v-for="game in profile.recentGames"
                :key="game.raGameId"
                class="recent-games__item"
              >
                <img
                  v-if="game.imageIcon"
                  class="recent-games__icon"
                  :src="game.imageIcon"
                  :alt="game.title"
                />
                <div>
                  <p class="recent-games__title">{{ game.title }}</p>
                  <p class="recent-games__meta">
                    {{ game.consoleName || "—" }}
                    ·
                    {{ formatRelativeTimeEs(game.lastPlayed) }}
                  </p>
                </div>
              </li>
            </ul>
            <p v-else class="profile-muted">Todavía no hay juegos jugados recientes.</p>
          </section>

          <section class="profile-panel">
            <header class="profile-panel__head">
              <h2>Muro del usuario</h2>
            </header>
            <p class="profile-muted">Sin comentarios</p>
            <p class="profile-note">
              El muro de comentarios no está disponible desde la API pública.
            </p>
          </section>
        </div>

        <aside class="profile-side">
          <section class="profile-panel">
            <header class="profile-panel__head">
              <h2>Progreso reciente</h2>
            </header>
            <p class="profile-muted">
              <template v-if="livePresence">
                {{ livePresence }}
              </template>
              <template v-else>
                Sin actividad ahora.
              </template>
            </p>
          </section>

          <section class="profile-panel">
            <header class="profile-panel__head">
              <h2>Estado</h2>
            </header>
            <p class="profile-muted">
              {{ profile.status || "Desconocido" }}
            </p>
          </section>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.profile-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}

.profile-error {
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.12);
  color: #fecdd3;
  font-size: 14px;
}

.profile-muted {
  margin: 0;
  color: #8ba3bc;
  font-size: 14px;
}

.profile-note {
  margin: 12px 0 0;
  color: #6f8499;
  font-size: 12px;
}

.profile-hero {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 22px;
}

.profile-hero__avatar {
  width: 84px;
  height: 84px;
  border-radius: 2px;
  object-fit: cover;
  background: #1b2838;
  flex-shrink: 0;
}

.profile-hero__avatar--fallback {
  display: grid;
  place-items: center;
  background: #1a9fff;
  color: #fff;
  font-size: 32px;
  font-weight: 700;
}

.profile-hero__name {
  margin: 0 0 4px;
  color: #66c0f4;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
}

.profile-hero__motto {
  margin: 0 0 10px;
  color: #9fb4c8;
  font-size: 14px;
  font-style: italic;
}

.profile-hero__stats {
  margin: 0;
  padding: 0;
  list-style: none;
  color: #9ec8e6;
  font-size: 14px;
  line-height: 1.55;
}

.profile-hero__stats span {
  color: #66c0f4;
  margin-right: 4px;
}

.profile-hero__stats em {
  font-style: italic;
  color: #9ec8e6;
}

.profile-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
}

.profile-main,
.profile-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.profile-panel {
  border: 1px solid rgba(102, 192, 244, 0.12);
  background: rgba(16, 24, 34, 0.9);
  padding: 14px 16px 16px;
}

.profile-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.profile-panel__head h2 {
  margin: 0;
  color: #66c0f4;
  font-size: 18px;
  font-weight: 600;
}

.profile-panel__sub {
  margin: 8px 0 10px;
  color: #8ec8ef;
  font-size: 13px;
  font-weight: 600;
}

.profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}

.stat-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: #b7c9da;
  font-size: 13px;
}

.stat-row__dots {
  flex: 1;
  min-width: 12px;
  border-bottom: 1px dotted rgba(142, 168, 190, 0.45);
  transform: translateY(-4px);
}

.stat-row strong {
  color: #e8f1f8;
  font-weight: 600;
}

.recent-games {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.recent-games__item {
  display: flex;
  gap: 10px;
  align-items: center;
}

.recent-games__icon {
  width: 40px;
  height: 40px;
  border-radius: 2px;
  object-fit: cover;
  background: #0f1720;
}

.recent-games__title {
  margin: 0;
  color: #e8f1f8;
  font-size: 14px;
}

.recent-games__meta {
  margin: 2px 0 0;
  color: #8ba3bc;
  font-size: 12px;
}

@media (max-width: 860px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }

  .profile-grid {
    grid-template-columns: 1fr;
  }
}
</style>
