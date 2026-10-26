@echo off
cd /d "%~dp0"
chcp 65001 > nul
title TeacherOS Pro
cls
echo Starting TeacherOS Pro...
start http://localhost:3000
node server.js
pause
