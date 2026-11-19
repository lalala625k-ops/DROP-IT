@echo off
setlocal
set "PORTABLE=%~dp0release\Drop-it 0.1.1"
if exist "%PORTABLE%\DropIt.exe" (
    start "" "%PORTABLE%\DropIt.exe"
    exit /b 0
)
call "%~dp0Start-DropIt.bat" %*
exit /b %errorlevel%
