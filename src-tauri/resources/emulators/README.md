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

## Actualizaciones (sin reinstalar Blaze)

1. Subís versión/URL/hash en `src-tauri/runtimes.manifest.json`
2. Publicás un update de Blaze (o más adelante un manifiesto remoto)
3. En el cliente, `ensureRuntime` detecta versión distinta y **descarga por red** el runtime nuevo a `AppData/runtimes/`

El bundle del instalador es solo el primer arranque offline. No hace falta redistribuir el instalador completo para cada update de emulador.

## Licencias

- **PCSX2 / RetroArch / cores**: GPL (u otras OSS). Redistribuir binarios implica cumplir la licencia (aviso, oferta de código fuente, etc.).
- **BIOS / firmware de consolas (Sony, etc.)**: no redistribuir. El usuario debe aportar su propio dump legal; Blaze solo abre la carpeta managed.
