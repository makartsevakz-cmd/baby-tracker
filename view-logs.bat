@echo off
REM View logs from Android device

echo.
echo Android Logs Viewer
echo ===================
echo.
echo Press Ctrl+C to stop viewing logs
echo.

timeout /t 2 /nobreak > nul

REM Filter logs for our app
adb logcat | findstr /I "Baby React Capacitor Chromium ERROR"
