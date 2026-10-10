# Emuladores del instalador completo

Bootstrap offline: se copian **una sola vez** a `%AppData%/…/runtimes/{id}/{version}/`.
Si esa versión ya está instalada (`.installed.json`), no se vuelve a copiar.

## Qué poner aquí

- `pcsx2/` con `pcsx2-qt.exe` y dependencias (sin BIOS en ese pack)
- `retroarch/` con `retroarch.exe`, DLLs y cores en `cores/`
- `eden/` con `eden.exe` y dependencias (sin keys ni firmware Switch)
- BIOS PS2: `resources/pcsx2/bios/` (o `packs/bios.7z` en Release vendor) → va en el instalador
- (opcional packs) `packs/eden.7z` o `.zip` alineado con `runtimes.manifest.json`

```powershell
.\scripts\prepare-emulators.ps1
```

## GitHub Actions (Release automático)

Los `.7z` no van al repo. Una sola vez creá un Release con tag **`vendor`** y subí:

- `pcsx2.7z`
- `retroarch.7z`
- `bios.7z` → **obligatorio**; se extrae a `resources/pcsx2/bios/` y el cliente recibe la BIOS con el instalador
- (opcional) `eden.7z` → bootstrap offline de Eden

```powershell
.\scripts\prepare-emulators.ps1   # genera pcsx2/retroarch/bios(/eden).7z
# Después subí esos .7z al Release tag "vendor"
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

1. Pack offline: `packs/eden.7z` + `eden.blaze-bundle.json` (o descarga si el host responde).
2. Keys: Configuración → **Abrir carpeta keys Eden** → pegá `prod.keys` / `title.keys`.
3. Firmware: Configuración → **Importar firmware Switch (.zip)** (`.nca` en el zip).
4. Juegos: plataforma `Nintendo Switch`, contenido `.nsp` / `.xci`.

No meter keys ni firmware en el instalador público.

## Licencias

- **PCSX2 / RetroArch / Eden / cores**: GPL (u otras OSS). Redistribuir binarios implica cumplir la licencia (aviso, oferta de código fuente, etc.).
- **BIOS PS2**: Blaze la incluye en el instalador vía `bios.7z` del Release vendor (uso privado / amigos). No subir dumps al repo git.
- **Keys / firmware Switch**: no van en el instalador; cada máquina los aporta en Configuración.
