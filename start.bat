@echo off
REM ============================================================================
REM  NuRock Utilities AP - Local launcher
REM  Double-click this file to start the dev server and open the app in Chrome.
REM ============================================================================
setlocal
title NuRock Utilities AP

REM Change to the folder this batch file lives in (makes it work no matter
REM where the user double-clicks from, including a desktop shortcut).
cd /d "%~dp0"

echo ============================================================
echo   NuRock Utilities AP - Local Launcher
echo ============================================================
echo.

REM ---------------------------------------------------------------------------
REM  Preflight checks
REM ---------------------------------------------------------------------------

REM Check Node.js is installed and on PATH
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not on PATH.
    echo.
    echo   1. Download Node.js LTS from https://nodejs.org/
    echo   2. Run the installer with default options
    echo   3. Restart this launcher after installation
    echo.
    pause
    exit /b 1
)

REM Check .env.local exists
if not exist ".env.local" (
    echo [ERROR] .env.local not found in this folder.
    echo.
    echo You need to create .env.local with your Supabase, Anthropic,
    echo Resend, and intake-webhook keys before the app will run.
    echo.
    echo   1. Copy .env.example to .env.local
    echo   2. Fill in the values ^(see README.md, Prerequisites section^)
    echo   3. Re-run this launcher
    echo.
    pause
    exit /b 1
)

REM First-time setup: install dependencies if missing
if not exist "node_modules" (
    echo First-time setup detected. Installing dependencies...
    echo This may take 3-5 minutes. Subsequent launches will skip this step.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check the errors above.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed.
    echo.
)

REM ---------------------------------------------------------------------------
REM  Launch dev server in a separate window
REM ---------------------------------------------------------------------------

echo Starting dev server in a new window...
echo   ^(Close that window to stop the app^)
echo.
start "NuRock Dev Server - close to stop" cmd /k "npm run dev"

REM Wait for the server to boot. Next.js typically takes 4-8 seconds.
echo Waiting 10 seconds for server to boot...
timeout /t 10 /nobreak >nul

REM ---------------------------------------------------------------------------
REM  Open the app in Chrome (fall back to default browser if not installed)
REM ---------------------------------------------------------------------------

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" ^
    set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" ^
    set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" ^
    set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
    echo Opening Chrome at http://localhost:3050 ...
    start "" "%CHROME%" "http://localhost:3050"
) else (
    echo Chrome not found in standard locations.
    echo Opening default browser at http://localhost:3050 ...
    start "" "http://localhost:3050"
)

echo.
echo ============================================================
echo   NuRock Utilities AP is now running
echo     URL:   http://localhost:3050
echo     Stop:  close the "NuRock Dev Server" window
echo ============================================================
echo.
echo This launcher window will close in 10 seconds.
timeout /t 10 /nobreak >nul
endlocal
