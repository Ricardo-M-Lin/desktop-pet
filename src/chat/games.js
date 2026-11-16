/* ------------------------------------------------------------------ */
/* 小游戏：格斗 + 小本子                                               */
/* ------------------------------------------------------------------ */

const GAME_ASSETS = {
  char: "../assets/eri-avatar.png",
  charLoaded: false,
};

const FIGHT = {
  canvas: null,
  ctx: null,
  raf: 0,
  running: false,
  keys: {},
  keysBound: false,
  W: 900,
  H: 480,
  hitstop: 0,
  shake: 0,
  particles: [],
  floaters: [],
  round: 1,
  wins: [0, 0],
  timer: 60,
  over: false,
  result: "",
  banner: null,
  player: null,
  ai: null,
  lastTime: 0,
  superP1: 0,
  superP2: 0,
};

const NOTEBOOK = {
  step: 0,
  score: 0,
  hearts: 3,
  lines: [],
  current: null,
  deck: [],
};

/* ---------------------------- 工具 ---------------------------- */

function gameRandom(n) {
  return Math.floor(Math.random() * n);
}

function loadGameAssets() {
  if (GAME_ASSETS.charLoaded) return;
  const img = new Image();
  img.src = GAME_ASSETS.char;
  img.onload = () => {
    GAME_ASSETS.charImg = img;
    GAME_ASSETS.charLoaded = true;
  };
}

function openGames() {
  const modal = document.getElementById("games");
  if (!modal) return;
  modal.hidden = false;
  showGamesMenu();
  loadGameAssets();
}

function closeGames() {
  const modal = document.getElementById("games");
  if (modal) modal.hidden = true;
  stopFight();
}

function showGamesMenu() {
  stopFight();
  const menu = document.getElementById("games-menu");
  const stage = document.getElementById("games-stage");
  const nb = document.getElementById("games-notebook");
  if (menu) menu.hidden = false;
  if (stage) stage.hidden = true;
  if (nb) nb.hidden = true;
}

/* ---------------------------- 格斗 ---------------------------- */

const ATTACKS = {
  jab: { startup: 4, active: 3, recovery: 6, damage: 4, range: 58, knock: 3, meter: 8 },
  heavy: { startup: 8, active: 4, recovery: 12, damage: 9, range: 74, knock: 6, meter: 12 },
  kick: { startup: 7, active: 5, recovery: 10, damage: 7, range: 86, knock: 5, meter: 10 },
};

function makeFighter(isAI) {
  return {
    isAI,
    x: isAI ? 640 : 260,
    y: 0,
    vx: 0,
    vy: 0,
    facing: isAI ? -1 : 1,
    hp: 100,
    state: "idle",
    stateTime: 0,
    attack: null,
    attackTime: 0,
    hasHit: false,
    blocking: false,
    hitFlash: 0,
    walkPhase: 0,
    aiTimer: 0,
    aiMode: "approach",
    combo: 0,
    comboTimer: 0,
  };
}

function startFight() {
  const menu = document.getElementById("games-menu");
  const stage = document.getElementById("games-stage");
  if (menu) menu.hidden = true;
  if (stage) stage.hidden = false;

  FIGHT.canvas = document.getElementById("fight-canvas");
  FIGHT.ctx = FIGHT.canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  FIGHT.canvas.width = FIGHT.W * dpr;
  FIGHT.canvas.height = FIGHT.H * dpr;
  FIGHT.canvas.style.width = "100%";
  FIGHT.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  FIGHT.player = makeFighter(false);
  FIGHT.ai = makeFighter(true);
  FIGHT.round = 1;
  FIGHT.wins = [0, 0];
  FIGHT.timer = 60;
  FIGHT.over = false;
  FIGHT.result = "";
  FIGHT.banner = { text: "ROUND 1", time: 90 };
  FIGHT.hitstop = 0;
  FIGHT.shake = 0;
  FIGHT.particles = [];
  FIGHT.floaters = [];
  FIGHT.superP1 = 0;
  FIGHT.superP2 = 0;
  FIGHT.running = true;
  FIGHT.lastTime = performance.now();

  bindFightKeys();
  statusHint("← → 移动　↑ 跳　J 轻拳　K 重拳　L 踢　空格 防御　U 必杀");
  FIGHT.raf = requestAnimationFrame(fightLoop);
}

function stopFight() {
  FIGHT.running = false;
  if (FIGHT.raf) cancelAnimationFrame(FIGHT.raf);
  FIGHT.raf = 0;
  if (FIGHT.keysBound) {
    window.removeEventListener("keydown", fightKeyDown);
    window.removeEventListener("keyup", fightKeyUp);
    FIGHT.keysBound = false;
  }
}

function bindFightKeys() {
  if (FIGHT.keysBound) return;
  window.addEventListener("keydown", fightKeyDown);
  window.addEventListener("keyup", fightKeyUp);
  FIGHT.keysBound = true;
}

function fightKeyDown(event) {
  if (!FIGHT.running) return;
  const k = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) event.preventDefault();
  FIGHT.keys[k] = true;
  if (k === "u") trySuper(FIGHT.player, "p1");
}
function fightKeyUp(event) {
  FIGHT.keys[event.key.toLowerCase()] = false;
}

function statusHint(text) {
  const el = document.getElementById("fight-hint");
  if (el) el.textContent = text;
}

function trySuper(fighter, who) {
  if (!fighter || FIGHT.over) return;
  const meter = who === "p1" ? FIGHT.superP1 : FIGHT.superP2;
  if (meter < 100) return;
  if (who === "p1") FIGHT.superP1 = 0;
  else FIGHT.superP2 = 0;
  FIGHT.banner = { text: "言灵 · 审判", time: 70, super: true };
  const target = who === "p1" ? FIGHT.ai : FIGHT.player;
  if (target) {
    damage(target, 26, fighter, true);
  }
}

function damage(target, amount, from, superHit) {
  if (FIGHT.over) return;
  let dmg = amount;
  if (target.blocking && !superHit) dmg = Math.round(dmg * 0.25);
  target.hp = Math.max(0, target.hp - dmg);
  target.hitFlash = 14;
  FIGHT.hitstop = superHit ? 12 : 5;
  FIGHT.shake = superHit ? 16 : 6;
  const dir = target.x >= from.x ? 1 : -1;
  target.vx += dir * (superHit ? 9 : 3.5);
  if (!target.blocking || superHit) {
    target.state = "hit";
    target.stateTime = 0;
    from.combo += 1;
    from.comboTimer = 60;
  }
  addFloater(target.x, 120, "-" + dmg, "#ffd0d6");
  spawnParticles(target.x, 200, superHit ? 26 : 10, "#ffb3bd");
  if (target.hp <= 0) {
    endRound(from === FIGHT.player ? 0 : 1);
  }
}

function spawnParticles(x, y, n, color) {
  for (let i = 0; i < n; i += 1) {
    FIGHT.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 7 - 1,
      life: 30 + Math.random() * 20,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function addFloater(x, y, text, color) {
  FIGHT.floaters.push({ x, y, text, color, life: 45 });
}

function endRound(winner) {
  FIGHT.wins[winner] += 1;
  FIGHT.over = true;
  FIGHT.result = winner === 0 ? "你赢了这一局" : "她赢了这一局";
  FIGHT.banner = {
    text: FIGHT.wins[winner] >= 2 ? (winner === 0 ? "YOU WIN" : "SHE WINS") : "K.O.",
    time: 120,
  };
}

function resetRound() {
  FIGHT.player = makeFighter(false);
  FIGHT.ai = makeFighter(true);
  FIGHT.round += 1;
  FIGHT.timer = 60;
  FIGHT.over = false;
  FIGHT.banner = { text: "ROUND " + FIGHT.round, time: 80 };
  FIGHT.particles = [];
  FIGHT.floaters = [];
}

function fightLoop(now) {
  if (!FIGHT.running) return;
  const dt = Math.min(48, now - FIGHT.lastTime);
  FIGHT.lastTime = now;

  if (FIGHT.hitstop > 0) {
    FIGHT.hitstop -= 1;
    drawFight();
    FIGHT.raf = requestAnimationFrame(fightLoop);
    return;
  }

  updateFighter(FIGHT.player, FIGHT.ai, true, dt);
  updateAI(FIGHT.ai, FIGHT.player, dt);
  updateFighter(FIGHT.ai, FIGHT.player, false, dt);

  if (!FIGHT.over) {
    FIGHT.timer -= dt / 1000;
    if (FIGHT.timer <= 0) {
      FIGHT.timer = 0;
      endRound(FIGHT.player.hp >= FIGHT.ai.hp ? 0 : 1);
    }
  } else if (FIGHT.banner && FIGHT.banner.time <= 0) {
    if (FIGHT.wins[0] >= 2 || FIGHT.wins[1] >= 2) {
      FIGHT.banner = { text: FIGHT.wins[0] >= 2 ? "再来一局？（按 R）" : "她赢了……（按 R）", time: 9999 };
    } else {
      resetRound();
    }
  }

  if (FIGHT.banner) FIGHT.banner.time -= 1;

  for (const p of FIGHT.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.4;
    p.life -= 1;
  }
  FIGHT.particles = FIGHT.particles.filter((p) => p.life > 0);
  for (const f of FIGHT.floaters) {
    f.y -= 1.2;
    f.life -= 1;
  }
  FIGHT.floaters = FIGHT.floaters.filter((f) => f.life > 0);
  if (FIGHT.shake > 0) FIGHT.shake *= 0.86;

  drawFight();
  FIGHT.raf = requestAnimationFrame(fightLoop);
}

function fighterCanAct(f) {
  return ["idle", "walk", "block"].includes(f.state) || (f.state === "jump" && f.y > 30);
}

function startAttack(f, name) {
  if (!fighterCanAct(f)) return;
  if (f.attack || f.state === "hit" || f.state === "attack") return;
  f.state = "attack";
  f.attack = ATTACKS[name];
  f.attackTime = 0;
  f.hasHit = false;
}

function updateFighter(f, other, isPlayer, dt) {
  if (!f) return;
  f.stateTime += 1;
  if (f.hitFlash > 0) f.hitFlash -= 1;
  if (f.comboTimer > 0) {
    f.comboTimer -= 1;
    if (f.comboTimer === 0) f.combo = 0;
  }

  const dist = Math.abs(other.x - f.x);
  f.facing = other.x >= f.x ? 1 : -1;

  if (f.state === "hit") {
    f.vx *= 0.82;
    f.x += f.vx;
    if (f.stateTime > 18) {
      f.state = "idle";
      f.stateTime = 0;
    }
    clampFighter(f);
    return;
  }

  if (f.state === "attack" && f.attack) {
    const a = f.attack;
    f.attackTime += 1;
    const total = a.startup + a.active + a.recovery;
    if (isPlayer) f.vx = f.facing * 1.4;
    f.x += f.vx;
    f.vx *= 0.8;
    if (f.attackTime === a.startup + 1 && !f.hasHit) {
      if (dist < a.range && Math.abs(other.y - f.y) < 80) {
        f.hasHit = true;
        damage(other, a.damage, f, false);
        if (isPlayer) FIGHT.superP1 = Math.min(100, FIGHT.superP1 + a.meter);
        else FIGHT.superP2 = Math.min(100, FIGHT.superP2 + a.meter);
      }
    }
    if (f.attackTime >= total) {
      f.state = "idle";
      f.attack = null;
      f.stateTime = 0;
    }
    clampFighter(f);
    return;
  }

  if (f.state === "jump") {
    f.vy += 0.9;
    f.y -= f.vy;
    f.x += f.vx;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.state = "idle";
      f.stateTime = 0;
    }
    clampFighter(f);
    return;
  }

  if (isPlayer) {
    f.blocking = Boolean(FIGHT.keys[" "]);
    if (f.blocking) {
      f.state = "block";
      f.vx = 0;
      clampFighter(f);
      return;
    }

    let move = 0;
    if (FIGHT.keys["arrowleft"] || FIGHT.keys["a"]) move -= 1;
    if (FIGHT.keys["arrowright"] || FIGHT.keys["d"]) move += 1;
    if ((FIGHT.keys["arrowup"] || FIGHT.keys["w"]) && f.y === 0) {
      f.state = "jump";
      f.vy = 13;
      f.y = 1;
      f.vx = move * 3;
      FIGHT.keys["arrowup"] = false;
      FIGHT.keys["w"] = false;
      return;
    }
    if (FIGHT.keys["j"]) startAttack(f, "jab");
    if (FIGHT.keys["k"]) startAttack(f, "heavy");
    if (FIGHT.keys["l"]) startAttack(f, "kick");

    f.vx = move * 3.2;
    f.x += f.vx;
    f.walkPhase += Math.abs(move) * 0.2;
    f.state = move !== 0 ? "walk" : "idle";
    clampFighter(f);
    return;
  }

  // AI 物理
  f.x += f.vx;
  f.vx *= 0.8;
  clampFighter(f);
}

function clampFighter(f) {
  f.x = Math.max(70, Math.min(FIGHT.W - 70, f.x));
}

function updateAI(ai, player, dt) {
  if (FIGHT.over || ai.state === "hit" || ai.state === "attack") return;
  ai.aiTimer -= dt;
  const dist = Math.abs(player.x - ai.x);
  const lowHp = ai.hp < 35;
  const aggressive = lowHp ? 1 : 0;

  if (ai.aiTimer > 0) return;
  ai.aiTimer = 120 + gameRandom(180);

  if (player.blocking && dist < 90 && Math.random() < 0.4) {
    startAttack(ai, "kick");
    return;
  }

  if (dist > 140) {
    ai.vx = (player.x > ai.x ? 1 : -1) * (1.8 + aggressive * 0.8);
    ai.state = "walk";
    ai.walkPhase += 0.2;
    return;
  }

  if (dist < 70) {
    const roll = Math.random();
    if (roll < 0.35 + aggressive * 0.2) startAttack(ai, "jab");
    else if (roll < 0.6 + aggressive * 0.2) startAttack(ai, "heavy");
    else if (roll < 0.78) startAttack(ai, "kick");
    else if (roll < 0.88) {
      ai.vx = -(player.x > ai.x ? 1 : -1) * 1.6;
      ai.state = "walk";
    } else {
      ai.state = "idle";
    }
    return;
  }

  if (dist < 110) {
    if (Math.random() < 0.55) startAttack(ai, "kick");
    else {
      ai.vx = (player.x > ai.x ? 1 : -1) * 1.6;
      ai.state = "walk";
    }
  }
}

function drawFighter(f, colorTint) {
  const ctx = FIGHT.ctx;
  const img = GAME_ASSETS.charImg;
  const h = 200;
  const w = h * 0.72;
  const bob = f.state === "walk" ? Math.sin(f.walkPhase) * 4 : Math.sin(performance.now() / 500) * 2;
  const squash = f.state === "attack" ? 1.06 : f.state === "hit" ? 0.9 : 1;
  const footY = 372;
  const cx = f.x;
  const cy = footY - h * squash + f.y * 0.4 + bob;

  ctx.save();
  if (f.hitFlash > 0) ctx.globalAlpha = 0.85;
  if (img) {
    if (colorTint) {
      ctx.filter = "brightness(0.42) saturate(0.6) sepia(0.5) hue-rotate(215deg)";
    }
    ctx.drawImage(img, cx - w / 2, cy, w, h * squash);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = colorTint ? "#5a4a7a" : "#d96a75";
    ctx.fillRect(cx - w / 2, cy, w, h * squash);
  }
  if (f.hitFlash > 0) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ff9aa5";
    ctx.fillRect(cx - w / 2, cy, w, h * squash);
    ctx.globalAlpha = 1;
  }
  if (f.blocking) {
    ctx.strokeStyle = "rgba(150, 200, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + h * 0.45, 70, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFight() {
  const ctx = FIGHT.ctx;
  if (!ctx) return;
  const { W, H } = FIGHT;

  ctx.save();
  if (FIGHT.shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * FIGHT.shake, (Math.random() - 0.5) * FIGHT.shake);
  }

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1c0f16");
  bg.addColorStop(0.55, "#2a1620");
  bg.addColorStop(1, "#120a0e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 窗光
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.35, 10, W * 0.5, H * 0.35, W * 0.55);
  glow.addColorStop(0, "rgba(228, 105, 115, 0.16)");
  glow.addColorStop(1, "rgba(228, 105, 115, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 地面
  ctx.fillStyle = "rgba(255, 220, 230, 0.05)";
  ctx.fillRect(0, 380, W, 3);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  for (let x = 0; x < W; x += 60) {
    ctx.moveTo(x, 383);
    ctx.lineTo(x - 40, H);
  }
  ctx.stroke();

  drawFighter(FIGHT.player, true);
  drawFighter(FIGHT.ai, false);

  // 粒子 / 飘字
  for (const p of FIGHT.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 50);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 24px 'Microsoft YaHei UI', sans-serif";
  ctx.textAlign = "center";
  for (const f of FIGHT.floaters) {
    ctx.globalAlpha = Math.max(0, f.life / 45);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // HUD
  const barW = 300;
  const barH = 16;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(40, 28, barW, barH);
  ctx.fillRect(W - 40 - barW, 28, barW, barH);
  ctx.fillStyle = "#e46973";
  ctx.fillRect(40, 28, barW * (FIGHT.player.hp / 100), barH);
  ctx.fillStyle = "#8fd0ff";
  ctx.fillRect(W - 40 - barW * (FIGHT.ai.hp / 100), 28, barW * (FIGHT.ai.hp / 100), barH);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 28, barW, barH);
  ctx.strokeRect(W - 40 - barW, 28, barW, barH);

  // 超必杀槽
  ctx.fillStyle = "rgba(255, 200, 120, 0.75)";
  ctx.fillRect(40, 50, (barW * FIGHT.superP1) / 100, 5);
  ctx.fillRect(W - 40 - (barW * FIGHT.superP2) / 100, 50, (barW * FIGHT.superP2) / 100, 5);

  // 名字 + 计时
  ctx.font = "bold 15px 'Microsoft YaHei UI', sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffd9de";
  ctx.fillText("你", 40, 76);
  ctx.textAlign = "right";
  ctx.fillStyle = "#bfe4ff";
  ctx.fillText("上杉绘梨衣", W - 40, 76);
  ctx.textAlign = "center";
  ctx.font = "bold 30px 'Microsoft YaHei UI', sans-serif";
  ctx.fillStyle = "#fff1f3";
  ctx.fillText(String(Math.max(0, Math.ceil(FIGHT.timer))), W / 2, 46);
  ctx.font = "13px 'Microsoft YaHei UI', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("ROUND " + FIGHT.round, W / 2, 68);

  // 回合胜利小点
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.arc(W / 2 - 80 + i * 16, 86, 4, 0, Math.PI * 2);
    ctx.fillStyle = i < FIGHT.wins[0] ? "#e46973" : "rgba(255,255,255,0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W / 2 + 80 - i * 16, 86, 4, 0, Math.PI * 2);
    ctx.fillStyle = i < FIGHT.wins[1] ? "#8fd0ff" : "rgba(255,255,255,0.18)";
    ctx.fill();
  }

  // 连击
  const pCombo = FIGHT.player.combo > 1 ? FIGHT.player.combo : 0;
  if (pCombo) {
    ctx.font = "bold 26px 'Microsoft YaHei UI', sans-serif";
    ctx.fillStyle = "#ffd9a0";
    ctx.textAlign = "left";
    ctx.fillText(pCombo + " HIT", 46, 130);
  }

  // 横幅
  if (FIGHT.banner && FIGHT.banner.time > 0) {
    const t = FIGHT.banner;
    const alpha = Math.min(1, t.time / 25);
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.font = "bold 54px 'Microsoft YaHei UI', sans-serif";
    if (t.super) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = Math.min(0.12, alpha);
      ctx.fillStyle = "#ffd9e0";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#7a1020";
    } else {
      ctx.fillStyle = "#ffe1e6";
    }
    ctx.fillText(t.text, W / 2, H / 2);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/* ---------------------------- 小本子 ---------------------------- */

const NOTE_TEMPLATES = [
  {
    her: "今天想吃点甜的……",
    prompt: "你想给她买什么？",
    options: [
      { text: "草莓甜筒", ok: true, line: "……草莓的。谢谢。" },
      { text: "苦瓜汁", ok: false, danger: true, line: "……你故意的。" },
      { text: "热水", ok: false, line: "……" },
    ],
  },
  {
    her: "哥哥说，海是蓝色的。",
    prompt: "她问你海是什么样子",
    options: [
      { text: "像你的眼睛", ok: true, line: "……骗人。但我不讨厌。" },
      { text: "很咸", ok: false, line: "……咸的？" },
      { text: "没去过", ok: false, line: "……哦。" },
    ],
  },
  {
    her: "我写字很慢。",
    prompt: "你想怎么回她",
    options: [
      { text: "我等你写完", ok: true, line: "……好。那我慢慢写。" },
      { text: "那你快点", ok: false, line: "……" },
      { text: "别写了", ok: false, danger: true, line: "……" },
    ],
  },
  {
    her: "今天的月亮，有点冷。",
    prompt: "要给她留一句话吗",
    options: [
      { text: "披件衣服吧", ok: true, line: "……嗯。你也是。" },
      { text: "月亮 colder", ok: false, line: "……看不懂。" },
      { text: "关我什么事", ok: false, danger: true, line: "……" },
    ],
  },
  {
    her: "你会一直来吗？",
    prompt: "她写得很轻",
    options: [
      { text: "会来", ok: true, line: "……那我等。" },
      { text: "看情况", ok: false, line: "……" },
      { text: "不会", ok: false, danger: true, line: "……知道了。" },
    ],
  },
];

function pickDeck() {
  const pool = NOTE_TEMPLATES.slice();
  const out = [];
  while (out.length < 5 && pool.length) {
    out.push(pool.splice(gameRandom(pool.length), 1)[0]);
  }
  return out;
}

function startNotebook() {
  const menu = document.getElementById("games-menu");
  const stage = document.getElementById("games-stage");
  const nb = document.getElementById("games-notebook");
  if (menu) menu.hidden = true;
  if (stage) stage.hidden = true;
  if (nb) nb.hidden = false;

  NOTEBOOK.step = 0;
  NOTEBOOK.score = 0;
  NOTEBOOK.hearts = 3;
  NOTEBOOK.lines = [];
  NOTEBOOK.deck = pickDeck();
  renderNotebook();
}

function renderNotebook() {
  const paper = document.getElementById("notebook-paper");
  const options = document.getElementById("notebook-options");
  const meta = document.getElementById("notebook-meta");
  if (!paper || !options) return;

  if (NOTEBOOK.hearts <= 0 || NOTEBOOK.step >= NOTEBOOK.deck.length) {
    const won = NOTEBOOK.hearts > 0;
    paper.innerHTML =
      `<div class="nb-her">${won ? "……今天写了很多。" : "……"}</div>` +
      `<div class="nb-line">${won ? "她把小本子合上，看了你一眼。" : "她把本子合上了。"}</div>` +
      `<div class="nb-score">对了 ${NOTEBOOK.score} / ${NOTEBOOK.deck.length} 张字条</div>`;
    options.innerHTML = `<button class="nb-option" type="button" data-action="again">再写一页</button>`;
    if (meta) meta.textContent = won ? "她记住了今天" : "下次再来";
    options.querySelector("[data-action=again]").addEventListener("click", startNotebook);
    return;
  }

  const item = NOTEBOOK.deck[NOTEBOOK.step];
  NOTEBOOK.current = item;
  const old = NOTEBOOK.lines
    .map((l) => `<div class="nb-old">${escapeHtml(l)}</div>`)
    .join("");
  paper.innerHTML =
    old +
    `<div class="nb-her">${escapeHtml(item.her)}</div>` +
    `<div class="nb-prompt">${escapeHtml(item.prompt)}</div>`;

  options.innerHTML = item.options
    .map(
      (o, i) =>
        `<button class="nb-option${o.danger ? " danger" : ""}" type="button" data-index="${i}">${escapeHtml(o.text)}</button>`,
    )
    .join("");

  options.querySelectorAll(".nb-option").forEach((btn) => {
    btn.addEventListener("click", () => chooseNote(Number(btn.dataset.index)));
  });

  if (meta) {
    meta.textContent = `第 ${NOTEBOOK.step + 1} / ${NOTEBOOK.deck.length} 张 · 心 ${NOTEBOOK.hearts}`;
  }
}

function chooseNote(index) {
  const item = NOTEBOOK.current;
  if (!item) return;
  const choice = item.options[index];
  if (!choice) return;

  const paper = document.getElementById("notebook-paper");
  if (choice.ok) {
    NOTEBOOK.score += 1;
    NOTEBOOK.lines.push("你：" + choice.text);
    NOTEBOOK.lines.push("她：" + choice.line);
    flashNotebook("ok");
  } else {
    NOTEBOOK.hearts -= 1;
    NOTEBOOK.lines.push("你：" + choice.text);
    NOTEBOOK.lines.push("她：" + choice.line);
    flashNotebook(choice.danger ? "danger" : "bad");
  }
  NOTEBOOK.step += 1;
  setTimeout(renderNotebook, 260);
}

function flashNotebook(kind) {
  const el = document.getElementById("games-notebook");
  if (!el) return;
  el.classList.remove("flash-ok", "flash-bad", "flash-danger");
  void el.offsetWidth;
  el.classList.add(kind === "ok" ? "flash-ok" : kind === "danger" ? "flash-danger" : "flash-bad");
}

/* ---------------------------- 初始化 ---------------------------- */

function setupGames() {
  const btn = document.getElementById("btn-games");
  const modal = document.getElementById("games");
  if (!btn || !modal) return;

  btn.addEventListener("click", openGames);
  document.getElementById("games-close")?.addEventListener("click", closeGames);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeGames();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeGames();
    if (!modal.hidden && !document.getElementById("games-stage").hidden && event.key.toLowerCase() === "r" && FIGHT.over) {
      startFight();
    }
  });

  document.querySelectorAll("[data-game]").forEach((card) => {
    card.addEventListener("click", () => {
      const game = card.dataset.game;
      if (game === "fight") startFight();
      if (game === "notebook") startNotebook();
    });
  });
}

setupGames();
