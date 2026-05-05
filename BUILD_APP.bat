@echo off
echo.
echo ============================================================
echo   Building for local/offline usage
echo ============================================================
echo.

if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

echo [INFO] Building the application...
call npm run build

echo.
echo [SUCCESS] Build complete!
echo [INFO] You can find the output in the "dist" folder.
echo [INFO] Note: Some browser features may require a local server to work correctly.
echo.

pause
