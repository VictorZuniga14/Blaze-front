# Emuladores del instalador completo

Bootstrap offline: se copian **una sola vez** a `%AppData%/…/runtimes/{id}/{version}/`.
Si esa versión ya está instalada (`.installed.json`), no se vuelve a copiar.

## Qué poner aquí

- `pcsx2/` con `pcsx2-qt.exe` y dependencias (sin BIOS)
- `retroarch/` con `retroarch.exe`, DLLs y cores en `cores/`

```powershell
.\scripts\prepare-emulators.ps1
```

## GitHub Actions (Release automático)

Los `.7z` no van al repo. Una sola vez creá un Release con tag **`vendor`** y subí:

- `pcsx2.7z`
- `retroarch.7z`
- (opcional) `bios.7z` → contenido para `resources/pcsx2/bios/`

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

## Licencias

- **PCSX2 / RetroArch / cores**: GPL (u otras OSS). Redistribuir binarios implica cumplir la licencia (aviso, oferta de código fuente, etc.).
- **BIOS / firmware de consolas (Sony, etc.)**: no redistribuir. El usuario debe aportar su propio dump legal; Blaze solo abre la carpeta managed.
