@echo off
setlocal
call "%~dp0..\Start-DropIt.bat" %*
exit /b %errorlevel%
