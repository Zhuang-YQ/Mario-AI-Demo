// ============================================================
// 物理与逻辑验收测试 —— 对照 PRD 第 8 节逐条跑数值
// 用法：node test-physics.js
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');

/* ---------- 假 DOM（只需满足 game.js 的调用面） ---------- */
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 40 });
    if (k === 'canvas') return {};
    return t[k] !== undefined ? t[k] : noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});

const listeners = {};
const canvasEl = { width: 256, height: 240, style: {}, getContext: () => ctx2d };

const sandbox = {
  Math, console, JSON,
  document: {
    getElementById: () => canvasEl,
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
  },
  window: { innerWidth: 1200, innerHeight: 900, addEventListener: noop },
  requestAnimationFrame: noop,
};
sandbox.globalThis = sandbox;

// 在 boot() 之后把内部状态挂到 window 上，便于断言
const patched = code.replace(
  'boot();',
  'boot();\n window.__G = { Game, Player, Input, CONFIG, updateGame, updateCamera, FIXED_DT, TILE };'
);
vm.createContext(sandbox);
vm.runInContext(patched, sandbox, { filename: 'game.js' });

const G = sandbox.window.__G;
const { Game, Player, Input, CONFIG, updateGame, updateCamera, FIXED_DT, TILE } = G;
const GROUND_TOP = 208;

/* ---------- 工具 ---------- */
function key(code, down) {
  const ev = { code, preventDefault: noop };
  (listeners[down ? 'keydown' : 'keyup'] || []).forEach(f => f(ev));
}
function clearKeys() {
  ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'ShiftLeft', 'KeyA', 'KeyD', 'KeyJ'].forEach(k => key(k, false));
}
function step(n) {
  for (let i = 0; i < n; i++) { updateGame(FIXED_DT); Input.endFrame(); }
}
/** 重置到起点附近平地，锁相机（避免相机推进把测试点移出关卡） */
function reset() {
  clearKeys();
  Game.restart();
  Game.camLocked = true;
  Game.camera = 0;
  Player.x = 24;
  Player.y = GROUND_TOP - Player.h;
  Player.vx = 0; Player.vy = 0; Player.onGround = true;
}

const R = {};

/* ---------- 1. 跳跃高度 ---------- */
function measureJump(holdFrames, runUp) {
  reset();
  if (runUp) {
    key('ShiftLeft', true); key('ArrowRight', true);
    step(45);
  }
  const startY = Player.y;
  key('Space', true);
  step(1);
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    if (i >= holdFrames - 1) key('Space', false);
    step(1);
    peak = Math.max(peak, startY - Player.y);
    if (i > 2 && Player.onGround) break;
  }
  clearKeys();
  return peak;
}

R['轻点跳跃高度(目标24±4)'] = +measureJump(1, false).toFixed(1);
R['长按跳跃高度(目标64±6)'] = +measureJump(90, false).toFixed(1);

// 跑跳
reset();
key('ShiftLeft', true); key('ArrowRight', true);
step(45);
const runV = Math.abs(Player.vx);
{
  const startY = Player.y;
  key('Space', true);
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    step(1);
    peak = Math.max(peak, startY - Player.y);
    if (i > 2 && Player.onGround) break;
  }
  R['跑跳高度(目标80±8)'] = +peak.toFixed(1);
  R['起跳时水平速度'] = +runV.toFixed(1);
}
clearKeys();

/* ---------- 2. 上升/下落耗时比 ---------- */
reset();
key('Space', true);
let up = 0, down = 0;
for (let i = 0; i < 20; i++) {
  step(1);
  if (Player.vy >= 0) { up = i + 1; break; }
}
while (!Player.onGround && down < 300) { step(1); down++; }
clearKeys();
R['上升帧数'] = up;
R['下落帧数'] = down;
R['下落/上升耗时比(目标0.7)'] = +(down / up).toFixed(2);

/* ---------- 3. 加速 / 滑行 / 极速 ---------- */
reset();
key('ArrowRight', true);
let accelFrames = 0;
while (Math.abs(Player.vx) < CONFIG.walkSpeed - 0.5 && accelFrames < 300) { step(1); accelFrames++; }
R['走速到顶耗时(s，目标0.4~0.6)'] = +(accelFrames / 60).toFixed(2);
R['走速上限'] = +Math.abs(Player.vx).toFixed(1);
key('ArrowRight', false);
const x0 = Player.x;
let sl = 0;
while (Math.abs(Player.vx) > 0.01 && sl < 300) { step(1); sl++; }
R['全速滑行距离(目标40~60)'] = +(Player.x - x0).toFixed(1);

reset();
key('ArrowRight', true); key('ShiftLeft', true);
step(90);
R['跑速上限(目标155)'] = +Math.abs(Player.vx).toFixed(1);
clearKeys();

/* ---------- 4. 金币 / 分数 ---------- */
function findTile(ch) {
  for (let r = 0; r < Game.tileH; r++)
    for (let c = 0; c < Game.tileW; c++)
      if (Game.tiles[r][c].char === ch) return { c, r };
  return null;
}
reset();
Game.score = 0; Game.coins = 0;
let q = findTile('?');
Player.x = q.c * TILE + 2;
Player.y = (q.r + 1) * TILE;
Player.vy = -200; Player.onGround = false;
step(1);
R['顶问号砖→金币+'] = Game.coins;
R['顶问号砖→分数+'] = Game.score;
R['金币飘出动画数'] = Game.coinPops.length;
R['加分飘字数'] = Game.floatTexts.length;
R['问号砖变空块'] = Game.tiles[q.r][q.c].char;
Player.x = q.c * TILE + 2; Player.y = (q.r + 1) * TILE; Player.vy = -200; Player.onGround = false;
step(1);
R['再顶同一块→金币(应仍为1)'] = Game.coins;
R['分数6位格式'] = String(Game.score).padStart(6, '0');

reset();
Game.coins = 99; Game.lives = 3;
q = findTile('?');
Player.x = q.c * TILE + 2; Player.y = (q.r + 1) * TILE; Player.vy = -200; Player.onGround = false;
step(1);
R['100枚后金币数(应0)'] = Game.coins;
R['100枚后生命(应4)'] = Game.lives;

/* ---------- 5. 敌人 ---------- */
reset();
Game.score = 0;
let e0 = Game.enemies.filter(e => e.alive)[0];
Player.x = e0.x + 1;
Player.y = e0.y - Player.h;
Player.vy = 120; Player.onGround = false;
step(1);
R['踩怪→分数+100'] = Game.score;
R['踩怪→敌人变扁'] = !e0.alive;
R['踩怪→玩家弹起vy(负)'] = +Player.vy.toFixed(0);
step(Math.ceil(CONFIG.enemySquashTime * 60) + 2);
R['踩扁后0.3s消失'] = !Game.enemies.includes(e0);

reset();
e0 = Game.enemies.filter(e => e.alive)[0];
Player.x = e0.x - Player.w + 1;
Player.y = e0.y;
Player.vx = 0; Player.vy = 0; Player.onGround = false;
step(1);
R['侧撞敌人→状态'] = Game.state;

/* ---------- 6. 流程 ---------- */
reset();
Game.lives = 3;
Player.y = 300;
step(1);
R['掉坑→状态'] = Game.state;
step(80);
R['掉坑→生命(应2)'] = Game.lives;
R['重生后状态'] = Game.state;
R['重生位置x'] = Math.round(Player.x);

reset();
Game.lives = 1; Game.state = 'play';
Player.y = 300;
step(90);
R['生命归零→GAME OVER'] = Game.state;
key('KeyR', true); key('KeyR', false);
R['按R重开→状态'] = Game.state;
R['按R重开→生命'] = Game.lives;

/* ---------- 7. 关卡 ---------- */
R['关卡格数'] = Game.tileW;
R['关卡像素宽'] = Game.worldW;
R['板栗仔数量'] = Game.enemies.length;

/* ---------- 8. 土狼时间 / 跳跃缓冲 ---------- */
reset();
Player.x = 15 * TILE + 8;
Player.y = GROUND_TOP - Player.h;
Player.onGround = true;
key('ArrowRight', true);
let walkOff = 0;
while (Player.onGround && walkOff < 90) { step(1); walkOff++; }
step(2);
key('Space', true);
step(1);
R['离开边缘100ms内可跳(vy<0)'] = Player.vy < 0;
clearKeys();

reset();
Player.y = GROUND_TOP - Player.h - 40;
Player.vy = 200; Player.onGround = false;
// 一直下落到"下一帧就要落地"时再按跳
let guard = 0;
while (Player.y + Player.h < GROUND_TOP - 8 && guard < 200) { step(1); guard++; }
key('Space', true);
step(1);
key('Space', false);
let jumped = false;
for (let i = 0; i < 40; i++) { step(1); if (Player.vy < -100) { jumped = true; break; } }
R['落地前按跳→自动起跳'] = jumped;
clearKeys();

/* ---------- 输出 ---------- */
const lines = Object.keys(R).map(k => '  ' + k + ' : ' + R[k]);
console.log('=== PRD 验收实测 ===');
console.log(lines.join('\n'));
