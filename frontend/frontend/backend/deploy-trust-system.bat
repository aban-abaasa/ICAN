@echo off
REM QUICK FIX: Deploy Trust System Tables
REM Error: relation "public.trust_transactions" does not exist
REM
REM Run this script to deploy the trust system to your Supabase database

setlocal enabledelayedexpansion

cls
echo ======================================
echo TRUST SYSTEM DEPLOYMENT FOR WINDOWS
echo ======================================
echo.
echo This script will create the missing trust_transactions table
echo and all related trust system tables in your Supabase database.
echo.
echo Prerequisites:
echo   1. PostgreSQL client (psql) installed and in PATH
echo   2. Know your Supabase database password
echo.

REM Configuration
set DB_HOST=hswxazpxcgtqbxeqcxxw.supabase.co
set DB_USER=postgres
set DB_NAME=postgres
set SQL_FILE=backend\db\DEPLOY_TRUST_SYSTEM.sql

echo Database Host: %DB_HOST%
echo Database User: %DB_USER%
echo SQL Script: %SQL_FILE%
echo.

REM Check if SQL file exists
if not exist "%SQL_FILE%" (
    echo ❌ ERROR: SQL file not found: %SQL_FILE%
    echo Make sure you're running this from the project root directory
    echo.
    pause
    exit /b 1
)

echo ✓ SQL file found
echo.
set /p response="Proceed with deployment? (y/n): "

if /i not "%response%"=="y" (
    echo Deployment cancelled.
    exit /b 0
)

echo.
echo Deploying...
echo.

REM Run the SQL script
REM Note: You'll be prompted for the password
psql -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -f "%SQL_FILE%"

if %errorlevel% equ 0 (
    echo.
    echo ======================================
    echo ✓ DEPLOYMENT SUCCESSFUL
    echo ======================================
    echo.
    echo Next steps:
    echo   1. Refresh your browser (Ctrl+F5 to clear cache^)
    echo   2. Navigate to Trust Management / SACCOHub
    echo   3. Check browser console for errors
    echo.
    echo Verify in Supabase:
    echo   1. Go to https://app.supabase.com
    echo   2. Select your project
    echo   3. Database ^> Tables
    echo   4. Verify tables exist:
    echo      - trust_groups
    echo      - trust_group_members
    echo      - trust_transactions     ^<-- THIS WAS MISSING
    echo      - trust_cycles
    echo      - trust_disputes
    echo.
) else (
    echo.
    echo ======================================
    echo ❌ DEPLOYMENT FAILED
    echo ======================================
    echo.
    echo Troubleshooting:
    echo   1. Verify psql is installed and in PATH
    echo   2. Check your database password
    echo   3. Ensure you have permission to create tables
    echo   4. Try deploying via Supabase SQL Editor instead:
    echo      - Copy file: backend\db\DEPLOY_TRUST_SYSTEM.sql
    echo      - Paste in: https://app.supabase.com/project/YOUR-PROJECT/sql/new
    echo      - Click Run
    echo.
)

echo ======================================
pause
exit /b %errorlevel%
