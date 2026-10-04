@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo [First run] Installing dependencies, please wait...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies. Please check Node.js and your network.
    pause
    exit /b 1
  )
)

echo Starting file transfer station...
echo Local: http://localhost:3000
npm start
pause
