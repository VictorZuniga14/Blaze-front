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

## Backend requerido

El backend debe implementar el endpoint:

```
GET /api/vendor/manifest
Authorization: Bearer <token>
```

Response esperado:

```json
{
  "assets": [
    {
      "id": "pcsx2-bios-pack-v1",
      "kind": "pcsx2-bios",
      "name": "PCSX2 BIOS Pack",
      "size": 5242880,
      "sha256": "hash-sha256-del-archivo",
      "url": "https://storage-presignada.com/pcsx2-bios.7z",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "id": "retroarch-ps1-bios-v1",
      "kind": "retroarch-ps1-bios",
      "name": "RetroArch PS1 BIOS",
      "size": 524288,
      "sha256": "hash-sha256",
      "url": "https://storage.com/ps1-bios.bin",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "id": "eden-keys-pack-v1",
      "kind": "eden-keys",
      "name": "Eden Keys",
      "size": 1048576,
      "sha256": "hash-sha256",
      "url": "https://storage.com/eden-keys.7z",
      "expiresAt": "2026-10-15T12:00:00Z"
    },
    {
      "id": "eden-firmware-pack-v1",
      "kind": "eden-firmware",
      "name": "Eden Firmware",
      "size": 10485760,
      "sha256": "hash-sha256",
      "url": "https://storage.com/eden-firmware.7z",
      "expiresAt": "2026-10-15T12:00:00Z"
    }
  ]
}
```

## Tipos de assets

- `pcsx2-bios`: BIOS de PS2 (7z que se extrae a `resources/pcsx2/bios/`)
- `retroarch-ps1-bios`: BIOS de PS1 (bin que va a `resources/retroarch/system/`)
- `eden-keys`: Keys de Switch (7z → `resources/eden/keys/`)
- `eden-firmware`: Firmware de Switch (7z → `resources/eden/nand/system/Contents/registered/`)

## Desarrollo sin backend

Si el backend no está listo, el código usa mocks internos:

- `src/services/vendorApi.service.ts` tiene URLs de ejemplo
- Los emuladores se descargan del manifiesto embebido (`runtimes.manifest.json`)
- Solo los assets vendor (BIOS/keys/firmware) usan el mock del backend

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

### 6. Verificar assets vendor en resources

BIOS, keys y firmware deben estar en las carpetas de recursos:

#### PCSX2
```
%APPDATA%\Blaze\resources\pcsx2\bios\
```
- Debe haber archivos .bin de BIOS de PS2
- Intentar lanzar un juego de PS2

#### RetroArch PS1
```
%APPDATA%\Blaze\resources\retroarch\system\
```
- Debe haber archivos como `scph1001.bin`
- Intentar lanzar un juego de PS1

#### Eden Switch
```
%APPDATA%\Blaze\resources\eden\keys\
%APPDATA%\Blaze\resources\eden\nand\system\Contents\registered\
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
3. Debe mostrar error claro
4. Botón "Reintentar" debe estar visible

#### Backend caído
1. Detener el backend
2. Hacer login
3. Debe usar mocks (desarrollo) o mostrar error

## Verificación de seguridad

### Paths restringidos

Intentar desde la consola del navegador (F12):

```javascript
// Esto debe fallar:
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

## Rollback en caso de problemas

Si algo falla críticamente:

1. Hacer checkout de `dev`
2. Regenerar instalador con el workflow anterior (incluye BIOS embebidas)
3. El flujo anterior sigue funcionando

## Checklist de pruebas

- [ ] Instalador generado correctamente
- [ ] Tamaño del instalador mínimo (~200 MB)
- [ ] Instalador NO contiene emuladores ni assets
- [ ] Primera ejecución muestra onboarding
- [ ] Progreso de descarga visible para todos los componentes
- [ ] PCSX2 descargado e instalado en `%APPDATA%\Blaze\runtimes\pcsx2\`
- [ ] RetroArch descargado e instalado en `%APPDATA%\Blaze\runtimes\retroarch\`
- [ ] Eden descargado e instalado en `%APPDATA%\Blaze\runtimes\eden\`
- [ ] BIOS PCSX2 descargada en `%APPDATA%\Blaze\resources\pcsx2\bios\`
- [ ] BIOS PS1 descargada en `%APPDATA%\Blaze\resources\retroarch\system\`
- [ ] Keys Eden descargadas en `%APPDATA%\Blaze\resources\eden\keys\`
- [ ] Firmware Eden descargado en `%APPDATA%\Blaze\resources\eden\nand\`
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
