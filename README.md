# 桌宠项目

这是同一角色陪伴系统的 Windows 桌面原型，使用 Electron 实现。

## 当前交互

- 待机 / 左右行走 / 转身 / 吃东西四组动作轮播
- 按住角色拖动可移动桌宠，松开后留在新位置
- 角色高 225 像素，透明背景直接显示在桌面上
- 右键点击角色，菜单里有「打开绘梨衣对话」「视频通话」和「退出」
- 她在说话时，桌宠会停下走动、站定
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

## 对话窗口（已并入本应用）

对话窗与视频通话都跑在桌宠进程里，不再单独启动第二个 Electron：

- 右键桌宠 →「打开绘梨衣对话」/「视频通话」
- 对话窗 `src/chat/`，通话窗 `src/chat/call.html`，后端 `electron/chat-backend.cjs`
- 配置沿用旧版对话窗的数据（首次启动自动迁移）
- 点头像打开快捷菜单：视频通话 / 更换性格 / 记忆 / 声音 / 设置
- 「记忆」打开识海面板：默认是**星云图**（每条记忆一颗星，拖动平移、滚轮缩放、悬停看内容、点开可删），另含事实 / 未完成 / 时间线 / 自我 / 语气分类视图

## 替换待机动画

准备纯绿幕视频后，使用已安装的 Python 和 FFmpeg 转换素材：

    python scripts/prepare-idle.py "待机动画.mp4" --height 225

然后重新启动桌宠。转换过程会自动去绿幕、去音轨、裁掉留白，并重新计算窗口的可点击轮廓。

