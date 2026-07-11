@echo off
setlocal
cd /d "%~dp0"
title MACN + ComputeRTC v0.5.2
color 0B

echo.
echo ==============================================
echo      MACN + ComputeRTC v0.5.2 - TEST LOCALE
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRORE: Node.js non risulta installato.
  pause
  exit /b 1
)

if not exist "node_modules\socket.io" (
  echo Installazione dipendenze...
  call npm install
  if errorlevel 1 (
    echo Installazione non riuscita.
    pause
    exit /b 1
  )
)

echo Avvio del server di signaling...
start "MACN ComputeRTC Server" cmd /k "cd /d %~dp0 && node signaling-server.js"
timeout /t 3 /nobreak >nul

echo Apertura di due peer nel browser...
start "" "http://localhost:3002/client.html?v=0.5.2"
timeout /t 1 /nobreak >nul
start "" "http://localhost:3002/client.html?v=0.5.2"

echo.
echo Nelle due schede:
echo  1. premi CONNETTI AL SERVER;
echo  2. in una scheda premi CONNETTI TUTTI;
echo  3. attendi la scritta CONTROL + DATA;
echo  4. avvia il test MACN.
echo.
echo Per terminare chiudi anche la finestra del server.
pause
