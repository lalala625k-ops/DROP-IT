@echo off
setlocal
title DROP-IT
set "DROPIT_PAUSE=1"
for %%A in (%*) do (
    if /i "%%~A"=="-NonInteractive" set "DROPIT_PAUSE="
    if /i "%%~A"=="-PrepareOnly" set "DROPIT_PAUSE="
)
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap\SourceBootstrap.ps1" %*
set "DROPIT_EXIT=%errorlevel%"
if not "%DROPIT_EXIT%"=="0" (
    echo.
    if "%DROPIT_EXIT%"=="3010" (echo Please restart Windows and open DROP-IT again.) else (echo DROP-IT did not finish. See the message and log path above.)
    if defined DROPIT_PAUSE pause
)
exit /b %DROPIT_EXIT%
