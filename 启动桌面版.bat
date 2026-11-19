@echo off
setlocal
call "%~dp0Start-DropIt.bat" %*
exit /b %errorlevel%
