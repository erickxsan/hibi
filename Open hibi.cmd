@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open hibi.ps1"
if errorlevel 1 (
  echo.
  echo hibi could not be opened. See the message above.
  pause
)
