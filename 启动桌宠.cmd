@echo off
setlocal
cd /d "%~dp0"
start "绘梨衣桌宠" "%~dp0node_modules\electron\dist\electron.exe" --no-sandbox "%~dp0"
