@echo off
echo ============================================
echo  Deploy Share Target Fix
echo ============================================
echo.

REM Add the documentation files
echo Adding documentation...
git add ..\WEB_SHARE_TARGET_IMPLEMENTATION.md
git add ..\SHARE_TO_STATUS_DEPLOYMENT.md
git add ..\FIX_HTTP_405_SHARE_ERROR.md

REM Add the code changes
echo Adding code changes...
git add vercel.json
git add sw.js  
git add public\test-share.html
git add src\services\sharedContentService.js
git add src\components\status\StatusUploader.jsx
git add src\components\MobileView.jsx

echo.
echo Files staged. Ready to commit.
echo.
echo Run this command to commit:
echo git commit -m "feat: Add Web Share Target support - Fix HTTP 405 error"
echo.
echo Then push with:
echo git push origin master
echo.
pause
