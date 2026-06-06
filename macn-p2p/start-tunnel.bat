@echo off
color 0A
title Cloudflare Tunnel - MACN
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║       🌐 CLOUDFLARE TUNNEL - MACN P2P            ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo Avvio tunnel e generazione URL...
echo Attendi 10 secondi...
echo.

REM Avvia cloudflared in background e cattura output
start /B cloudflared tunnel --url http://localhost:3000 > "%~dp0tunnel-temp.txt" 2>&1

REM Aspetta che il tunnel si attivi
timeout /t 10 /nobreak >nul

REM Estrai URL
for /f "tokens=*" %%a in ('powershell -Command "if(Test-Path '%~dp0tunnel-temp.txt'){Get-Content '%~dp0tunnel-temp.txt' | Select-String 'https://.*\.trycloudflare\.com' | ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1}"') do set TUNNEL_URL=%%a

cls
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║       ✅ TUNNEL ATTIVO E PRONTO!                 ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo 📱 URL COMPLETO per dispositivi esterni:
echo.
if defined TUNNEL_URL (
    echo    %TUNNEL_URL%/client.html
    echo.
    echo 🔌 URL Server per campo "URL Server":
    echo.
    echo    %TUNNEL_URL:https://=wss://%
    echo.
    echo ══════════════════════════════════════════════════
    echo 💡 Copia uno degli URL sopra e usalo sui dispositivi
    echo ══════════════════════════════════════════════════
) else (
    echo    ⚠️ URL non ancora disponibile
    echo    Riavvia o attendi qualche secondo...
)
echo.
echo ════════════════════════════════════════════════════
echo Log completo tunnel:
echo ════════════════════════════════════════════════════
echo.

REM Mostra output tunnel in tempo reale
cloudflared tunnel --url http://localhost:3000