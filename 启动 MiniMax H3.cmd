@echo off
setlocal
set "COMFY_ROOT=D:\大肥鱼\ComfyUI"
set "PYTHON_EXE=C:\Users\linjunxin\AppData\Local\Programs\Python\Python312\python.exe"
set "PYTHONPATH=D:\dafeiyu\sing\venv\Lib\site-packages"
set "MODEL_CONFIG=%~dp0scripts\minimax-h3-model-paths.yaml"

if not exist "%PYTHON_EXE%" (
  echo 找不到 ComfyUI 使用的 Python 3.12：%PYTHON_EXE%
  pause
  exit /b 1
)
if not exist "%COMFY_ROOT%\main.py" (
  echo 找不到现有 ComfyUI：%COMFY_ROOT%
  pause
  exit /b 1
)
if not exist "%~dp0.minimax-h3-models\diffusion_models\minimax_h3_fl2va_pruned_int8_convrot.safetensors" (
  echo MiniMax H3 权重还没有下载完成，请先运行 scripts\download-minimax-h3.cmd
  pause
  exit /b 1
)

cd /d "%COMFY_ROOT%"
echo 正在启动 MiniMax H3 ComfyUI，浏览器地址：http://127.0.0.1:8190
"%PYTHON_EXE%" main.py ^
  --extra-model-paths-config "%MODEL_CONFIG%" ^
  --lowvram ^
  --disable-pinned-memory ^
  --use-ck-attention ^
  --reserve-vram 1 ^
  --mmap-torch-files ^
  --disable-assets ^
  --output-directory "%~dp0.minimax-h3-output" ^
  --temp-directory "%~dp0.minimax-h3-temp" ^
  --listen 127.0.0.1 ^
  --port 8190
pause
