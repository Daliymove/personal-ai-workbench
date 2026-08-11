# Diagnostic: sample pixels from an image at key locations
param([Parameter(Mandatory=$true)][string]$Path)

Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Path).Path)
$w = $bmp.Width
$h = $bmp.Height
"Size: ${w}x${h}, Format: $($bmp.PixelFormat)"

$samples = New-Object System.Collections.ArrayList
$null = $samples.Add(@{x=0;    y=0;    label='corner TL'})
$null = $samples.Add(@{x=0;    y=256;  label='left mid'})
$null = $samples.Add(@{x=0;    y=512;  label='left lower'})
$null = $samples.Add(@{x=0;    y=1023; label='corner BL'})
$null = $samples.Add(@{x=256;  y=0;    label='top mid'})
$null = $samples.Add(@{x=512;  y=0;    label='top 512'})
$null = $samples.Add(@{x=1023; y=0;    label='corner TR'})
$null = $samples.Add(@{x=1023; y=256;  label='right mid'})
$null = $samples.Add(@{x=1023; y=1023; label='corner BR'})
$null = $samples.Add(@{x=100;  y=100;  label='inner 100,100'})
$null = $samples.Add(@{x=512;  y=512;  label='center'})
$null = $samples.Add(@{x=512;  y=700;  label='center lower'})

foreach ($s in $samples) {
    $c = $bmp.GetPixel($s.x, $s.y)
    "{0} ({1},{2}): R={3} G={4} B={5} A={6}" -f $s.label, $s.x, $s.y, $c.R, $c.G, $c.B, $c.A
}
$bmp.Dispose()
