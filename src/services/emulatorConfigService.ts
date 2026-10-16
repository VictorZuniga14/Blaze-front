/**
 * Servicio para gestionar la configuración automática de emuladores.
 * Los perfiles se editan desde Blaze, nunca desde el emulador.
 */

import { invoke } from '@tauri-apps/api/core';

// Tipos exportados desde Rust
export interface EmulatorConfig {
  runtimeKind: string;
  
  // Video
  fullscreen: boolean;
  resolutionScale: number;
  renderer: string;
  vsync: boolean;
  
  // Audio
  audioEngine: string;
  audioDevice: string;
  volume: number;
  
  // Controles
  controllerProfile: string;
  
  // UI
  uiLanguage: string;
  showFps: boolean;
  showNotifications: boolean;
  
  // Hotkeys
  hotkeySaveState: string;
  hotkeyLoadState: string;
  hotkeyPause: string;
  hotkeyExit: string;
  hotkeyFullscreen: string;
}

export interface EmulatorConfigCapabilities {
  runtimeKind: string;
  
  // Qué se puede configurar
  supportsResolutionScale: boolean;
  supportsRendererChoice: boolean;
  supportsVsync: boolean;
  supportsAudioEngine: boolean;
  supportsUiLanguage: boolean;
  supportsHotkeys: boolean;
  supportsControllerProfiles: boolean;
  
  // Valores disponibles
  availableRenderers: string[];
  availableLanguages: string[];
  maxResolutionScale: number;
}

/**
 * Obtiene las capacidades de configuración de un emulador.
 */
export async function getEmulatorConfigCapabilities(
  runtimeKind: string
): Promise<EmulatorConfigCapabilities> {
  return await invoke<EmulatorConfigCapabilities>('get_emulator_config_capabilities', {
    runtimeKind,
  });
}

/**
 * Obtiene la configuración por defecto de un emulador.
 */
export async function getDefaultEmulatorConfig(
  runtimeKind: string
): Promise<EmulatorConfig> {
  return await invoke<EmulatorConfig>('get_default_emulator_config', {
    runtimeKind,
  });
}

/**
 * Aplica una configuración a un emulador (escribe archivos de config).
 */
export async function applyEmulatorConfig(
  configPath: string,
  config: EmulatorConfig
): Promise<void> {
  await invoke<void>('apply_emulator_config', {
    configPath,
    config,
  });
}

/**
 * Lee la configuración actual de un emulador desde sus archivos.
 * (Si no existe, retorna defaults)
 */
export async function readEmulatorConfig(
  runtimeKind: string,
  _configPath: string
): Promise<EmulatorConfig> {
  // TODO: Implementar comando Rust para leer config existente
  // Por ahora, retornamos defaults
  return await getDefaultEmulatorConfig(runtimeKind);
}

// Helpers

export function getEmulatorRuntimeKind(runtimeType: string): string {
  switch (runtimeType) {
    case 'pcsx2':
      return 'pcsx2';
    case 'retroarch_ps1':
    case 'retroarch_snes':
      return 'retroarch';
    case 'eden':
      return 'eden';
    default:
      throw new Error(`Tipo de runtime no soportado: ${runtimeType}`);
  }
}

/**
 * Asegura que un emulador esté configurado antes del primer lanzamiento.
 * Si no tiene config, aplica defaults.
 */
export async function ensureEmulatorConfigured(
  runtimeType: string,
  configPath: string
): Promise<void> {
  const kind = getEmulatorRuntimeKind(runtimeType);
  
  // TODO: Verificar si existe config
  // Por ahora, siempre aplicamos defaults
  const defaults = await getDefaultEmulatorConfig(kind);
  await applyEmulatorConfig(configPath, defaults);
}

// Valores por defecto sensatos (documentación)

export const DEFAULT_CONFIG_VALUES = {
  pcsx2: {
    fullscreen: true,
    resolutionScale: 2,       // 2x Native (1920x1056)
    renderer: 'd3d11',        // Direct3D 11
    vsync: true,
    audioEngine: 'xaudio2',
    volume: 80,
    uiLanguage: 'es',
    showFps: false,
  },
  
  retroarch: {
    fullscreen: true,
    resolutionScale: 2,
    renderer: 'd3d11',
    vsync: true,
    audioEngine: 'wasapi',
    volume: 80,
    uiLanguage: 'es',
    showFps: false,
  },
  
  eden: {
    fullscreen: true,
    resolutionScale: 2,       // 2x Native (1920x1080)
    renderer: 'vulkan',
    vsync: true,
    audioEngine: 'auto',      // Eden usa audio del sistema
    volume: 80,
    uiLanguage: 'es',
    showFps: false,
  },
};

// Opciones de renderer por emulador

export const RENDERER_OPTIONS = {
  pcsx2: [
    { value: 'auto', label: 'Automático' },
    { value: 'd3d11', label: 'Direct3D 11 (recomendado)' },
    { value: 'd3d12', label: 'Direct3D 12' },
    { value: 'opengl', label: 'OpenGL' },
    { value: 'vulkan', label: 'Vulkan' },
  ],
  
  retroarch: [
    { value: 'auto', label: 'Automático' },
    { value: 'd3d11', label: 'Direct3D 11 (recomendado)' },
    { value: 'opengl', label: 'OpenGL' },
    { value: 'vulkan', label: 'Vulkan' },
  ],
  
  eden: [
    { value: 'vulkan', label: 'Vulkan (recomendado)' },
    { value: 'opengl', label: 'OpenGL' },
  ],
};

// Opciones de idioma

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ja', label: '日本語' },
];

// Escalas de resolución

export const RESOLUTION_SCALE_OPTIONS = [
  { value: 1, label: '1x Native (960x528 / 1280x720)' },
  { value: 2, label: '2x Native (1920x1056 / 2560x1440) [Recomendado]' },
  { value: 3, label: '3x Native (2880x1584 / 3840x2160)' },
  { value: 4, label: '4x Native (3840x2112 / 5120x2880)' },
  { value: 6, label: '6x Native (5760x3168 / 7680x4320)' },
  { value: 8, label: '8x Native (7680x4224 / 10240x5760)' },
];

// Audio engines

export const AUDIO_ENGINE_OPTIONS = {
  windows: [
    { value: 'auto', label: 'Automático' },
    { value: 'wasapi', label: 'WASAPI (recomendado)' },
    { value: 'xaudio2', label: 'XAudio2' },
  ],
  
  linux: [
    { value: 'auto', label: 'Automático' },
    { value: 'pulse', label: 'PulseAudio' },
    { value: 'alsa', label: 'ALSA' },
  ],
};
