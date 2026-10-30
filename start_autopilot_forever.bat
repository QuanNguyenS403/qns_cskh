@echo off
title QuanNguyenS AI CSKH - AutoPilot 24/7 Supervisor
cd /d "%~dp0"

echo ==============================================================================
echo   QUANNGUYENS AI AGENT CSKH - HE THONG AUTO-PILOT 24/7 (SELF-HEALING)
echo ==============================================================================
echo  - Che do: Tu dong quet va tra loi Meta Business Suite (Messenger + Instagram)
echo  - Co che: Tu dong khoi dong lai khi trinh duyet bi crash (Khong bao gio dung)
echo  - Bao ve: Tu dong dong bang ngay neu Meta yeu cau xac minh Checkpoint / 2FA
echo ==============================================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] May tinh chua cai dat Node.js! Vui long cai Node.js tu https://nodejs.org
    pause
    exit /b 1
)

:loop
echo [%date% %time%] Dang khoi chay Supervisor giam sat 24/7...
node scripts/autopilot_supervisor.js
echo.
echo [CANH BAO] Supervisor bi ngat! Tu dong khoi dong lai sau 5 giay...
timeout /t 5 /nobreak >nul
goto loop
