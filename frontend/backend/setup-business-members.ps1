#!/usr/bin/env pwsh

# =====================================================
# ICAN BUSINESS PROFILE MEMBERS SETUP SCRIPT (PowerShell)
# =====================================================
# Sets up the business profile members table and
# configures environment variables for shareholder notifications
# Run from: backend folder

Write-Host "🔧 ICAN Business Profile Members Setup" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""

# Colors
$Green = "Green"
$Blue = "Cyan"
$Yellow = "Yellow"
$Red = "Red"

# Step 1: Check Node.js
Write-Host "Step 1: Checking Node.js installation..." -ForegroundColor $Blue

try {
    $nodeVersion = node -v
    Write-Host "✓ Node.js $nodeVersion found" -ForegroundColor $Green
} catch {
    Write-Host "❌ Node.js not found. Please install Node.js 16+" -ForegroundColor $Red
    exit 1
}

Write-Host ""

# Step 2: Check npm
Write-Host "Step 2: Checking npm installation..." -ForegroundColor $Blue

try {
    $npmVersion = npm -v
    Write-Host "✓ npm $npmVersion found" -ForegroundColor $Green
} catch {
    Write-Host "❌ npm not found" -ForegroundColor $Red
    exit 1
}

Write-Host ""

# Step 3: Environment file setup
Write-Host "Step 3: Setting up environment file..." -ForegroundColor $Blue

$envFile = ".\.env"
$envExampleFile = ".\.env.example"

if (-Not (Test-Path $envFile)) {
    Write-Host "Creating .env file..." -ForegroundColor $Yellow
    
    if (Test-Path $envExampleFile) {
        Copy-Item $envExampleFile $envFile
        Write-Host "✓ .env copied from .env.example" -ForegroundColor $Green
    } else {
        Write-Host "No .env.example found, creating minimal .env" -ForegroundColor $Yellow
        
        $envContent = @"
# ICAN Capital Engine - Environment Variables
SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjE0MTU3MCwiZXhwIjoyMDY3NzE3NTcwfQ.ljWN-RgMNI5vd9ueq2Ybs4b2a9e_i_tu51uRehrltWw

# Notifications
ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
ENABLE_SHAREHOLDER_NOTIFICATIONS=true
NOTIFICATION_TIMEOUT_MS=5000

# Shareholder Settings
SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60

# Features
ALLOW_TEST_NOTIFICATIONS=true
LOG_NOTIFICATIONS=true
"@
        
        Set-Content -Path $envFile -Value $envContent
        Write-Host "✓ .env file created" -ForegroundColor $Green
    }
} else {
    Write-Host "✓ .env file exists" -ForegroundColor $Green
    
    # Check if notification settings exist
    $envContent = Get-Content $envFile -Raw
    if ($envContent -notmatch "ENABLE_BUSINESS_OWNER_NOTIFICATIONS") {
        Write-Host "Adding notification settings to .env..." -ForegroundColor $Yellow
        
        $notificationSettings = @"

# Notifications
ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
ENABLE_SHAREHOLDER_NOTIFICATIONS=true
NOTIFICATION_TIMEOUT_MS=5000
SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60
ALLOW_TEST_NOTIFICATIONS=true
LOG_NOTIFICATIONS=true
"@
        
        Add-Content -Path $envFile -Value $notificationSettings
        Write-Host "✓ Notification settings added to .env" -ForegroundColor $Green
    }
}

Write-Host ""

# Step 4: Display configuration summary
Write-Host "Step 4: Configuration Summary" -ForegroundColor $Blue
Write-Host "=======================================" -ForegroundColor $Blue

$env:SUPABASE_URL = "https://hswxazpxcgtqbxeqcxxw.supabase.co"
$supabaseUrlShort = $env:SUPABASE_URL.Substring(0, 30) + "..."

Write-Host "Supabase URL: " -ForegroundColor $Yellow -NoNewline
Write-Host $supabaseUrlShort -ForegroundColor $Blue

Write-Host "Node.js Version: " -ForegroundColor $Yellow -NoNewline
Write-Host $nodeVersion -ForegroundColor $Blue

Write-Host "npm Version: " -ForegroundColor $Yellow -NoNewline
Write-Host $npmVersion -ForegroundColor $Blue

Write-Host "Business Owner Notifications: " -ForegroundColor $Yellow -NoNewline
Write-Host "ENABLED" -ForegroundColor $Green

Write-Host "Shareholder Notifications: " -ForegroundColor $Yellow -NoNewline
Write-Host "ENABLED" -ForegroundColor $Green

Write-Host "Signature Deadline: " -ForegroundColor $Yellow -NoNewline
Write-Host "24 hours" -ForegroundColor $Blue

Write-Host "Approval Threshold: " -ForegroundColor $Yellow -NoNewline
Write-Host "60%" -ForegroundColor $Blue

Write-Host ""

# Step 5: npm dependencies check
Write-Host "Step 5: Checking npm dependencies..." -ForegroundColor $Blue

if (-Not (Test-Path ".\node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor $Yellow
    npm install
    Write-Host "✓ Dependencies installed" -ForegroundColor $Green
} else {
    Write-Host "✓ Dependencies already installed" -ForegroundColor $Green
}

Write-Host ""

# Final summary
Write-Host "✓ Setup Complete!" -ForegroundColor $Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor $Cyan
Write-Host "1. Apply SQL schema:"
Write-Host "   - Via Supabase Dashboard: Paste BUSINESS_PROFILE_MEMBERS_SETUP.sql" -ForegroundColor $Yellow
Write-Host "   - Via Node: npm run db:setup:members" -ForegroundColor $Yellow
Write-Host ""
Write-Host "2. Migrate existing co-owners:"
Write-Host "   npm run migrate:co-owners-to-members" -ForegroundColor $Yellow
Write-Host ""
Write-Host "3. Verify setup:"
Write-Host "   npm run verify:business-members" -ForegroundColor $Yellow
Write-Host ""
Write-Host "4. Test notifications:"
Write-Host "   npm run test:owner-notifications" -ForegroundColor $Yellow
Write-Host ""
Write-Host "Documentation: See BUSINESS_PROFILE_MEMBERS_SETUP.md" -ForegroundColor $Cyan
