@echo off
cd /d "%~dp0"
chcp 65001 > nul
start "" "%~dp0index.html"
exit
