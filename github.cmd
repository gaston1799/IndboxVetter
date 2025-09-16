@echo off
REM ==============================
REM InboxVetter GitHub Push Script
REM ==============================

REM Navigate to the project folder (edit path if needed)
cd /d "%~dp0"

REM Ensure git is available
where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Git is not installed or not in PATH.
  pause
  exit /b 1
)

REM Stage all changes
git add -A

REM Commit with timestamp message
set CURRDATE=%date% %time%
git commit -m "Auto commit on %CURRDATE%"

REM Ensure remote is set
git remote -v | find "origin" >nul
if %ERRORLEVEL% neq 0 (
  git remote add origin https://github.com/gaston1799/IndboxVetter.git
)

REM Push to main branch
git push -u origin main

echo.
echo ==============================
echo   Push complete!
echo ==============================
pause
