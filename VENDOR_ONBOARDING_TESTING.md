# Vendor Onboarding - Guía de Pruebas

## Contexto

Este branch implementa la descarga de BIOS/keys/firmware desde el backend tras el primer login, eliminándolos del instalador para reducir su tamaño y mejorar la seguridad.

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
- La descarga fallará pero el código es funcional para pruebas de UI

## Pruebas en Windows Sandbox

### 1. Preparar el Release vendor

El instalador ya no incluye BIOS/keys/firmware, pero el workflow espera:

```
gh release create vendor --repo VictorZuniga14/Blaze-front
gh release upload vendor eden.7z --repo VictorZuniga14/Blaze-front
```

### 2. Generar instalador

```powershell
# Desde la rama cursor/vendor-onboarding-hardening-2738
npm ci
npm run build
cd src-tauri
cargo build --release
```

El instalador estará en `src-tauri/target/release/bundle/nsis/`

### 3. Instalar en Windows limpio

1. Abrir Windows Sandbox
2. Copiar el instalador
3. Ejecutar el instalador
4. Verificar tamaño (debería ser ~500 MB menos que antes)

### 4. Primera ejecución

1. Iniciar Blaze
2. Hacer login con RetroAchievements
3. **Debe aparecer** la pantalla "Preparando Blaze..."
4. Debe mostrar progreso de descarga:
   - "PCSX2 BIOS Pack"
   - "RetroArch PS1 BIOS"
   - "Eden Keys"
   - "Eden Firmware"
5. Barra de progreso debe avanzar
6. Al terminar, debe continuar a la biblioteca

### 5. Segunda ejecución

1. Cerrar Blaze
2. Volver a abrir
3. **NO debe aparecer** la pantalla de onboarding
4. Debe ir directo a la biblioteca

### 6. Verificar emuladores

#### PCSX2
```
# Verificar que existen BIOS en:
%APPDATA%\Blaze\resources\pcsx2\bios\
```
- Debe haber archivos .bin de BIOS de PS2
- Intentar lanzar un juego de PS2

#### RetroArch PS1
```
# Verificar BIOS en:
%APPDATA%\Blaze\resources\retroarch\system\
```
- Debe haber archivos como `scph1001.bin`
- Intentar lanzar un juego de PS1

#### Eden Switch
```
# Verificar keys:
%APPDATA%\Blaze\resources\eden\keys\

# Verificar firmware:
%APPDATA%\Blaze\resources\eden\nand\system\Contents\registered\
```
- Intentar lanzar un juego de Switch

### 7. Manejo de errores

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
- [ ] Tamaño del instalador reducido (~500 MB menos)
- [ ] Primera ejecución muestra onboarding
- [ ] Progreso de descarga visible
- [ ] Descarga completa exitosa
- [ ] Segunda ejecución **no** muestra onboarding
- [ ] PCSX2 funciona (BIOS presente)
- [ ] RetroArch PS1 funciona (BIOS presente)
- [ ] Eden Switch funciona (keys y firmware presentes)
- [ ] Manejo de errores funciona (sin conexión)
- [ ] Botón reintentar funciona
- [ ] Seguridad: paths restringidos
- [ ] CSP no bloquea funcionalidad

## Problemas conocidos

### Mock del backend

Actualmente el código usa mocks si el backend no responde. Para pruebas reales:

1. Implementar `/api/vendor/manifest` en el backend
2. Configurar `VITE_API_URL` en el workflow
3. Subir los assets a S3 u otro storage
4. Generar URLs presignadas válidas

### Eden offline

Eden sigue necesitando el pack offline (`eden.7z`) en el instalador porque puede funcionar sin red. Los otros emuladores (PCSX2, RetroArch) siempre se descargan del manifiesto embebido.

## Contacto

Si hay problemas con las pruebas, revisar:
- Logs de Tauri en `%APPDATA%\Blaze\logs\`
- Consola del navegador (F12)
- Network tab para ver requests fallidos
