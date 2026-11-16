/* ------------------------------------------------------------------ */
/* 小游戏：格斗 + 小本子                                               */
/* ------------------------------------------------------------------ */

const GAME_ASSETS = {
  char: "../assets/eri-avatar.png",
  charLoaded: false,
};



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
  paused: false,
  difficulty: "normal",
};

const NOTEBOOK = {
  step: 0,
  score: 0,
  hearts: 3,
  favor: 50,
  lines: [],
  current: null,
  deck: [],
  timer: 25,
  deadline: 0,
  tick: null,
  finished: false,
};

/* ---------------------------- 格斗 ---------------------------- */




const ATTACKS = {
  jab: { startup: 4, active: 3, recovery: 7, damage: 4, range: 62, meter: 8, sound: "whiff" },
  heavy: { startup: 9, active: 4, recovery: 13, damage: 10, range: 78, meter: 12, sound: "whiff" },
  kick: { startup: 8, active: 5, recovery: 11, damage: 8, range: 92, meter: 10, sound: "whiff" },
};

const AI_LEVELS = {
  easy: { reaction: 300, block: 0.12, aggr: 0.35, name: "简单" },
  normal: { reaction: 190, block: 0.3, aggr: 0.6, name: "普通" },
  hard: { reaction: 120, block: 0.52, aggr: 0.85, name: "困难" },
};

const SPRITE = { video: null, ready: false };

const SND = {
  ctx: null,
  on: true,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  blip(freq, dur, type, gain) {
    if (!this.on) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.4), ctx.currentTime + dur);
    g.gain.setValueAtTime(gain || 0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  },
  hit(heavy) { this.blip(heavy ? 150 : 220, heavy ? 0.16 : 0.1, "square", heavy ? 0.12 : 0.08); },
  block() { this.blip(520, 0.08, "triangle", 0.05); },
  whiff() { this.blip(900, 0.05, "sine", 0.03); },
  super() {
    if (!this.on) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.5);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.75);
  },
  ko() { this.blip(110, 0.6, "sine", 0.14); },
};

function initSprite() {
  if (SPRITE.video) return;
  const video = document.createElement("video");
  video.src = "../assets/eri-idle.webm";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.style.display = "none";
  document.body.appendChild(video);
  video.addEventListener("loadeddata", () => {
    SPRITE.ready = true;
    SPRITE.video = video;
  });
  video.play().catch(() => {});
  SPRITE.video = video;
}

function makeFighter(isAI) {
  return {
    isAI,
    x: isAI ? 690 : 270,
    y: 0,
    vx: 0,
    vy: 0,
    facing: isAI ? -1 : 1,
    hp: 100,
    state: "idle",
    stateTime: 0,
    attack: null,
    attackName: "",
    attackTime: 0,
    hasHit: false,
    blocking: false,
    hitFlash: 0,
    walkPhase: Math.random() * 6,
    aiTimer: 0,
    combo: 0,
    comboTimer: 0,
    dashCd: 0,
    lastTap: 0,
  };
}

const G = {
  W: 960,
  H: 540,
  floor: 470,
  shake: 0,
  hitstop: 0,
  ko: 0,
  slow: 1,
  superAnim: null,
  rings: [],
  sparks: [],
  dust: [],
  banner: null,
  dust2: [],
};

function startFight() {
  const menu = document.getElementById("games-menu");
  const stage = document.getElementById("games-stage");
  if (menu) menu.hidden = true;
  if (stage) stage.hidden = false;
  initSprite();
  SND.ensure();

  FIGHT.canvas = document.getElementById("fight-canvas");
  FIGHT.ctx = FIGHT.canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  FIGHT.canvas.width = G.W * dpr;
  FIGHT.canvas.height = G.H * dpr;
  FIGHT.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  FIGHT.player = makeFighter(false);
  FIGHT.ai = makeFighter(true);
  FIGHT.round = 1;
  FIGHT.wins = [0, 0];
  FIGHT.timer = 60;
  FIGHT.over = false;
  FIGHT.result = "";
  FIGHT.banner = { text: "ROUND 1", sub: "", time: 100 };
  FIGHT.hitstop = 0;
  FIGHT.paused = false;
  FIGHT.particles = [];
  FIGHT.floaters = [];
  FIGHT.superP1 = 0;
  FIGHT.superP2 = 0;
  FIGHT.difficulty = FIGHT.difficulty || "normal";
  G.shake = 0;
  G.ko = 0;
  G.slow = 1;
  G.superAnim = null;
  G.rings = [];
  G.sparks = [];
  G.dust2 = [];
  G.dust = Array.from({ length: 40 }, () => ({
    x: Math.random() * G.W,
    y: Math.random() * G.H,
    r: Math.random() * 1.4 + 0.3,
    a: Math.random() * 0.25 + 0.05,
    s: Math.random() * 0.3 + 0.1,
  }));

  FIGHT.running = true;
  FIGHT.lastTime = performance.now();

  bindFightKeys();
  statusHint("三局两胜 · 打空她的血条 · 按 H 看规则 · 难度：" + AI_LEVELS[FIGHT.difficulty].name);
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
  if (k === "r" && FIGHT.over) startFight();
}

function fightKeyUp(event) {
  FIGHT.keys[event.key.toLowerCase()] = false;
}

function statusHint(text) {
  const el = document.getElementById("fight-hint");
  if (el) el.textContent = text;
}

function trySuper(fighter, who) {
  if (!fighter || FIGHT.over || G.superAnim) return;
  const meter = who === "p1" ? FIGHT.superP1 : FIGHT.superP2;
  if (meter < 100) return;
  if (who === "p1") FIGHT.superP1 = 0;
  else FIGHT.superP2 = 0;
  G.superAnim = { t: 0, dur: 64, by: who };
  SND.super();
  FIGHT.hitstop = 0;
}

function resolveSuper() {
  const who = G.superAnim.by;
  const from = who === "p1" ? FIGHT.player : FIGHT.ai;
  const target = who === "p1" ? FIGHT.ai : FIGHT.player;
  G.shake = 22;
  damage(target, 28, from, true);
  G.rings.push({ x: target.x, y: G.floor - 130, r: 10, life: 40, color: "#fff0f3" });
}

function damage(target, amount, from, superHit) {
  if (FIGHT.over) return;
  let dmg = amount;
  const blocked = target.blocking && !superHit;
  if (blocked) dmg = Math.round(dmg * 0.22);
  target.hp = Math.max(0, target.hp - dmg);
  target.hitFlash = 14;
  FIGHT.hitstop = superHit ? 14 : blocked ? 3 : 6;
  G.shake = blocked ? 4 : superHit ? 20 : 8;

  const dir = target.x >= from.x ? 1 : -1;
  target.vx += dir * (superHit ? 11 : blocked ? 2 : 4.2);
  if (!blocked) {
    target.state = "hit";
    target.stateTime = 0;
    from.combo += 1;
    from.comboTimer = 70;
  }
  if (blocked) SND.block();
  else SND.hit(amount >= 10);

  addFloater(target.x, 170, "-" + dmg, blocked ? "#9fd6ff" : "#ffd0d6");
  spawnSparks(target.x - dir * 10, G.floor - 150, superHit ? 26 : blocked ? 6 : 12, blocked ? "#9fd6ff" : "#ffb3bd");
  G.rings.push({ x: target.x, y: G.floor - 150, r: 6, life: superHit ? 30 : 18, color: blocked ? "#9fd6ff" : "#ffd0d6" });

  if (target.hp <= 0) endRound(from === FIGHT.player ? 0 : 1);
}

function spawnSparks(x, y, n, color) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const sp = Math.random() * 8 + 2;
    G.sparks.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1,
      life: 24 + Math.random() * 18,
      color,
      size: Math.random() * 3 + 1,
    });
  }
}

function addFloater(x, y, text, color) {
  FIGHT.floaters.push({ x, y, text, color, life: 50, vy: -1.6 });
}

function endRound(winner) {
  FIGHT.wins[winner] += 1;
  FIGHT.over = true;
  G.ko = 110;
  G.slow = 0.28;
  SND.ko();
  const done = FIGHT.wins[winner] >= 2;
  FIGHT.banner = {
    text: done ? (winner === 0 ? "YOU WIN" : "SHE WINS") : "K.O.",
    sub: done ? (winner === 0 ? "按 R 再来一局" : "她合上本子，看了你一眼") : "",
    time: done ? 9999 : 150,
  };
}

function resetRound() {
  FIGHT.player = makeFighter(false);
  FIGHT.ai = makeFighter(true);
  FIGHT.round += 1;
  FIGHT.timer = 60;
  FIGHT.over = false;
  FIGHT.banner = { text: "ROUND " + FIGHT.round, sub: "", time: 90 };
  FIGHT.particles = [];
  FIGHT.floaters = [];
  G.slow = 1;
  G.ko = 0;
}

function fightLoop(now) {
  if (!FIGHT.running) return;
  if (FIGHT.paused) {
    FIGHT.lastTime = now;
    drawFight();
    FIGHT.raf = requestAnimationFrame(fightLoop);
    return;
  }
  let dt = Math.min(48, now - FIGHT.lastTime);
  FIGHT.lastTime = now;

  if (G.superAnim) {
    G.superAnim.t += 1;
    if (G.superAnim.t === G.superAnim.dur) resolveSuper();
    if (G.superAnim.t > G.superAnim.dur + 26) G.superAnim = null;
    drawFight();
    FIGHT.raf = requestAnimationFrame(fightLoop);
    return;
  }

  if (FIGHT.hitstop > 0) {
    FIGHT.hitstop -= 1;
    drawFight();
    FIGHT.raf = requestAnimationFrame(fightLoop);
    return;
  }

  dt *= G.slow;
  if (G.ko > 0) {
    G.ko -= 1;
    if (G.ko === 0) G.slow = 1;
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
      FIGHT.banner = { text: "按 R 再来一局", sub: "", time: 9999 };
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
    f.y += f.vy;
    f.life -= 1;
  }
  FIGHT.floaters = FIGHT.floaters.filter((f) => f.life > 0);
  for (const s of G.sparks) {
    s.x += s.vx;
    s.y += s.vy;
    s.vy += 0.45;
    s.life -= 1;
  }
  G.sparks = G.sparks.filter((s) => s.life > 0);
  for (const r of G.rings) {
    r.r += 4;
    r.life -= 1;
  }
  G.rings = G.rings.filter((r) => r.life > 0);
  if (G.shake > 0) G.shake *= 0.86;

  drawFight();
  FIGHT.raf = requestAnimationFrame(fightLoop);
}

function fighterCanAct(f) {
  return ["idle", "walk", "block"].includes(f.state) || (f.state === "jump" && f.y > 30);
}

function startAttack(f, name) {
  if (!f || !fighterCanAct(f) || f.attack || f.state === "hit" || f.state === "attack") return;
  f.state = "attack";
  f.attack = ATTACKS[name];
  f.attackName = name;
  f.attackTime = 0;
  f.hasHit = false;
  SND.whiff();
}

function updateFighter(f, other, isPlayer, dt) {
  if (!f) return;
  const step = dt / 16.67;
  f.stateTime += 1;
  if (f.hitFlash > 0) f.hitFlash -= 1;
  if (f.comboTimer > 0) {
    f.comboTimer -= 1;
    if (f.comboTimer === 0) f.combo = 0;
  }
  if (f.dashCd > 0) f.dashCd -= 1;

  const dist = Math.abs(other.x - f.x);
  f.facing = other.x >= f.x ? 1 : -1;

  if (f.state === "hit") {
    f.vx *= 0.82;
    f.x += f.vx * step;
    if (f.stateTime > 16) {
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
    if (isPlayer) f.x += f.facing * 1.6 * step;
    if (f.attackTime === a.startup + 1 && !f.hasHit) {
      if (dist < a.range && Math.abs(other.y - f.y) < 90 && !other.blocking) {
        f.hasHit = true;
        damage(other, a.damage, f, false);
        if (isPlayer) FIGHT.superP1 = Math.min(100, FIGHT.superP1 + a.meter);
        else FIGHT.superP2 = Math.min(100, FIGHT.superP2 + a.meter);
      } else if (dist < a.range && other.blocking) {
        f.hasHit = true;
        damage(other, a.damage, f, false);
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
    f.vy += 0.9 * step;
    f.y -= f.vy * step;
    f.x += f.vx * step;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.state = "idle";
      f.stateTime = 0;
      G.shake = Math.max(G.shake, 3);
      spawnSparks(f.x, G.floor, 4, "rgba(255,220,230,0.5)");
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
      f.vx = move * 3.2;
      FIGHT.keys["arrowup"] = false;
      FIGHT.keys["w"] = false;
      return;
    }
    if (FIGHT.keys["j"]) startAttack(f, "jab");
    if (FIGHT.keys["k"]) startAttack(f, "heavy");
    if (FIGHT.keys["l"]) startAttack(f, "kick");

    f.vx = move * 3.4;
    f.x += f.vx * step;
    f.walkPhase += Math.abs(move) * 0.22;
    f.state = move !== 0 ? "walk" : "idle";
    clampFighter(f);
    return;
  }

  f.x += f.vx * step;
  f.vx *= 0.8;
  clampFighter(f);
}

function clampFighter(f) {
  f.x = Math.max(80, Math.min(G.W - 80, f.x));
}

function updateAI(ai, player, dt) {
  if (FIGHT.over || ai.state === "hit" || ai.state === "attack") return;
  const lvl = AI_LEVELS[FIGHT.difficulty] || AI_LEVELS.normal;
  ai.aiTimer -= dt;
  if (ai.aiTimer > 0) return;
  ai.aiTimer = lvl.reaction + gameRandom(140);

  const dist = Math.abs(player.x - ai.x);
  const lowHp = ai.hp < 35;
  const aggr = Math.min(1, lvl.aggr + (lowHp ? 0.2 : 0));

  if (player.blocking && dist < 110 && Math.random() < lvl.block + 0.15) {
    startAttack(ai, "kick");
    return;
  }

  if (dist > 170) {
    ai.vx = (player.x > ai.x ? 1 : -1) * (2.0 + aggr);
    ai.state = "walk";
    ai.walkPhase += 0.2;
    return;
  }

  if (dist < 80) {
    const roll = Math.random();
    if (roll < 0.3 + aggr * 0.2) startAttack(ai, "jab");
    else if (roll < 0.55 + aggr * 0.25) startAttack(ai, "heavy");
    else if (roll < 0.75) startAttack(ai, "kick");
    else if (roll < 0.86) {
      ai.vx = -(player.x > ai.x ? 1 : -1) * 1.8;
      ai.state = "walk";
    } else {
      ai.state = "idle";
      ai.aiTimer = 120;
    }
    return;
  }

  if (Math.random() < 0.6) startAttack(ai, "kick");
  else {
    ai.vx = (player.x > ai.x ? 1 : -1) * 1.7;
    ai.state = "walk";
  }
}

function drawRoom() {
  const ctx = FIGHT.ctx;
  const { W, H } = G;

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#170b13");
  sky.addColorStop(0.55, "#26121d");
  sky.addColorStop(1, "#0f080c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 窗外夜景
  const wx = 90;
  const wy = 60;
  const ww = 300;
  const wh = 210;
  const win = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  win.addColorStop(0, "#1b2440");
  win.addColorStop(1, "#2b1830");
  ctx.fillStyle = win;
  ctx.fillRect(wx, wy, ww, wh);

  // 城市灯光
  for (let i = 0; i < 26; i += 1) {
    const bx = wx + ((i * 53) % ww);
    const bh = 12 + ((i * 31) % 60);
    ctx.fillStyle = "rgba(20, 14, 26, 0.85)";
    ctx.fillRect(bx, wy + wh - bh, 16, bh);
    ctx.fillStyle = i % 3 === 0 ? "rgba(255, 210, 150, 0.7)" : "rgba(150, 200, 255, 0.35)";
    for (let j = 0; j < 4; j += 1) {
      if ((i + j) % 2 === 0) ctx.fillRect(bx + 3, wy + wh - bh + 4 + j * 9, 3, 4);
    }
  }

  // 月亮
  ctx.fillStyle = "rgba(255, 235, 240, 0.75)";
  ctx.beginPath();
  ctx.arc(wx + ww - 60, wy + 46, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 235, 240, 0.12)";
  ctx.beginPath();
  ctx.arc(wx + ww - 60, wy + 46, 34, 0, Math.PI * 2);
  ctx.fill();

  // 窗框
  ctx.strokeStyle = "rgba(20, 12, 18, 0.9)";
  ctx.lineWidth = 10;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.stroke();

  // 右侧墙面文字
  ctx.fillStyle = "rgba(255, 190, 205, 0.09)";
  ctx.font = "bold 84px 'Microsoft YaHei UI', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("上杉", W - 60, 190);

  // 地面
  const floor = ctx.createLinearGradient(0, G.floor - 6, 0, H);
  floor.addColorStop(0, "rgba(255, 200, 215, 0.08)");
  floor.addColorStop(0.04, "rgba(30, 16, 24, 0.95)");
  floor.addColorStop(1, "#120a10");
  ctx.fillStyle = floor;
  ctx.fillRect(0, G.floor - 6, W, H - G.floor + 6);

  // 地板反光
  ctx.strokeStyle = "rgba(255, 220, 232, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, G.floor - 4);
  ctx.lineTo(W, G.floor - 4);
  ctx.stroke();

  // 浮动尘埃
  const t = performance.now() / 1000;
  for (const d of G.dust) {
    const y = (d.y + t * d.s * 12) % H;
    ctx.globalAlpha = d.a;
    ctx.fillStyle = "#ffd9e2";
    ctx.beginPath();
    ctx.arc(d.x, y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFighter(f, isPlayer) {
  const ctx = FIGHT.ctx;
  const h = 250;
  const w = h * 0.72;
  const bob = f.state === "walk" ? Math.sin(f.walkPhase) * 5 : Math.sin(performance.now() / 520 + (isPlayer ? 1 : 0)) * 2.5;
  const squash = f.state === "attack" ? 1.08 : f.state === "hit" ? 0.9 : 1;
  const lunge = f.state === "attack" ? f.facing * (f.attackName === "heavy" ? 10 : 6) : 0;
  const cx = f.x + lunge;
  const cy = G.floor - h * squash + f.y * 0.45 + bob;

  // 落地阴影
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(f.x, G.floor + 4, 62 - f.y * 0.1, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (SPRITE.ready && SPRITE.video) {
    ctx.save();
    if (isPlayer) {
      ctx.filter = "brightness(0.42) saturate(0.55) sepia(0.5) hue-rotate(215deg)";
    }
    if (f.hitFlash > 0) ctx.globalAlpha = 0.85;
    ctx.drawImage(SPRITE.video, cx - w / 2, cy, w, h * squash);
    ctx.restore();
  } else if (GAME_ASSETS.charImg) {
    ctx.save();
    if (isPlayer) ctx.filter = "brightness(0.42) saturate(0.55) sepia(0.5) hue-rotate(215deg)";
    ctx.drawImage(GAME_ASSETS.charImg, cx - w / 2, cy, w, h * squash);
    ctx.restore();
  } else {
    ctx.fillStyle = isPlayer ? "#5a4a7a" : "#d96a75";
    ctx.fillRect(cx - w / 2, cy, w, h * squash);
  }

  if (f.hitFlash > 0) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#ff9aa5";
    ctx.fillRect(cx - w / 2, cy, w, h * squash);
    ctx.globalAlpha = 1;
  }

  // 防御盾
  if (f.blocking) {
    ctx.strokeStyle = "rgba(150, 200, 255, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(f.x + f.facing * 30, cy + h * 0.42, 62, -1.0, 1.0);
    ctx.stroke();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#9fd6ff";
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 出拳轨迹
  if (f.state === "attack" && f.attack) {
    const a = f.attack;
    const prog = f.attackTime / (a.startup + a.active + a.recovery);
    if (prog > 0.15 && prog < 0.7) {
      const reach = a.range * 0.9;
      const alpha = 0.55 * (1 - Math.abs(0.5 - prog) * 2);
      ctx.strokeStyle = isPlayer ? `rgba(160, 210, 255, ${alpha})` : `rgba(255, 150, 170, ${alpha})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(f.x + f.facing * 20, cy + h * 0.42, reach * 0.8, -0.9 * f.facing, 0.9 * f.facing, f.facing < 0);
      ctx.stroke();
    }
  }
}

function drawFight() {
  const ctx = FIGHT.ctx;
  if (!ctx) return;
  const { W, H } = G;

  ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
  ctx.clearRect(0, 0, W, H);

  const sh = G.shake;
  ctx.save();
  if (sh > 0.5) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);

  drawRoom();

  drawFighter(FIGHT.player, true);
  drawFighter(FIGHT.ai, false);

  // 火花
  for (const s of G.sparks) {
    ctx.globalAlpha = Math.max(0, s.life / 40);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
  ctx.globalAlpha = 1;

  // 冲击环
  for (const r of G.rings) {
    ctx.globalAlpha = Math.max(0, r.life / 30);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 飘字
  ctx.font = "bold 26px 'Microsoft YaHei UI', sans-serif";
  ctx.textAlign = "center";
  for (const f of FIGHT.floaters) {
    ctx.globalAlpha = Math.max(0, f.life / 50);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  drawHud();
  drawBanner();

  if (G.superAnim) drawSuperCutin();
}

function drawHud() {
  const ctx = FIGHT.ctx;
  const { W } = G;
  const barW = 330;
  const barH = 22;
  const x1 = 46;
  const x2 = W - 46 - barW;

  // 血条底
  ctx.fillStyle = "rgba(10, 5, 8, 0.72)";
  ctx.fillRect(x1 - 3, 26, barW + 6, barH + 6);
  ctx.fillRect(x2 - 3, 26, barW + 6, barH + 6);

  // 血量
  const p1 = FIGHT.player.hp / 100;
  const p2 = FIGHT.ai.hp / 100;
  const g1 = ctx.createLinearGradient(x1, 0, x1 + barW, 0);
  g1.addColorStop(0, "#ff8f9b");
  g1.addColorStop(1, "#c2354a");
  ctx.fillStyle = g1;
  ctx.fillRect(x1, 29, barW * p1, barH);
  const g2 = ctx.createLinearGradient(x2, 0, x2 + barW, 0);
  g2.addColorStop(0, "#6fb5ff");
  g2.addColorStop(1, "#2f5fd0");
  ctx.fillStyle = g2;
  ctx.fillRect(x2 + barW * (1 - p2), 29, barW * p2, barH);

  // 边框
  ctx.strokeStyle = "rgba(255, 225, 232, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x1, 29, barW, barH);
  ctx.strokeRect(x2, 29, barW, barH);

  // 名字
  ctx.font = "bold 16px 'Microsoft YaHei UI', sans-serif";
  ctx.fillStyle = "#ffd9de";
  ctx.textAlign = "left";
  ctx.fillText("你", x1, 76);
  ctx.textAlign = "right";
  ctx.fillStyle = "#bfe4ff";
  ctx.fillText("上杉绘梨衣", x2 + barW, 76);

  // 必杀槽
  const m1 = FIGHT.superP1 / 100;
  const m2 = FIGHT.superP2 / 100;
  ctx.fillStyle = "rgba(255, 210, 140, 0.18)";
  ctx.fillRect(x1, 60, barW, 6);
  ctx.fillRect(x2, 60, barW, 6);
  ctx.fillStyle = m1 >= 1 ? "#ffd27a" : "rgba(255, 200, 120, 0.7)";
  ctx.fillRect(x1, 60, barW * m1, 6);
  ctx.fillStyle = m2 >= 1 ? "#ffd27a" : "rgba(255, 200, 120, 0.7)";
  ctx.fillRect(x2, 60, barW * m2, 6);
  if (m1 >= 1) {
    ctx.fillStyle = "#ffd27a";
    ctx.font = "bold 11px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("U 必杀就绪", x1, 82);
  }

  // 中央计时
  ctx.textAlign = "center";
  ctx.font = "bold 44px 'Microsoft YaHei UI', sans-serif";
  ctx.fillStyle = "#fff3f5";
  ctx.fillText(String(Math.max(0, Math.ceil(FIGHT.timer))), W / 2, 62);
  ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
  ctx.fillStyle = "rgba(255, 220, 228, 0.6)";
  ctx.fillText("ROUND " + FIGHT.round, W / 2, 84);

  // 回合点
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.arc(W / 2 - 70 + i * 18, 100, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < FIGHT.wins[0] ? "#ff8f9b" : "rgba(255,255,255,0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W / 2 + 70 - i * 18, 100, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < FIGHT.wins[1] ? "#7fb8ff" : "rgba(255,255,255,0.16)";
    ctx.fill();
  }

  // 连击
  const combo = FIGHT.player.combo;
  if (combo > 1) {
    const scale = 1 + Math.min(0.25, combo * 0.03);
    ctx.save();
    ctx.translate(80, 150);
    ctx.scale(scale, scale);
    ctx.textAlign = "left";
    ctx.font = "bold 34px 'Microsoft YaHei UI', sans-serif";
    ctx.fillStyle = "#ffd9a0";
    ctx.fillText(combo + " HIT", 0, 0);
    ctx.restore();
  }
}

function drawBanner() {
  if (!FIGHT.banner || FIGHT.banner.time <= 0) return;
  const ctx = FIGHT.ctx;
  const { W, H } = G;
  const b = FIGHT.banner;
  const alpha = Math.min(1, b.time / 25);
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(10, 5, 8, 0.45)";
  ctx.fillRect(0, H / 2 - 70, W, 120);
  ctx.fillStyle = "#fff1f3";
  ctx.font = "bold 64px 'Microsoft YaHei UI', sans-serif";
  ctx.fillText(b.text, W / 2, H / 2 + 6);
  if (b.sub) {
    ctx.font = "15px 'Microsoft YaHei UI', sans-serif";
    ctx.fillStyle = "rgba(255, 220, 228, 0.75)";
    ctx.fillText(b.sub, W / 2, H / 2 + 42);
  }
  ctx.globalAlpha = 1;
}

function drawSuperCutin() {
  const ctx = FIGHT.ctx;
  const { W, H } = G;
  const a = G.superAnim;
  const p = a.t / a.dur;
  const byPlayer = a.by === "p1";

  ctx.save();
  ctx.fillStyle = `rgba(8, 3, 6, ${Math.min(0.88, p * 3)})`;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const scale = 1.2 + p * 0.5;
  ctx.globalAlpha = Math.min(1, p * 2);
  if (GAME_ASSETS.charImg) {
    ctx.drawImage(GAME_ASSETS.charImg, cx - 150 * scale, cy - 170 * scale, 300 * scale, 420 * scale);
  }
  ctx.globalAlpha = 1;

  const txt = byPlayer ? "言灵 · 审判" : "她好像认真了";
  ctx.font = "bold 58px 'Microsoft YaHei UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = byPlayer ? "#ffe1e6" : "#bfe4ff";
  ctx.fillText(txt, cx, cy + 150);

  // 白闪
  if (p > 0.85) {
    ctx.globalAlpha = Math.min(1, (p - 0.85) / 0.15);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */

const NOTE_SCENES = [
  {
    her: "今天想吃点甜的……",
    hint: "她没抬头，笔尖在本子上停着。",
    options: [
      { text: "我带你去买草莓甜筒", score: 2, tone: "温柔", line: "……好。那我要最大的。" },
      { text: "给你买草莓甜筒", score: 1, tone: "直白", line: "……嗯。谢谢。" },
      { text: "吃什么吃，先减肥吧", score: -1, tone: "敷衍", line: "……" },
      { text: "你自己去买", score: -1, tone: "危险", danger: true, line: "……知道了。" },
    ],
  },
  {
    her: "哥哥说，海是蓝色的。",
    hint: "她写完这行，看了你一会儿。",
    options: [
      { text: "等有空，我带你去看", score: 2, tone: "温柔", line: "……真的？那我要记下来。" },
      { text: "海是蓝的，很咸", score: 1, tone: "直白", line: "……咸的。原来会咸。" },
      { text: "网上搜一下就有", score: -1, tone: "敷衍", line: "……搜出来的，和看到的不一样吧。" },
      { text: "别想那些没用的", score: -1, tone: "危险", danger: true, line: "……哦。" },
    ],
  },
  {
    her: "我写字很慢。",
    hint: "本子上的字确实比平时更用力。",
    options: [
      { text: "没关系，我等你写完", score: 2, tone: "温柔", line: "……那我慢慢写。你别走。" },
      { text: "慢慢写，不着急", score: 1, tone: "直白", line: "……嗯。" },
      { text: "说快点不就好了", score: -1, tone: "敷衍", line: "……" },
      { text: "那你就别写了", score: -1, tone: "危险", danger: true, line: "她把笔放下了。" },
    ],
  },
  {
    her: "今天的月亮，有点冷。",
    hint: "她抱着本子，肩膀缩了一点。",
    options: [
      { text: "披件衣服，我陪你坐会儿", score: 2, tone: "温柔", line: "……嗯。你坐这边。" },
      { text: "那回屋吧", score: 1, tone: "直白", line: "……好。" },
      { text: "月亮哪会冷", score: 0, tone: "敷衍", line: "……你不懂。" },
      { text: "冷就冷吧", score: -1, tone: "危险", danger: true, line: "……" },
    ],
  },
  {
    her: "你会一直来吗？",
    hint: "这行字写得特别轻，像怕被你看见。",
    options: [
      { text: "会，除非你赶我走", score: 2, tone: "温柔", line: "……我不赶你。" },
      { text: "会来的", score: 1, tone: "直白", line: "……那我等。" },
      { text: "看情况吧", score: -1, tone: "敷衍", line: "……看情况啊。" },
      { text: "不知道", score: 0, tone: "危险", line: "……" },
    ],
  },
  {
    her: "他们都说我是怪物。",
    hint: "她写得很慢，中间停顿了一次。",
    options: [
      { text: "你不是。在我这儿不是", score: 2, tone: "温柔", line: "……你这样说，我会当真的。" },
      { text: "谁说你的，我去说他们", score: 1, tone: "直白", line: "……别去。会受伤。" },
      { text: "那你别做奇怪的事", score: -1, tone: "敷衍", line: "……嗯。" },
      { text: "他们说得也没错", score: -1, tone: "危险", danger: true, line: "她把本子合上了一半。" },
    ],
  },
  {
    her: "你身上有别人的味道。",
    hint: "她写完没有立刻把本子推过来。",
    options: [
      { text: "今天见过朋友，你介意？", score: 2, tone: "温柔", line: "……不介意。只是问问。" },
      { text: "有吗？可能是同事", score: 1, tone: "直白", line: "……哦。" },
      { text: "你管得真多", score: -1, tone: "敷衍", line: "……" },
      { text: "关你什么事", score: -1, tone: "危险", danger: true, line: "她写下这两个字又划掉了。" },
    ],
  },
  {
    her: "如果有一天我不在了……",
    hint: "她写到一半就停住了。",
    options: [
      { text: "那我就去找你，一直找", score: 2, tone: "温柔", line: "……那你要找很久。" },
      { text: "别乱说这种话", score: 1, tone: "直白", line: "……好。" },
      { text: "人总会不在的", score: -1, tone: "敷衍", line: "……" },
      { text: "那我正好清静", score: -1, tone: "危险", danger: true, line: "……" },
    ],
  },
  {
    her: "我今天记了好多事。",
    hint: "她把本子翻给你看，字迹密密麻麻。",
    options: [
      { text: "念给我听吧", score: 2, tone: "温柔", line: "……那我从第一页开始。" },
      { text: "写得真多", score: 1, tone: "直白", line: "……嗯，都是重要的。" },
      { text: "记这些干嘛", score: -1, tone: "敷衍", line: "……因为会忘。" },
      { text: "没用的事别记", score: -1, tone: "危险", danger: true, line: "她把本子抱紧了。" },
    ],
  },
  {
    her: "明天，还能见到你吗？",
    hint: "这是今天最后一张字条。",
    options: [
      { text: "能。明天我第一个来找你", score: 2, tone: "温柔", line: "……那我明天早点睡，等天亮。" },
      { text: "应该能", score: 1, tone: "直白", line: "……嗯，我等。" },
      { text: "看明天忙不忙", score: -1, tone: "敷衍", line: "……好。" },
      { text: "不一定", score: 0, tone: "危险", line: "……" },
    ],
  },
];

const NOTEBOOK_TIMER = 25; // 每张字条 25 秒

function pickDeck() {
  const pool = NOTE_SCENES.slice();
  const out = [];
  while (out.length < 8 && pool.length) {
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
  NOTEBOOK.favor = 50;
  NOTEBOOK.lines = [];
  NOTEBOOK.deck = pickDeck();
  NOTEBOOK.timer = NOTEBOOK_TIMER;
  NOTEBOOK.deadline = Date.now() + NOTEBOOK_TIMER * 1000;
  if (NOTEBOOK.tick) clearInterval(NOTEBOOK.tick);
  NOTEBOOK.tick = setInterval(notebookTick, 200);
  renderNotebook();
}

function notebookTick() {
  if (!NOTEBOOK.current || NOTEBOOK.finished) return;
  const left = Math.max(0, (NOTEBOOK.deadline - Date.now()) / 1000);
  NOTEBOOK.timer = left;
  const bar = document.getElementById("notebook-timerfill");
  if (bar) bar.style.width = (left / NOTEBOOK_TIMER) * 100 + "%";
  if (left <= 0) {
    timeoutNote();
  }
}

function timeoutNote() {
  if (!NOTEBOOK.current) return;
  NOTEBOOK.hearts -= 1;
  NOTEBOOK.favor = Math.max(0, NOTEBOOK.favor - 6);
  NOTEBOOK.lines.push("（你迟疑了太久）");
  NOTEBOOK.lines.push("她：……算了，不写了。");
  NOTEBOOK.step += 1;
  NOTEBOOK.current = null;
  flashNotebook("bad");
  setTimeout(renderNotebook, 300);
}

function endNotebook() {
  NOTEBOOK.finished = true;
  NOTEBOOK.current = null;
  if (NOTEBOOK.tick) clearInterval(NOTEBOOK.tick);
  const paper = document.getElementById("notebook-paper");
  const options = document.getElementById("notebook-options");
  const meta = document.getElementById("notebook-meta");
  if (!paper || !options) return;

  const favor = NOTEBOOK.favor;
  let ending;
  if (NOTEBOOK.hearts <= 0) {
    ending = { title: "她把本子合上了", text: "今天她写错了很多字，最后什么也没说。" };
  } else if (favor >= 85) {
    ending = { title: "她把本子递给你", text: "「这一页，你留着吧。」她把最后一张字条撕下来，塞进你手里。" };
  } else if (favor >= 65) {
    ending = { title: "她合上本子，看了你一眼", text: "「……明天还写。」她说得很轻，但你知道她认真的。" };
  } else if (favor >= 40) {
    ending = { title: "她写完了最后一页", text: "「今天就到这里。」她把笔帽扣上，安静地坐了一会儿。" };
  } else {
    ending = { title: "她写得很慢", text: "字条一张比一张短，最后她只写了「……」。" };
  }

  paper.innerHTML =
    `<div class="nb-ending-title">${escapeHtml(ending.title)}</div>` +
    `<div class="nb-line">${escapeHtml(ending.text)}</div>` +
    `<div class="nb-score">好感 ${Math.round(favor)} · 字条 ${NOTEBOOK.step}/${NOTEBOOK.deck.length} · 心 ${Math.max(0, NOTEBOOK.hearts)}</div>`;
  options.innerHTML = `<button class="nb-option" type="button" data-action="again">再写一页</button>`;
  if (meta) meta.textContent = "这一页写完了";
  options.querySelector("[data-action=again]").addEventListener("click", startNotebook);
}

function renderNotebook() {
  const paper = document.getElementById("notebook-paper");
  const options = document.getElementById("notebook-options");
  const meta = document.getElementById("notebook-meta");
  if (!paper || !options) return;

  if (NOTEBOOK.hearts <= 0 || NOTEBOOK.step >= NOTEBOOK.deck.length) {
    endNotebook();
    return;
  }

  const item = NOTEBOOK.deck[NOTEBOOK.step];
  NOTEBOOK.current = item;
  const old = NOTEBOOK.lines
    .slice(-6)
    .map((l) => `<div class="nb-old">${escapeHtml(l)}</div>`)
    .join("");
  paper.innerHTML =
    old +
    `<div class="nb-her">${escapeHtml(item.her)}</div>` +
    `<div class="nb-prompt">${escapeHtml(item.hint || "")}</div>`;

  options.innerHTML = item.options
    .map(
      (o, i) =>
        `<button class="nb-option${o.danger ? " danger" : ""}" type="button" data-index="${i}">` +
        `<span class="nb-tone tone-${toneClass(o.tone)}">${escapeHtml(o.tone)}</span>${escapeHtml(o.text)}</button>`,
    )
    .join("");

  options.querySelectorAll(".nb-option").forEach((btn) => {
    btn.addEventListener("click", () => chooseNote(Number(btn.dataset.index)));
  });

  if (meta) {
    meta.innerHTML =
      `<span class="nb-hearts">${"♥".repeat(Math.max(0, NOTEBOOK.hearts))}${"♡".repeat(Math.max(0, 3 - NOTEBOOK.hearts))}</span>` +
      `<span class="nb-favor">好感 ${Math.round(NOTEBOOK.favor)}</span>` +
      `<span class="nb-count">第 ${NOTEBOOK.step + 1}/${NOTEBOOK.deck.length} 张</span>`;
  }
}

function toneClass(tone) {
  if (tone === "温柔") return "warm";
  if (tone === "直白") return "plain";
  if (tone === "敷衍") return "cold";
  return "danger";
}

function chooseNote(index) {
  const item = NOTEBOOK.current;
  if (!item) return;
  const choice = item.options[index];
  if (!choice) return;
  NOTEBOOK.current = null;

  NOTEBOOK.lines.push("你：" + choice.text);
  NOTEBOOK.lines.push("她：" + choice.line);

  if (choice.score >= 2) {
    NOTEBOOK.score += 1;
    NOTEBOOK.favor = Math.min(100, NOTEBOOK.favor + 10);
    flashNotebook("ok");
  } else if (choice.score === 1) {
    NOTEBOOK.favor = Math.min(100, NOTEBOOK.favor + 5);
    flashNotebook("ok");
  } else if (choice.score === 0) {
    NOTEBOOK.favor = Math.max(0, NOTEBOOK.favor - 2);
    flashNotebook("bad");
  } else {
    NOTEBOOK.hearts -= 1;
    NOTEBOOK.favor = Math.max(0, NOTEBOOK.favor - 10);
    flashNotebook(choice.danger ? "danger" : "bad");
  }

  NOTEBOOK.step += 1;
  NOTEBOOK.deadline = Date.now() + NOTEBOOK_TIMER * 1000;
  setTimeout(renderNotebook, 320);
}

/* ---------------------------- 规则说明 ---------------------------- */

const GAME_RULES = {
  fight: {
    title: "街头对决 · 玩法",
    html:
      "<p>三局两胜。每局 60 秒，时间到血多的一方赢。</p>" +
      "<ul>" +
      "<li><b>← →</b> 移动　<b>↑</b> 跳</li>" +
      "<li><b>J</b> 轻拳（快、伤害低）　<b>K</b> 重拳（慢、伤害高）　<b>L</b> 踢（距离远）</li>" +
      "<li><b>空格</b> 防御：伤害只吃四分之一，但打不出连击</li>" +
      "<li><b>U</b> 必杀「言灵 · 审判」：右上角金色槽满了才能放，全屏闪白、伤害 26</li>" +
      "<li>打中/被打中都会攒必杀槽；连击会在左边显示 HIT 数</li>" +
      "<li>她血量低于 35% 会变凶，爱出重拳；你一直防御她会用踢克制</li>" +
      "<li>按 <b>H</b> 看规则，按 <b>R</b> 重开，按 <b>M</b> 静音</li>" +
      "</ul>" +
      "<div class=\"diff-row\">难度：" +
      "<button class=\"diff-btn\" data-diff=\"easy\" type=\"button\">简单</button>" +
      "<button class=\"diff-btn active\" data-diff=\"normal\" type=\"button\">普通</button>" +
      "<button class=\"diff-btn\" data-diff=\"hard\" type=\"button\">困难</button></div>",
  },
  notebook: {
    title: "小本子 · 玩法",
    html:
      "<p>她不能开口，只能把话写在便签上递给你。</p>" +
      "<ul>" +
      "<li>每局 8 张字条，你有 <b>3 颗心</b>，每张 <b>25 秒</b></li>" +
      "<li>四个选项带语气标签：<b>温柔 / 直白 / 敷衍 / 危险</b>，分数不同</li>" +
      "<li>不是所有「好听的话」都对——要看她当下在说什么</li>" +
      "<li>迟疑到超时会掉心；选到<b>危险词</b>会触发「审判」</li>" +
      "<li>好感度决定结局：85 以上她会把最后一张字条撕给你</li>" +
      "<li>按 <b>H</b> 随时看规则</li>" +
      "</ul>",
  },
};

let pendingGame = null;
let pendingMode = "start";

function showRules(game, mode) {
  const box = document.getElementById("games-rules");
  const title = document.getElementById("rules-title");
  const body = document.getElementById("rules-body");
  const startBtn = document.getElementById("rules-start");
  const spec = GAME_RULES[game];
  if (!box || !spec) return;
  pendingGame = game;
  pendingMode = mode;
  if (title) title.textContent = spec.title;
  if (body) body.innerHTML = spec.html;
  if (startBtn) startBtn.textContent = mode === "resume" ? "继续" : "开始";
  if (game === "fight") {
    document.querySelectorAll(".diff-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.diff === (FIGHT.difficulty || "normal"));
    });
  }
  box.hidden = false;
  document.querySelector(".games-shell")?.classList.add("rules-open");
  if (game === "fight") FIGHT.paused = true;
}

function hideRules() {
  const box = document.getElementById("games-rules");
  if (box) box.hidden = true;
  document.querySelector(".games-shell")?.classList.remove("rules-open");
  if (pendingGame === "fight" && pendingMode === "resume") FIGHT.paused = false;
  if (pendingMode === "start") {
    const game = pendingGame;
    pendingGame = null;
    if (game === "fight") startFight();
    if (game === "notebook") startNotebook();
  }
  pendingGame = null;
  pendingMode = "start";
}

function toggleRules(game) {
  const box = document.getElementById("games-rules");
  if (!box) return;
  if (box.hidden) showRules(game, "resume");
  else hideRules();
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
      showRules(game, "start");
    });
  });

  document.getElementById("rules-body")?.addEventListener("click", (event) => {
    const diff = event.target?.dataset?.diff;
    if (!diff) return;
    FIGHT.difficulty = diff;
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.toggle("active", b.dataset.diff === diff));
  });

  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key.toLowerCase() === "m") {
      SND.on = !SND.on;
      statusHint(SND.on ? "声音：开" : "声音：关");
    }
  });

  document.getElementById("rules-start")?.addEventListener("click", hideRules);
  document.getElementById("fight-rules-btn")?.addEventListener("click", () => toggleRules("fight"));
  document.getElementById("notebook-rules-btn")?.addEventListener("click", () => toggleRules("notebook"));

  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    const k = event.key.toLowerCase();
    if (k === "h") {
      const stageVisible = !document.getElementById("games-stage").hidden;
      const nbVisible = !document.getElementById("games-notebook").hidden;
      if (stageVisible) toggleRules("fight");
      else if (nbVisible) toggleRules("notebook");
    }
  });
}

setupGames();

