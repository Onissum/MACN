@echo off
title MACN - Arresto
color 0C
echo.
echo ========================================
echo    MACN - Arresto servizi
echo ========================================
echo.

REM Ferma Coturn
echo Arresto Coturn...
wsl -e sudo systemctl stop coturn

REM Chiudi finestre Node e ngrok
echo Chiusura processi Node.js e ngrok...
taskkill /FI "WINDOWTITLE eq MACN Signaling Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ngrok*" /F >nul 2>&1
taskkill /IM node.exe /F >nul 2>&1
taskkill /IM ngrok.exe /F >nul 2>&1

echo.
echo [OK] MACN arrestato!
echo.
pause