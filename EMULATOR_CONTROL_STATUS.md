# Estado de Implementación - Control Automático de Emuladores

## ✅ Completado

### Backend Rust

**emulator_transport.rs** - Transporte IPC
- [x] PINE protocol (TCP) para PCSX2
  - Puerto base 28011 + slot
  - Comandos: MsgRead (status), MsgSaveState, MsgLoadState
  - Timeout 2s, respuestas confirmed
- [x] RetroArch UDP Network Commands
  - Puerto 55355
  - Comandos: VERSION, GET_STATUS, PAUSE_TOGGLE, SAVE_STATE, LOAD_STATE
  - Fire-and-forget (delivery: sent)
- [x] Eden process check
  - Verificación de PID (Windows/Linux)
  - Sin IPC real en v0.2.1
- [x] Comandos Tauri expuestos
  - `emulator_transport_send`
  - `emulator_transport_probe_retroarch`
  - `emulator_transport_check_process`

**emulator_full_config.rs** - Configuración automática
- [x] Estructura EmulatorConfig completa
  - Video: fullscreen, resolution_scale (1-8x), renderer, vsync
  - Audio: engine, device, volume (0-100)
  - UI: language, show_fps, show_notifications
  - Hotkeys: save, load, pause, exit, fullscreen
  - Controller: profiles
- [x] Defaults por emulador
  - PCSX2: D3D11, 2x scale, español
  - RetroArch: D3D11, 2x scale, español
  - Eden: Vulkan, 2x scale, español
- [x] Capacidades documentadas
  - EmulatorConfigCapabilities por cada uno
  - Renderers disponibles, idiomas, límites
- [x] Funciones de aplicación
  - `apply_pcsx2_config`: INI completo (UI, GS, Audio, Hotkeys)
  - `apply_retroarch_config`: CFG completo (video, audio, UI, network)
  - `apply_eden_config`: INI completo (UI, Renderer, Audio)
- [x] Comandos Tauri expuestos
  - `get_emulator_config_capabilities`
  - `get_default_emulator_config`
  - `apply_emulator_config`

### Frontend TypeScript

**realTransport.ts**
- [x] `createRealTransport`: wrapper de comandos Tauri
- [x] `probeRetroArchTransport`: detección UDP
- [x] `checkProcessAlive`: verificación de proceso

**pcsx2Adapter.ts**
- [x] EmulatorAdapter completo para PCSX2
- [x] launch con PINE habilitado (`-pine=0`)
- [x] stop con cleanup de transport
- [x] saveState/loadState via PINE
- [x] status via PINE con parsing de respuesta
- [x] Gestión de handles y transports

## 🚧 Pendiente (En progreso)

### Adapters TypeScript

**retroarchAdapter.ts** - FALTA CREAR
- [ ] EmulatorAdapter para RetroArch
- [ ] launch con network commands habilitado
- [ ] stop con cleanup
- [ ] pause via UDP (PAUSE_TOGGLE)
- [ ] saveState/loadState via UDP
- [ ] status via UDP (GET_STATUS)
- [ ] Gestión de handles

**edenAdapter.ts** - FALTA CREAR
- [ ] EmulatorAdapter para Eden
- [ ] launch normal (sin IPC)
- [ ] stop via process kill
- [ ] pause: NO SOPORTADO (documentar)
- [ ] saveState/loadState: NO SOPORTADO (documentar)
- [ ] status via process check (running/not_running)
- [ ] Gestión básica de proceso

### Integración

**resolveControlAdapter.ts** - ACTUALIZAR
- [ ] Usar adapters reales en lugar de fake cuando ipcEnabled=true
- [ ] PCSX2: createPcsx2Adapter() si managed
- [ ] RetroArch: createRetroarchAdapter() si managed
- [ ] Eden: createEdenAdapter() si managed
- [ ] Fallback a fake si manual o error

**Configuración automática** - SERVICIOS TS
- [ ] Servicio para leer/escribir configuración desde UI
- [ ] `emulatorConfigService.ts`:
  - getConfig(runtimeId)
  - saveConfig(runtimeId, config)
  - getCapabilities(runtimeId)
  - getDefaults(runtimeId)
- [ ] UI en Settings para editar perfiles
- [ ] Aplicar config antes del primer launch

### Pre-launch Config

**emulator_data.rs** - EXTENDER
- [ ] `ensure_emulator_configured`:
  - Verificar si existe config
  - Si no, aplicar defaults
  - Llamar antes de launch
- [ ] Integrar con `prepare_runtime_launch`

## 📋 Capacidades Documentadas

### PCSX2

**Soportado:**
- ✅ Resolution scale: 1-8x Native
- ✅ Renderers: Auto, D3D11, D3D12, OpenGL, Vulkan
- ✅ VSync: Sí
- ✅ Audio engine: XAudio2, WASAPI
- ✅ Hotkeys: Configurables via INI
- ✅ Controller profiles: Sí
- ✅ Control IPC: PINE (save/load state, status)

**No soportado:**
- ❌ UI language: PCSX2 no tiene config de idioma
- ❌ Pause toggle: No via PINE (solo estados)

### RetroArch

**Soportado:**
- ✅ Resolution scale: Variable por core (1-8x)
- ✅ Renderers: Auto, D3D11, OpenGL, Vulkan
- ✅ VSync: Sí
- ✅ Audio engine: WASAPI, XAudio
- ✅ UI language: EN, ES, PT, FR, DE
- ✅ Hotkeys: Configurables via CFG
- ✅ Controller profiles: Sí
- ✅ Control IPC: UDP (pause, save/load, status)

**No soportado:**
- ❌ Confirmed delivery: UDP es fire-and-forget

### Eden (v0.2.1)

**Soportado:**
- ✅ Resolution scale: 1-4x Native
- ✅ Renderers: Vulkan, OpenGL
- ✅ VSync: Sí
- ✅ UI language: EN, ES, JA
- ✅ Fullscreen: Sí

**No soportado:**
- ❌ Audio engine: Usa audio del sistema
- ❌ Hotkeys: No configurables en v0.2.1
- ❌ Controller profiles: No configurables
- ❌ IPC: Sin API de control en v0.2.1
- ❌ Pause: Solo via kill/resume proceso (no implementado)
- ❌ Save states: No disponible via IPC

### Limitaciones de Eden

Eden v0.2.1 no tiene una API de control IPC. Las opciones son:

1. **Solo gestión de proceso** (implementado):
   - Verificar si está corriendo (PID check)
   - Cerrar el proceso (kill)
   - Status: running/not_running

2. **Posibles mejoras futuras**:
   - Ventana: minimizar, restaurar (Win32 API)
   - Memoria: pause/resume thread (muy invasivo)
   - Esperarversión futura de Eden con IPC

## 🎯 Próximos Pasos

1. **Crear adapters faltantes**
   - retroarchAdapter.ts (con UDP)
   - edenAdapter.ts (process-only)

2. **Integrar en resolveControlAdapter**
   - Usar reales en lugar de fake
   - Fallback apropiado

3. **Servicio de configuración TS**
   - CRUD de perfiles
   - UI en Settings

4. **Pre-launch config**
   - Aplicar defaults automáticamente
   - Primera vez sin intervención

5. **Testing**
   - Unit tests con fake transport
   - Integration tests en Windows

6. **Documentación**
   - Actualizar PR con capacidades
   - Guía de pruebas actualizada
   - Limitaciones de Eden

## 📝 Notas de Implementación

### PINE Protocol (PCSX2)
- Socket TCP en 127.0.0.1:28011
- Mensajes null-terminated
- Responses pueden ser vacías o con payload
- Timeout: 2 segundos

### RetroArch UDP
- Socket UDP en 127.0.0.1:55355
- Comandos con `\n` al final
- No hay respuesta (fire-and-forget)
- Timeout: 1 segundo (para probe)

### Eden Process Management
- Windows: OpenProcess con PROCESS_QUERY_LIMITED_INFORMATION
- Linux: `ps -p <pid>`
- Status solo indica si está corriendo
- Sin control fino (pause/resume/save)

### Configuración Automática

Todos los emuladores se configuran antes del primer launch:
1. Detectar si existe config
2. Si no existe, crear con defaults
3. Aplicar valores de Blaze (no del emulador)
4. Usuario nunca ve UI de configuración del emulador

Valores por defecto sensatos:
- Fullscreen: Sí
- Resolution: 2x (balance calidad/rendimiento)
- Audio: 80% volumen
- Idioma: Español
- VSync: Sí (menos tearing)
- Renderer: D3D11 (PCSX2/RA), Vulkan (Eden)
