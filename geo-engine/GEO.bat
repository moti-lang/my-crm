@echo off
chcp 65001 > nul
title מנוע בדיקת נראות

cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js לא מותקן במחשב הזה.
  echo   הרץ קודם את RUN-ME.bat
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\better-sqlite3" (
  echo.
  echo   הספריות חסרות. הרץ קודם את RUN-ME.bat
  echo.
  pause
  exit /b 1
)

echo.
echo   פותח את הממשק...
echo   אל תסגור את החלון הזה כל עוד אתה עובד.
echo.

node src\app.js

echo.
echo   הממשק נסגר.
echo.
pause
