// Keyboard state + swipe + virtual joysticks, all removable on dispose.
export function createInput(target) {
  const keys = new Set();
  const pressed = new Set();
  const listeners = [];
  const on = (el, ev, fn, opt) => {
    el.addEventListener(ev, fn, opt);
    listeners.push(() => el.removeEventListener(ev, fn, opt));
  };

  on(window, 'keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  });
  on(window, 'keyup', (e) => keys.delete(e.code));
  on(window, 'blur', () => keys.clear());

  const api = {
    down: (...codes) => codes.some((c) => keys.has(c)),
    // True once per physical key press.
    hit: (...codes) => {
      let r = false;
      for (const c of codes) if (pressed.has(c)) { pressed.delete(c); r = true; }
      return r;
    },
    endFrame: () => pressed.clear(),
    on,
    onSwipe(cb) {
      let sx = 0, sy = 0, st = 0, active = false;
      on(target, 'touchstart', (e) => {
        const t = e.changedTouches[0];
        sx = t.clientX; sy = t.clientY; st = performance.now(); active = true;
      }, { passive: true });
      on(target, 'touchend', (e) => {
        if (!active) return;
        active = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 25) return cb('tap');
        if (performance.now() - st > 600) return;
        if (Math.abs(dx) > Math.abs(dy)) cb(dx > 0 ? 'right' : 'left');
        else cb(dy > 0 ? 'down' : 'up');
      });
    },
    // On-screen joystick for touch devices. Returns {x, y, active}.
    joystick(parent, side = 'left') {
      const state = { x: 0, y: 0, active: false };
      const base = document.createElement('div');
      base.className = `joystick joystick-${side}`;
      const knob = document.createElement('div');
      knob.className = 'joystick-knob';
      base.appendChild(knob);
      parent.appendChild(base);
      let id = null, cx = 0, cy = 0;
      const R = 50;
      on(base, 'touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        id = t.identifier;
        const r = base.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        state.active = true;
        move(t);
      }, { passive: false });
      const move = (t) => {
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
        state.x = dx / R; state.y = dy / R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      on(window, 'touchmove', (e) => {
        for (const t of e.changedTouches) if (t.identifier === id) move(t);
      }, { passive: true });
      const end = (e) => {
        for (const t of e.changedTouches) if (t.identifier === id) {
          id = null; state.x = state.y = 0; state.active = false;
          knob.style.transform = '';
        }
      };
      on(window, 'touchend', end);
      on(window, 'touchcancel', end);
      return state;
    },
    dispose() {
      listeners.forEach((f) => f());
    },
  };
  return api;
}

export const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
