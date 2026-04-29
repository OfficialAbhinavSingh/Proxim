# install-rhubarb-windows.ps1
# Downloads Rhubarb Lip Sync for Windows and installs it to C:\rhubarb
# Run from any directory:  powershell -ExecutionPolicy Bypass -File scripts\install-rhubarb-windows.ps1

$Version   = "1.14.0"
$InstallDir = "C:\rhubarb"
$ZipUrl    = "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v$Version/rhubarb-lip-sync-$Version-windows.zip"
$TmpZip    = "$env:TEMP\rhubarb.zip"
$TmpDir    = "$env:TEMP\rhubarb_extracted"

Write-Host "Downloading Rhubarb Lip Sync v$Version for Windows..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $ZipUrl -OutFile $TmpZip -UseBasicParsing

Write-Host "Extracting..."
if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
Expand-Archive -Path $TmpZip -DestinationPath $TmpDir

$Bin = Get-ChildItem -Path $TmpDir -Filter "rhubarb.exe" -Recurse | Select-Object -First 1
if (-not $Bin) {
    Write-Error "rhubarb.exe not found in the downloaded archive. Check the URL."
    exit 1
}

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
Copy-Item -Path $Bin.FullName -Destination "$InstallDir\rhubarb.exe" -Force

# Copy any required DLLs alongside the binary
Get-ChildItem -Path $Bin.DirectoryName -Filter "*.dll" | ForEach-Object {
    Copy-Item $_.FullName "$InstallDir\" -Force
}

Remove-Item $TmpZip -Force
Remove-Item $TmpDir -Recurse -Force

Write-Host ""
Write-Host "Rhubarb installed to $InstallDir\rhubarb.exe" -ForegroundColor Green
Write-Host ""
Write-Host "Add this line to server\.env:" -ForegroundColor Yellow
Write-Host "  RHUBARB_PATH=$InstallDir\rhubarb.exe" -ForegroundColor Yellow
Write-Host ""
Write-Host "Verify with: & '$InstallDir\rhubarb.exe' --version" -ForegroundColor Gray
& "$InstallDir\rhubarb.exe" --version
