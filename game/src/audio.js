// Procedural sound: every effect is synthesised with WebAudio — short filtered
// noise bursts and oscillator blips shaped per weapon — so the game ships no
// audio files. The context is created lazily on the first user gesture and
// every call is guarded, so a headless or muted browser simply stays silent.
// Distance is a plain gain falloff; there is no per-frame work here, sounds
// are fire-and-forget nodes.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise({ at = 0, dur = 0.1, gain = 0.4, freq = 1800, q = 0.8, type = 'bandpass', sweepTo = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function tone({ at = 0, dur = 0.08, gain = 0.2, freq = 440, type = 'square', sweepTo = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function distGain(dist) {
    return 1 / (1 + dist * 0.09);
  }

  return {
    unlock() {
      ensure();
    },
    // kind: sidearm | smg | rifle | shotgun | sniper — pitch and body differ.
    shot(kind, dist = 0) {
      const g = distGain(dist) * 0.9;
      if (kind === 'shotgun') {
        noise({ dur: 0.22, gain: g, freq: 900, type: 'lowpass' });
        tone({ dur: 0.12, gain: g * 0.5, freq: 160, type: 'triangle', sweepTo: 60 });
      } else if (kind === 'sniper') {
        noise({ dur: 0.3, gain: g, freq: 1400, type: 'lowpass' });
        tone({ dur: 0.2, gain: g * 0.6, freq: 220, type: 'sawtooth', sweepTo: 50 });
      } else if (kind === 'sidearm') {
        noise({ dur: 0.07, gain: g * 0.7, freq: 2400 });
        tone({ dur: 0.05, gain: g * 0.3, freq: 300, type: 'triangle', sweepTo: 120 });
      } else {
        noise({ dur: 0.11, gain: g * 0.85, freq: 1700 });
        tone({ dur: 0.07, gain: g * 0.35, freq: 240, type: 'triangle', sweepTo: 90 });
      }
    },
    dry() {
      tone({ dur: 0.03, gain: 0.15, freq: 1200, type: 'square' });
    },
    reload() {
      noise({ dur: 0.04, gain: 0.2, freq: 900 });
      noise({ at: 0.16, dur: 0.04, gain: 0.25, freq: 600 });
      noise({ at: 0.34, dur: 0.05, gain: 0.3, freq: 1100 });
    },
    bolt() {
      noise({ dur: 0.05, gain: 0.25, freq: 700 });
      noise({ at: 0.12, dur: 0.05, gain: 0.25, freq: 900 });
    },
    swing() {
      noise({ dur: 0.09, gain: 0.12, freq: 500, sweepTo: 1800 });
    },
    hit(head = false) {
      tone({ dur: 0.05, gain: 0.22, freq: head ? 1560 : 980, type: 'sine' });
    },
    kill() {
      tone({ dur: 0.07, gain: 0.2, freq: 740, type: 'sine' });
      tone({ at: 0.07, dur: 0.1, gain: 0.2, freq: 1180, type: 'sine' });
    },
    hurt() {
      tone({ dur: 0.09, gain: 0.18, freq: 140, type: 'sawtooth', sweepTo: 70 });
    },
    step(dist = 0) {
      noise({ dur: 0.05, gain: 0.1 * distGain(dist), freq: 500, type: 'lowpass' });
    },
    jump() {
      noise({ dur: 0.06, gain: 0.08, freq: 700, type: 'lowpass' });
    },
    throwNade() {
      noise({ dur: 0.08, gain: 0.1, freq: 800, sweepTo: 300 });
    },
    explosion(dist = 0) {
      const g = distGain(dist);
      noise({ dur: 0.7, gain: g, freq: 3000, type: 'lowpass', sweepTo: 60 });
      tone({ dur: 0.5, gain: g * 0.8, freq: 90, type: 'sine', sweepTo: 34 });
    },
    smokePop(dist = 0) {
      noise({ dur: 0.4, gain: 0.25 * distGain(dist), freq: 1200, type: 'lowpass', sweepTo: 300 });
    },
    beep(fast = false) {
      tone({ dur: 0.05, gain: 0.16, freq: fast ? 1760 : 1320, type: 'sine' });
    },
    channelTick() {
      tone({ dur: 0.03, gain: 0.1, freq: 1040, type: 'sine' });
    },
    uiClick() {
      tone({ dur: 0.03, gain: 0.12, freq: 880, type: 'square' });
    },
    buy() {
      tone({ dur: 0.05, gain: 0.15, freq: 660, type: 'sine' });
      tone({ at: 0.05, dur: 0.07, gain: 0.15, freq: 990, type: 'sine' });
    },
    denied() {
      tone({ dur: 0.09, gain: 0.15, freq: 196, type: 'square' });
    },
    roundSting(won) {
      if (won) {
        tone({ dur: 0.12, gain: 0.18, freq: 523, type: 'triangle' });
        tone({ at: 0.12, dur: 0.12, gain: 0.18, freq: 659, type: 'triangle' });
        tone({ at: 0.24, dur: 0.22, gain: 0.2, freq: 784, type: 'triangle' });
      } else {
        tone({ dur: 0.14, gain: 0.18, freq: 392, type: 'triangle' });
        tone({ at: 0.14, dur: 0.14, gain: 0.18, freq: 330, type: 'triangle' });
        tone({ at: 0.28, dur: 0.26, gain: 0.2, freq: 262, type: 'triangle' });
      }
    },
    plantDone() {
      tone({ dur: 0.06, gain: 0.2, freq: 1174, type: 'sine' });
      tone({ at: 0.08, dur: 0.06, gain: 0.2, freq: 1174, type: 'sine' });
      tone({ at: 0.16, dur: 0.1, gain: 0.22, freq: 1568, type: 'sine' });
    },
  };
}
