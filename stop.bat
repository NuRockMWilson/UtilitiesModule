@echo off
REM ============================================================================
REM  NuRock Utilities AP - Stop dev server
REM  Kills any node.exe process listening on port 3050.
REM ============================================================================
setlocal
title NuRock Utilities AP - Stop

echo Stopping NuRock Utilities AP dev server...

REM Find the PID of whatever is listening on port 3050 and kill it
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3050 ^| findstr LISTENING') do (
    echo   Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo Done.
timeout /t 3 /nobreak >nul
endlocal
