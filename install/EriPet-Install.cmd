@echo off
chcp 936 >nul
title 绘梨衣桌宠 - 一键安装
setlocal

echo ================================================
echo    绘梨衣桌宠  一键安装
echo ================================================
echo.
echo  这个脚本会：
echo    1. 从 GitHub 取最新安装包
echo    2. 下载到临时目录
echo    3. 启动安装程序
echo.
echo  为什么不用浏览器下载：浏览器会给文件打上
echo  「来自网络」的标记，Windows 就会弹安全提示。
echo  这里用系统接口直接下载，可以避开这个提示。
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$api='https://api.github.com/repos/Ricardo-M-Lin/desktop-pet/releases/latest';" ^
  "Write-Host '正在查询最新版本...';" ^
  "$r=Invoke-RestMethod -Uri $api -UseBasicParsing;" ^
  "$a=$r.assets | Where-Object { $_.name -like '*setup*.exe' } | Select-Object -First 1;" ^
  "if(-not $a){ throw '没有找到安装包，请手动下载：https://github.com/Ricardo-M-Lin/desktop-pet/releases/latest' };" ^
  "$out=Join-Path $env:TEMP $a.name;" ^
  "Write-Host ('正在下载 ' + $a.name + ' (' + [math]::Round($a.size/1MB,1) + ' MB)');" ^
  "Invoke-WebRequest -Uri $a.browser_download_url -OutFile $out -UseBasicParsing;" ^
  "Write-Host '下载完成，正在启动安装程序...';" ^
  "Start-Process -FilePath $out"

if errorlevel 1 (
  echo.
  echo 下载失败。可能是网络问题，请手动打开：
  echo https://github.com/Ricardo-M-Lin/desktop-pet/releases/latest
)

echo.
echo 安装程序已启动，按任意键关闭本窗口。
pause >nul
