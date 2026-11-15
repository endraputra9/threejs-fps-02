// Foundry Nine: an original dusk foundry yard. Two charge sites — the Smelter
// (A, north-west) and the Casting Hall (B, north-east) — three lanes south to
// north (west lane, mid, east lane) and two cross-links, so every round is a
// choice of route. The world module owns the static geometry, the AABB
// colliders every actor collides with, analytic raycasts (no three.js
// Raycaster in the hot path), and the waypoint graph the bots path over.
// Everything visual is boxes and canvas textures: no external assets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, s, base, fleck, n = 2600, a = 0.16) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? fleck : '#00000022';
    ctx.globalAlpha = Math.random() * a;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  ctx.globalAlpha = 1;
}

// Block kinds: mat picks the material, h is the collider height (the box sits
// on the ground), cover blocks are what actors hide behind.
const BLOCKS = [
  // Perimeter walls
  { x: 0, z: -35, w: 74, d: 2, h: 5.5, mat: 'wall' }, { x: 0, z: 35, w: 74, d: 2, h: 5.5, mat: 'wall' },
  { x: -35, z: 0, w: 2, d: 74, h: 5.5, mat: 'wall' }, { x: 35, z: 0, w: 2, d: 74, h: 5.5, mat: 'wall' },
  // The four hall blocks that carve the three lanes
  { x: -9, z: 12, w: 10, d: 14, h: 5.5, mat: 'hall' }, { x: 9, z: 12, w: 10, d: 14, h: 5.5, mat: 'hall' },
  { x: -9, z: -12, w: 10, d: 12, h: 5.5, mat: 'hall' }, { x: 9, z: -12, w: 10, d: 12, h: 5.5, mat: 'hall' },
  // Outer lane walls
  { x: -27, z: 0, w: 8, d: 22, h: 6, mat: 'hall' }, { x: 27, z: 0, w: 8, d: 22, h: 6, mat: 'hall' },
  // Defender spawn screens (leave the z=-21 passages open)
  { x: -5, z: -28, w: 2, d: 7, h: 4, mat: 'steel' }, { x: 5, z: -28, w: 2, d: 7, h: 4, mat: 'steel' },
  // Mid cover
  { x: 0, z: 4, w: 3.4, d: 1, h: 1.1, mat: 'barrier' }, { x: 0, z: -6, w: 1, d: 3.4, h: 1.1, mat: 'barrier' },
  { x: -4.6, z: -22, w: 3.4, d: 2.6, h: 2.6, mat: 'contTeal' }, { x: 4.6, z: -22, w: 3.4, d: 2.6, h: 2.6, mat: 'contRust' },
  { x: -2, z: -9, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' }, { x: 2.2, z: 11, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: 2.2, z: 12.3, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  // West lane cover
  { x: -18, z: 6, w: 2.6, d: 6, h: 2.6, mat: 'contRust' }, { x: -18, z: -4, w: 2.6, d: 6, h: 2.6, mat: 'contGrey' },
  { x: -20, z: -12, w: 4, d: 0.8, h: 1.1, mat: 'barrier' }, { x: -15.5, z: 16, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: -21, z: 20, w: 2.4, d: 1.2, h: 1.2, mat: 'crate' },
  // East lane cover
  { x: 18, z: 2, w: 2.6, d: 6, h: 2.6, mat: 'contTeal' }, { x: 18, z: -8, w: 2.6, d: 6, h: 2.6, mat: 'contGrey' },
  { x: 20, z: -13, w: 4, d: 0.8, h: 1.1, mat: 'barrier' }, { x: 15.5, z: 15, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: 21, z: 21, w: 2.4, d: 1.2, h: 1.2, mat: 'crate' },
  // South yard (Vanguard spawn) cover
  { x: -10, z: 29, w: 6, d: 2.6, h: 2.6, mat: 'contTeal' }, { x: 10, z: 29, w: 6, d: 2.6, h: 2.6, mat: 'contRust' },
  { x: 0, z: 25, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' }, { x: -4, z: 33, w: 2.4, d: 1.2, h: 1.2, mat: 'crate' },
  // Site A — the Smelter: furnace block, containers, low walls
  { x: -27, z: -27, w: 5.5, d: 5.5, h: 6.5, mat: 'furnace' },
  { x: -14.5, z: -25, w: 6, d: 2.6, h: 2.6, mat: 'contTeal' }, { x: -14.5, z: -22.4, w: 6, d: 2.6, h: 2.6, mat: 'contTeal' },
  { x: -19, z: -17.5, w: 0.8, d: 4.6, h: 1.1, mat: 'barrier' }, { x: -24, z: -19, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: -24, z: -17.8, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' }, { x: -30, z: -15, w: 3, d: 3, h: 4.5, mat: 'steel' },
  // Site B — the Casting Hall: mould block, containers, low walls
  { x: 27, z: -27, w: 5.5, d: 5.5, h: 3.6, mat: 'mould' },
  { x: 14.5, z: -25, w: 2.6, d: 6, h: 2.6, mat: 'contRust' }, { x: 17.1, z: -25, w: 2.6, d: 6, h: 2.6, mat: 'contRust' },
  { x: 19, z: -17.5, w: 0.8, d: 4.6, h: 1.1, mat: 'barrier' }, { x: 24, z: -19, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: 24, z: -17.8, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' }, { x: 30, z: -15, w: 3, d: 3, h: 4.5, mat: 'steel' },
  // North-link and lane-mouth cover
  { x: -9, z: -20, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' }, { x: 9, z: -20, w: 1.2, d: 1.2, h: 1.2, mat: 'crate' },
  { x: -14, z: -16, w: 3.4, d: 1, h: 1.1, mat: 'barrier' }, { x: 14, z: -16, w: 3.4, d: 1, h: 1.1, mat: 'barrier' },
];

// Waypoint graph: bots path node to node; positions sit in open floor beside
// the cover they use. Edges are listed once and mirrored.
const NODES = [
  [-4, 29], [0, 30], [4, 29], // 0-2 Vanguard spawn
  [-9, 22], [0, 22], [9, 22], // 3-5 south link
  [-18, 16], [0, 13], [18, 16], // 6-8 lane mouths
  [-18, 6], [0, 4], [18, 4], // 9-11 mid-lane
  [-18, -6], [0, -6], [18, -6], // 12-14
  [-18, -14], [0, -13], [18, -14], // 15-17 north lane ends
  [-9, -16], [9, -16], // 18-19 north link
  [-21, -21], [-14, -20], [-27, -16], // 20-22 site A
  [21, -21], [14, -20], [27, -16], // 23-25 site B
  [-3, -28], [3, -28], [0, -23], // 26-28 Warden spawn
  [-9, -24], [9, -24], // 29-30 site approaches
  [-24, 24], [24, 24], // 31-32 yard corners
  [-18, 24], [18, 24], // 33-34 lane mouths south
];
const EDGES = [
  [0, 3], [0, 4], [1, 4], [2, 4], [2, 5], [3, 4], [4, 5], [3, 33], [5, 34], [3, 31], [5, 32],
  [33, 6], [34, 8], [4, 7], [6, 9], [7, 10], [8, 11], [9, 12], [10, 13], [11, 14],
  [12, 15], [13, 16], [14, 17], [15, 18], [16, 18], [16, 19], [17, 19], [9, 10], [10, 11], [12, 13], [13, 14],
  [18, 29], [19, 30], [29, 21], [30, 24], [29, 28], [30, 28], [26, 28], [27, 28], [26, 29], [27, 30],
  [21, 20], [21, 22], [20, 22], [24, 23], [24, 25], [23, 25], [15, 21], [17, 24], [31, 33], [32, 34],
];

export const SITES = [
  { id: 'A', name: 'Smelter', x: -21, z: -21, r: 6.5, color: PALETTE.siteA },
  { id: 'B', name: 'Casting Hall', x: 21, z: -21, r: 6.5, color: PALETTE.siteB },
];
export const SPAWNS = {
  attack: [[0, 29.5], [-2.5, 30.5], [2.5, 30.5], [-5, 29.5], [5, 29.5]],
  defend: [[0, -29.5], [-2, -30.5], [2, -30.5], [-4, -29.5], [4, -29.5]],
};

export function createWorld(scene) {
  const colliders = BLOCKS.map((b) => ({
    x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, h: b.h,
  }));

  // ---- materials (canvas textures, generated once) ----
  const groundTex = canvasTexture(512, (ctx, s) => {
    speckle(ctx, s, '#43464a', '#5a5e60', 3200, 0.2);
    ctx.strokeStyle = '#ffffff10';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo((s / 4) * i, 0); ctx.lineTo((s / 4) * i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (s / 4) * i); ctx.lineTo(s, (s / 4) * i); ctx.stroke();
    }
  }, 10);
  const wallTex = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#6a655d', '#7d776c', 1500, 0.15);
    ctx.fillStyle = '#00000026';
    for (let y = 42; y < s; y += 43) ctx.fillRect(0, y, s, 3);
  }, 3);
  const corrugated = (base) => canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, base, '#ffffff', 700, 0.08);
    for (let x = 0; x < s; x += 32) {
      ctx.fillStyle = '#00000030'; ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = '#ffffff18'; ctx.fillRect(x + 6, 0, 4, s);
    }
    ctx.fillStyle = '#00000038'; ctx.fillRect(0, 0, s, 10); ctx.fillRect(0, s - 10, s, 10);
  }, 1);
  const crateTex = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#8a6b42', '#a07c4c', 900, 0.14);
    ctx.strokeStyle = '#5e472a'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, s - 14, s - 14);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s); ctx.stroke();
  }, 1);
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }),
    hall: new THREE.MeshStandardMaterial({ map: wallTex, color: 0xb9c0c4, roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.55, metalness: 0.55 }),
    barrier: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.9 }),
    contTeal: new THREE.MeshStandardMaterial({ map: corrugated('#2e6f6a'), roughness: 0.7, metalness: 0.25 }),
    contRust: new THREE.MeshStandardMaterial({ map: corrugated('#8c4a2d'), roughness: 0.75, metalness: 0.2 }),
    contGrey: new THREE.MeshStandardMaterial({ map: corrugated('#62676b'), roughness: 0.7, metalness: 0.3 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 }),
    furnace: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.4 }),
    mould: new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.5, metalness: 0.6 }),
  };

  // ---- scene dressing ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 12),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(512, (ctx, s) => {
        const grad = ctx.createLinearGradient(0, 0, 0, s);
        grad.addColorStop(0, '#141d29');
        grad.addColorStop(0.55, '#2c3d4f');
        grad.addColorStop(0.78, '#7a5a3c');
        grad.addColorStop(1, '#c97e3f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
      }),
      side: THREE.BackSide, fog: false, depthWrite: false,
    }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 190);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.set(-30, 62, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(76, 76), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Apron beyond the walls and a skyline of dead foundry sheds for depth.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x1c242e, fog: true });
  const skylineGeo = new THREE.BoxGeometry(1, 1, 1);
  const skylineSpots = [[-70, -60, 26, 30], [40, -80, 34, 22], [85, -20, 22, 38], [-90, 10, 30, 18], [70, 55, 40, 16], [-60, 70, 28, 24], [0, -95, 60, 26]];
  for (const [x, z, w, h] of skylineSpots) {
    const m = new THREE.Mesh(skylineGeo, skylineMat);
    m.position.set(x, h / 2, z);
    m.scale.set(w, h, w * 0.7);
    scene.add(m);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of BLOCKS) {
    const mesh = new THREE.Mesh(boxGeo, mats[b.mat]);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.castShadow = b.h > 1.3;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (b.mat === 'furnace') {
      const glow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
      glow.position.set(b.x, 1.6, b.z + b.d / 2 + 0.16);
      scene.add(glow);
      const lamp = new THREE.PointLight(0xff7a2a, 30, 18, 1.8);
      lamp.position.set(b.x, 2.2, b.z + 4.4);
      scene.add(lamp);
    }
  }
  // Gantry crane over mid: two legs (colliders already implied by hall blocks
  // is wrong — legs get their own thin colliders) and a high beam.
  const craneMat = new THREE.MeshStandardMaterial({ color: PALETTE.safety, roughness: 0.6, metalness: 0.3 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(boxGeo, craneMat);
    leg.position.set(sx * 5.4, 4, -1);
    leg.scale.set(0.5, 8, 0.5);
    leg.castShadow = true;
    scene.add(leg);
    colliders.push({ x0: sx * 5.4 - 0.25, x1: sx * 5.4 + 0.25, z0: -1.25, z1: -0.75, h: 8 });
  }
  const beam = new THREE.Mesh(boxGeo, craneMat);
  beam.position.set(0, 8.1, -1);
  beam.scale.set(11.6, 0.5, 0.7);
  scene.add(beam);

  // Site paint: a ring, the letter, and a pulsing point light per site.
  const siteLights = [];
  for (const site of SITES) {
    const tex = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = '#' + site.color.toString(16).padStart(6, '0');
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `700 ${s * 0.52}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site.id, s / 2, s / 2 + 4);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const paint = new THREE.Mesh(
      new THREE.CircleGeometry(site.r, 40),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(site.x, 0.02, site.z);
    scene.add(paint);
    const light = new THREE.PointLight(site.color, 14, 15, 1.9);
    light.position.set(site.x, 3.4, site.z);
    scene.add(light);
    siteLights.push(light);
  }

  // ---- queries ----
  const _hit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  // Ray vs every collider plus the ground plane; returns the shared _hit or
  // null. Slab test per box — the map is small enough that this is cheap.
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let found = false;
    if (dy < -1e-8) {
      const t = -oy / dy;
      if (t > 0 && t < best) {
        best = t; found = true;
        _hit.nx = 0; _hit.ny = 1; _hit.nz = 0;
      }
    }
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      let tmin = 0;
      let tmax = best;
      let axis = -1;
      // X slab
      if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
      else {
        let t1 = (c.x0 - ox) / dx; let t2 = (c.x1 - ox) / dx;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) { tmin = t1; axis = 0; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y slab (boxes stand on the ground: 0..h)
      if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) continue; }
      else {
        let t1 = (0 - oy) / dy; let t2 = (c.h - oy) / dy;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) { tmin = t1; axis = 1; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
      else {
        let t1 = (c.z0 - oz) / dz; let t2 = (c.z1 - oz) / dz;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) { tmin = t1; axis = 2; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin > 0.001 && tmin < best) {
        best = tmin; found = true;
        _hit.nx = axis === 0 ? (dx > 0 ? -1 : 1) : 0;
        _hit.ny = axis === 1 ? (dy > 0 ? -1 : 1) : 0;
        _hit.nz = axis === 2 ? (dz > 0 ? -1 : 1) : 0;
      }
    }
    if (!found) return null;
    _hit.dist = best;
    _hit.x = ox + dx * best; _hit.y = oy + dy * best; _hit.z = oz + dz * best;
    return _hit;
  }

  function groundHeightAt(x, z, refY) {
    let g = 0;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && c.h <= refY + 0.55 && c.h > g) g = c.h;
    }
    return g;
  }

  // Push a circle (actor footprint) out of every collider it overlaps, one
  // axis at a time; returns true when it touched anything.
  function collideCircle(pos, radius) {
    let touched = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (pos.y >= c.h - 0.3) continue; // feet at/above the top: walk over it
      const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
      const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
      const ddx = pos.x - nx;
      const ddz = pos.z - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= radius * radius) continue;
      touched = true;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = nx + (ddx / d) * radius;
        pos.z = nz + (ddz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pl = pos.x - c.x0; const pr = c.x1 - pos.x;
        const pt = pos.z - c.z0; const pb = c.z1 - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.x0 - radius;
        else if (m === pr) pos.x = c.x1 + radius;
        else if (m === pt) pos.z = c.z0 - radius;
        else pos.z = c.z1 + radius;
      }
    }
    return touched;
  }

  function segmentBlocked(ax, ay, az, bx, by, bz, extraSpheres) {
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.01) return false;
    const hit = raycast(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
    if (hit) return true;
    if (extraSpheres) {
      for (const s of extraSpheres) {
        // Distance from the segment to the sphere centre vs its radius.
        const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / (dist * dist)));
        const px = ax + dx * t - s.x; const py = ay + dy * t - s.y; const pz = az + dz * t - s.z;
        if (px * px + py * py + pz * pz < s.r * s.r) return true;
      }
    }
    return false;
  }

  // ---- waypoint graph + A* ----
  const nodes = NODES.map(([x, z]) => ({ x, z }));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearestNode(x, z) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  const _open = [];
  function findPath(sx, sz, tx, tz) {
    const start = nearestNode(sx, sz);
    const goal = nearestNode(tx, tz);
    if (start === goal) return [{ x: tx, z: tz }];
    const came = new Map();
    const gScore = new Map([[start, 0]]);
    _open.length = 0;
    _open.push({ n: start, f: 0 });
    const closed = new Set();
    while (_open.length) {
      let bi = 0;
      for (let i = 1; i < _open.length; i++) if (_open[i].f < _open[bi].f) bi = i;
      const { n } = _open.splice(bi, 1)[0];
      if (n === goal) {
        const path = [{ x: tx, z: tz }];
        let cur = goal;
        while (cur !== start) {
          path.unshift({ x: nodes[cur].x, z: nodes[cur].z });
          cur = came.get(cur);
        }
        return path;
      }
      if (closed.has(n)) continue;
      closed.add(n);
      for (const m of adjacency[n]) {
        const g = (gScore.get(n) ?? 0) + Math.hypot(nodes[m].x - nodes[n].x, nodes[m].z - nodes[n].z);
        if (g < (gScore.get(m) ?? Infinity)) {
          gScore.set(m, g);
          came.set(m, n);
          const h = Math.hypot(nodes[m].x - nodes[goal].x, nodes[m].z - nodes[goal].z);
          _open.push({ n: m, f: g + h });
        }
      }
    }
    return [{ x: tx, z: tz }];
  }

  return {
    colliders,
    blocks: BLOCKS,
    nodes,
    raycast,
    groundHeightAt,
    collideCircle,
    segmentBlocked,
    findPath,
    nearestNode,
    siteAt(x, z) {
      for (const s of SITES) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d <= s.r) return s;
      }
      return null;
    },
    update(t) {
      siteLights[0].intensity = 12 + Math.sin(t * 2.2) * 3;
      siteLights[1].intensity = 12 + Math.cos(t * 1.9) * 3;
    },
  };
}
