# Prepara packs .7z del instalador completo de Blaze.
# Uso:
#   .\scripts\prepare-emulators.ps1
#   .\scripts\prepare-emulators.ps1 -Pcsx2Path "D:\pcsx2" -RetroArchPath "C:\RetroArch-Win64"

param(
  [string]$Pcsx2Path = "C:\Users\viczo\OneDrive\Escritorio\pcsx2-v2.8.2-windows-x64-Qt",
  [string]$RetroArchPath = "C:\RetroArch-Win64",
  [string]$EdenPath = "C:\Users\viczo\OneDrive\Escritorio\Eden",
  # Dump(s) PS2 para el instalador (Release vendor → bios.7z). Por defecto: carpeta bios de PCSX2.
  [string]$BiosPath = "",
  # Keys + firmware Switch (Release vendor → eden-keys.7z / eden-firmware.7z).
  # Por defecto: datos managed de Blaze ya configurados en esta PC.
  [string]$EdenDataPath = "$env:APPDATA\com.blaze.app\emulator-data\eden",
  [string]$SevenZip = "C:\Program Files\NVIDIA Corporation\NVIDIA app\7z.exe"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stagingPcsx2 = Join-Path $root "src-tauri\resources\emulators\pcsx2"
$stagingRa = Join-Path $root "src-tauri\resources\emulators\retroarch"
$packs = Join-Path $root "src-tauri\resources\emulators\packs"

if (-not (Test-Path $SevenZip)) {
  throw "No se encontró 7z en $SevenZip"
}
if (-not (Test-Path (Join-Path $Pcsx2Path "pcsx2-qt.exe"))) {
  throw "No se encontró pcsx2-qt.exe en $Pcsx2Path"
}
if (-not (Test-Path (Join-Path $RetroArchPath "retroarch.exe"))) {
  throw "No se encontró retroarch.exe en $RetroArchPath"
}

New-Item -ItemType Directory -Force -Path $stagingPcsx2, "$stagingRa\cores", $packs | Out-Null

Write-Host "Copiando PCSX2 (staging)..."
robocopy $Pcsx2Path $stagingPcsx2 /E /XD bios docs /XF updater.exe /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy PCSX2 falló: $LASTEXITCODE" }

Write-Host "Copiando RetroArch (staging)..."
$raExclude = @("saves","states","screenshots","recordings","playlists","thumbnails","downloads","logs","config","cheats")
robocopy $RetroArchPath $stagingRa /E /XD $raExclude /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy RetroArch falló: $LASTEXITCODE" }

$needed = @(
  "fceumm_libretro.dll",
  "snes9x_libretro.dll",
  "gambatte_libretro.dll",
  "mgba_libretro.dll",
  "genesis_plus_gx_libretro.dll",
  "swanstation_libretro.dll",
  "mupen64plus_next_libretro.dll",
  "ppsspp_libretro.dll",
  "dolphin_libretro.dll",
  "melonds_libretro.dll"
)
$missing = @($needed | Where-Object { -not (Test-Path (Join-Path $stagingRa "cores\$_")) })
if ($missing.Count -gt 0) {
  $tmp = Join-Path $env:TEMP "blaze-ra-cores.7z"
  $extract = Join-Path $env:TEMP "blaze-ra-cores-extract"
  $url = "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch_cores.7z"
  Write-Host "Descargando pack de cores ($($missing.Count) faltantes)..."
  curl.exe -L --fail --retry 3 -o $tmp $url
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  & $SevenZip x $tmp "-o$extract" -y | Out-Null
  foreach ($dll in $missing) {
    $found = Get-ChildItem $extract -Recurse -Filter $dll | Select-Object -First 1
    if (-not $found) { throw "No está en el pack: $dll" }
    Copy-Item $found.FullName (Join-Path $stagingRa "cores\$dll") -Force
  }
}

$manifestPath = Join-Path $root "src-tauri\runtimes.manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
foreach ($id in @("pcsx2", "retroarch")) {
  $entry = $manifest.runtimes | Where-Object { $_.id -eq $id }
  if (-not $entry) { throw "Falta $id en runtimes.manifest.json" }
  $dest = if ($id -eq "pcsx2") { $stagingPcsx2 } else { $stagingRa }
  $meta = @{ version = $entry.version; sha256 = $entry.sha256 } | ConvertTo-Json
  Set-Content -Encoding utf8 (Join-Path $dest ".blaze-bundle.json") -Value $meta
  Set-Content -Encoding utf8 (Join-Path $packs "$id.blaze-bundle.json") -Value $meta
}

Write-Host "Creando pcsx2.7z..."
$pcsx2Pack = Join-Path $packs "pcsx2.7z"
if (Test-Path $pcsx2Pack) { Remove-Item $pcsx2Pack -Force }
& $SevenZip a -t7z -mx=5 -mmt=on $pcsx2Pack "$stagingPcsx2\*" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z pcsx2 falló: $LASTEXITCODE" }

Write-Host "Creando retroarch.7z (sin shaders)..."
$raPack = Join-Path $packs "retroarch.7z"
if (Test-Path $raPack) { Remove-Item $raPack -Force }
& $SevenZip a -t7z -mx=5 -mmt=on "-xr!shaders" $raPack "$stagingRa\*" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z retroarch falló: $LASTEXITCODE" }

if (Test-Path (Join-Path $EdenPath "eden.exe")) {
  Write-Host "Creando eden.7z..."
  $edenPack = Join-Path $packs "eden.7z"
  if (Test-Path $edenPack) { Remove-Item $edenPack -Force }
  $edenFiles = @(
    "eden.exe", "eden-cli.exe", "eden-room.exe",
    "Qt6Core.dll", "Qt6Gui.dll", "Qt6Network.dll", "Qt6Svg.dll", "Qt6Widgets.dll",
    "LICENSE.txt", "README.md"
  ) | ForEach-Object { Join-Path $EdenPath $_ } | Where-Object { Test-Path $_ }
  & $SevenZip a -t7z -mx=5 -mmt=on $edenPack @edenFiles | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7z eden falló: $LASTEXITCODE" }
  $hash = (Get-FileHash $edenPack -Algorithm SHA256).Hash.ToLowerInvariant()
  $entry = $manifest.runtimes | Where-Object { $_.id -eq "eden" }
  $ver = if ($entry) { $entry.version } else { "0.1.0" }
  $meta = @{ version = $ver; sha256 = $hash } | ConvertTo-Json
  Set-Content -Encoding utf8 (Join-Path $packs "eden.blaze-bundle.json") -Value $meta
  Write-Host "Actualizá sha256 de eden en runtimes.manifest.json si cambió: $hash"
} else {
  Write-Host "Omitiendo Eden (no hay eden.exe en $EdenPath)"
}

# BIOS PS2 → resources/pcsx2/bios + packs/bios.7z (obligatorio en Release vendor).
if (-not $BiosPath) {
  $BiosPath = Join-Path $Pcsx2Path "bios"
}
$biosDest = Join-Path $root "src-tauri\resources\pcsx2\bios"
New-Item -ItemType Directory -Force -Path $biosDest | Out-Null
if (Test-Path $BiosPath) {
  Write-Host "Copiando BIOS PS2 desde $BiosPath..."
  Get-ChildItem $biosDest -File -ErrorAction SilentlyContinue | Remove-Item -Force
  robocopy $BiosPath $biosDest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy BIOS falló: $LASTEXITCODE" }
  $biosFiles = @(Get-ChildItem $biosDest -File -ErrorAction SilentlyContinue)
  if ($biosFiles.Count -lt 1) {
    throw "No hay archivos de BIOS en $BiosPath"
  }
  Write-Host "Creando bios.7z..."
  $biosPack = Join-Path $packs "bios.7z"
  if (Test-Path $biosPack) { Remove-Item $biosPack -Force }
  & $SevenZip a -t7z -mx=5 -mmt=on $biosPack "$biosDest\*" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7z bios falló: $LASTEXITCODE" }
} else {
  Write-Host "ADVERTENCIA: no hay carpeta BIOS en $BiosPath"
  Write-Host "  Pasá -BiosPath o subí bios.7z al Release vendor a mano."
}

# Keys + firmware Eden → resources/eden + packs (van en el instalador).
$edenKeysSrc = Join-Path $EdenDataPath "keys"
$edenFwSrc = Join-Path $EdenDataPath "nand\system\Contents\registered"
$edenKeysDest = Join-Path $root "src-tauri\resources\eden\keys"
$edenFwDest = Join-Path $root "src-tauri\resources\eden\nand\system\Contents\registered"
New-Item -ItemType Directory -Force -Path $edenKeysDest, $edenFwDest | Out-Null

if ((Test-Path (Join-Path $edenKeysSrc "prod.keys"))) {
  Write-Host "Copiando Eden keys desde $edenKeysSrc..."
  Get-ChildItem $edenKeysDest -File -ErrorAction SilentlyContinue | Remove-Item -Force
  Copy-Item (Join-Path $edenKeysSrc "prod.keys") $edenKeysDest -Force
  if (Test-Path (Join-Path $edenKeysSrc "title.keys")) {
    Copy-Item (Join-Path $edenKeysSrc "title.keys") $edenKeysDest -Force
  }
  $keysPack = Join-Path $packs "eden-keys.7z"
  if (Test-Path $keysPack) { Remove-Item $keysPack -Force }
  & $SevenZip a -t7z -mx=5 -mmt=on $keysPack "$edenKeysDest\*" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7z eden-keys falló: $LASTEXITCODE" }
} else {
  Write-Host "ADVERTENCIA: no hay prod.keys en $edenKeysSrc"
}

if (Test-Path $edenFwSrc) {
  $fwCount = @(Get-ChildItem -LiteralPath $edenFwSrc -File -ErrorAction SilentlyContinue).Count
  if ($fwCount -gt 0) {
    Write-Host "Copiando Eden firmware ($fwCount archivos)..."
    Get-ChildItem $edenFwDest -File -ErrorAction SilentlyContinue | Remove-Item -Force
    robocopy $edenFwSrc $edenFwDest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy Eden firmware falló: $LASTEXITCODE" }
    $fwPack = Join-Path $packs "eden-firmware.7z"
    if (Test-Path $fwPack) { Remove-Item $fwPack -Force }
    Write-Host "Creando eden-firmware.7z (puede tardar)..."
    & $SevenZip a -t7z -mx=5 -mmt=on $fwPack "$edenFwDest\*" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7z eden-firmware falló: $LASTEXITCODE" }
  } else {
    Write-Host "ADVERTENCIA: carpeta firmware Eden vacía: $edenFwSrc"
  }
} else {
  Write-Host "ADVERTENCIA: no hay firmware Eden en $edenFwSrc"
}

Write-Host "Listo. Packs para el instalador:"
Get-ChildItem $packs | ForEach-Object {
  "{0,-32} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)
}
Write-Host "Subí al Release tag vendor:"
Write-Host "  pcsx2.7z + retroarch.7z + bios.7z + eden-keys.7z + eden-firmware.7z"
Write-Host "  (+ eden.7z opcional para runtime offline)"
Write-Host "Volvé a correr: npm run tauri -- build"
