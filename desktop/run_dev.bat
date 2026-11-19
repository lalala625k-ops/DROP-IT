@echo off
setlocal
call "%~dp0..\Start-DropIt.bat" -Dev %*
exit /b %errorlevel%
