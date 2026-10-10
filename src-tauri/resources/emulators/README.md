# Emuladores del instalador completo

Bootstrap offline: se copian **una sola vez** a `%AppData%/…/runtimes/{id}/{version}/`.
Si esa versión ya está instalada (`.installed.json`), no se vuelve a copiar.

## Qué poner aquí

- `pcsx2/` con `pcsx2-qt.exe` y dependencias (sin BIOS en ese pack)
- `retroarch/` con `retroarch.exe`, DLLs y cores en `cores/`
- `eden/` con `eden.exe` y dependencias (sin keys ni firmware Switch)
- BIOS PS2: `resources/pcsx2/bios/` ← `bios.7z` en Release vendor → instalador
- Eden keys/firmware: `resources/eden/…` ← `eden-keys.7z` + `eden-firmware.7z` → instalador
- (opcional) `packs/eden.7z` runtime offline

```powershell
.\scripts\prepare-emulators.ps1
```

## GitHub Actions (Release automático)

Los `.7z` no van al repo. Una sola vez creá un Release con tag **`vendor`** y subí:

- `pcsx2.7z` + `retroarch.7z` + **`eden.7z`** (runtimes offline)
- `bios.7z` → BIOS PS2 en el instalador
- `eden-keys.7z` / `eden-firmware.7z` → keys + firmware Switch en el instalador

Los `*.blaze-bundle.json` **no hace falta subirlos**: el workflow de Release los genera solo
(hash del `.7z` + versión del manifiesto). Sin ese json, Blaze ignora el pack y baja por URL.

```powershell
.\scripts\prepare-emulators.ps1   # genera los .7z
# Subí al Release tag "vendor" solo los .7z listados arriba
```

Después, cada vez:

```powershell
git tag v0.1.2
git push origin v0.1.2
```

El workflow `.github/workflows/release.yml` baja esos packs, compila y publica el instalador en ese tag.

## Updater (updates al abrir la app)

1. Generá claves (una vez, local): `npx tauri signer generate -w src-tauri/.updater/blaze.key --ci`
2. En GitHub → Settings → Secrets → Actions, creá:
   - `TAURI_SIGNING_PRIVATE_KEY` = contenido de `blaze.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = vacío si no pusiste password
   - `VITE_API_URL` = URL del backend (Railway), sin `/` final
   - `RELEASE_TOKEN` = PAT classic con scopes `repo` + `workflow`  
     (hace falta si el commit del tag tocó `.github/workflows/`; si no, el Release falla con *Resource not accessible by integration*)
3. La pubkey va en `tauri.conf.json` → `plugins.updater.pubkey`

**Repo privado:** GitHub no sirve `latest.json` / el `.exe` sin login. Para que el updater funcione hace falta repo público, o hospedar `latest.json` + instalador en un URL público (CDN/R2).

## Actualizaciones (sin reinstalar Blaze)

1. Subís versión/URL/hash en `src-tauri/runtimes.manifest.json`
2. Publicás un update de Blaze (o más adelante un manifiesto remoto)
3. En el cliente, `ensureRuntime` detecta versión distinta y **descarga por red** el runtime nuevo a `AppData/runtimes/`

El bundle del instalador es solo el primer arranque offline. No hace falta redistribuir el instalador completo para cada update de emulador.

## Eden (Nintendo Switch)

Runtime managed `eden` (mismo flujo que PCSX2/RetroArch):

1. Pack offline opcional: `eden.7z` en vendor (o descarga por URL del manifiesto).
2. Keys + firmware van en el instalador (`eden-keys.7z` / `eden-firmware.7z`); Blaze los siembra a AppData al iniciar.
3. Juegos: plataforma `Nintendo Switch`, contenido `.nsp` / `.xci`.
4. Configuración sigue teniendo Abrir keys / Importar firmware por si hace falta override manual.

## Licencias

- **PCSX2 / RetroArch / Eden / cores**: GPL (u otras OSS). Redistribuir binarios implica cumplir la licencia (aviso, oferta de código fuente, etc.).
- **BIOS PS2 / keys / firmware Switch**: van en el instalador vía packs del Release `vendor` (uso privado / amigos). No subir dumps al repo git.
