#Requires -Version 5.1
<#
.SYNOPSIS
    Installs ctx-gate and runs `ctx-gate init` in the current repo.

.DESCRIPTION
    1. Reads VERSION from this repo (pinned, not a moving "main").
    2. Copies bin/ + src/ + agent-pack/ + package.json + node_modules to
       $env:USERPROFILE\.ctx-gate\<version>\, and writes a current.txt
       pointer file (no symlink, to avoid requiring elevated privileges
       on Windows).
    3. Runs `ctx-gate init` in the invoking directory (the repo the
       developer ran this installer from).
    4. Copies hook-templates/hooks.json into the target repo's
       .github/hooks/ctx-gate.json, with the installed path substituted
       into the `powershell` command entries. The `bash` entries are left
       pointing at `~/.ctx-gate/current/...` -- that indirection is only
       meaningful under install.sh (WSL2/macOS/Linux), so it isn't
       resolved by this script.

.NOTES
    Windows has no unprivileged symlink, so unlike install.sh's
    ~/.ctx-gate/current symlink, this script writes current.txt as a
    plain pointer file AND resolves hooks.json straight to the versioned
    install directory. Re-running this script after an upgrade will
    re-point hooks.json at the new version.
#>

$ErrorActionPreference = 'Stop'

$SourceRoot = $PSScriptRoot
$VersionFile = Join-Path $SourceRoot 'VERSION'
if (-not (Test-Path $VersionFile)) {
    Write-Error "Could not find VERSION next to install.ps1 at $SourceRoot."
}
$Version = (Get-Content $VersionFile -Raw).Trim()

$InstallRoot = Join-Path $env:USERPROFILE '.ctx-gate'
$VersionDir = Join-Path $InstallRoot $Version

Write-Host "Installing ctx-gate $Version to $VersionDir ..."
New-Item -ItemType Directory -Force -Path $VersionDir | Out-Null

foreach ($item in @('bin', 'src', 'agent-pack', 'package.json')) {
    $src = Join-Path $SourceRoot $item
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $VersionDir -Recurse -Force
    }
}

$NodeModulesSrc = Join-Path $SourceRoot 'node_modules'
if (Test-Path $NodeModulesSrc) {
    Copy-Item -Path $NodeModulesSrc -Destination $VersionDir -Recurse -Force
} else {
    Write-Warning "node_modules not found next to install.ps1 -- run 'npm install --omit=dev' inside $VersionDir before using ctx-gate."
}

[System.IO.File]::WriteAllText((Join-Path $InstallRoot 'current.txt'), $Version, (New-Object System.Text.UTF8Encoding $false))

$CtxGateJs = Join-Path $VersionDir 'bin\ctx-gate.js'
$TargetRepo = (Get-Location).Path

Write-Host "Running 'ctx-gate init' in $TargetRepo ..."
& node $CtxGateJs init
if ($LASTEXITCODE -ne 0) {
    Write-Error "ctx-gate init failed with exit code $LASTEXITCODE."
}

$HooksDir = Join-Path $TargetRepo '.github\hooks'
New-Item -ItemType Directory -Force -Path $HooksDir | Out-Null

$HooksTemplatePath = Join-Path $SourceRoot 'hook-templates\hooks.json'
$ResolvedInstallPath = $VersionDir -replace '\\', '/'

$HooksTemplate = Get-Content $HooksTemplatePath -Raw | ConvertFrom-Json
foreach ($eventName in $HooksTemplate.hooks.PSObject.Properties.Name) {
    foreach ($entry in $HooksTemplate.hooks.$eventName) {
        $entry.powershell = $entry.powershell -replace [regex]::Escape('~/.ctx-gate/current'), $ResolvedInstallPath
    }
}
$HooksJsonText = $HooksTemplate | ConvertTo-Json -Depth 10
# Set-Content -Encoding utf8 writes a BOM on Windows PowerShell 5.1, which
# breaks plain JSON.parse for anything that reads this file back -- write
# via .NET directly instead to get real BOM-less UTF-8.
$HooksJsonPath = Join-Path $HooksDir 'ctx-gate.json'
[System.IO.File]::WriteAllText($HooksJsonPath, $HooksJsonText, (New-Object System.Text.UTF8Encoding $false))

Write-Host "ctx-gate $Version installed."
Write-Host "Hook config written to $(Join-Path $HooksDir 'ctx-gate.json')"
Write-Host "The 'bash' command entries in that file are for macOS/Linux/WSL2 only; native Windows Copilot uses the 'powershell' entries, which now point at $ResolvedInstallPath."
