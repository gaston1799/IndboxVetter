@echo offsREM ==============================
REM InboxVetter GitHub Push Script
REM ==============================

REM Navigate to the project folder (this script's folder)
cd /d "%~dp0"

REM Ensure git is installed
where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Git is not installed or not in PATH.
  pause
  exit /b 1
)

REM Parse commit message from arguments
set MESSAGE=
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="-m" (
  shift
  set MESSAGE=%~1
  shift
  goto parse_args
) else (
  shift
  goto parse_args
)
:args_done

if "%MESSAGE%"=="" (
  echo No commit message provided. Use: github.cmd -m "your message"
  exit /b 1
)

REM Stage all changes
git add -A

REM Commit
git commit -m "%MESSAGE%"

REM Ensure remote is set
git remote -v | find "origin" >nul
if %ERRORLEVEL% neq 0 (
  git remote add origin https://github.com/gaston1799/IndboxVetter.git
)

REM Push to main branch
git push -u origin main

echo.
echo ==============================
echo   Push complete with message: %MESSAGE%
echo ==============================
sage: %MESSAGE%
echo ==============================
sage: %MESSAGE%
echo ==============================
