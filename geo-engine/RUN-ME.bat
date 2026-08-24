@echo off
chcp 65001 > nul
title geo-engine

set "PS1=%TEMP%\geo-setup.ps1"
set "URL=https://raw.githubusercontent.com/moti-lang/my-crm/claude/already-sending-continued-np8pr6/geo-engine/setup-windows.ps1"

echo.
echo   Downloading...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%URL%' -OutFile '%PS1%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"

if not exist "%PS1%" (
  echo.
  echo   Download failed. Check your internet connection.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

echo.
echo   ------------------------------------------------
echo    Script finished with exit code %ERRORLEVEL%
echo    Log file: %USERPROFILE%\geo-engine-log.txt
echo   ------------------------------------------------
echo.
pause
