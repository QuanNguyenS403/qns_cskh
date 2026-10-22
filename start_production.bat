@echo off
title QuanNguyenS AI CSKH (May) - Production 24/7
cd /d "%~dp0"
echo ==============================================================================
echo   QUANNGUYENS AI AGENT CSKH (MAY) - KHOI CHAY HE THONG PRODUCTION 24/7
echo ==============================================================================
echo  - Cong lang nghe: 3002
echo  - Cac kenh tich hop: Messenger, Instagram, Threads, Zalo OA, SePay, VietQR
echo  - Ban quyen: QuanNguyenS (quannguyens.com)
echo ==============================================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] May tinh chua cai dat Node.js! Vui long cai Node.js LTS tu https://nodejs.org
    pause
    exit /b 1
)

echo Dang khoi chay Gateway may chu AI...
npm start
if %errorlevel% neq 0 (
    echo.
    echo [CANH BAO] May chu dung dot ngot voi ma loi: %errorlevel%
    pause
)
