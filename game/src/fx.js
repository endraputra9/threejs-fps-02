// Transient effects, all pooled: tracers, impact puffs, muzzle smoke, thrown
// grenades' visuals, smoke clouds (which also block bot sightlines), the
// planted charge with its blinking light, and explosion flashes. Nothing here
// allocates in the frame loop — pools recycle fixed arrays of meshes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 48;
const PUFFS = 140;

export function createFx(scene) {
  // Tracers: stretched additive boxes from muzzle to impact.
  const tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, ttl: 0 });
  }
  let tracerIdx = 0;
  const _mid = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  // Impact puffs: small sprites that grow and fade.
  const puffTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const mat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    puffs.push({ sprite: s, ttl: 0, life: 1, vx: 0, vy: 0, vz: 0, grow: 1, base: 0.2 });
  }
  let puffIdx = 0;

  // Smoke clouds: clusters of big soft sprites + a sight-blocking sphere the
  // game registers while the cloud lives.
  const smokes = [];
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);

  // Explosion flash light.
  const boomLight = new THREE.PointLight(0xffa050, 0, 22, 1.6);
  scene.add(boomLight);
  let boomT = 0;

  // The charge: a dark brick with a red beacon, placed by the game.
  const charge = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: PALETTE.chargeBody, roughness: 0.5, metalness: 0.4 }),
  );
  chargeBody.position.y = 0.08;
  charge.add(chargeBody);
  const beaconMat = new THREE.MeshBasicMaterial({ color: PALETTE.chargeLight });
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), beaconMat);
  beacon.position.set(0.12, 0.19, 0);
  charge.add(beacon);
  const chargeLight = new THREE.PointLight(PALETTE.chargeLight, 0, 6, 2);
  chargeLight.position.y = 0.4;
  charge.add(chargeLight);
  charge.visible = false;
  scene.add(charge);

  // Dropped charge (carrier died): same mesh family, steady amber beacon.
  const dropped = charge.clone();
  dropped.visible = false;
  scene.add(dropped);

  function spawnPuff(x, y, z, { color = 0xcfc8bd, size = 0.22, life = 0.4, vx = 0, vy = 0.6, vz = 0, grow = 2.2, opacity = 0.5 } = {}) {
    const p = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % PUFFS;
    p.sprite.visible = true;
    p.sprite.position.set(x, y, z);
    p.sprite.material.color.setHex(color);
    p.sprite.material.opacity = opacity;
    p.base = size;
    p.sprite.scale.set(size, size, 1);
    p.ttl = life;
    p.life = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.grow = grow;
  }

  return {
    smokes,
    tracer(from, to) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      _mid.addVectors(from, to).multiplyScalar(0.5);
      _dir.subVectors(to, from);
      const len = _dir.length();
      if (len < 0.5) return;
      t.mesh.position.copy(_mid);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(to);
      t.mesh.visible = true;
      t.ttl = 0.055;
    },
    impact(point, normal, kind) {
      const n = kind === 'flesh' ? 5 : 4;
      for (let i = 0; i < n; i++) {
        spawnPuff(
          point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05,
          {
            color: kind === 'flesh' ? 0xb0402f : kind === 'metal' ? 0xffc46b : 0xcfc8bd,
            size: kind === 'flesh' ? 0.16 : 0.13,
            life: 0.32,
            vx: normal.x * 0.7 + (Math.sin(i * 2.4) * 0.3),
            vy: 0.5 + (i % 3) * 0.22,
            vz: normal.z * 0.7 + (Math.cos(i * 1.9) * 0.3),
            opacity: 0.65,
          },
        );
      }
    },
    muzzleSmoke(pos) {
      spawnPuff(pos.x, pos.y, pos.z, { color: 0x9aa0a3, size: 0.1, life: 0.5, vy: 0.35, opacity: 0.3 });
    },
    explosion(pos) {
      boomLight.position.copy(pos).y += 1;
      boomT = 0.28;
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        spawnPuff(pos.x, pos.y + 0.4, pos.z, {
          color: i % 3 ? 0xff8a3a : 0x5a5a5a, size: 0.5, life: 0.7,
          vx: Math.cos(a) * (1 + (i % 4)), vy: 1.4 + (i % 5) * 0.5, vz: Math.sin(a) * (1 + (i % 4)),
          grow: 3.4, opacity: 0.8,
        });
      }
    },
    throwSmoke(pos, radius) {
      const group = new THREE.Group();
      group.position.copy(pos);
      const mat = new THREE.SpriteMaterial({ map: puffTex, color: PALETTE.smoke, transparent: true, opacity: 0.34, depthWrite: false });
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Sprite(mat);
        const a = (i / 9) * Math.PI * 2;
        s.position.set(Math.cos(a) * radius * 0.45, 1 + (i % 3) * 0.7, Math.sin(a) * radius * 0.45);
        const sc = radius * (1.1 + (i % 4) * 0.22);
        s.scale.set(sc, sc, 1);
        group.add(s);
      }
      smokeGroup.add(group);
      const entry = { x: pos.x, y: 1.3, z: pos.z, r: radius, ttl: 14, group };
      smokes.push(entry);
      return entry;
    },
    setCharge(pos, planted) {
      const m = planted ? charge : dropped;
      (planted ? dropped : charge).visible = false;
      if (!pos) { charge.visible = false; dropped.visible = false; return; }
      m.position.copy(pos);
      m.visible = true;
    },
    update(dt, t) {
      for (const tr of tracers) {
        if (tr.ttl > 0) {
          tr.ttl -= dt;
          if (tr.ttl <= 0) tr.mesh.visible = false;
        }
      }
      for (const p of puffs) {
        if (p.ttl > 0) {
          p.ttl -= dt;
          if (p.ttl <= 0) { p.sprite.visible = false; continue; }
          const k = p.ttl / p.life;
          p.sprite.position.x += p.vx * dt;
          p.sprite.position.y += p.vy * dt;
          p.sprite.position.z += p.vz * dt;
          const sc = p.base * (1 + (1 - k) * p.grow);
          p.sprite.scale.set(sc, sc, 1);
          p.sprite.material.opacity = Math.min(0.85, k * 1.4) * 0.75;
        }
      }
      for (let i = smokes.length - 1; i >= 0; i--) {
        smokes[i].ttl -= dt;
        if (smokes[i].ttl <= 0) {
          smokeGroup.remove(smokes[i].group);
          smokes.splice(i, 1);
        }
      }
      if (boomT > 0) {
        boomT -= dt;
        boomLight.intensity = Math.max(0, boomT / 0.28) * 260;
      }
      if (charge.visible) {
        const blink = (t % 0.8) < 0.12;
        beaconMat.color.setHex(blink ? 0xff6a5e : 0x7a130d);
        chargeLight.intensity = blink ? 5 : 0;
      }
    },
  };
}
