// Keyboard and mouse state plus pointer lock. The simulation reads held keys
// and accumulated mouse deltas once per fixed step; discrete actions (reload,
// buy, weapon slots, interact) are edge-triggered flags the game consumes.
// Pointer lock is only requested from a real click during live play — the
// screenshot modes never lock.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;
  let wheel = 0;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (locked) wheel += Math.sign(e.deltaY);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });

  return {
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    held(code) { return keys.has(code); },
    wasPressed(code) { return pressed.has(code); },
    // Mouse delta since the last call; the game calls this once per step.
    takeMouse() {
      const out = { dx: mouseDX, dy: mouseDY };
      mouseDX = 0;
      mouseDY = 0;
      return out;
    },
    takeWheel() {
      const w = wheel;
      wheel = 0;
      return w;
    },
    endStep() {
      pressed.clear();
    },
    requestLock() {
      if (locked) return;
      // Chrome returns a promise here; a programmatic (non-gesture) call is
      // refused with a rejection that must not surface as a page error.
      const pending = canvas.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    },
    releaseLock() {
      if (locked) document.exitPointerLock();
    },
  };
}
