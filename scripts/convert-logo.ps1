Add-Type -AssemblyName System.Drawing
$sourcePath = 'C:/Users/tienn/.gemini/antigravity/brain/0fb813d7-59fe-482d-bec8-af1011e401e5/.user_uploaded/media_1793961217910_ed455132.jpg'
$destDir = 'C:/TikWipe/tiktok-cleaner-pro/public/icons'
[System.IO.Directory]::CreateDirectory($destDir) | Out-Null

$srcImg = [System.Drawing.Image]::FromFile($sourcePath)
$srcImg.Save("$destDir/logo.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Saved: $destDir/logo.png"

$sizes = @(16, 32, 48, 128, 256, 512)
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $s, $s)
    $g.Dispose()
    $outPath = Join-Path $destDir "icon$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated: $outPath"
}
$srcImg.Dispose()
