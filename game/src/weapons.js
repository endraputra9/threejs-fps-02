// The arsenal: five guns and a knife, all original names, tuned so accuracy
// pays — spread blooms hard while moving or spraying and settles when the
// shooter stops and crouches, the first shot of a burst is nearly exact, and
// headshots multiply damage. This module owns the catalogue, per-actor weapon
// state (mags, reserve, reload and switch timers, bloom) and the first-person
// viewmodel; the game module resolves the actual rays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  knife: {
    name: 'Field Knife', slot: 3, price: 0, kind: 'melee',
    damage: 55, headMult: 1, rpm: 110, mag: Infinity, reserve: Infinity,
    reloadTime: 0, auto: false, range: 1.7, spread: 0, sound: 'knife',
  },
  p9: {
    name: 'P9 Sidearm', slot: 2, price: 0, kind: 'sidearm',
    damage: 27, headMult: 4, rpm: 380, mag: 12, reserve: 96,
    reloadTime: 1.6, auto: false, range: 90, falloff: [18, 55],
    spread: 0.006, spreadMove: 0.045, bloom: 0.006, recoil: 0.011, sound: 'sidearm',
  },
  raptor: {
    name: 'Raptor-9 SMG', slot: 1, price: 1000, kind: 'smg',
    damage: 21, headMult: 3, rpm: 780, mag: 30, reserve: 120,
    reloadTime: 2.1, auto: true, range: 80, falloff: [12, 38],
    spread: 0.014, spreadMove: 0.05, bloom: 0.007, recoil: 0.008, sound: 'smg',
  },
  breacher: {
    name: 'Breacher-12', slot: 1, price: 1100, kind: 'shotgun',
    damage: 9, pellets: 8, headMult: 2, rpm: 68, mag: 6, reserve: 24,
    reloadTime: 3.1, auto: false, range: 40, falloff: [6, 20],
    spread: 0.045, spreadMove: 0.06, bloom: 0, recoil: 0.05, sound: 'shotgun',
  },
  vk7: {
    name: 'VK-7 Carbine', slot: 1, price: 2700, kind: 'rifle',
    damage: 33, headMult: 4, rpm: 640, mag: 30, reserve: 90,
    reloadTime: 2.3, auto: true, range: 120, falloff: [30, 90],
    spread: 0.004, spreadMove: 0.055, bloom: 0.009, recoil: 0.014, sound: 'rifle',
  },
  meridian: {
    name: 'Meridian LR', slot: 1, price: 4750, kind: 'sniper',
    damage: 112, headMult: 2, rpm: 42, mag: 5, reserve: 30,
    reloadTime: 3.4, auto: false, range: 220, falloff: [60, 200],
    spread: 0.001, spreadMove: 0.09, bloom: 0, recoil: 0.06, sound: 'sniper', zoom: 4.2,
  },
};
export const PRIMARY_KEYS = ['vk7', 'meridian', 'breacher', 'raptor'];
export const GRENADES = {
  frag: { name: 'Frag Charge', price: 300, damage: 92, radius: 5.2 },
  smoke: { name: 'Veil Smoke', price: 300, radius: 3.4, duration: 14 },
};
export const GEAR = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Vest + Helm', price: 1000 },
  kit: { name: 'Defuse Kit', price: 400 },
};

export function newLoadout() {
  return {
    current: 'p9',
    owned: { knife: true, p9: true },
    mag: { p9: WEAPONS.p9.mag },
    reserve: { p9: WEAPONS.p9.reserve },
    frags: 0,
    smokes: 0,
    lastShotAt: -9,
    bloom: 0,
    reloadEnd: 0,
    switchEnd: 0,
    scoped: false,
  };
}

export function giveWeapon(load, key) {
  load.owned[key] = true;
  load.mag[key] = WEAPONS[key].mag;
  load.reserve[key] = WEAPONS[key].reserve;
}

export function selectWeapon(load, key, now) {
  if (!load.owned[key] || load.current === key) return false;
  load.current = key;
  load.reloadEnd = 0;
  load.switchEnd = now + 0.32;
  load.bloom = 0;
  load.scoped = false;
  return true;
}

export function startReload(load, now) {
  const def = WEAPONS[load.current];
  if (!Number.isFinite(def.mag)) return false;
  if (load.mag[load.current] >= def.mag || load.reserve[load.current] <= 0) return false;
  if (load.reloadEnd > now) return false;
  load.reloadEnd = now + def.reloadTime;
  return true;
}

// Called every step by the game; returns 'reloaded' on the step a reload lands.
export function updateLoadout(load, now) {
  if (load.reloadEnd && now >= load.reloadEnd) {
    const key = load.current;
    const def = WEAPONS[key];
    const need = def.mag - load.mag[key];
    const take = Math.min(need, load.reserve[key]);
    load.mag[key] += take;
    load.reserve[key] -= take;
    load.reloadEnd = 0;
    return 'reloaded';
  }
  // Bloom decays fast once the trigger rests.
  const rest = now - load.lastShotAt;
  if (rest > 0.09) load.bloom = Math.max(0, load.bloom - rest * 0.55);
  return null;
}

// Total spread (radians) for the next shot: base + movement + air + bloom,
// discounted by crouching and by aiming down the Meridian's scope.
export function spreadOf(load, actor) {
  const def = WEAPONS[load.current];
  if (def.kind === 'melee') return 0;
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  let s = def.spread + def.spreadMove * Math.min(1, speed / 5) + load.bloom;
  if (!actor.onGround) s += 0.06;
  if (actor.crouch) s *= 0.62;
  if (load.scoped) s *= 0.25;
  return s;
}

export function damageAt(def, dist) {
  if (!def.falloff) return def.damage;
  const [a, b] = def.falloff;
  if (dist <= a) return def.damage;
  if (dist >= b) return def.damage * 0.4;
  return def.damage * (1 - 0.6 * ((dist - a) / (b - a)));
}

// Ray vs one actor's two hit boxes. Boxes follow the feet position; the head
// box sits higher and is smaller, which is what makes headshots a skill.
// Returns {dist, zone} or null. dir must be normalised.
export function rayVsActor(ox, oy, oz, dx, dy, dz, actor, maxDist) {
  const feetY = actor.pos.y;
  const crouch = actor.crouch;
  const headCY = feetY + (crouch ? 1.06 : 1.58);
  const bodyTop = feetY + (crouch ? 0.98 : 1.44);
  const bodyBot = feetY + 0.12;
  let best = null;
  // Head
  let t = rayBox(ox, oy, oz, dx, dy, dz, actor.pos.x - 0.17, headCY - 0.15, actor.pos.z - 0.17, actor.pos.x + 0.17, headCY + 0.15, actor.pos.z + 0.17, maxDist);
  if (t !== null) best = { dist: t, zone: 'head' };
  // Body (includes legs; the game splits legs by hit height)
  t = rayBox(ox, oy, oz, dx, dy, dz, actor.pos.x - 0.35, bodyBot, actor.pos.z - 0.27, actor.pos.x + 0.35, bodyTop, actor.pos.z + 0.27, maxDist);
  if (t !== null && (!best || t < best.dist)) {
    const hitY = oy + dy * t;
    best = { dist: t, zone: hitY < feetY + 0.75 ? 'legs' : 'body' };
  }
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return null; }
  else {
    let t1 = (x0 - ox) / dx; let t2 = (x1 - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return null; }
  else {
    let t1 = (y0 - oy) / dy; let t2 = (y1 - oy) / dy;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return null; }
  else {
    let t1 = (z0 - oz) / dz; let t2 = (z1 - oz) / dz;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0.01 ? tmin : null;
}

// ---- first-person viewmodel ----
// One low-poly gun per weapon built from boxes, parented to the camera. The
// game drives bob, recoil kick, reload dip and the scope fade through
// update(). Meshes are built once and toggled visible.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.26, -0.24, -0.5);
  camera.add(group);
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5133, roughness: 0.85 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const part = (parent, mat, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  const builds = {
    knife: () => {
      const g = new THREE.Group();
      part(g, grip, 0, -0.02, 0.05, 0.035, 0.1, 0.05);
      part(g, dark, 0, 0.01, -0.12, 0.012, 0.045, 0.3);
      return g;
    },
    p9: () => {
      const g = new THREE.Group();
      part(g, dark, 0, 0.02, -0.09, 0.05, 0.06, 0.24);
      part(g, grip, 0, -0.06, 0.03, 0.045, 0.11, 0.06);
      part(g, accent, 0, 0.055, -0.2, 0.008, 0.02, 0.008);
      return g;
    },
    raptor: () => {
      const g = new THREE.Group();
      part(g, dark, 0, 0.02, -0.16, 0.055, 0.07, 0.42);
      part(g, grip, 0, -0.06, 0.05, 0.05, 0.12, 0.06);
      part(g, grip, 0, -0.05, -0.12, 0.04, 0.1, 0.05);
      part(g, dark, 0, 0.03, -0.42, 0.03, 0.03, 0.1);
      return g;
    },
    breacher: () => {
      const g = new THREE.Group();
      part(g, dark, 0, 0.03, -0.2, 0.06, 0.06, 0.5);
      part(g, wood, 0, -0.01, -0.18, 0.055, 0.05, 0.22);
      part(g, grip, 0, -0.05, 0.08, 0.05, 0.11, 0.07);
      part(g, dark, 0, 0.02, -0.48, 0.045, 0.045, 0.08);
      return g;
    },
    vk7: () => {
      const g = new THREE.Group();
      part(g, dark, 0, 0.02, -0.2, 0.055, 0.075, 0.52);
      part(g, grip, 0, -0.065, 0.02, 0.045, 0.13, 0.055);
      part(g, grip, 0, -0.04, -0.2, 0.04, 0.09, 0.05);
      part(g, dark, 0, -0.02, -0.52, 0.035, 0.035, 0.14);
      part(g, accent, 0, 0.075, -0.3, 0.01, 0.025, 0.01);
      part(g, dark, 0, 0.07, -0.05, 0.03, 0.03, 0.16);
      return g;
    },
    meridian: () => {
      const g = new THREE.Group();
      part(g, dark, 0, 0.02, -0.24, 0.05, 0.065, 0.62);
      part(g, wood, 0, -0.03, 0.08, 0.05, 0.06, 0.2);
      part(g, grip, 0, -0.06, 0.0, 0.045, 0.11, 0.055);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.17, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.085, -0.16);
      g.add(scope);
      part(g, dark, 0, 0.02, -0.58, 0.04, 0.04, 0.1);
      return g;
    },
  };
  const models = {};
  for (const key of Object.keys(builds)) {
    models[key] = builds[key]();
    models[key].visible = false;
    group.add(models[key]);
  }
  // Muzzle flash: a soft radial sprite (always faces the camera, reads as a
  // flash bloom rather than a card) plus a short warm fill light that also
  // keeps the viewmodel readable in shadowed lanes.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const fgrad = fctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  fgrad.addColorStop(0, 'rgba(255,230,170,1)');
  fgrad.addColorStop(0.4, 'rgba(255,170,70,0.75)');
  fgrad.addColorStop(1, 'rgba(255,120,30,0)');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 64, 64);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(flashCanvas), color: 0xffffff, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flash.scale.set(0.34, 0.34, 1);
  flash.position.set(0, 0.03, -0.62);
  group.add(flash);
  const fill = new THREE.PointLight(0xfff1dd, 1.6, 3.2, 1.6);
  fill.position.set(0.1, 0.1, 0.1);
  group.add(fill);
  const flashLight = new THREE.PointLight(0xffa040, 0, 9, 2);
  flashLight.position.set(0, 0.05, -0.6);
  group.add(flashLight);

  let current = null;
  let kick = 0;
  let flashT = 0;
  return {
    group,
    setWeapon(key) {
      if (current) models[current].visible = false;
      current = key;
      if (key) models[key].visible = true;
    },
    fire() {
      kick = 1;
      flashT = 0.045;
    },
    update(dt, { bobPhase = 0, bobAmt = 0, reloadDip = 0, scoped = false, switchDip = 0 }) {
      kick = Math.max(0, kick - dt * 9);
      flashT = Math.max(0, flashT - dt);
      flash.material.opacity = flashT > 0 ? 0.9 : 0;
      flash.material.rotation = bobPhase * 1.7;
      flashLight.intensity = flashT > 0 ? 14 : 0;
      group.visible = !scoped;
      group.position.set(
        0.26 + Math.sin(bobPhase) * 0.012 * bobAmt,
        -0.24 + Math.abs(Math.cos(bobPhase)) * 0.01 * bobAmt - reloadDip * 0.16 - switchDip * 0.22,
        -0.5 + kick * 0.07,
      );
      group.rotation.set(kick * 0.06 + reloadDip * 0.5 + switchDip * 0.4, 0, reloadDip * 0.22);
    },
  };
}
