@echo off
REM Quick install - use when you already built the APK

echo.
echo Quick Install to Phone
echo ======================
echo.

echo Checking phone connection...
adb devices | findstr "device" > nul
if %errorlevel% neq 0 (
    echo ERROR: Phone not connected!
    pause
    exit /b 1
)

echo Uninstalling old version...
adb uninstall com.babytracker.app 2>nul

echo Installing new version...
adb install -r android\app\build\outputs\apk\debug\app-debug.apk

if %errorlevel% neq 0 (
    echo ERROR: Installation failed
    pause
    exit /b 1
)

echo.
echo SUCCESS! App installed.
echo.
pause
