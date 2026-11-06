# Generates icons/16.png, 32.png, 48.png, 128.png: rounded tile with white
# viewfinder corner brackets. Run from anywhere: powershell -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 128.0
  $bg = New-RoundedRect 0 0 ($size - 1) ($size - 1) (28 * $s)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF 0, 0),
    (New-Object System.Drawing.PointF $size, $size),
    [System.Drawing.Color]::FromArgb(255, 79, 70, 229),
    [System.Drawing.Color]::FromArgb(255, 14, 165, 233))
  $g.FillPath($brush, $bg)

  # Corner brackets of a selection rectangle.
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(1.5, 11 * $s))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $a = 30 * $s; $b = 98 * $s; $l = 24 * $s
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF $a, ($a + $l)), (New-Object System.Drawing.PointF $a, $a), (New-Object System.Drawing.PointF ($a + $l), $a)))
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF ($b - $l), $a), (New-Object System.Drawing.PointF $b, $a), (New-Object System.Drawing.PointF $b, ($a + $l))))
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF $b, ($b - $l)), (New-Object System.Drawing.PointF $b, $b), (New-Object System.Drawing.PointF ($b - $l), $b)))
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF ($a + $l), $b), (New-Object System.Drawing.PointF $a, $b), (New-Object System.Drawing.PointF $a, ($b - $l))))

  # Center dot.
  $r = [Math]::Max(1.5, 10 * $s)
  $g.FillEllipse([System.Drawing.Brushes]::White, (64 * $s - $r), (64 * $s - $r), (2 * $r), (2 * $r))

  $path = Join-Path $outDir "$size.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $pen.Dispose(); $brush.Dispose(); $bg.Dispose()
  Write-Output "wrote $path"
}
