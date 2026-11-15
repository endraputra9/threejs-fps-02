// BREACHLINE — boot and the frame loop. A fixed 60 Hz simulation (game.step)
// runs from an accumulator; rendering (game.renderFrame) happens once per
// display frame and never feeds back into the simulation, so the game plays
// identically at any refresh rate.
//
// Screenshot modes: ?shot=menu|buy|fight|plant&seed=N stages a deterministic
// scene instead of starting a match, renders it frozen, and sets
// window.__shotReady when the frame is stable — that is how the entry's
// screenshots were captured, and the scenes are real game states (the buy
// menu, a live mid fight, a plant in progress), not mock-ups.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES } from './world.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera); // the viewmodel is parented to the camera

const world = createWorld(scene);
const fx = createFx(scene);
const audio = createAudio();
const input = createInput(renderer.domElement);

let game = null;
const hud = createHud({
  blocks: world.blocks,
  sites: SITES,
  onBuy: (key) => game && game.buy(key),
});
game = createGame({ scene, camera, world, fx, audio, hud, input, rng, shotMode: shot });
window.__breachline = game; // debug handle: the whole match state, for testing

hud.onDeployClick(() => {
  hud.closeBuy();
  audio.unlock();
  input.requestLock();
});
document.getElementById('play-btn').addEventListener('click', () => {
  audio.unlock();
  hud.setMenuVisible(false);
  game.startMatch();
  input.requestLock();
});
document.getElementById('again-btn').addEventListener('click', () => {
  audio.unlock();
  hud.hideMatchEnd();
  game.startMatch();
  input.requestLock();
});
renderer.domElement.addEventListener('click', () => {
  audio.unlock();
  if (!shot && game.state.phase !== 'menu' && game.state.phase !== 'matchEnd' && !input.locked && !hud.buyOpen()) {
    input.requestLock();
  }
});
// Scoreboard while Tab is held.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    const rows = [...game.actors]
      .sort((a, b) => b.kills - a.kills)
      .map((a) => ({
        name: `${a.side === 'A' ? 'VAN' : 'WAR'} · ${a.name}`,
        k: a.kills, d: a.deaths, money: `$${a.money}`, me: a.isPlayer,
      }));
    hud.setScoreboard(rows, true);
  }
  if (e.code === 'KeyB' && game.state.phase === 'buy' && game.player.alive) {
    if (hud.buyOpen()) {
      hud.closeBuy();
      input.requestLock();
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.setScoreboard([], false);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const FIXED_STEP = 1 / 60;
let accumulator = 0;
let lastTime = performance.now();
let framesRendered = 0;

if (shot) {
  game.stageShot(shot);
  hud.setMenuVisible(shot === 'menu');
} else {
  hud.setMenuVisible(true);
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dtRender = Math.min(0.1, (nowMs - lastTime) / 1000);
  lastTime = nowMs;
  if (shot) {
    // Frozen staged scene: render the same instant until captured. The
    // instant is picked so the menu orbit sits on the sunlit south side.
    game.renderFrame(26, 0);
    renderer.render(scene, camera);
    framesRendered++;
    if (framesRendered >= 4 && !window.__shotReady) window.__shotReady = true;
    return;
  }
  accumulator += dtRender;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    game.step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps++;
  }
  if (steps === 5) accumulator = 0;
  game.renderFrame(nowMs / 1000, dtRender);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
