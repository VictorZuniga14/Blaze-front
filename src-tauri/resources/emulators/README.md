# Emuladores del instalador completo

El instalador **no** mete 15.000 archivos sueltos (NSIS/MSI los omitía).
Usa packs comprimidos:

- `packs/pcsx2.7z` + `packs/pcsx2.blaze-bundle.json`
- `packs/retroarch.7z` + `packs/retroarch.blaze-bundle.json`

Generar antes del build:

```powershell
.\scripts\prepare-emulators.ps1
npm run tauri -- build
```

En el primer arranque Blaze extrae el pack a `%AppData%/…/runtimes/{id}/{version}/`.

BIOS aparte: `resources/pcsx2/bios` y `resources/retroarch/system`.
