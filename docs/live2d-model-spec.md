# 绯红巫女 Live2D 通话模型

## 参考底稿

- 文件：`C:\Users\linjunxin\Pictures\桌宠图\绯红巫女与流霞长发.png`
- 形态：正面胸像通话形象
- 画面范围：按红线裁切到胸口和腰带上方，默认画面不露出双手；双手作为需要时从下方出现的动作层
- 背景：透明
- 目标画布：2048 × 2048

## PSD 图层结构

```text
Live2D_Erii_Call
├─ 00_guide
│  └─ reference_flat
├─ 01_body
│  ├─ neck
│  ├─ torso
│  ├─ left_sleeve
│  ├─ right_sleeve
│  ├─ collar
│  ├─ obi
│  └─ chest_ornament
├─ 02_back_hair
│  ├─ back_hair_main
│  ├─ back_hair_left
│  ├─ back_hair_right
│  └─ long_hair_tips
├─ 03_face
│  ├─ face_base
│  ├─ ears
│  ├─ nose_shadow
│  ├─ blush_left
│  └─ blush_right
├─ 04_front_hair
│  ├─ bangs_main
│  ├─ bang_left
│  ├─ bang_right
│  ├─ side_lock_left
│  └─ side_lock_right
├─ 05_eyes
│  ├─ eye_white_left
│  ├─ eye_white_right
│  ├─ iris_left
│  ├─ iris_right
│  ├─ pupil_left
│  ├─ pupil_right
│  ├─ highlight_left
│  ├─ highlight_right
│  ├─ upper_lid_left
│  ├─ upper_lid_right
│  ├─ lower_lid_left
│  ├─ lower_lid_right
│  ├─ eyebrow_left
│  └─ eyebrow_right
├─ 06_mouth
│  ├─ mouth_neutral
│  ├─ mouth_smile
│  ├─ mouth_open_small
│  ├─ mouth_open_wide
│  └─ mouth_shy
├─ 07_accessories
│  ├─ hair_bow_left
│  ├─ hair_bow_right
│  ├─ tassel_left
│  ├─ tassel_right
│  └─ hair_ornament_highlight
├─ 08_expression
   ├─ blush_strong
   ├─ happy_eye_left
   ├─ happy_eye_right
   ├─ sweat_drop
   └─ tear
└─ 09_hand_gestures
   ├─ hand_wave_left
   ├─ hand_wave_right
   ├─ hand_heart
   └─ hand_greeting
```

## 第一版参数

| 参数 | 范围 | 用途 |
|---|---:|---|
| `ParamAngleX` | -30 到 30 | 头部左右转动 |
| `ParamAngleY` | -20 到 20 | 抬头、低头 |
| `ParamAngleZ` | -15 到 15 | 歪头 |
| `ParamEyeBallX` | -1 到 1 | 瞳孔左右跟随 |
| `ParamEyeBallY` | -1 到 1 | 瞳孔上下跟随 |
| `ParamEyeLOpen` | 0 到 1 | 左眼开合 |
| `ParamEyeROpen` | 0 到 1 | 右眼开合 |
| `ParamBrowLY` | -1 到 1 | 左眉表情 |
| `ParamBrowRY` | -1 到 1 | 右眉表情 |
| `ParamMouthOpenY` | 0 到 1 | 嘴巴开合 |
| `ParamMouthForm` | -1 到 1 | 嘴型：平静、微笑、害羞 |
| `ParamBreath` | 0 到 1 | 呼吸和身体起伏 |
| `ParamHairSway` | -1 到 1 | 长发和发饰摆动 |

## 第一版表情

- `neutral`：平静待机
- `smile`：轻微微笑
- `shy`：脸红、眼睛弯曲
- `surprised`：睁大眼睛、张嘴
- `sad`：眉毛下压、眼神变柔
- `blink`：左右眼自然闭合
- `talk`：嘴巴开合循环

## 验收顺序

1. 头部左右、上下、歪头时没有露出空洞。
2. 瞳孔跟随方向自然，眼白和眼皮不穿插。
3. 眨眼时上下眼皮闭合完整。
4. 嘴巴四种形态切换没有白边或透明洞。
5. 长发、蝴蝶结和袖子有轻微物理摆动。
6. 导出 Web 模型后可以在 Electron 通话窗口加载。
