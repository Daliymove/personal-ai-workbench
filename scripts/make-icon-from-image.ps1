# Convert an uploaded image to app icon: icon.png (512) + icon.ico (multi-size)
# Steps: detect bg color -> make corner rounded transparent -> resize 512 -> build ico
param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$OutDir
)

$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public class IconConverter {

    static double Dist(Color c, int r, int g, int b) {
        double dr = c.R - r, dg = c.G - g, db = c.B - b;
        return Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    // Remove near-white / near-gray background via alpha, keep the lavender rounded square
    public static void Convert(string src, string outPng, string outIco) {
        using (var orig = new Bitmap(src)) {
            int w = orig.Width, h = orig.Height;
            using (var mask = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        Color c = orig.GetPixel(x, y);
                        double dw = Dist(c, 253, 253, 253); // white canvas
                        double dg = Dist(c, 163, 163, 163); // gray frame
                        double d = Math.Min(dw, dg);
                        int alpha;
                        if (d <= 10) alpha = 0;
                        else if (d >= 28) alpha = 255;
                        else alpha = (int)((d - 10) / 18.0 * 255.0);
                        mask.SetPixel(x, y, Color.FromArgb(alpha, c.R, c.G, c.B));
                    }
                }

                using (var bmp512 = new Bitmap(512, 512, PixelFormat.Format32bppArgb)) {
                    using (var g = Graphics.FromImage(bmp512)) {
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(mask, 0, 0, 512, 512);
                    }

                    // edge cleanup: transparent outer ring + remove low-alpha noise
                    for (int y = 0; y < 512; y++) {
                        for (int x = 0; x < 512; x++) {
                            Color c = bmp512.GetPixel(x, y);
                            if (c.A < 48 || x == 0 || y == 0 || x == 511 || y == 511) {
                                bmp512.SetPixel(x, y, Color.Transparent);
                            }
                        }
                    }
                    bmp512.Save(outPng, ImageFormat.Png);

                    // multi-size ico (png-in-ico)
                    int[] sizes = { 256, 48, 32, 16 };
                    var pngs = new List<byte[]>();
                    foreach (int s in sizes) {
                        using (var bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb)) {
                            using (var g = Graphics.FromImage(bmp)) {
                                g.SmoothingMode = SmoothingMode.HighQuality;
                                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                g.DrawImage(bmp512, 0, 0, s, s);
                            }
                            using (var ms = new MemoryStream()) {
                                bmp.Save(ms, ImageFormat.Png);
                                pngs.Add(ms.ToArray());
                            }
                        }
                    }
                    using (var fs = File.Create(outIco)) {
                        using (var bw = new BinaryWriter(fs)) {
                            bw.Write((short)0);
                            bw.Write((short)1);
                            bw.Write((short)sizes.Length);
                            int offset = 6 + 16 * sizes.Length;
                            for (int i = 0; i < sizes.Length; i++) {
                                int s = sizes[i];
                                bw.Write((byte)(s >= 256 ? 0 : s));
                                bw.Write((byte)(s >= 256 ? 0 : s));
                                bw.Write((byte)0);
                                bw.Write((byte)0);
                                bw.Write((short)1);
                                bw.Write((short)32);
                                bw.Write(pngs[i].Length);
                                bw.Write(offset);
                                offset += pngs[i].Length;
                            }
                            foreach (var png in pngs) bw.Write(png);
                        }
                    }
                }
            }
        }
    }
}
'@

Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition $code

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$png = Join-Path $OutDir "icon.png"
$ico = Join-Path $OutDir "icon.ico"
[IconConverter]::Convert((Resolve-Path $Source).Path, $png, $ico)
Write-Output "Generated: $png"
Write-Output "Generated: $ico"
