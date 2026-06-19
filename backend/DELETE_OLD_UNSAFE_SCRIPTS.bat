@echo off
REM ============================================================
REM DELETE OLD UNSAFE SCRIPTS
REM ============================================================
REM This removes the old scripts that do bulk updates
REM Only the new SAFE versions should be used
REM ============================================================

echo.
echo ========================================
echo REMOVING UNSAFE BULK UPDATE SCRIPTS
echo ========================================
echo.
echo These files will be DELETED:
echo   - FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql (bulk updates)
echo   - QUICK_FIX_CMMS_ROLE.sql (hardcoded user)
echo   - FIX_SUPERVISOR_TASK_ASSIGNMENT.sql (bulk normalization)
echo   - CMMS_ROLE_NORMALIZATION_TRIGGER.sql (affects existing data)
echo.
echo These files will be KEPT:
echo   - SAFE_UPDATE_ASSIGN_FUNCTION.sql (function only)
echo   - SAFE_FIX_SPECIFIC_USER_ROLE.sql (one user at a time)
echo   - OPTIONAL_ROLE_NORMALIZATION_TRIGGER.sql (future only)
echo   - CMMS_REPORT_MESSAGING_SYSTEM.sql (core system)
echo.

pause

echo.
echo Deleting unsafe files...
echo.

if exist "FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql" (
    del "FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql"
    echo [X] Deleted FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql
) else (
    echo [SKIP] FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql not found
)

if exist "QUICK_FIX_CMMS_ROLE.sql" (
    del "QUICK_FIX_CMMS_ROLE.sql"
    echo [X] Deleted QUICK_FIX_CMMS_ROLE.sql
) else (
    echo [SKIP] QUICK_FIX_CMMS_ROLE.sql not found
)

if exist "FIX_SUPERVISOR_TASK_ASSIGNMENT.sql" (
    del "FIX_SUPERVISOR_TASK_ASSIGNMENT.sql"
    echo [X] Deleted FIX_SUPERVISOR_TASK_ASSIGNMENT.sql
) else (
    echo [SKIP] FIX_SUPERVISOR_TASK_ASSIGNMENT.sql not found
)

if exist "CMMS_ROLE_NORMALIZATION_TRIGGER.sql" (
    del "CMMS_ROLE_NORMALIZATION_TRIGGER.sql"
    echo [X] Deleted CMMS_ROLE_NORMALIZATION_TRIGGER.sql
) else (
    echo [SKIP] CMMS_ROLE_NORMALIZATION_TRIGGER.sql not found
)

echo.
echo ========================================
echo CLEANUP COMPLETE
echo ========================================
echo.
echo Safe files remaining:
dir /b SAFE_*.sql OPTIONAL_*.sql CMMS_REPORT_MESSAGING_SYSTEM.sql 2>nul
echo.
echo Use SAFE_DEPLOYMENT_GUIDE.md for instructions.
echo.

pause
