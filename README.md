# 桌宠项目

这是同一角色陪伴系统的 Windows 桌面原型，使用 Electron 实现。

## 当前交互

- 待机 / 左右行走 / 转身 / 吃东西四组动作轮播
- 按住角色拖动可移动桌宠，松开后留在新位置
- 角色高 225 像素，透明背景直接显示在桌面上
- 右键点击角色，菜单里有「打开绘梨衣对话」和「退出」
- 窗口贴近动画尺寸，人物轮廓外的空白区域可点击穿透

## 角色素材

- `assets/idle.webm` 待机动画，`idle-poster.png` 首帧预览
- `assets/walk-left.webm`、`walk-right.webm` 左右行走
- `assets/turn-left-right.webm`、`turn-right-left.webm` 左右转身
- `assets/eat.webm` 吃东西
- `*.layout.json` 保存每组动画的显示尺寸与轮廓，供点击穿透使用
- `assets/turnaround-source.png` 原始三视图，`character-*.png` 为透明切图

## 本地运行

本机可双击桌面上的“绘梨衣桌宠”快捷方式启动。重复启动会显示已有窗口。

需要安装 Node.js 当前 LTS 版本。

    npm install
    npm start

语音、视频互动、手机控制和实体机器人会在后续阶段加入。

## 与绘梨衣对话窗口联动

右键菜单里的「打开绘梨衣对话」会启动本机 `Documents\绘梨衣对话` 的独立对话窗口；
语音通话（麦克风 + 绘梨衣语音）也运行在那个窗口里，本仓库只包含桌宠本体。

## 不入库的大文件

`.minimax-h3-models/` 是本地视频生成模型（约 38 GB），已被 `.gitignore` 排除；
克隆仓库后按需重新下载，不影响桌宠运行。

## 替换待机动画

准备纯绿幕视频后，使用已安装的 Python 和 FFmpeg 转换素材：

    python scripts/prepare-idle.py "待机动画.mp4" --height 225

然后重新启动桌宠。转换过程会自动去绿幕、去音轨、裁掉留白，并重新计算窗口的可点击轮廓。

## MiniMax H3 本地部署

本机检测到 NVIDIA RTX 5060 Laptop GPU（8GB 显存）和约 16GB 系统内存。项目附带了面向该配置的 ComfyUI 启动与下载脚本：

- 运行 `scripts\download-minimax-h3.cmd` 下载官方 Comfy-Org 的 FL2VA 量化组件。总量约 40GiB，使用 ModelScope 镜像，支持断点续传。
- 下载完成后双击 `启动 MiniMax H3.cmd`，ComfyUI 会在 `http://127.0.0.1:8190` 启动。
- 工作流使用 `pruned INT8 ConvRot` 扩散模型、`NVFP4 AWQ` 文本编码器和 `INT8` 视频 VAE；这是 8GB 显存配置的兼容档，先从 608×352、5 秒、24fps 开始测试。
- 如果模板库显示为空，把 `docs\MiniMax H3 Image to Video.json` 拖到 ComfyUI 画布即可载入已配好的工作流。
- 桌面上的 `MiniMax H3.lnk` 是一键入口：点击后会自动启动服务并打开页面；服务已运行时会直接打开页面。

模型文件保存在 `.minimax-h3-models/`，不会进入 Git。H3 是视频与音频生成模型，不能替换绘梨衣对话窗口里的文本聊天模型。

