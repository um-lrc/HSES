@echo off
echo.
echo ============================================================
echo   Practice High-Stakes Academic English Simulator
echo ============================================================
echo.

:: Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Please ensure Node.js is installed.
        pause
        exit /b %errorlevel%
    )
)

echo [INFO] Starting the application...
echo [INFO] Access the app at http://localhost:3000
echo.

call npm run dev -- --port 3000

pause
