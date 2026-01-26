# Rename image files to use dash-separated names for Vercel compatibility
# This script converts spaces to dashes and normalizes capitalization

$imageDir = "C:\Users\MACROS\Desktop\LOVE\ICAN\frontend\public\images"

# Mapping of old names to new names
$renameMap = @{
    "dairy expense and inacome.png" = "dairy-expense-and-income.png"
    "dairy%20expense%20and%20inacome.png" = "dairy-expense-and-income.png"
    "ICANera expense.png" = "icanera-expense.png"
    "ICANera%20expense.png" = "icanera-expense.png"
    "icanera wallet.png" = "icanera-wallet.png"
    "icanera%20wallet.png" = "icanera-wallet.png"
    "ICANwallet.png" = "ican-wallet.png"
    "incaera share.png" = "incaera-share.png"
    "incaera%20share.png" = "incaera-share.png"
    "ICANera pitchin.png" = "icanera-pitchin.png"
    "ICANera%20pitchin.png" = "icanera-pitchin.png"
    "ICANera pitchin 8.png" = "icanera-pitchin-8.png"
    "ICANera%20pitchin%208.png" = "icanera-pitchin-8.png"
    "ICANera CMMS.png" = "icanera-cmms.png"
    "ICANera%20CMMS.png" = "icanera-cmms.png"
    "ICANera CMMS1.png" = "icanera-cmms1.png"
    "ICANera%20CMMS1.png" = "icanera-cmms1.png"
    "ICAN era sacco.png" = "ican-era-sacco.png"
    "ICAN%20era%20sacco.png" = "ican-era-sacco.png"
    "ICANera trust.png" = "icanera-trust.png"
    "ICANera%20trust.png" = "icanera-trust.png"
    "ICANera trust 2.png" = "icanera-trust-2.png"
    "ICANera%20trust%202.png" = "icanera-trust-2.png"
    "ICANera 3.png" = "icanera-3.png"
    "ICANera%203.png" = "icanera-3.png"
    "ICANera tithe.png" = "icanera-tithe.png"
    "ICANera%20tithe.png" = "icanera-tithe.png"
    "ICANera tith2.png" = "icanera-tith2.png"
    "ICANera%20tith2.png" = "icanera-tith2.png"
}

Write-Host "Image Renaming Script" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host "Directory: $imageDir`n" -ForegroundColor Gray

if (-not (Test-Path $imageDir)) {
    Write-Host "Error: Directory not found!" -ForegroundColor Red
    exit 1
}

$renamedCount = 0
$skippedCount = 0

# Get all files in directory
$files = Get-ChildItem -Path $imageDir -File

foreach ($file in $files) {
    $oldName = $file.Name
    $newName = $null

    # Check if file needs renaming
    if ($renameMap.ContainsKey($oldName)) {
        $newName = $renameMap[$oldName]
    } else {
        # Skip if already in correct format (lowercase with dashes)
        $skippedCount++
        Write-Host "⊘ Skipped: $oldName (already correct format)" -ForegroundColor Gray
        continue
    }

    $oldPath = $file.FullName
    $newPath = Join-Path -Path $imageDir -ChildPath $newName

    # Don't rename if target already exists
    if (Test-Path $newPath) {
        Write-Host "⊘ Skipped: $oldName → $newName (target exists)" -ForegroundColor Yellow
        $skippedCount++
        continue
    }

    # Rename the file
    try {
        Rename-Item -Path $oldPath -NewName $newName
        Write-Host "✓ Renamed: $oldName → $newName" -ForegroundColor Green
        $renamedCount++
    } catch {
        Write-Host "✗ Error: Failed to rename $oldName - $_" -ForegroundColor Red
    }
}

Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "========" -ForegroundColor Cyan
Write-Host "Renamed: $renamedCount files" -ForegroundColor Green
Write-Host "Skipped: $skippedCount files" -ForegroundColor Yellow
Write-Host "`nDone!" -ForegroundColor Green
