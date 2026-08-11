# Replace Workbench front-end icons with the new app icon
# Use $PSScriptRoot for path resolution (no hardcoded non-ASCII paths)
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root "build\icon.png"
$public = Join-Path $root "Workbench\public"

function Resize-Save($src, $size, $out) {
    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $size, $size)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $img.Dispose()
    Write-Output "Generated: $out ($size x $size)"
}

# 512 logo for sidebar / favicon
Copy-Item $srcPath (Join-Path $public "icon.png") -Force
Write-Output "Copied: icon.png (512)"

# small favicon 32
Resize-Save $srcPath 32 (Join-Path $public "favicon-32.png")

# apple touch icon 180
Resize-Save $srcPath 180 (Join-Path $public "apple-touch-icon.png")

# multi-size ico
Copy-Item (Join-Path $root "build\icon.ico") (Join-Path $public "favicon.ico") -Force
Write-Output "Copied: favicon.ico"
