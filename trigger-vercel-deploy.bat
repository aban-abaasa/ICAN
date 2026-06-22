@echo off
REM ============================================================
REM TRIGGER VERCEL DEPLOYMENT
REM ============================================================

echo.
echo ========================================
echo TRIGGER VERCEL DEPLOYMENT
echo ========================================
echo.
echo This will create an empty commit to trigger Vercel
echo.

pause

echo.
echo Creating empty commit...
git commit --allow-empty -m "Trigger Vercel deployment - %date% %time%"

echo.
echo Pushing to GitHub...
git push origin master

echo.
echo ========================================
echo DONE!
echo ========================================
echo.
echo Vercel should start deploying now.
echo.
echo Check status at:
echo https://vercel.com/dashboard
echo.
echo Or visit your live site:
echo https://ican-era.vercel.app
echo.
echo Press Ctrl+Shift+R to hard refresh once deployed
echo.

pause
