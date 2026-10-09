# Prepara packs .7z del instalador completo de Blaze.
# Uso:
#   .\scripts\prepare-emulators.ps1
#   .\scripts\prepare-emulators.ps1 -Pcsx2Path "D:\pcsx2" -RetroArchPath "C:\RetroArch-Win64"

param(
  [string]$Pcsx2Path = "C:\Users\viczo\OneDrive\Escritorio\pcsx2-v2.8.2-windows-x64-Qt",
  [string]$RetroArchPath = "C:\RetroArch-Win64",
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

Write-Host "Listo. Packs para el instalador:"
Get-ChildItem $packs | ForEach-Object {
  "{0,-32} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)
}
Write-Host "Volvé a correr: npm run tauri -- build"
