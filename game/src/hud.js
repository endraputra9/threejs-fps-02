// The HUD: plain DOM over the canvas, updated from a view-model the game
// builds each frame — this module never touches game state directly. It owns
// the vitals/ammo readouts, the match bar, killfeed, hit and damage feedback,
// the buy menu and scoreboard overlays, round banners, the plant/defuse
// progress bar, and a north-up radar whose static layer (blocks and sites) is
// painted once from the world's own layout data.
const $ = (id) => document.getElementById(id);

export function createHud({ blocks, sites, onBuy, onDeploy }) {
  const els = {
    hud: $('hud'), hpBar: $('hp-bar'), hpNum: $('hp-num'), armorBar: $('armor-bar'),
    armorNum: $('armor-num'), money: $('money'), ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    nades: $('nades'), timer: $('round-timer'), roundLabel: $('round-label'),
    scoreA: $('score-a'), scoreB: $('score-b'), aliveA: $('alive-a'), aliveB: $('alive-b'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), hitmarker: $('hitmarker'), crosshair: $('crosshair'),
    progress: $('progress'), progressFill: $('progress-fill'), progressLabel: $('progress-label'),
    hint: $('hint'), vignette: $('vignette'), dmgDir: $('dmg-dir'), scope: $('scope'),
    spectate: $('spectate'), buyMenu: $('buy-menu'), buyItems: $('buy-items'),
    buyMoney: $('buy-money'), buyTimer: $('buy-timer'), scoreboard: $('scoreboard'),
    sbBody: $('sb-body'), radar: $('radar'), objLabel: $('obj-label'),
    chargeTag: $('charge-tag'), menu: $('menu'), matchEnd: $('match-end'),
    endTitle: $('end-title'), endSub: $('end-sub'),
  };
  const radarCtx = els.radar.getContext('2d');
  const RADAR = 176;
  const SCALE = RADAR / 78;

  // Static radar layer: blocks and site rings painted once.
  const radarBase = document.createElement('canvas');
  radarBase.width = radarBase.height = RADAR;
  {
    const c = radarBase.getContext('2d');
    c.fillStyle = '#10141a';
    c.fillRect(0, 0, RADAR, RADAR);
    c.fillStyle = '#2c333b';
    for (const b of blocks) {
      c.fillRect((b.x - b.w / 2 + 39) * SCALE, (b.z - b.d / 2 + 39) * SCALE, b.w * SCALE, b.d * SCALE);
    }
    for (const s of sites) {
      c.strokeStyle = '#' + s.color.toString(16).padStart(6, '0');
      c.lineWidth = 2;
      c.beginPath();
      c.arc((s.x + 39) * SCALE, (s.z + 39) * SCALE, s.r * SCALE, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = '700 11px system-ui';
      c.textAlign = 'center';
      c.fillText(s.id, (s.x + 39) * SCALE, (s.z + 39) * SCALE + 4);
    }
  }

  let bannerUntil = 0;
  let hitUntil = 0;
  let dmgUntil = 0;

  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  return {
    fmtTime,
    setMenuVisible(v) { els.menu.hidden = !v; },
    setMatchEnd(title, sub) {
      els.endTitle.textContent = title;
      els.endSub.textContent = sub;
      els.matchEnd.hidden = false;
    },
    hideMatchEnd() { els.matchEnd.hidden = true; },
    banner(title, sub, color, seconds = 3.2) {
      els.bannerTitle.textContent = title;
      els.bannerTitle.style.color = color || '';
      els.bannerSub.textContent = sub || '';
      els.banner.style.opacity = '1';
      bannerUntil = performance.now() + seconds * 1000;
    },
    hitmarker(head, kill) {
      els.hitmarker.className = kill ? 'kill' : head ? 'head' : 'on';
      hitUntil = performance.now() + (kill ? 260 : 130);
    },
    damageFrom(relAngle, hp) {
      els.dmgDir.style.transform = `translate(-50%,-50%) rotate(${relAngle}rad)`;
      els.dmgDir.style.opacity = '1';
      dmgUntil = performance.now() + 700;
      els.vignette.style.opacity = String(Math.min(0.75, 0.3 + (1 - hp / 100) * 0.5));
    },
    setProgress(label, frac) {
      if (frac === null) { els.progress.hidden = true; return; }
      els.progress.hidden = false;
      els.progressLabel.textContent = label;
      els.progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setHint(text) { els.hint.textContent = text || ''; },
    addKill(killer, victim, weapon, headshot, killerSide, victimSide) {
      const row = document.createElement('div');
      row.className = 'kf-row';
      const k = document.createElement('span');
      k.className = killerSide === 'A' ? 'side-a' : 'side-b';
      k.textContent = killer;
      const w = document.createElement('span');
      w.className = 'kf-weapon';
      w.textContent = headshot ? `${weapon} ⌖` : weapon;
      const v = document.createElement('span');
      v.className = victimSide === 'A' ? 'side-a' : 'side-b';
      v.textContent = victim;
      row.append(k, w, v);
      els.killfeed.appendChild(row);
      while (els.killfeed.children.length > 5) els.killfeed.firstChild.remove();
      setTimeout(() => row.classList.add('fade'), 3600);
      setTimeout(() => row.remove(), 4300);
    },
    // ---- buy menu ----
    openBuy(catalog, money, timerText) {
      els.buyMoney.textContent = `$${money}`;
      els.buyTimer.textContent = timerText;
      els.buyItems.replaceChildren();
      catalog.forEach((item, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-item' + (item.owned ? ' owned' : '') + (!item.afford && !item.owned ? ' poor' : '');
        row.disabled = item.owned || !item.afford;
        const name = document.createElement('span');
        name.className = 'buy-name';
        name.textContent = `${i + 1} · ${item.name}`;
        const detail = document.createElement('span');
        detail.className = 'buy-detail';
        detail.textContent = item.detail;
        const price = document.createElement('span');
        price.className = 'buy-price';
        price.textContent = item.owned ? 'OWNED' : `$${item.price}`;
        row.append(name, detail, price);
        row.addEventListener('click', () => onBuy(item.key));
        els.buyItems.appendChild(row);
      });
      els.buyMenu.hidden = false;
    },
    refreshBuy(catalog, money, timerText) {
      if (!els.buyMenu.hidden) this.openBuy(catalog, money, timerText);
    },
    closeBuy() { els.buyMenu.hidden = true; },
    buyOpen() { return !els.buyMenu.hidden; },
    onDeployClick(fn) { $('deploy-btn').addEventListener('click', fn); },
    // ---- scoreboard ----
    setScoreboard(rows, visible) {
      els.scoreboard.hidden = !visible;
      if (!visible) return;
      els.sbBody.replaceChildren();
      for (const r of rows) {
        const tr = document.createElement('tr');
        if (r.me) tr.className = 'me';
        for (const cell of [r.name, r.k, r.d, r.money]) {
          const td = document.createElement('td');
          td.textContent = String(cell);
          tr.appendChild(td);
        }
        els.sbBody.appendChild(tr);
      }
    },
    // ---- per-frame view-model ----
    update(vm) {
      els.hpBar.style.width = `${Math.max(0, vm.hp)}%`;
      els.hpNum.textContent = String(Math.max(0, Math.ceil(vm.hp)));
      els.hpBar.className = vm.hp <= 30 ? 'low' : '';
      els.armorBar.style.width = `${Math.max(0, vm.armor)}%`;
      els.armorNum.textContent = String(Math.max(0, Math.ceil(vm.armor)));
      els.money.textContent = `$${vm.money}`;
      els.weaponName.textContent = vm.weaponName;
      els.ammoMag.textContent = vm.mag === Infinity ? '—' : String(vm.mag);
      els.ammoReserve.textContent = vm.reserve === Infinity ? '' : `/ ${vm.reserve}`;
      els.ammoMag.classList.toggle('empty', vm.mag === 0);
      els.nades.textContent = `Frag ×${vm.frags}   Smoke ×${vm.smokes}${vm.hasKit ? '   Kit ✓' : ''}`;
      els.timer.textContent = vm.timerText;
      els.timer.classList.toggle('urgent', vm.timerUrgent);
      els.roundLabel.textContent = vm.roundLabel;
      els.scoreA.textContent = String(vm.scoreA);
      els.scoreB.textContent = String(vm.scoreB);
      els.aliveA.textContent = '●'.repeat(vm.aliveA) + '○'.repeat(5 - vm.aliveA);
      els.aliveB.textContent = '●'.repeat(vm.aliveB) + '○'.repeat(5 - vm.aliveB);
      els.objLabel.textContent = vm.objective;
      els.chargeTag.hidden = !vm.hasCharge;
      els.crosshair.style.setProperty('--gap', `${vm.crossGap}px`);
      els.scope.style.opacity = vm.scoped ? '1' : '0';
      els.spectate.hidden = !vm.spectate;
      if (vm.spectate) els.spectate.textContent = vm.spectate;
      const now = performance.now();
      if (now > bannerUntil) els.banner.style.opacity = '0';
      els.hitmarker.style.opacity = now < hitUntil ? '1' : '0';
      if (now > dmgUntil) {
        els.dmgDir.style.opacity = '0';
        els.vignette.style.opacity = vm.hp < 100 && vm.hp > 0 ? String((1 - vm.hp / 100) * 0.35) : '0';
      }
    },
    drawRadar(vm) {
      const c = radarCtx;
      c.clearRect(0, 0, RADAR, RADAR);
      c.drawImage(radarBase, 0, 0);
      const px = (x) => (x + 39) * SCALE;
      const pz = (z) => (z + 39) * SCALE;
      if (vm.chargePos) {
        c.fillStyle = (performance.now() % 600) < 300 ? '#ff3b30' : '#7a130d';
        c.beginPath();
        c.arc(px(vm.chargePos.x), pz(vm.chargePos.z), 4, 0, Math.PI * 2);
        c.fill();
      }
      for (const a of vm.actors) {
        if (!a.alive || a.isPlayer) continue;
        if (a.side !== vm.playerSide) continue; // teammates only
        c.fillStyle = a.side === 'A' ? '#1fb6a6' : '#e04f39';
        c.beginPath();
        c.arc(px(a.pos.x), pz(a.pos.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      // Player arrow at centre of its position, rotated by yaw (north-up map:
      // yaw 0 faces -z, i.e. up on the radar).
      const x = px(vm.player.pos.x);
      const y = pz(vm.player.pos.z);
      c.save();
      c.translate(x, y);
      c.rotate(-vm.player.yaw);
      c.fillStyle = '#f5f2ea';
      c.beginPath();
      c.moveTo(0, -6);
      c.lineTo(4.4, 5);
      c.lineTo(0, 2.4);
      c.lineTo(-4.4, 5);
      c.closePath();
      c.fill();
      c.restore();
    },
  };
}
