# Vendor Onboarding - Guía de Pruebas

## Contexto

Este branch implementa la descarga completa de **todos los emuladores** (PCSX2, RetroArch, Eden) y sus assets (BIOS/keys/firmware) desde el backend/manifiesto tras el primer login. El instalador es mínimo (~200 MB) y solo contiene la app Tauri.

## Arquitectura

### Instalador
- **Solo contiene:** Frontend Tauri + estructura de carpetas (.gitkeep)
- **NO contiene:** Emuladores, BIOS, keys, firmware, ni packs offline
- **Tamaño esperado:** ~200 MB (vs ~700 MB anterior)

### Primera ejecución
1. Usuario instala Blaze
2. Hace login con RetroAchievements
3. Aparece pantalla "Preparando Blaze..."
4. Descarga en paralelo:
   - **PCSX2** desde GitHub (manifiesto embebido)
   - **RetroArch** + cores desde buildbot.libretro.com (manifiesto)
   - **Eden** desde git.eden-emu.dev (manifiesto)
   - **BIOS PCSX2** desde backend `/api/vendor/manifest`
   - **BIOS PS1** desde backend
   - **Keys Eden** desde backend
   - **Firmware Eden** desde backend

### Ejecuciones siguientes
- Verifica rápidamente que todo esté presente
- No muestra pantalla de onboarding
- Va directo a la biblioteca

## Backend requerido (Contrato Real)

**Referencia:** Blaze-back PR #1, rama `cursor/vendor-assets-b423`

El backend debe implementar el endpoint:

```
GET /api/vendor/manifest
Authorization: Bearer <token>
```

Response esperado (contrato real):

```json
{
  "items": [
    {
      "kind": "bios_ps2",
      "downloadUrl": "https://pub-xxxxx.r2.dev/pcsx2-bios.7z?X-Amz-...",
      "fileSizeBytes": "5242880",
      "fileName": "pcsx2-bios.7z",
      "sha256": "abc123...",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "kind": "bios_ps1",
      "downloadUrl": "https://pub-xxxxx.r2.dev/SCPH1001.bin?X-Amz-...",
      "fileSizeBytes": "524288",
      "fileName": "SCPH1001.bin",
      "sha256": "def456...",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "kind": "switch_keys",
      "downloadUrl": "https://pub-xxxxx.r2.dev/eden-keys.7z?X-Amz-...",
      "fileSizeBytes": "1048576",
      "fileName": "eden-keys.7z",
      "sha256": "ghi789...",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "kind": "switch_firmware",
      "downloadUrl": "https://pub-xxxxx.r2.dev/eden-firmware.7z?X-Amz-...",
      "fileSizeBytes": "157286400",
      "fileName": "eden-firmware.7z",
      "sha256": "jkl012...",
      "expiresAt": "2026-10-15T12:00:00Z"
    }
  ]
}
```

### Campos del contrato

- **`kind`**: `bios_ps2`, `bios_ps1`, `switch_keys`, `switch_firmware`, `other` (guiones bajos)
- **`downloadUrl`**: URL presignada de Cloudflare R2 (termina en `?X-Amz-...`)
- **`fileSizeBytes`**: String con el tamaño en bytes
- **`fileName`**: Nombre real del archivo (se usa para guardar con ese nombre)
- **`sha256`**: Hash SHA256 hexadecimal para verificación
- **`expiresAt`** (opcional): Timestamp ISO 8601 de expiración de la URL

### Cambios vs versión anterior

- ✅ `{ items: [...] }` en lugar de `{ assets: [...] }`
- ✅ Kinds con guiones bajos: `bios_ps2`, `bios_ps1`, `switch_keys`, `switch_firmware`
- ✅ `downloadUrl` (no `url`), `fileSizeBytes` (string), `fileName`
- ❌ Eliminados campos: `id`, `name` (no necesarios)

## Tipos de assets

- **`bios_ps2`**: BIOS de PS2 (7z → `%APPDATA%\com.blaze.app\emulator-data\pcsx2\PCSX2\bios\`)
- **`bios_ps1`**: BIOS de PS1 (bin que va a `%APPDATA%\Blaze\emulator-data\retroarch\system\`)
- **`switch_keys`**: Keys de Switch (7z → `%APPDATA%\Blaze\emulator-data\eden\keys\`)
- **`switch_firmware`**: Firmware de Switch (7z → `%APPDATA%\Blaze\emulator-data\eden\nand\system\Contents\registered\`)

### Nota sobre destinos

Assets van a **AppData** (`emulator-data/`), **NO** a Resources. Esto permite actualización sin permisos de admin.

## Desarrollo sin backend

**IMPORTANTE:** El frontend ya NO tiene mock ni fallback. Si no hay backend, la app falla al intentar obtener el manifiesto.

Para desarrollo local:
1. Implementar endpoint `/api/vendor/manifest` en backend local
2. O usar un mock server (ej: json-server, msw) que devuelva el contrato correcto

## Preparación del ambiente

### Ya NO es necesario Release vendor

El instalador ya no depende de ningún asset externo. Todo se descarga en runtime.

### Verificar runtimes.manifest.json

Debe incluir Eden con URL y hash válidos:

```json
{
  "id": "eden",
  "version": "0.2.1",
  "url": "https://git.eden-emu.dev/eden-emu/eden/releases/download/v0.2.1/Eden-Windows-v0.2.1-amd64-msvc-standard.zip",
  "sha256": "ff498e5da9630216926ac3cbe9fb493b14930665c728a40a8f5b59507fdd7ebf",
  "hash_origin": "computed-locally",
  "archive": "zip",
  "exe": "eden.exe",
  ...
}
```

## Pruebas en Windows Sandbox

### 1. Generar instalador

```powershell
# Desde la rama cursor/vendor-onboarding-hardening-2738
npm ci
npm run build
cd src-tauri
cargo build --release
```

El instalador estará en `src-tauri/target/release/bundle/nsis/`

### 2. Instalar en Windows limpio

1. Abrir Windows Sandbox
2. Copiar el instalador
3. Ejecutar el instalador
4. Verificar tamaño (~200 MB, mucho menor que antes)
5. Verificar que NO existen emuladores en la carpeta de instalación

### 3. Primera ejecución

1. Iniciar Blaze
2. Hacer login con RetroAchievements
3. **Debe aparecer** la pantalla "Preparando Blaze..."
4. Debe mostrar progreso de descarga de múltiples componentes:
   - "PCSX2" (emulador)
   - "RetroArch" (emulador)
   - "Eden" (emulador)
   - "PCSX2 BIOS Pack"
   - "RetroArch PS1 BIOS"
   - "Eden Keys"
   - "Eden Firmware"
5. Barra de progreso debe avanzar para cada componente
6. Al terminar, debe continuar a la biblioteca
7. **Verificar que todos los emuladores se instalaron en `%APPDATA%\Blaze\runtimes\`**

### 4. Segunda ejecución

1. Cerrar Blaze
2. Volver a abrir
3. **NO debe aparecer** la pantalla de onboarding
4. Debe ir directo a la biblioteca

### 5. Verificar emuladores en AppData

Todos los emuladores deben estar en `%APPDATA%\Blaze\runtimes\`:

```
%APPDATA%\Blaze\runtimes\
├── pcsx2\
│   └── 2.8.2\
│       ├── pcsx2-qt.exe
│       └── .installed.json
├── retroarch\
│   └── 1.22.2\
│       ├── retroarch.exe
│       ├── cores\
│       └── .installed.json
└── eden\
    └── 0.2.1\
        ├── eden.exe
        └── .installed.json
```

### 6. Verificar assets vendor en AppData managed

BIOS, keys y firmware deben estar en las mismas carpetas que usa el launch:

#### PCSX2
```
%APPDATA%\com.blaze.app\emulator-data\pcsx2\PCSX2\bios\
```
- Debe haber archivos .bin de BIOS de PS2
- `PCSX2.ini` en `...\pcsx2\PCSX2\inis\` con `SettingsVersion=1`
- Intentar lanzar un juego de PS2 (sin setup wizard)

#### RetroArch PS1
```
%APPDATA%\com.blaze.app\emulator-data\retroarch\system\
```
- Debe haber archivos como `scph1001.bin`
- Intentar lanzar un juego de PS1

#### Eden Switch
```
%APPDATA%\com.blaze.app\emulator-data\eden\keys\
%APPDATA%\com.blaze.app\emulator-data\eden\nand\system\Contents\registered\
```
- Intentar lanzar un juego de Switch

### 7. Verificar que el usuario NO ve carpetas de emuladores

- La carpeta de instalación de Blaze (ej. `C:\Program Files\Blaze`) debe ser mínima
- No debe haber subcarpetas de emuladores visibles
- Todo debe estar en `%APPDATA%\Blaze\` (carpeta oculta del sistema)

### 8. Manejo de errores

#### Sin conexión
1. Desconectar Internet
2. Hacer login
3. Debe mostrar error claro: "Sin token de autenticación" o "Sin conexión"
4. Botón "Reintentar" debe estar visible

#### Backend caído
1. Detener el backend o no tener endpoint `/api/vendor/manifest`
2. Hacer login
3. Debe mostrar error claro (ya NO hay fallback a mock)
4. App no continúa hasta que el backend responda

## Verificación de seguridad

### Paths restringidos

Intentar desde la consola del navegador (F12):

```javascript
// Esto debe fallar (fuera de scope):
await window.__TAURI__.core.invoke('remove_path', { 
  path: 'C:\\Windows\\System32\\evil.dll' 
});

// Esto debe funcionar (dentro de catalog-games):
await window.__TAURI__.core.invoke('catalog_games_dir', {});
// Usar la ruta devuelta + '/test.txt'
```

### CSP

1. Abrir consola del navegador
2. No debe haber errores de CSP bloqueando recursos legítimos
3. Verificar que los estilos y scripts inline funcionan

### Allowlist de hosts

Verificar que SOLO estos hosts son permitidos:
- `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`
- `buildbot.libretro.com`
- `git.eden-emu.dev`
- `*.r2.cloudflarestorage.com` (Cloudflare R2 para assets vendor - URLs presignadas)
- `*.r2.dev` (Cloudflare R2 public domains - opcional)

**URLs presignadas de R2:** El backend firma las URLs con el endpoint de Cloudflare R2:
```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com/path/to/file?X-Amz-Algorithm=...
```

Intentar descargar desde otro host debe fallar con "Host no permitido".

**Tests de matching:**
- ✅ `abc123.r2.cloudflarestorage.com` → permitido
- ✅ `pub-xyz.r2.dev` → permitido
- ❌ `evil.com` → rechazado
- ❌ `not-r2.cloudflarestorage.com` → rechazado (no termina en `.r2.cloudflarestorage.com`)
- ❌ `r2.cloudflarestorage.com` → rechazado (sin subdomain)
- ❌ HTTP → rechazado (solo HTTPS)

### Verificación de archivos Eden

1. Ir a `%APPDATA%\Blaze\emulator-data\eden\keys\`
2. Debe existir `prod.keys` con tamaño >32 bytes
3. Ir a `%APPDATA%\Blaze\emulator-data\eden\nand\system\Contents\registered\`
4. Debe haber archivos `.nca` (firmware)

Si solo hay placeholders vacíos, la verificación debe fallar.

## Rollback en caso de problemas

Si algo falla críticamente:

1. Hacer checkout de `dev`
2. Regenerar instalador con el workflow anterior (incluye BIOS embebidas)
3. El flujo anterior sigue funcionando

## Cambios clave en esta versión

### Contrato backend actualizado
- ✅ `{ items: [...] }` en lugar de `{ assets: [...] }`
- ✅ Kinds: `bios_ps2`, `bios_ps1`, `switch_keys`, `switch_firmware`
- ✅ `downloadUrl`, `fileSizeBytes`, `fileName`
- ✅ Sin mocks ni fallbacks en release

### Seguridad mejorada
- ✅ Límite 500 MB por asset (alineado con backend)
- ✅ Wildcard `*.r2.cloudflarestorage.com` (URLs presignadas del backend)
- ✅ Wildcard `*.r2.dev` (dominios públicos opcionales)
- ✅ Matching estricto: requiere subdomain válido
- ✅ Detección de formato por fileName (evita problemas con query params)
- ✅ Archivos guardados con nombre real
- ✅ Destino AppData (no Resources)

### Verificación real
- ✅ Eden keys verificados: `prod.keys` >32 bytes
- ✅ Eden firmware verificado: archivos `.nca` presentes
- ❌ Sin placeholders ni "asumir listo"

### Compilación y tests
- ✅ `cargo check`: PASSED (solo warnings de unused vars)
- ✅ `cargo test secure_download`: 7/7 tests passing
- ✅ TypeScript compila sin errores
- ✅ Dependencias del sistema instaladas (Linux)

## Checklist de pruebas

- [ ] Instalador generado correctamente
- [ ] Tamaño del instalador mínimo (~200 MB)
- [ ] Instalador NO contiene emuladores ni assets
- [ ] Primera ejecución muestra onboarding
- [ ] Progreso de descarga visible para todos los componentes
- [ ] PCSX2 descargado e instalado en `%APPDATA%\Blaze\runtimes\pcsx2\`
- [ ] RetroArch descargado e instalado en `%APPDATA%\Blaze\runtimes\retroarch\`
- [ ] Eden descargado e instalado en `%APPDATA%\Blaze\runtimes\eden\`
- [ ] BIOS PCSX2 descargada en `%APPDATA%\com.blaze.app\emulator-data\pcsx2\PCSX2\bios\`
- [ ] BIOS PS1 descargada en `%APPDATA%\com.blaze.app\emulator-data\retroarch\system\`
- [ ] Keys Eden descargadas en `%APPDATA%\com.blaze.app\emulator-data\eden\keys\`
- [ ] PCSX2.ini tiene `SettingsVersion=1` (sin setup wizard)
- [ ] Firmware Eden en `%APPDATA%\com.blaze.app\emulator-data\eden\nand\system\Contents\registered\`
- [ ] Segunda ejecución **no** muestra onboarding
- [ ] PCSX2 funciona (lanza juegos de PS2)
- [ ] RetroArch PS1 funciona (lanza juegos de PS1)
- [ ] Eden Switch funciona (lanza juegos de Switch)
- [ ] Usuario NO ve carpetas de emuladores en instalación
- [ ] Todo está en AppData (carpeta oculta)
- [ ] Manejo de errores funciona (sin conexión)
- [ ] Botón reintentar funciona
- [ ] Seguridad: paths restringidos
- [ ] CSP no bloquea funcionalidad

## Problemas conocidos

### Descargas en serie vs paralelo

Actualmente los emuladores y assets se descargan en serie (uno después del otro). Para mejorar la experiencia:

1. Descargar emuladores en paralelo (3 threads)
2. Luego descargar assets vendor en paralelo
3. Mostrar progreso global y por componente

### Tiempo de primera ejecución

Con conexión lenta, la primera ejecución puede tardar varios minutos:
- PCSX2: ~60 MB
- RetroArch: ~300 MB
- Eden: ~60 MB
- Assets vendor: ~20 MB
- **Total: ~440 MB de descarga**

### Verificación de integridad

Si una descarga falla a mitad, el sistema la reintenta automáticamente pero no resume desde donde quedó. Mejoras futuras:
- Download resumible (HTTP Range requests)
- Cache de archivos parciales válidos

## Contacto

Si hay problemas con las pruebas, revisar:
- Logs de Tauri en `%APPDATA%\Blaze\logs\`
- Consola del navegador (F12)
- Network tab para ver requests fallidos
