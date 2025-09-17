@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ==============================
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

REM Parse commit message from arguments (expect -m "message")
set "MESSAGE="
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="-m" (
  shift
  if "%~1"=="" goto missing_message
  set "MESSAGE=%~1"
  shift
  goto collect_message
)
shift
goto parse_args

:collect_message
if "%~1"=="" goto args_done
set "MESSAGE=!MESSAGE! %~1"
shift
goto collect_message

:missing_message
echo No commit message provided. Use: github.cmd -m "your message"
exit /b 1

:args_done
if not defined MESSAGE (
  echo No commit message provided. Use: github.cmd -m "your message"
  exit /b 1
)

REM Stage all changes
git add -A

REM Commit
git commit -m "!MESSAGE!"
if %ERRORLEVEL% neq 0 (
  echo Commit failed. Aborting push.
  exit /b 1
)

REM Ensure remote is set
git remote -v | find "origin" >nul
if %ERRORLEVEL% neq 0 (
  git remote add origin https://github.com/gaston1799/IndboxVetter.git
)

REM Push to main branch
git push -u origin main
if %ERRORLEVEL% neq 0 (
  echo Push failed.
  exit /b 1
)

echo.
echo ==============================
echo   Push complete with message: !MESSAGE!
echo ==============================
endlocal
