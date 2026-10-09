@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19 or newer is required. Install Node.js LTS from https://nodejs.org/
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number); if (major<20 || major===21 || (major===20 && minor<19) || (major===22 && minor<12)) process.exit(1)"
if errorlevel 1 (
  echo Use Node.js 20.19+ or 22.12+.
  node --version
  exit /b 1
)

if not exist node_modules (
  echo Installing frontend dependencies...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

echo Starting the local API at http://127.0.0.1:3001
start "What Did I Miss API" cmd /c "npm.cmd run dev:api"
timeout /t 2 /nobreak >nul
echo Starting WHAT DID I MISS? at http://127.0.0.1:5173
call npm.cmd run dev
