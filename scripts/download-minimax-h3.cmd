@echo off
setlocal
cd /d "%~dp0.."
set "BASE=https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master"
set "ROOT=%CD%\.minimax-h3-models"
set "PYTHON_EXE=D:\python\python.exe"
if not exist "%ROOT%\diffusion_models" mkdir "%ROOT%\diffusion_models"
if not exist "%ROOT%\text_encoders" mkdir "%ROOT%\text_encoders"
if not exist "%ROOT%\vae" mkdir "%ROOT%\vae"
if not exist "%ROOT%\loras" mkdir "%ROOT%\loras"

echo This downloads about 40 GiB of official Comfy-Org MiniMax H3 weights.
echo The downloader resumes incomplete files and uses ModelScope as the mirror.
echo.
"%PYTHON_EXE%" scripts\download-range.py "%BASE%/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" "%ROOT%\diffusion_models\minimax_h3_fl2va_pruned_int8_convrot.safetensors" --workers 12 --chunk-gib 0.0625
"%PYTHON_EXE%" scripts\download-range.py "%BASE%/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" "%ROOT%\text_encoders\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" --workers 12 --chunk-gib 0.0625
"%PYTHON_EXE%" scripts\download-range.py "%BASE%/vae/minimax_h3_video_vae_int8_convrot.safetensors" "%ROOT%\vae\minimax_h3_video_vae_int8_convrot.safetensors" --workers 12 --chunk-gib 0.0625
"%PYTHON_EXE%" scripts\download-range.py "%BASE%/vae/minimax_h3_audio_vae_fp32.safetensors" "%ROOT%\vae\minimax_h3_audio_vae_fp32.safetensors" --workers 12 --chunk-gib 0.0625
echo.
echo MiniMax H3 base weights are ready. Optional Turbo LoRA is not downloaded by default.
pause
