# PowerShell script to execute COMPLETE_INVESTMENT_SETUP.sql in Supabase

$sqlFile = "COMPLETE_INVESTMENT_SETUP.sql"
$sqlPath = Join-Path $PSScriptRoot $sqlFile

if (!(Test-Path $sqlPath)) {
    Write-Host "[ERROR] $sqlFile not found in $PSScriptRoot" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  COMPLETE INVESTMENT SETUP - SQL EXECUTOR" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Read the SQL file
$sqlContent = Get-Content $sqlPath -Raw

# Copy to clipboard
$sqlContent | Set-Clipboard

Write-Host "[OK] SQL content copied to clipboard!" -ForegroundColor Green
Write-Host ""

Write-Host "EXECUTION STEPS:" -ForegroundColor Yellow
Write-Host "================"
Write-Host ""
Write-Host "1. Open Supabase Dashboard:"
Write-Host "   https://app.supabase.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Select your project (hswxazpxcgtqbxeqcxxw)"
Write-Host ""
Write-Host "3. Navigate to SQL Editor (left sidebar)"
Write-Host ""
Write-Host "4. Click 'New Query' button"
Write-Host ""
Write-Host "5. Paste the SQL (Ctrl+V) - content is already copied!"
Write-Host ""
Write-Host "6. Click 'Run' button at bottom right"
Write-Host ""
Write-Host "7. Wait for execution to complete"
Write-Host ""

Write-Host "SQL FILE DETAILS:" -ForegroundColor Yellow
Write-Host "================="
Write-Host "File: $sqlFile"
Write-Host "Size: $('{0:N0}' -f $sqlContent.Length) bytes"
Write-Host "Lines: $(($sqlContent | Measure-Object -Line).Lines)"
Write-Host ""

Write-Host "Expected execution time: 5-15 seconds" -ForegroundColor Magenta
Write-Host ""
Write-Host "If successful, you will see:" -ForegroundColor Green
Write-Host "  - All tables created"
Write-Host "  - All functions created"
Write-Host "  - All indexes created"
Write-Host "  - RLS enabled on signing workflow tables"
Write-Host ""

Write-Host "[READY] SQL content is in your clipboard!" -ForegroundColor Green
