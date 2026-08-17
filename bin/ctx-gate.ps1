#Requires -Version 5.1
# Thin wrapper so PowerShell-based hook entries (see hook-templates/hooks.json)
# can invoke ctx-gate the same way the bash entries invoke bin/ctx-gate.js
# directly. Installed alongside ctx-gate.js by install.ps1.

$ErrorActionPreference = 'Stop'
$CtxGateJs = Join-Path $PSScriptRoot 'ctx-gate.js'
& node $CtxGateJs @args
exit $LASTEXITCODE
