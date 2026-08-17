#Requires -Version 5.1
<#
.SYNOPSIS
    Installs ctx-gate and runs `ctx-gate init` in the current repo.

.NOTES
    Stub — full implementation lands in Phase 8 of the build plan.
    Planned steps:
      1. Read VERSION from this repo (pinned, not main).
      2. Copy bin/ + src/ to $env:USERPROFILE\.ctx-gate\<version>\,
         and write a current.txt pointer file (no symlink, to avoid
         requiring elevated privileges on Windows).
      3. Run `ctx-gate init` in the invoking directory.
      4. Copy hook-templates/hooks.json into the target repo's
         .github/hooks/ctx-gate.json with the installed path substituted.
#>

Write-Error "install.ps1 is not implemented yet (Phase 8 of the build plan)."
exit 1
