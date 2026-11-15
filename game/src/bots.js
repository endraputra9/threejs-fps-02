// Actors and their brains. One actor record serves the player and every bot:
// feet position, velocity, look angles, health and armour, a loadout, and a
// move order ({x, z, speed, jump, crouch}) that whoever controls the actor —
// the player's input or a bot brain — fills in each step. stepActor() is the
// only place movement is integrated: ground acceleration and friction, weak
// air control, gravity, step-up and circle-vs-AABB collision, so bots and the
// player obey exactly the same physics.
//
// Bot brains run decisions at 8 Hz and movement every step: perceive (vision
// cone + line of sight through the world's raycast, smoke blocks it; hearing
// from the game's noise events), path over the waypoint graph with A*, fight
// in bursts with strafing, and play the objective — attackers route to a
// site, the carrier plants, defenders hold sites and converge to defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { newLoadout, giveWeapon, WEAPONS } from './weapons.js';

export const RUN_SPEED = 5.3;
let nextId = 1;

export function createActor(name, side, isPlayer) {
  return {
    id: nextId++,
    name,
    side, // 'A' Vanguard roster, 'B' Warden roster
    role: 'attack', // set per round by the game
    isPlayer: !!isPlayer,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    crouch: false,
    onGround: true,
    hp: 100,
    armor: 0,
    helm: false,
    alive: true,
    loadout: newLoadout(),
    money: 800,
    kills: 0,
    deaths: 0,
    hasCharge: false,
    defuseKit: false,
    move: { x: 0, z: 0, speed: 0, jump: false, crouch: false },
    channel: null, // 'plant' | 'defuse' | null
    wantNade: null, // {kind, x, y, z}
    speed2d: 0,
    walkPhase: 0,
    stepSide: 1,
    mesh: null,
    brain: null,
    lastDamageAt: -9,
    lastDamageFrom: null,
    flashT: 0,
  };
}

export function eyeHeight(actor) {
  return actor.crouch ? 1.14 : 1.62;
}

// Shared movement integration. wishX/wishZ are a unit wish direction in world
// space; speed is the target speed (already includes crouch/walk factors).
export function stepActor(actor, world, dt) {
  const m = actor.move;
  actor.crouch = !!m.crouch;
  const targetVx = m.x * m.speed;
  const targetVz = m.z * m.speed;
  if (actor.onGround) {
    const k = 1 - Math.exp(-11 * dt);
    actor.vel.x += (targetVx - actor.vel.x) * k;
    actor.vel.z += (targetVz - actor.vel.z) * k;
    if (m.jump) {
      actor.vel.y = 4.9;
      actor.onGround = false;
    }
  } else {
    actor.vel.x += (targetVx - actor.vel.x) * 0.12 * dt * 8;
    actor.vel.z += (targetVz - actor.vel.z) * 0.12 * dt * 8;
  }
  actor.vel.y -= 14.5 * dt;
  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;
  world.collideCircle(actor.pos, 0.35);
  const ground = world.groundHeightAt(actor.pos.x, actor.pos.z, actor.pos.y);
  if (actor.pos.y <= ground) {
    actor.pos.y = ground;
    actor.vel.y = 0;
    actor.onGround = true;
  } else if (actor.pos.y > ground + 0.02) {
    actor.onGround = false;
  }
  actor.speed2d = Math.hypot(actor.vel.x, actor.vel.z);
  actor.walkPhase += actor.speed2d * dt * 1.9;
  m.jump = false;
}

// ---- bot bodies ----
const _boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function buildBotMesh(side) {
  const team = side === 'A' ? PALETTE.vanguard : PALETTE.warden;
  const teamDark = side === 'A' ? PALETTE.vanguardDark : PALETTE.wardenDark;
  const suit = new THREE.MeshStandardMaterial({
    color: team, roughness: 0.8,
    emissive: side === 'A' ? 0x07231e : 0x260b06, // never reads pure black in shadow
  });
  const dark = new THREE.MeshStandardMaterial({ color: teamDark, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.6 });
  const g = new THREE.Group();
  const part = (parent, mat, x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(_boxGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.92, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.92, 0); g.add(legR);
  part(legL, dark, 0, -0.45, 0, 0.17, 0.9, 0.19);
  part(legR, dark, 0, -0.45, 0, 0.17, 0.9, 0.19);
  const torso = part(g, suit, 0, 1.16, 0, 0.52, 0.6, 0.3);
  part(g, dark, 0, 1.16, -0.17, 0.4, 0.44, 0.06); // chest rig
  const head = part(g, skin, 0, 1.6, 0, 0.27, 0.28, 0.27);
  part(g, dark, 0, 1.74, 0, 0.3, 0.1, 0.3); // helmet cap
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.14, 1.34, -0.1);
  g.add(gunPivot);
  part(gunPivot, gunMat, 0, 0, -0.24, 0.06, 0.08, 0.56);
  part(gunPivot, suit, -0.05, -0.05, -0.08, 0.09, 0.24, 0.09); // arm
  g.userData = { legL, legR, torso, head, gunPivot, suit };
  return g;
}

export function poseBotMesh(actor, dt) {
  const g = actor.mesh;
  if (!g) return;
  const u = g.userData;
  g.position.copy(actor.pos);
  g.rotation.y = actor.yaw;
  if (!actor.alive) {
    // Fall backwards and settle; corpses stay for the round.
    g.rotation.x = Math.max(-Math.PI / 2 + 0.12, g.rotation.x - dt * 5);
    g.position.y = actor.pos.y + 0.12;
    return;
  }
  g.rotation.x = 0;
  const swing = Math.sin(actor.walkPhase * 2) * Math.min(0.65, actor.speed2d * 0.14);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  const crouchDip = actor.crouch ? 0.34 : 0;
  u.torso.position.y = 1.16 - crouchDip;
  u.head.position.y = 1.6 - crouchDip;
  u.gunPivot.position.y = 1.34 - crouchDip;
  u.gunPivot.rotation.x = actor.pitch;
  const flash = actor.flashT > 0 ? 0.55 : 0;
  u.suit.emissive.setRGB(flash, flash * 0.4, flash * 0.3);
  actor.flashT = Math.max(0, actor.flashT - dt * 3);
}

// ---- buying ----
// Bots spend like cautious players: keep a primary if they have one, prefer
// the VK-7, armour most rounds, a defuse kit for defenders, the odd grenade.
export function botBuy(bot, rng) {
  const load = bot.loadout;
  const buy = (key, price) => {
    if (bot.money < price) return false;
    bot.money -= price;
    return true;
  };
  if (bot.role === 'defend' && !bot.defuseKit && buy('kit', 400)) bot.defuseKit = true;
  const hasPrimary = ['vk7', 'meridian', 'breacher', 'raptor'].some((k) => load.owned[k]);
  if (!hasPrimary) {
    if (bot.money >= 2700 && buy('vk7', 2700)) giveWeapon(load, 'vk7');
    else if (bot.money >= 1400 && buy('breacher', 1100)) giveWeapon(load, 'breacher');
    else if (bot.money >= 1000 && buy('raptor', 1000)) giveWeapon(load, 'raptor');
  }
  if (bot.armor < 60 && bot.money >= 1000 && buy('vesthelm', 1000)) { bot.armor = 100; bot.helm = true; }
  else if (bot.armor < 40 && bot.money >= 650 && buy('vest', 650)) { bot.armor = 100; }
  if (load.frags === 0 && bot.money > 900 && rng() < 0.4 && buy('frag', 300)) load.frags = 1;
  if (load.smokes === 0 && bot.money > 1200 && rng() < 0.25 && buy('smoke', 300)) load.smokes = 1;
  // Equip the best gun for the round.
  for (const key of ['vk7', 'meridian', 'breacher', 'raptor']) {
    if (load.owned[key]) { load.current = key; break; }
  }
}

// ---- the brain ----
export function createBrain(skill, rng) {
  return {
    skill, // 0..1: reaction time and aim error scale with it
    rng,
    tickAt: 0,
    path: [],
    pathIdx: 0,
    goal: null,
    state: 'advance',
    enemy: null,
    lastSeenAt: -9,
    lastSeenPos: new THREE.Vector3(),
    seenAt: 0,
    burstLeft: 0,
    nextShotAt: 0,
    pauseUntil: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    holdPos: null,
    holdYaw: 0,
    holdCrouch: false,
    investigate: null,
    nadeAt: 0,
    peekPhase: rng() * 6,
    lane: 0,
    waypoints: null,
    wpIdx: 0,
    post: null,
    goal: null,
    channelWanted: null,
    faceYaw: 0,
    crouchFight: rng() < 0.3,
  };
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export function updateBrain(bot, ctx, dt) {
  const brain = bot.brain;
  const now = ctx.now;
  const move = bot.move;
  move.x = 0; move.z = 0; move.speed = 0; move.crouch = false;
  bot.channel = null;
  bot.wantNade = null;
  if (!bot.alive || ctx.phase !== 'live' && ctx.phase !== 'planted') return;

  // ---- perception at 8 Hz ----
  if (now >= brain.tickAt) {
    brain.tickAt = now + 0.12;
    perceive(bot, ctx);
    decide(bot, ctx);
  }

  // ---- continuous: follow path or fight ----
  const enemy = brain.enemy;
  if (enemy && enemy.alive && now - brain.lastSeenAt < 0.4) {
    fight(bot, ctx, enemy, dt);
  } else if (brain.channelWanted) {
    // Stand still and channel (plant/defuse); the game validates and counts.
    bot.channel = brain.channelWanted;
    faceToward(bot, brain.faceYaw, dt, 6);
  } else if (brain.path.length && brain.pathIdx < brain.path.length) {
    const target = brain.path[brain.pathIdx];
    const dx = target.x - bot.pos.x;
    const dz = target.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      brain.pathIdx++;
    } else {
      move.x = dx / dist;
      move.z = dz / dist;
      move.speed = brain.state === 'engage' ? RUN_SPEED : RUN_SPEED * 0.92;
      faceToward(bot, Math.atan2(-dx, -dz), dt, 5);
    }
  } else if (brain.holdPos) {
    // Settle onto the hold spot, then watch the assigned angle with a sway.
    const dx = brain.holdPos.x - bot.pos.x;
    const dz = brain.holdPos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.5) {
      move.x = dx / dist; move.z = dz / dist; move.speed = RUN_SPEED * 0.6;
      faceToward(bot, Math.atan2(-dx, -dz), dt, 5);
    } else {
      const sway = Math.sin(now * 0.7 + brain.peekPhase) * 0.35;
      faceToward(bot, brain.holdYaw + sway, dt, 2.5);
      move.crouch = brain.holdCrouch;
    }
  }
}

function faceToward(bot, yaw, dt, rate) {
  let d = yaw - bot.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const maxTurn = rate * dt;
  bot.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
}

function perceive(bot, ctx) {
  const brain = bot.brain;
  const now = ctx.now;
  brain.enemy = null;
  let bestScore = -Infinity;
  for (const other of ctx.actors) {
    if (other === bot || !other.alive || other.side === bot.side) continue;
    _v1.copy(other.pos); _v1.y += 1.25;
    _v2.copy(bot.pos); _v2.y += eyeHeight(bot);
    const dist = _v1.distanceTo(_v2);
    if (dist > 65) continue;
    // Vision cone 110°, or point-blank awareness in any direction.
    const dx = other.pos.x - bot.pos.x;
    const dz = other.pos.z - bot.pos.z;
    const angTo = Math.atan2(-dx, -dz);
    let dAng = Math.abs(angTo - bot.yaw);
    while (dAng > Math.PI) dAng = Math.abs(dAng - Math.PI * 2);
    if (dAng > 1.9 && dist > 5) continue;
    if (ctx.world.segmentBlocked(_v2.x, _v2.y, _v2.z, _v1.x, _v1.y, _v1.z, ctx.fx.smokes)) continue;
    const score = -dist;
    if (score > bestScore) {
      bestScore = score;
      brain.enemy = other;
    }
  }
  if (brain.enemy) {
    if (brain.seenAt === 0 || now - brain.lastSeenAt > 1.2) brain.seenAt = now;
    brain.lastSeenAt = now;
    brain.lastSeenPos.copy(brain.enemy.pos);
    brain.investigate = null;
  } else {
    // Hearing: the loudest recent event on the enemy side draws a look.
    for (const ev of ctx.noise) {
      if (ev.team === bot.side || now - ev.at > 2.5) continue;
      const d = Math.hypot(ev.x - bot.pos.x, ev.z - bot.pos.z);
      if (d < ev.radius) {
        brain.investigate = { x: ev.x, z: ev.z };
      }
    }
  }
}

function decide(bot, ctx) {
  const brain = bot.brain;
  const now = ctx.now;
  brain.channelWanted = null;

  // Someone is visible or freshly seen: fight from where we stand.
  if (brain.enemy || now - brain.lastSeenAt < 1.6) {
    brain.state = 'engage';
    return;
  }
  brain.state = 'advance';

  const charge = ctx.charge;
  if (charge.state === 'planted') {
    if (bot.role === 'defend') {
      const d = Math.hypot(charge.pos.x - bot.pos.x, charge.pos.z - bot.pos.z);
      const nearest = ctx.nearestDefenderTo(charge.pos);
      if (nearest === bot && d < 1.6) {
        brain.channelWanted = 'defuse';
        brain.faceYaw = bot.yaw;
        brain.path = [];
        return;
      }
      goTo(bot, ctx, charge.pos.x, charge.pos.z);
      return;
    }
    // Attackers fall back to hold the planted charge.
    holdNear(bot, ctx, charge.pos.x, charge.pos.z, 7);
    return;
  }

  if (charge.state === 'dropped' && bot.role === 'attack') {
    const d = Math.hypot(charge.pos.x - bot.pos.x, charge.pos.z - bot.pos.z);
    if (d < 14 && ctx.nearestAttackerTo(charge.pos) === bot) {
      goTo(bot, ctx, charge.pos.x, charge.pos.z);
      return;
    }
  }

  if (bot.role === 'attack') {
    const site = ctx.plan.site;
    if (bot.hasCharge) {
      const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
      if (d < site.r - 1.6) {
        // In the zone with a little team cover nearby: plant.
        brain.channelWanted = 'plant';
        brain.faceYaw = bot.yaw;
        brain.path = [];
        return;
      }
      goTo(bot, ctx, site.x + brain.lane * 1.5, site.z + 1);
      return;
    }
    // Non-carriers push their lane toward the site, then hold its edge.
    const wp = brain.waypoints;
    if (wp && brain.wpIdx < wp.length) {
      const t = wp[brain.wpIdx];
      if (Math.hypot(t.x - bot.pos.x, t.z - bot.pos.z) < 2.2) brain.wpIdx++;
      else { goTo(bot, ctx, t.x, t.z); return; }
    }
    holdNear(bot, ctx, site.x, site.z, 8.5);
    return;
  }

  // Defenders hold their assigned site or mid, drifting to investigate noise.
  if (brain.investigate) {
    goTo(bot, ctx, brain.investigate.x, brain.investigate.z);
    return;
  }
  const post = brain.post;
  if (post) {
    if (Math.hypot(post.x - bot.pos.x, post.z - bot.pos.z) > 1.2) {
      brain.holdPos = null; // still travelling: follow the path, don't settle
      goTo(bot, ctx, post.x, post.z);
    } else {
      brain.holdPos = post;
      brain.holdYaw = post.yaw;
      brain.holdCrouch = post.crouch;
      brain.path = [];
    }
  }
}

function goTo(bot, ctx, x, z) {
  const brain = bot.brain;
  if (brain.goal && Math.hypot(brain.goal.x - x, brain.goal.z - z) < 0.6 && brain.path.length) return;
  brain.goal = { x, z };
  brain.path = ctx.world.findPath(bot.pos.x, bot.pos.z, x, z);
  brain.pathIdx = 0;
  brain.holdPos = null;
}

function holdNear(bot, ctx, x, z, dist) {
  const brain = bot.brain;
  if (brain.holdPos) return; // already travelling to, or settled at, a hold
  // Pick an offset around the point, seeded per bot so holders spread out.
  const a = brain.peekPhase * 1.7;
  brain.holdPos = { x: x + Math.cos(a) * dist * 0.55, z: z + Math.sin(a) * dist * 0.55 };
  brain.holdYaw = Math.atan2(-(x - brain.holdPos.x), -(z - brain.holdPos.z));
  brain.holdCrouch = brain.rng() < 0.35;
  brain.goal = { x: brain.holdPos.x, z: brain.holdPos.z };
  brain.path = ctx.world.findPath(bot.pos.x, bot.pos.z, brain.holdPos.x, brain.holdPos.z);
  brain.pathIdx = 0;
}

function fight(bot, ctx, enemy, dt) {
  const brain = bot.brain;
  const now = ctx.now;
  const load = bot.loadout;
  const def = WEAPONS[load.current];
  // Aim: lead the target slightly, aim at chest, head for the skilled at
  // close range. Error shrinks the longer the target has been tracked.
  const tx = enemy.pos.x + enemy.vel.x * 0.12;
  const tz = enemy.pos.z + enemy.vel.z * 0.12;
  const tracked = now - brain.seenAt;
  const aimHead = brain.skill > 0.55 && Math.hypot(tx - bot.pos.x, tz - bot.pos.z) < 16;
  const ty = enemy.pos.y + (aimHead ? 1.56 : 1.22) - (enemy.crouch ? 0.5 : 0);
  const eyeY = bot.pos.y + eyeHeight(bot) - 0.12;
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const dy = ty - eyeY;
  const flat = Math.hypot(dx, dz);
  faceToward(bot, Math.atan2(-dx, -dz), dt, 8);
  const targetPitch = Math.atan2(dy, flat);
  bot.pitch += (targetPitch - bot.pitch) * Math.min(1, dt * 10);

  // Combat movement: strafe across the target's view, flip on a timer,
  // sometimes drop to a crouch between bursts. Keep a fighting distance.
  const move = bot.move;
  if (now >= brain.strafeFlipAt) {
    brain.strafeFlipAt = now + 0.6 + brain.rng() * 0.9;
    brain.strafeDir = brain.rng() < 0.5 ? -1 : 1;
  }
  const dist = flat;
  const toward = dist > 26 ? 0.55 : dist < 7 ? -0.4 : 0;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const rx = -fz * brain.strafeDir;
  const rz = fx * brain.strafeDir;
  move.x = fx * toward + rx;
  move.z = fz * toward + rz;
  const ml = Math.hypot(move.x, move.z) || 1;
  move.x /= ml; move.z /= ml;
  move.speed = RUN_SPEED * (def.kind === 'sniper' ? 0.25 : 0.72);
  move.crouch = brain.crouchFight && now < brain.pauseUntil;

  // Trigger discipline: react, then burst, then a beat to re-aim.
  if (now < brain.seenAt + (0.42 - brain.skill * 0.24)) return;
  if (load.reloadEnd > now || load.switchEnd > now) return;
  if (load.mag[load.current] <= 0) {
    ctx.reload(bot);
    return;
  }
  if (now < brain.pauseUntil) return;
  if (brain.burstLeft <= 0) {
    brain.burstLeft = def.auto ? 2 + Math.floor(brain.rng() * 3) : 1;
  }
  if (now >= brain.nextShotAt) {
    // Per-shot aim error: degrees of cone, tighter when tracked and still.
    const errDeg = (2.3 - brain.skill * 1.5) * (tracked > 0.8 ? 0.55 : 1) * (bot.speed2d > 1 ? 1.5 : 1);
    const fired = ctx.shoot(bot, errDeg * Math.PI / 180);
    if (fired) {
      brain.burstLeft--;
      brain.nextShotAt = now + 60 / def.rpm;
      if (brain.burstLeft <= 0) brain.pauseUntil = now + 0.24 + brain.rng() * 0.3;
    } else {
      brain.nextShotAt = now + 0.05;
    }
  }
  // A frag over cover at a freshly-lost target is the one grenade bots throw.
  if (load.frags > 0 && now - brain.lastSeenAt > 0.5 && now - brain.lastSeenAt < 1.4 && now > brain.nadeAt && dist > 7 && dist < 22) {
    brain.nadeAt = now + 9;
    bot.wantNade = { kind: 'frag', x: brain.lastSeenPos.x, y: 1, z: brain.lastSeenPos.z };
  }
}
