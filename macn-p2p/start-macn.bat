@echo off
title MACN - Avvio Automatico (Cloudflare Tunnel)
color 0A

REM AGGIUNGI NODE.JS AL PATH TEMPORANEAMENTE
set PATH=%PATH%;C:\Program Files\nodejs

echo.
echo ========================================
echo    MACN - P2P Computing Startup
echo ========================================
echo.

REM Avvia Coturn in WSL con finestra interattiva
echo [1/3] Avvio Coturn (TURN server)...
echo Inserisci la password sudo nella finestra WSL che si apre!
start "Coturn TURN Server" wsl bash -c "cd '%CD%' && ./start-coturn.sh"
timeout /t 3 /nobreak >nul

REM Avvia signaling server
echo [2/3] Avvio Signaling Server...
start "MACN Signaling Server" cmd /k "set PATH=%PATH%;C:\Program Files\nodejs && cd /d %~dp0 && node signaling-server.js"
timeout /t 3 /nobreak >nul

REM Avvia Cloudflare Tunnel con script personalizzato
echo [3/3] Avvio Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "%~dp0start-tunnel.bat"
timeout /t 3 /nobreak >nul

REM Apri browser
echo.
echo [OK] Apertura client MACN...
timeout /t 5 /nobreak >nul
start http://localhost:3000/client.html

echo.
echo ========================================
echo  MACN avviato con successo!
echo ========================================
echo.
echo Servizi attivi:
echo  - Coturn (WSL) - CONTROLLA FINESTRA WSL!
echo  - Signaling Server  
echo  - Cloudflare Tunnel (ILLIMITATO!)
echo  - Browser (Client MACN)
echo.
echo ========================================
echo  📡 COPIA L'URL DALLA FINESTRA:
echo     "Cloudflare Tunnel"
echo.
echo  L'URL completo è gia pronto da copiare!
echo ========================================
echo.
echo IMPORTANTE: Lascia aperta la finestra WSL!
echo.
pause