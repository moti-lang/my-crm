@echo off
chcp 65001 > nul
title geo-engine

echo.
echo   ================================================
echo     Downloading... please wait
echo   ================================================
echo.

set "PS1=%TEMP%\geo-setup.ps1"
set "URL=https://raw.githubusercontent.com/moti-lang/my-crm/claude/already-sending-continued-np8pr6/geo-engine/setup-windows.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%URL%' -OutFile '%PS1%' -UseBasicParsing } catch { exit 1 }"

if not exist "%PS1%" goto :failed

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto :end

:failed
echo.
echo   Download failed. Check your internet connection and try again.
echo.
pause

:end
