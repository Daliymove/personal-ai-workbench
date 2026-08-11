# Build production assets for the seed:
#   1. vite build  -> Workbench/dist/client (self-contained frontend)
#   2. esbuild     -> Workbench/server/server-bundle.cjs (single-file server)
# After this, node_modules is no longer needed at runtime.
param([Parameter(Mandatory = $false)][string]$Root)

$root = if ($Root) { $Root } else { Split-Path $PSScriptRoot -Parent }
$wb = Join-Path $root "Workbench"
$bundle = Join-Path $wb "server\server-bundle.cjs"

Write-Output "==> [1/2] vite build (frontend -> dist/client)"
Push-Location $wb
npx vite build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vite build failed" }

Write-Output "==> [2/2] esbuild (server -> single file bundle, CJS 以支持 xlsx 的动态 require)"
npx esbuild server/standalone.mjs --bundle --platform=node --format=cjs `
    --outfile=$bundle --log-level=warning `
    --banner:js="globalThis.__WB_BUNDLE_SERVER_DIR__=__dirname;"
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "esbuild failed" }

$size = [math]::Round((Get-Item $bundle).Length / 1MB, 2)
$dist = (Get-ChildItem (Join-Path $wb "dist\client") -Recurse -File | Measure-Object).Count
Write-Output "build-production ok: server-bundle.mjs ($size MB), dist/client ($dist files)"
