# Pack production Workbench + Vault into a single seed archive (HanaAgent seed pattern)
# The NSIS installer only ships this archive; first launch extracts it.
# Production seed contains only: server-bundle.cjs + dist/client + Vault.
# (Run scripts/build-production.ps1 first to build server-bundle.cjs & dist/client.)
param([Parameter(Mandatory = $false)][string]$Root)

$root = if ($Root) { $Root } else { Split-Path $PSScriptRoot -Parent }
$outDir = Join-Path $root "build"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$out = Join-Path $outDir "seed.tar.gz"

# sanity: production artifacts must exist before packing
if (-not (Test-Path (Join-Path $root "Workbench\server\server-bundle.cjs"))) {
    throw "server-bundle.cjs not found - run scripts/build-production.ps1 first"
}
if (-not (Test-Path (Join-Path $root "Workbench\dist\client\index.html"))) {
    throw "dist/client/index.html not found - run scripts/build-production.ps1 first"
}

Push-Location $root
tar -czf $out `
    --exclude="Workbench/node_modules" `
    --exclude="Workbench/src" `
    --exclude="Workbench/public" `
    --exclude="Workbench/scripts" `
    --exclude="Workbench/tests" `
    --exclude="Workbench/worker" `
    --exclude="Workbench/server/*.mjs" `
    --exclude="Workbench/vite.config.mjs" `
    --exclude="Workbench/index.html" `
    --exclude="Workbench/package.json" `
    --exclude="Workbench/package-lock.json" `
    --exclude="Workbench/README.md" `
    --exclude="Workbench/.gitignore" `
    "Workbench" "个人知识库"
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) { throw "tar failed with exit code: $code" }
# seed version stamp: every rebuild gets a fresh timestamp,
# the shell compares it with the extracted copy and re-extracts on mismatch
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
Set-Content -Path (Join-Path $outDir "seed-version.txt") -Value $stamp -Encoding Ascii
$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Output ("seed archive: {0} ({1} MB), version={2}" -f $out, $size, $stamp)
