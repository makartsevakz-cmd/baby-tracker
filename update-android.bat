@echo off
cls
echo.
echo ====================================
echo   Baby Tracker - Android Update
echo ====================================
echo.

echo [1/7] Cleaning old build...
cd android
call gradlew.bat clean
if %errorlevel% neq 0 (
    echo ERROR: Failed to clean
    pause
    exit /b 1
)
cd ..
echo Done.
echo.

echo [2/7] Building React app...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build React
    pause
    exit /b 1
)
echo Done.
echo.

echo [3/7] Syncing with Capacitor...
call npx cap sync android
if %errorlevel% neq 0 (
    echo ERROR: Failed to sync
    pause
    exit /b 1
)
echo Done.
echo.

echo [4/7] Uninstalling old app...
adb uninstall com.babytracker.app 2>nul
echo Done.
echo.

echo [5/7] Building APK...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    echo ERROR: Failed to build APK
    cd ..
    pause
    exit /b 1
)
cd ..
echo Done.
echo.

echo [6/7] Checking phone connection...
adb devices > temp.txt
findstr /C:"device" temp.txt > nul
if %errorlevel% neq 0 (
    echo ERROR: Phone not connected!
    echo Please connect your phone via USB.
    del temp.txt
    pause
    exit /b 1
)
del temp.txt
echo Phone connected.
echo.

echo [7/7] Installing app...
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
if %errorlevel% neq 0 (
    echo ERROR: Failed to install
    pause
    exit /b 1
)
echo Done.
echo.

echo ====================================
echo   SUCCESS! Check your phone.
echo ====================================
echo.
pause