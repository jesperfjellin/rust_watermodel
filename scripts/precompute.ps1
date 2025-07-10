<#
.SYNOPSIS
    Pre-computation script for Rust Water Model (Windows PowerShell)

.DESCRIPTION
    Processes all GeoTIFF DEM files in an input directory and writes the
    optimized, pre-computed assets to an output directory.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $InputDir,

    [Parameter(Mandatory = $true, Position = 1)]
    [string] $OutputDir
)

# -----------------------------------------------------------------------------
# Determine repository root (folder containing Cargo.toml) and move there
# -----------------------------------------------------------------------------
$RepoRoot = Join-Path $PSScriptRoot ".." | Resolve-Path
Set-Location $RepoRoot

Write-Host "=== Rust Water Model Pre-computation Tool ===" -ForegroundColor Green
Write-Host ""

# -----------------------------------------------------------------------------
# Validate input directory
# -----------------------------------------------------------------------------
if (-not (Test-Path -Path $InputDir -PathType Container)) {
    Write-Host "Error: Input directory does not exist:`n  $InputDir" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------------------
# Locate GeoTIFF files
# -----------------------------------------------------------------------------
$demFiles  = Get-ChildItem -Path $InputDir -Filter *.tif  -Recurse -File
$demFiles += Get-ChildItem -Path $InputDir -Filter *.tiff -Recurse -File

if ($demFiles.Count -eq 0) {
    Write-Host "Error: No GeoTIFF files found in:`n  $InputDir" -ForegroundColor Red
    exit 1
}

Write-Host "Found $($demFiles.Count) GeoTIFF file(s) in:`n  $InputDir" -ForegroundColor Yellow
Write-Host "Output will be saved to:`n  $OutputDir" -ForegroundColor Yellow
Write-Host ""

# -----------------------------------------------------------------------------
# Ensure output directory exists
# -----------------------------------------------------------------------------
if (-not (Test-Path -Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "Created output directory:`n  $OutputDir" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Build the pre-computation tool
# -----------------------------------------------------------------------------
Write-Host "Building pre-computation tool..." -ForegroundColor Yellow

# Set GDAL environment variables for Pixi installation
Write-Host "Setting up GDAL environment for Pixi installation..." -ForegroundColor Yellow
$env:GDAL_HOME = "C:\gdal\.pixi\envs\default\Library"
$env:GDAL_INCLUDE_DIR = "C:\gdal\.pixi\envs\default\Library\include"
$env:GDAL_LIB_DIR = "C:\gdal\.pixi\envs\default\Library\lib"
$env:PKG_CONFIG_PATH = "C:\gdal\.pixi\envs\default\Library\lib\pkgconfig"

Write-Host "GDAL_HOME: $env:GDAL_HOME" -ForegroundColor Green
Write-Host "GDAL_INCLUDE_DIR: $env:GDAL_INCLUDE_DIR" -ForegroundColor Green
Write-Host "GDAL_LIB_DIR: $env:GDAL_LIB_DIR" -ForegroundColor Green
Write-Host "PKG_CONFIG_PATH: $env:PKG_CONFIG_PATH" -ForegroundColor Green

try {
    cargo build --release --bin precompute --features "native,bindgen"
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Host "Error: Failed to build pre-computation tool:`n  $_" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------------------
# Run the pre-computation
# -----------------------------------------------------------------------------
Write-Host "Running pre-computation..." -ForegroundColor Yellow
$ExePath = Join-Path $RepoRoot "target\release\precompute.exe"

try {
    & $ExePath $InputDir $OutputDir
    if ($LASTEXITCODE -ne 0) {
        throw "precompute.exe exited with code $LASTEXITCODE"
    }
} catch {
    Write-Host "Error: Pre-computation failed:`n  $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Pre-computation completed successfully! ===" -ForegroundColor Green
Write-Host "Pre-computed data saved to:`n  $OutputDir" -ForegroundColor Green
Write-Host ""
Write-Host "You can now view the results at:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/precomputed_viewer.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "To serve the files, run:" -ForegroundColor Yellow
Write-Host "  npm start" -ForegroundColor Cyan
Write-Host "  or" -ForegroundColor Yellow
Write-Host "  npx serve www" -ForegroundColor Cyan
Write-Host ""
