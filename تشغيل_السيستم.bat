@echo off
cd /d "%~dp0"
chcp 65001 > nul
title نظام المساعد الذكي للمدرسين - TeacherOS Pro
cls
echo =======================================================
echo    🚀 جاري تشغيل نظام المساعد الذكي للمدرسين v2.0 Pro
echo =======================================================
echo.
echo 🔗 جاري فتح المتصفح على: http://localhost:3000
echo.
start http://localhost:3000
node server.js
pause
