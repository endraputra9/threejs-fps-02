// The match: two five-player rosters (the player leads the Vanguard), twelve
// rounds with a half-time side swap, first to seven. This module is the one
// place game state lives: phases (buy, live, planted, round end), the round
// clock and charge timer, the economy, plant/defuse channels, grenades in
// flight, noise events for bot hearing, all shot resolution (rays vs the
// world's AABBs and the actors' head/body boxes, armour, falloff), and the
// player's own controller. Brains and physics live in bots.js; this module
// tells them what the situation is and resolves what they do.
import * as THREE from 'three';
import { SITES, SPAWNS } from './world.js';
import {
  WEAPONS, GRENADES, giveWeapon, selectWeapon, startReload, updateLoadout,
  spreadOf, damageAt, rayVsActor, createViewmodel,
} from './weapons.js';
import {
  createActor, buildBotMesh, poseBotMesh, stepActor, botBuy, createBrain,
  updateBrain, eyeHeight, RUN_SPEED,
} from './bots.js';
import { PALETTE } from './palette.js';

const TEAM_NAME = { A: 'VANGUARD', B: 'WARDENS' };
const BOT_NAMES = {
  A: ['ORIN', 'TALO', 'VESK', 'MIRA'],
  B: ['DREX', 'HALV', 'SORIN', 'KURO', 'PIKE'],
};
const ROUND_TIME = 115;
const CHARGE_TIME = 40;
const BUY_TIME = 12;
const PLANT_TIME = 3;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 12;

// Lane routes as waypoint walks (world coordinates), per objective.
const ROUTES = {
  A: {
    west: [[-18, 24], [-18, 16], [-18, 6], [-18, -6], [-18, -14], [-14, -20]],
    mid: [[0, 22], [0, 13], [0, 4], [0, -6], [0, -13], [-9, -16], [-9, -24], [-14, -20]],
    east: [[18, 24], [18, 16], [18, 4], [18, -6], [18, -14], [9, -16], [9, -24], [-14, -20]],
  },
  B: {
    east: [[18, 24], [18, 16], [18, 4], [18, -6], [18, -14], [14, -20]],
    mid: [[0, 22], [0, 13], [0, 4], [0, -6], [0, -13], [9, -16], [9, -24], [14, -20]],
    west: [[-18, 24], [-18, 16], [-18, 6], [-18, -6], [-18, -14], [-9, -16], [-9, -24], [14, -20]],
  },
  mid: [[0, 22], [0, 13], [0, 4], [0, -6]],
};
const POSTS = {
  A: [
    { x: -14.5, z: -18.5, yaw: 2.6, crouch: false },
    { x: -23.5, z: -14.5, yaw: -0.7, crouch: true },
  ],
  B: [
    { x: 14.5, z: -18.5, yaw: -2.6, crouch: false },
    { x: 23.5, z: -14.5, yaw: 0.7, crouch: true },
  ],
  mid: [{ x: 1.8, z: -11, yaw: 0.2, crouch: true }],
};

export function createGame({ scene, camera, world, fx, audio, hud, input, rng, shotMode }) {
  const actors = [];
  const player = createActor('YOU', 'A', true);
  actors.push(player);
  for (const side of ['A', 'B']) {
    for (const name of BOT_NAMES[side]) {
      const bot = createActor(name, side, false);
      bot.brain = createBrain(0.35 + rng() * 0.45, rng);
      bot.mesh = buildBotMesh(side);
      scene.add(bot.mesh);
      actors.push(bot);
    }
  }
  const viewmodel = createViewmodel(camera);

  const state = {
    phase: 'menu',
    phaseT: 0,
    round: 1,
    score: { A: 0, B: 0 },
    lossStreak: { A: 0, B: 0 },
    roundTime: ROUND_TIME,
    chargeTime: 0,
    now: 0,
    over: false,
  };
  const charge = { state: 'none', carrier: null, pos: new THREE.Vector3(), site: null, beepAt: 0, planter: null, defuser: null };
  const plan = { site: SITES[0], lanes: [] };
  const noise = [];
  const nades = [];
  const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const nadeMat = new THREE.MeshStandardMaterial({ color: 0x2f353a, roughness: 0.4, metalness: 0.5 });
  let spectateTarget = null;
  let recoilPitch = 0;
  let bobPhase = 0;
  let prevFiring = false;
  let buyOpenWanted = false;
  let matchStarted = false;

  const attackingSide = () => (state.round <= 6 ? 'A' : 'B');
  const playerTeamWon = (side) => side === player.side;
  const aliveOf = (side) => actors.filter((a) => a.side === side && a.alive);
  const ctx = {
    get now() { return state.now; },
    get phase() { return state.phase; },
    actors, world, fx, noise, plan,
    charge: { get state() { return charge.state; }, get pos() { return charge.pos; }, get site() { return charge.site; } },
    shoot(bot, errRad) { return resolveShot(bot, errRad, true); },
    reload(bot) { if (startReload(bot.loadout, state.now)) audio.reload(); },
    nearestDefenderTo(pos) { return nearestOf('defend', pos); },
    nearestAttackerTo(pos) { return nearestOf('attack', pos); },
  };
  function nearestOf(role, pos) {
    let best = null;
    let bd = Infinity;
    for (const a of actors) {
      if (!a.alive || a.isPlayer || a.role !== role) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // ---------- match / round flow ----------
  function resetLoadout(actor) {
    actor.loadout = freshLoadout();
    actor.armor = 0;
    actor.helm = false;
    actor.defuseKit = false;
  }
  function freshLoadout() {
    return {
      current: 'p9', owned: { knife: true, p9: true },
      mag: { p9: WEAPONS.p9.mag }, reserve: { p9: WEAPONS.p9.reserve },
      frags: 0, smokes: 0, lastShotAt: -9, bloom: 0, reloadEnd: 0, switchEnd: 0, scoped: false,
    };
  }

  function startMatch() {
    state.score.A = 0;
    state.score.B = 0;
    state.lossStreak.A = 0;
    state.lossStreak.B = 0;
    state.round = 1;
    state.over = false;
    matchStarted = true;
    for (const a of actors) {
      a.money = 800;
      a.kills = 0;
      a.deaths = 0;
      resetLoadout(a);
    }
    hud.hideMatchEnd();
    startRound(true);
  }

  function startRound(first = false) {
    const atk = attackingSide();
    charge.state = 'none';
    charge.carrier = null;
    fx.setCharge(null, false);
    nades.length = 0;
    noise.length = 0;
    // Objective plan for the attacking bots (defenders never learn it).
    plan.site = rng() < 0.5 ? SITES[0] : SITES[1];
    plan.lanes = ['west', 'mid', 'east'];
    let laneIdx = 0;
    let postIdx = { A: 0, B: 0, mid: 0 };
    const attackers = actors.filter((a) => a.side === atk);
    // The charge goes to a random attacker; the player carries it about as
    // often as anyone.
    const carrier = attackers[Math.floor(rng() * attackers.length)];
    for (const a of actors) {
      a.role = a.side === atk ? 'attack' : 'defend';
      a.alive = true;
      a.hp = 100;
      a.hasCharge = false;
      a.channel = null;
      a.channelT = 0;
      if (a.deadLastRound) resetLoadout(a);
      a.deadLastRound = false;
      const spawn = SPAWNS[a.role][actors.filter((x) => x.side === a.side).indexOf(a)];
      a.pos.set(spawn[0], 0, spawn[1]);
      a.vel.set(0, 0, 0);
      a.yaw = a.role === 'attack' ? 0 : Math.PI;
      a.pitch = 0;
      if (a.brain) {
        const b = a.brain;
        b.path = []; b.pathIdx = 0; b.holdPos = null; b.enemy = null;
        b.lastSeenAt = -9; b.seenAt = 0; b.state = 'advance'; b.goal = null;
        b.investigate = null; b.channelWanted = null;
        if (a.role === 'attack') {
          const laneName = a === carrier ? (plan.site.id === 'A' ? 'west' : 'east') : plan.lanes[laneIdx++ % 3];
          const route = a === carrier
            ? ROUTES[plan.site.id][plan.site.id === 'A' ? 'west' : 'east']
            : laneName === 'mid' ? ROUTES.mid.concat(ROUTES[plan.site.id].mid.slice(4)) : ROUTES[plan.site.id][laneName];
          b.waypoints = route.map(([x, z]) => ({ x, z }));
          b.wpIdx = 0;
          b.lane = laneName === 'west' ? -1 : laneName === 'east' ? 1 : 0;
        } else {
          const posts = postIdx.A + postIdx.B + postIdx.mid;
          const which = a.side === atk ? null : (posts % 3 === 0 ? 'A' : posts % 3 === 1 ? 'B' : 'mid');
          const list = POSTS[which || 'mid'];
          const post = list[(which === 'A' ? postIdx.A++ : which === 'B' ? postIdx.B++ : postIdx.mid++) % list.length];
          b.post = { ...post };
        }
        botBuy(a, rng);
      }
    }
    carrier.hasCharge = true;
    charge.state = 'carried';
    charge.carrier = carrier;
    state.phase = 'buy';
    state.phaseT = BUY_TIME;
    state.roundTime = ROUND_TIME;
    spectateTarget = null;
    if (!shotMode) {
      hud.banner(
        `ROUND ${state.round}`,
        `${TEAM_NAME[atk]} attack · ${planHintForPlayer()}`,
        '#f5f2ea', 2.4,
      );
      buyOpenWanted = true;
    }
  }

  function planHintForPlayer() {
    if (player.role === 'attack') {
      return player.hasCharge ? 'You carry the Charge — plant it at a site' : 'Plant the Charge at A or B';
    }
    return 'Defend the Smelter and the Casting Hall';
  }

  function endRound(winnerSide, reason, objective) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.phaseT = 4.6;
    state.score[winnerSide]++;
    const loser = winnerSide === 'A' ? 'B' : 'A';
    state.lossStreak[winnerSide] = 0;
    state.lossStreak[loser] = Math.min(4, state.lossStreak[loser] + 1);
    const winPay = objective ? 3500 : 3250;
    const lossPay = 1400 + 500 * (state.lossStreak[loser] - 1);
    for (const a of actors) {
      if (!a.alive) a.deadLastRound = true;
      if (a.side === winnerSide) a.money = Math.min(16000, a.money + winPay);
      else a.money = Math.min(16000, a.money + lossPay);
      if (charge.state === 'planted' || charge.state === 'detonated') {
        if (a.role === 'attack') a.money = Math.min(16000, a.money + 800);
      }
    }
    if (charge.planter) charge.planter.money = Math.min(16000, charge.planter.money + 300);
    if (charge.defuser) charge.defuser.money = Math.min(16000, charge.defuser.money + 300);
    charge.planter = null;
    charge.defuser = null;
    const won = playerTeamWon(winnerSide);
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? '#1fb6a6' : '#e04f39', 3.6);
    audio.roundSting(won);
    hud.closeBuy();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    state.over = true;
    const won = state.score[player.side] > state.score[player.side === 'A' ? 'B' : 'A'];
    const draw = state.score.A === state.score.B;
    hud.setMatchEnd(
      draw ? 'MATCH DRAWN' : won ? 'MATCH WON' : 'MATCH LOST',
      `${TEAM_NAME.A} ${state.score.A} — ${state.score.B} ${TEAM_NAME.B}`,
    );
    input.releaseLock();
  }

  function checkRoundEnd() {
    if (state.phase !== 'live' && state.phase !== 'planted') return;
    const atkAlive = aliveOf(attackingSide()).length;
    const defSide = attackingSide() === 'A' ? 'B' : 'A';
    const defAlive = aliveOf(defSide).length;
    if (charge.state === 'planted') {
      if (defAlive === 0) endRound(attackingSide(), 'Defenders eliminated · the Charge holds', false);
      return; // attackers all dead: the charge still ticks, defenders must defuse
    }
    if (atkAlive === 0) endRound(defSide, 'Attackers eliminated', false);
    else if (defAlive === 0) endRound(attackingSide(), 'Defenders eliminated', false);
  }

  // ---------- shooting ----------
  const _origin = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _end = new THREE.Vector3();
  const NOISE_RADIUS = { knife: 0, sidearm: 22, smg: 27, rifle: 32, shotgun: 34, sniper: 42 };

  function eyePos(actor, out) {
    return out.set(actor.pos.x, actor.pos.y + eyeHeight(actor) - 0.06, actor.pos.z);
  }

  function resolveShot(actor, aimErr, isBot) {
    const load = actor.loadout;
    const def = WEAPONS[load.current];
    const now = state.now;
    if (!actor.alive || (state.phase !== 'live' && state.phase !== 'planted')) return false;
    if (now < load.switchEnd || (load.reloadEnd && now < load.reloadEnd)) return false;
    if (now - load.lastShotAt < 60 / def.rpm) return false;
    if (def.kind === 'melee') {
      load.lastShotAt = now;
      audio.swing();
      // Nearest enemy inside the blade's short cone.
      let best = null;
      let bd = def.range;
      for (const other of actors) {
        if (other === actor || !other.alive || other.side === actor.side) continue;
        const d = Math.hypot(other.pos.x - actor.pos.x, other.pos.z - actor.pos.z);
        if (d > bd) continue;
        const ang = Math.atan2(-(other.pos.x - actor.pos.x), -(other.pos.z - actor.pos.z));
        let da = Math.abs(ang - actor.yaw);
        while (da > Math.PI) da = Math.abs(da - Math.PI * 2);
        if (da < 0.9) { best = other; bd = d; }
      }
      if (best) damageActor(best, def.damage, 'body', actor, def);
      return true;
    }
    if (load.mag[load.current] <= 0) {
      load.lastShotAt = now;
      if (actor.isPlayer) audio.dry();
      const reloading = startReload(load, now);
      if (!reloading && isBot) {
        // Dry primary with nothing in reserve: fall back to the sidearm.
        if (load.owned.p9 && (load.mag.p9 > 0 || load.reserve.p9 > 0)) selectWeapon(load, 'p9', now);
        else selectWeapon(load, 'knife', now);
      }
      return false;
    }
    load.mag[load.current]--;
    load.lastShotAt = now;
    load.bloom = Math.min(0.05, load.bloom + def.bloom);
    const spread = isBot ? aimErr : spreadOf(load, actor);
    eyePos(actor, _origin);
    const pellets = def.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const yaw = actor.yaw + (rng() * 2 - 1) * spread;
      const pitch = actor.pitch + (rng() * 2 - 1) * spread;
      _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      fireRay(actor, def, _origin, _dir);
    }
    audio.shot(def.sound, actor.isPlayer ? 0 : _origin.distanceTo(player.pos));
    if (actor.isPlayer) {
      viewmodel.fire();
      recoilPitch += def.recoil;
      fx.muzzleSmoke(_end.copy(_origin).addScaledVector(_dir, 0.7));
    }
    const radius = NOISE_RADIUS[def.sound] || 25;
    if (radius) noise.push({ x: actor.pos.x, z: actor.pos.z, radius, at: now, team: actor.side });
    if (load.mag[load.current] === 0) startReload(load, now);
    return true;
  }

  function fireRay(actor, def, origin, dir) {
    const wallHit = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
    const wallDist = wallHit ? wallHit.dist : def.range;
    let bestActor = null;
    let bestHit = null;
    for (const other of actors) {
      if (other === actor || !other.alive || other.side === actor.side) continue;
      const hit = rayVsActor(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, other, wallDist);
      if (hit && (!bestHit || hit.dist < bestHit.dist)) {
        bestHit = hit;
        bestActor = other;
      }
    }
    _end.copy(origin).addScaledVector(dir, bestHit ? bestHit.dist : wallDist);
    if (!actor.isPlayer || bestHit || wallDist < 40) fx.tracer(origin, _end);
    if (bestActor) {
      const dmg = damageAt(def, bestHit.dist);
      fx.impact(_end, { x: -dir.x, y: -dir.y, z: -dir.z }, 'flesh');
      damageActor(bestActor, dmg, bestHit.zone, actor, def);
    } else if (wallHit) {
      fx.impact(_end, { x: wallHit.nx, y: wallHit.ny, z: wallHit.nz }, wallHit.ny === 1 && wallHit.y < 0.1 ? 'dust' : 'metal');
    }
  }

  function damageActor(victim, base, zone, attacker, def) {
    let dmg = base;
    if (zone === 'head') dmg *= def.headMult;
    else if (zone === 'legs') dmg *= 0.75;
    const armored = victim.armor > 0 && (zone !== 'head' || victim.helm);
    if (armored) {
      victim.armor = Math.max(0, victim.armor - dmg * 0.5);
      dmg *= 0.5;
    }
    victim.hp -= dmg;
    victim.flashT = 1;
    victim.lastDamageAt = state.now;
    victim.lastDamageFrom = attacker;
    if (victim.isPlayer) {
      const rel = Math.atan2(-(attacker.pos.x - victim.pos.x), -(attacker.pos.z - victim.pos.z)) - victim.yaw;
      hud.damageFrom(rel, victim.hp);
      audio.hurt();
    }
    if (victim.hp <= 0 && victim.alive) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths++;
      victim.channel = null;
      if (attacker && attacker !== victim) {
        attacker.kills++;
        attacker.money = Math.min(16000, attacker.money + 300);
      }
      if (attacker && attacker.isPlayer) {
        hud.hitmarker(zone === 'head', true);
        audio.kill();
      }
      hud.addKill(attacker ? attacker.name : '—', victim.name, def.name, zone === 'head', attacker ? attacker.side : 'A', victim.side);
      if (victim.hasCharge) {
        victim.hasCharge = false;
        charge.state = 'dropped';
        charge.carrier = null;
        charge.pos.copy(victim.pos);
        fx.setCharge(charge.pos, false);
      }
      if (victim.isPlayer) {
        spectateTarget = aliveOf(player.side).find((a) => !a.isPlayer) || null;
      }
      checkRoundEnd();
    } else if (attacker && attacker.isPlayer) {
      hud.hitmarker(zone === 'head', false);
      audio.hit(zone === 'head');
    }
  }

  // ---------- grenades ----------
  function throwGrenade(actor, kind, targetPos) {
    const load = actor.loadout;
    if (kind === 'frag' && load.frags <= 0) return;
    if (kind === 'smoke' && load.smokes <= 0) return;
    if (kind === 'frag') load.frags--; else load.smokes--;
    eyePos(actor, _origin);
    const vel = new THREE.Vector3();
    if (targetPos) {
      const dx = targetPos.x - _origin.x;
      const dz = targetPos.z - _origin.z;
      const dy = (targetPos.y || 1) - _origin.y;
      const flat = Math.hypot(dx, dz);
      const t = Math.max(0.5, flat / 13);
      vel.set(dx / t, dy / t + 0.5 * 14.5 * t * 0.55, dz / t);
    } else {
      vel.set(-Math.sin(actor.yaw) * Math.cos(actor.pitch + 0.18), Math.sin(actor.pitch + 0.18), -Math.cos(actor.yaw) * Math.cos(actor.pitch + 0.18)).multiplyScalar(15.5);
    }
    const mesh = new THREE.Mesh(nadeGeo, nadeMat);
    mesh.position.copy(_origin);
    scene.add(mesh);
    nades.push({ kind, pos: mesh.position, vel, mesh, fuse: state.now + (kind === 'frag' ? 1.7 : 1.5), restAt: 0, thrower: actor });
    audio.throwNade();
  }

  function stepNades(dt) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const n = nades[i];
      n.vel.y -= 14.5 * dt;
      n.pos.addScaledVector(n.vel, dt);
      const ground = world.groundHeightAt(n.pos.x, n.pos.z, n.pos.y + 1);
      if (n.pos.y < ground + 0.09) {
        n.pos.y = ground + 0.09;
        if (Math.abs(n.vel.y) > 1.4) n.vel.y = -n.vel.y * 0.38;
        else {
          n.vel.y = 0;
          n.vel.x *= 0.7; n.vel.z *= 0.7;
          if (!n.restAt) n.restAt = state.now;
        }
      }
      world.collideCircle(n.pos, 0.12);
      const explode = state.now >= n.fuse || (n.restAt && state.now > n.restAt + 0.5);
      if (!explode) continue;
      scene.remove(n.mesh);
      nades.splice(i, 1);
      if (n.kind === 'smoke') {
        fx.throwSmoke(n.pos.clone(), GRENADES.smoke.radius);
        audio.smokePop(n.pos.distanceTo(player.pos));
      } else {
        fx.explosion(n.pos.clone());
        audio.explosion(n.pos.distanceTo(player.pos));
        noise.push({ x: n.pos.x, z: n.pos.z, radius: 46, at: state.now, team: n.thrower.side });
        for (const a of actors) {
          if (!a.alive) continue;
          _v.copy(a.pos); _v.y += 1.1;
          const d = _v.distanceTo(n.pos);
          if (d > GRENADES.frag.radius + 0.6) continue;
          if (world.segmentBlocked(n.pos.x, n.pos.y + 0.3, n.pos.z, _v.x, _v.y, _v.z, null)) continue;
          const dmg = GRENADES.frag.damage * Math.max(0.12, 1 - d / (GRENADES.frag.radius + 0.6));
          damageActor(a, dmg, 'body', n.thrower, { name: 'Frag Charge', headMult: 1 });
        }
      }
    }
  }
  const _v = new THREE.Vector3();

  // ---------- channels: plant & defuse ----------
  function stepChannels(dt) {
    let playerProgress = null;
    for (const a of actors) {
      if (!a.alive || !a.channel) { if (a) a.channelT = 0; continue; }
      const moving = a.speed2d > 0.6;
      if (a.channel === 'plant') {
        const site = world.siteAt(a.pos.x, a.pos.z);
        if (!a.hasCharge || !site || charge.state !== 'carried' || moving) { a.channelT = 0; if (a.isPlayer) playerProgress = null; continue; }
        a.channelT = (a.channelT || 0) + dt;
        if (a.isPlayer) playerProgress = { label: `PLANTING AT ${site.id}`, frac: a.channelT / PLANT_TIME };
        if (a.channelT >= PLANT_TIME) {
          a.hasCharge = false;
          a.channelT = 0;
          charge.state = 'planted';
          charge.site = site;
          charge.pos.copy(a.pos);
          charge.planter = a;
          fx.setCharge(charge.pos, true);
          state.phase = 'planted';
          state.chargeTime = CHARGE_TIME;
          charge.beepAt = 0;
          audio.plantDone();
          hud.banner('CHARGE PLANTED', `Site ${site.id} · ${CHARGE_TIME} seconds`, '#ff7a1a', 2.6);
        }
      } else if (a.channel === 'defuse') {
        if (charge.state !== 'planted' || moving) { a.channelT = 0; continue; }
        const d = Math.hypot(a.pos.x - charge.pos.x, a.pos.z - charge.pos.z);
        if (d > 1.7) { a.channelT = 0; continue; }
        const need = a.defuseKit ? 2.5 : 5;
        a.channelT = (a.channelT || 0) + dt;
        if (a.isPlayer) playerProgress = { label: 'DEFUSING', frac: a.channelT / need };
        if (a.channelT >= need) {
          charge.state = 'defused';
          charge.defuser = a;
          fx.setCharge(null, false);
          endRound(a.side, 'The Charge was defused', true);
        }
      }
    }
    if (playerProgress) hud.setProgress(playerProgress.label, playerProgress.frac);
    else if (player.channelT === 0) hud.setProgress(null);
    return playerProgress;
  }

  // ---------- the buy menu ----------
  function buyCatalog() {
    const load = player.loadout;
    const items = [];
    const gun = (key) => {
      const def = WEAPONS[key];
      items.push({
        key, name: def.name, price: def.price, detail: `${def.damage} dmg · ${def.mag} rounds`,
        owned: !!load.owned[key], afford: player.money >= def.price,
      });
    };
    gun('vk7'); gun('meridian'); gun('breacher'); gun('raptor');
    items.push({ key: 'vesthelm', name: 'Vest + Helm', price: 1000, detail: 'Halves body damage, helm covers headshots', owned: player.helm && player.armor > 90, afford: player.money >= 1000 });
    items.push({ key: 'vest', name: 'Kevlar Vest', price: 650, detail: 'Halves body and leg damage', owned: player.armor > 90 && !player.helm, afford: player.money >= 650 });
    if (player.role === 'defend') items.push({ key: 'kit', name: 'Defuse Kit', price: 400, detail: 'Defuse in 2.5s instead of 5s', owned: player.defuseKit, afford: player.money >= 400 });
    items.push({ key: 'frag', name: 'Frag Charge', price: 300, detail: `Explosive · you hold ${load.frags}`, owned: load.frags >= 2, afford: player.money >= 300 });
    items.push({ key: 'smoke', name: 'Veil Smoke', price: 300, detail: `Blocks sightlines 14s · you hold ${load.smokes}`, owned: load.smokes >= 1, afford: player.money >= 300 });
    return items;
  }
  function buy(key) {
    const load = player.loadout;
    const pay = (price) => {
      if (player.money < price) { audio.denied(); return false; }
      player.money -= price;
      return true;
    };
    if (WEAPONS[key] && !load.owned[key] && pay(WEAPONS[key].price)) {
      giveWeapon(load, key);
      selectWeapon(load, key, state.now);
      audio.buy();
    } else if (key === 'vesthelm' && pay(1000)) { player.armor = 100; player.helm = true; audio.buy(); }
    else if (key === 'vest' && pay(650)) { player.armor = 100; audio.buy(); }
    else if (key === 'kit' && pay(400)) { player.defuseKit = true; audio.buy(); }
    else if (key === 'frag' && load.frags < 2 && pay(300)) { load.frags++; audio.buy(); }
    else if (key === 'smoke' && load.smokes < 1 && pay(300)) { load.smokes++; audio.buy(); }
    hud.refreshBuy(buyCatalog(), player.money, `Buy phase · ${Math.ceil(state.phaseT)}s`);
  }

  // ---------- player controller ----------
  function stepPlayer(dt) {
    const p = player;
    p.channel = null;
    if (!p.alive || state.phase === 'menu' || state.phase === 'matchEnd') {
      p.move.x = 0; p.move.z = 0; p.move.speed = 0;
      prevFiring = input.firing;
      return;
    }
    const mouse = input.takeMouse();
    const sens = p.loadout.scoped ? 0.0007 : 0.0021;
    p.yaw -= mouse.dx * sens;
    p.pitch -= mouse.dy * sens;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    const frozen = state.phase === 'buy' || state.phase === 'roundEnd';
    // Movement keys in camera space.
    let ix = 0;
    let iz = 0;
    if (!frozen && input.locked) {
      if (input.held('KeyW')) iz -= 1;
      if (input.held('KeyS')) iz += 1;
      if (input.held('KeyA')) ix -= 1;
      if (input.held('KeyD')) ix += 1;
    }
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    // Forward is (-sin, -cos); right is (cos, -sin) — the same rotation the
    // camera uses, so keys move the player where the crosshair points.
    const fx = -sin; const fz = -cos;
    const rx = -fz; const rz = fx;
    let mx = fx * -iz + rx * ix;
    let mz = fz * -iz + rz * ix;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    const walking = input.held('ShiftLeft') || input.held('ShiftRight');
    const crouching = input.held('ControlLeft') || input.held('KeyC');
    p.move.x = mx;
    p.move.z = mz;
    p.move.speed = frozen || ml === 0 ? 0 : crouching ? RUN_SPEED * 0.34 : walking ? 2.4 : RUN_SPEED;
    p.move.crouch = crouching;
    p.move.jump = !frozen && input.wasPressed('Space');
    // Weapons
    const load = p.loadout;
    load.scoped = !!(WEAPONS[load.current].zoom && input.aiming && input.locked);
    if (!frozen && input.locked) {
      if (input.wasPressed('Digit1')) selectBestSlot(1);
      if (input.wasPressed('Digit2')) selectBestSlot(2);
      if (input.wasPressed('Digit3')) selectWeapon(load, 'knife', state.now);
      const wheel = input.takeWheel();
      if (wheel) cycleWeapon(wheel);
      if (input.wasPressed('KeyR')) { if (startReload(load, state.now)) audio.reload(); }
      const def = WEAPONS[load.current];
      const wantFire = input.firing && (def.auto || !prevFiring);
      if (wantFire) {
        const magBefore = load.mag[load.current];
        resolveShot(p, 0, false);
        if (def.kind === 'sniper' && load.mag[load.current] < magBefore) audio.bolt();
      }
      if (input.wasPressed('KeyG') && load.frags > 0) throwGrenade(p, 'frag', null);
      if (input.wasPressed('KeyV') && load.smokes > 0) throwGrenade(p, 'smoke', null);
      // Interact: plant or defuse.
      if (input.held('KeyE')) {
        if (p.hasCharge && world.siteAt(p.pos.x, p.pos.z)) p.channel = 'plant';
        else if (charge.state === 'planted' && p.role === 'defend'
          && Math.hypot(p.pos.x - charge.pos.x, p.pos.z - charge.pos.z) < 1.7) p.channel = 'defuse';
      }
    }
    prevFiring = input.firing;
    // Footstep noise + sounds
    if (p.speed2d > 4 && p.onGround) {
      p.stepAcc = (p.stepAcc || 0) + dt;
      if (p.stepAcc > 0.34) {
        p.stepAcc = 0;
        noise.push({ x: p.pos.x, z: p.pos.z, radius: 9, at: state.now, team: p.side });
      }
    }
    // Reload completion sound is implicit; update timers.
    updateLoadout(load, state.now);
  }
  function selectBestSlot(slot) {
    const load = player.loadout;
    if (slot === 2) { selectWeapon(load, 'p9', state.now); return; }
    for (const key of ['vk7', 'meridian', 'breacher', 'raptor']) {
      if (load.owned[key]) { selectWeapon(load, key, state.now); return; }
    }
  }
  function cycleWeapon(dir) {
    const load = player.loadout;
    const owned = ['vk7', 'meridian', 'breacher', 'raptor', 'p9', 'knife'].filter((k) => load.owned[k]);
    const i = owned.indexOf(load.current);
    const next = owned[(i + dir + owned.length) % owned.length];
    if (next) selectWeapon(load, next, state.now);
  }

  // ---------- main step ----------
  function step(dt) {
    state.now += dt;
    const phase = state.phase;
    // Phase clocks
    if (phase === 'buy') {
      state.phaseT -= dt;
      if (buyOpenWanted && player.alive) {
        buyOpenWanted = false;
        hud.openBuy(buyCatalog(), player.money, `Buy phase · ${Math.ceil(state.phaseT)}s`);
        input.releaseLock();
      }
      if (state.phaseT <= 0) {
        state.phase = 'live';
        hud.closeBuy();
        hud.banner('ROUND LIVE', planHintForPlayer(), '#f5f2ea', 1.6);
      }
    } else if (phase === 'live') {
      state.roundTime -= dt;
      if (state.roundTime <= 0) {
        endRound(attackingSide() === 'A' ? 'B' : 'A', 'Time expired · the sites hold', false);
      }
    } else if (phase === 'planted') {
      state.chargeTime -= dt;
      const interval = Math.max(0.14, state.chargeTime / CHARGE_TIME);
      if (state.now >= charge.beepAt) {
        charge.beepAt = state.now + interval;
        if (charge.pos.distanceTo(player.pos) < 34) audio.beep(state.chargeTime < 8);
      }
      if (state.chargeTime <= 0) {
        charge.state = 'detonated';
        fx.explosion(charge.pos.clone());
        audio.explosion(charge.pos.distanceTo(player.pos));
        fx.setCharge(null, false);
        endRound(attackingSide(), `The Charge detonated at Site ${charge.site.id}`, true);
      }
    } else if (phase === 'roundEnd') {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        const aWon = state.score.A >= WIN_ROUNDS;
        const bWon = state.score.B >= WIN_ROUNDS;
        if (aWon || bWon || state.round >= MAX_ROUNDS) endMatch();
        else {
          state.round++;
          if (state.round === 7) {
            for (const a of actors) { a.money = 800; resetLoadout(a); }
            hud.banner('HALFTIME', 'Sides swap · pistols out', '#f2b705', 3);
          }
          startRound();
        }
      }
    }

    stepPlayer(dt);
    // Bot brains + shared physics for everyone
    for (const a of actors) {
      if (!a.isPlayer) {
        if (a.brain) updateBrain(a, ctx, dt);
        if (a.wantNade) {
          throwGrenade(a, a.wantNade.kind, a.wantNade);
          a.wantNade = null;
        }
        updateLoadout(a.loadout, state.now);
      }
      if (a.alive && state.phase !== 'buy' && state.phase !== 'menu') stepActor(a, world, dt);
      else if (a.alive && state.phase === 'buy') { a.move.speed = 0; }
    }
    // Charge pickup: an attacker walking over a dropped charge takes it.
    if (charge.state === 'dropped') {
      for (const a of actors) {
        if (a.alive && a.role === 'attack' && Math.hypot(a.pos.x - charge.pos.x, a.pos.z - charge.pos.z) < 1.1) {
          a.hasCharge = true;
          charge.state = 'carried';
          charge.carrier = a;
          fx.setCharge(null, false);
          if (a.isPlayer) hud.setHint('You carry the Charge');
          break;
        }
      }
    }
    stepChannels(dt);
    stepNades(dt);
    // Prune noise
    for (let i = noise.length - 1; i >= 0; i--) if (state.now - noise[i].at > 3) noise.splice(i, 1);
    updateHud();
    input.endStep();
  }

  function updateHud() {
    const p = player;
    const load = p.loadout;
    const def = WEAPONS[load.current];
    const inBuy = state.phase === 'buy';
    const timerText = state.phase === 'planted' ? hud.fmtTime(state.chargeTime)
      : state.phase === 'live' ? hud.fmtTime(state.roundTime)
      : inBuy ? hud.fmtTime(state.phaseT) : '—';
    hud.update({
      hp: p.hp, armor: p.armor, money: p.money,
      weaponName: def.name,
      mag: Number.isFinite(def.mag) ? load.mag[load.current] : Infinity,
      reserve: Number.isFinite(def.mag) ? load.reserve[load.current] : Infinity,
      frags: load.frags, smokes: load.smokes, hasKit: p.defuseKit,
      timerText,
      timerUrgent: (state.phase === 'live' && state.roundTime < 10) || (state.phase === 'planted' && state.chargeTime < 10),
      roundLabel: matchStarted ? `Round ${state.round} of ${MAX_ROUNDS} · ${TEAM_NAME[attackingSide()]} attacking` : 'Friendly match',
      scoreA: state.score.A, scoreB: state.score.B,
      aliveA: aliveOf('A').length, aliveB: aliveOf('B').length,
      objective: objectiveText(),
      hasCharge: p.hasCharge,
      crossGap: 4 + spreadOf(load, p) * 900,
      scoped: load.scoped,
      spectate: !p.alive && matchStarted && state.phase !== 'matchEnd'
        ? (spectateTarget ? `Down · spectating ${spectateTarget.name}` : 'Down · no teammates left') : null,
    });
    hud.drawRadar({
      actors, playerSide: p.side, player: spectateTarget && !p.alive ? spectateTarget : p,
      chargePos: charge.state === 'planted' || charge.state === 'dropped' ? charge.pos : null,
    });
    // Context hints
    if (p.alive && (state.phase === 'live' || state.phase === 'planted')) {
      if (p.hasCharge && world.siteAt(p.pos.x, p.pos.z)) hud.setHint('Hold E to plant the Charge');
      else if (charge.state === 'planted' && p.role === 'defend' && Math.hypot(p.pos.x - charge.pos.x, p.pos.z - charge.pos.z) < 1.7) hud.setHint('Hold E to defuse');
      else if (load.mag[load.current] === 0 && Number.isFinite(def.mag)) hud.setHint('R — reload');
      else hud.setHint('');
    } else hud.setHint('');
    if (hud.buyOpen() && state.phase === 'buy') {
      // Rebuilding the menu DOM every step would eat clicks; 4 Hz is plenty.
      const nowMs = performance.now();
      if (nowMs - (updateHud.lastBuyRefresh || 0) > 250) {
        updateHud.lastBuyRefresh = nowMs;
        hud.refreshBuy(buyCatalog(), p.money, `Buy phase · ${Math.ceil(state.phaseT)}s`);
      }
    }
  }
  function objectiveText() {
    if (!matchStarted) return 'Click Play to start the match';
    if (charge.state === 'planted') return player.role === 'defend' ? `Charge at ${charge.site.id} — defuse it` : `Charge at ${charge.site.id} — protect it`;
    if (charge.state === 'dropped') return player.role === 'attack' ? 'The Charge is down — recover it' : 'The Charge is down — hold the sites';
    if (player.hasCharge) return 'You have the Charge — plant at A or B';
    return player.role === 'attack' ? 'Plant the Charge at A or B' : 'Defend sites A and B';
  }

  // ---------- rendering ----------
  const _camPos = new THREE.Vector3();
  function renderFrame(t, dtRender) {
    world.update(t);
    for (const a of actors) if (a.mesh) poseBotMesh(a, dtRender);
    fx.update(dtRender, t);
    // Camera: menu orbit, spectate, or the player's eyes.
    if (state.phase === 'menu' && !matchStarted) {
      const a = t * 0.05;
      camera.position.set(Math.cos(a) * 26, 13 + Math.sin(t * 0.13) * 2, Math.sin(a) * 26);
      camera.lookAt(0, 1, -6);
      viewmodel.group.visible = false;
      return;
    }
    viewmodel.group.visible = true;
    let viewActor = player;
    if (!player.alive && spectateTarget && spectateTarget.alive) viewActor = spectateTarget;
    eyePos(viewActor, _camPos);
    bobPhase += viewActor.speed2d * dtRender * 1.6;
    const bobAmt = viewActor === player && viewActor.onGround ? Math.min(1, viewActor.speed2d / RUN_SPEED) : 0;
    camera.position.copy(_camPos);
    if (viewActor === player) {
      camera.position.y += Math.abs(Math.sin(bobPhase)) * 0.028 * bobAmt;
    }
    recoilPitch = Math.max(0, recoilPitch - dtRender * 0.09);
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = viewActor.yaw;
    camera.rotation.x = viewActor.pitch + (viewActor === player ? recoilPitch : 0);
    const load = player.loadout;
    const targetFov = load.scoped && player.alive ? 20 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dtRender * 14);
      camera.updateProjectionMatrix();
    }
    const reloading = load.reloadEnd > state.now;
    const reloadDip = reloading ? Math.sin(Math.min(1, 1 - (load.reloadEnd - state.now) / WEAPONS[load.current].reloadTime) * Math.PI) : 0;
    const switchDip = load.switchEnd > state.now ? (load.switchEnd - state.now) / 0.32 : 0;
    if (viewActor === player && player.alive) {
      viewmodel.setWeapon(load.current);
      viewmodel.update(dtRender, {
        bobPhase, bobAmt,
        reloadDip, switchDip,
        scoped: load.scoped,
      });
    } else {
      viewmodel.group.visible = false;
    }
  }

  // ---------- screenshot staging ----------
  function stageShot(name) {
    matchStarted = true;
    state.score.A = 3;
    state.score.B = 2;
    state.round = 6;
    for (const a of actors) {
      a.role = a.side === 'A' ? 'attack' : 'defend';
      a.alive = true;
      a.hp = 100;
    }
    const byName = (n) => actors.find((a) => a.name === n);
    if (name === 'menu') {
      state.phase = 'menu';
      matchStarted = false;
      placeAllAtSpawns();
      updateHud();
      return;
    }
    if (name === 'buy') {
      startRoundStaged();
      state.phase = 'buy';
      state.phaseT = 9;
      player.money = 4350;
      giveWeapon(player.loadout, 'vk7');
      player.loadout.current = 'vk7';
      player.armor = 100;
      player.helm = true;
      player.loadout.frags = 1;
      hud.openBuy(buyCatalog(), player.money, 'Buy phase · 9s');
      player.pos.set(0, 0, 27.5);
      player.yaw = 0.5;
      updateHud();
      return;
    }
    if (name === 'fight') {
      startRoundStaged();
      state.phase = 'live';
      state.roundTime = 72;
      player.pos.set(0.5, 0, 10.5);
      player.yaw = 0.06;
      player.pitch = -0.02;
      player.hp = 68;
      player.armor = 41;
      player.money = 2350;
      giveWeapon(player.loadout, 'vk7');
      player.loadout.current = 'vk7';
      player.loadout.mag.vk7 = 17;
      player.loadout.reserve.vk7 = 60;
      const drex = byName('DREX');
      drex.pos.set(1.8, 0, -2);
      drex.yaw = Math.PI - 0.4;
      const halv = byName('HALV');
      halv.pos.set(-3.2, 0, -8.5);
      halv.yaw = Math.PI + 0.3;
      halv.crouch = true;
      const orin = byName('ORIN');
      orin.pos.set(-3.4, 0, 4.5);
      orin.yaw = -0.3;
      hud.addKill('YOU', 'SORIN', 'VK-7 Carbine', true, 'A', 'B');
      hud.addKill('TALO', 'KURO', 'Raptor-9 SMG', false, 'A', 'B');
      hud.hitmarker(true, true);
      // The shot being fired this instant: viewmodel flash + a tracer frozen
      // on its way to DREX's chest (fx only fades when its update runs with
      // real dt, which screenshot mode never gives it).
      viewmodel.setWeapon('vk7');
      viewmodel.fire();
      eyePos(player, _origin);
      _end.set(drex.pos.x, drex.pos.y + 1.25, drex.pos.z);
      fx.tracer(_origin, _end);
      updateHud();
      return;
    }
    if (name === 'plant') {
      startRoundStaged();
      state.phase = 'live';
      state.roundTime = 47;
      player.pos.set(-19.5, 0, -19.8);
      player.yaw = -0.7;
      player.hasCharge = true;
      charge.state = 'carried';
      charge.carrier = player;
      player.channelT = PLANT_TIME * 0.62;
      hud.setProgress('PLANTING AT A', 0.62);
      const vesk = byName('VESK');
      vesk.pos.set(-15.5, 0, -17.5);
      vesk.yaw = -1.2;
      const sorin = byName('SORIN');
      sorin.pos.set(-8.5, 0, -24.5);
      sorin.yaw = 2.2;
      updateHud();
      return;
    }
  }
  function placeAllAtSpawns() {
    for (const a of actors) {
      const list = SPAWNS[a.side === 'A' ? 'attack' : 'defend'];
      const idx = actors.filter((x) => x.side === a.side).indexOf(a);
      a.pos.set(list[idx][0], 0, list[idx][1]);
      a.yaw = a.side === 'A' ? 0 : Math.PI;
    }
  }
  function startRoundStaged() {
    placeAllAtSpawns();
    for (const a of actors) {
      a.money = 2900;
      if (!a.isPlayer) botBuy(a, rng);
    }
  }

  return {
    state,
    player,
    actors,
    startMatch,
    stageShot,
    step,
    renderFrame,
    buy,
    get charge() { return charge; },
  };
}
