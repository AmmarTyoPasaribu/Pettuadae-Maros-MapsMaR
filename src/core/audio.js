// Web Audio synth: every sound and all music are generated, no audio files.
// Buses: master -> { sfx, music, ambience }. Volumes are set from the settings menu.
let ctx = null;
let master = null;
const bus = {};
const vol = { master: 0.8, music: 0.55, sfx: 0.9, ambience: 0.7 };

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    // Gentle glue on the master so explosions and gunshots do not clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    for (const k of ['sfx', 'music', 'ambience']) {
      bus[k] = ctx.createGain();
      bus[k].connect(master);
    }
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vol.master * 0.6, t, 0.05);
  for (const k of ['sfx', 'music', 'ambience']) bus[k].gain.setTargetAtTime(vol[k], t, 0.05);
}

export function setVolumes(v) {
  Object.assign(vol, v);
  applyVolumes();
}

export function unlockAudio() {
  ac();
}

export const audioTime = () => (ctx ? ctx.currentTime : 0);

export function tone(freq, dur = 0.15, { type = 'sine', vol: v = 0.3, slide = null, delay = 0, at = null, out = 'sfx', attack = 0.01, vibrato = 0 } = {}) {
  if (v <= 0.0005) return;
  const a = ac();
  const t = at ?? a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  if (vibrato) {
    const l = a.createOscillator();
    const lg = a.createGain();
    l.frequency.value = 5.5;
    lg.gain.value = freq * vibrato;
    l.connect(lg).connect(o.frequency);
    l.start(t);
    l.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus[out]);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noiseBuffer(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

export function noise(dur = 0.2, { vol: v = 0.3, freq = 1200, q = 0.8, type = 'lowpass', delay = 0, at = null, out = 'sfx', sweep = null, attack = 0 } = {}) {
  if (v <= 0.0005) return;
  const a = ac();
  const t = at ?? a.currentTime + delay;
  const s = a.createBufferSource();
  s.buffer = noiseBuffer(a);
  s.loop = dur > 1.9;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = a.createGain();
  if (attack) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + attack);
  } else g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus[out]);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

// Continuous engine-like hum; returns controller.
export function loopTone({ type = 'sawtooth', freq = 60, vol: v0 = 0.05, filter = 600 } = {}) {
  const a = ac();
  const o = a.createOscillator();
  const o2 = a.createOscillator();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  o.type = type;
  o2.type = 'square';
  o.frequency.value = freq;
  o2.frequency.value = freq * 0.5;
  f.type = 'lowpass';
  f.frequency.value = filter;
  g.gain.value = v0;
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(bus.sfx);
  o.start();
  o2.start();
  return {
    set(fr, v = v0, fl = filter) {
      const t = a.currentTime;
      o.frequency.setTargetAtTime(fr, t, 0.05);
      o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
      g.gain.setTargetAtTime(v, t, 0.05);
      f.frequency.setTargetAtTime(fl, t, 0.05);
    },
    stop() {
      try {
        g.gain.setTargetAtTime(0, a.currentTime, 0.05);
        o.stop(a.currentTime + 0.2);
        o2.stop(a.currentTime + 0.2);
      } catch {
        /* already stopped */
      }
    },
  };
}

// Looped filtered noise bed (rain, wind, traffic murmur). set(volume, filterFreq).
export function noiseLoop({ type = 'lowpass', freq = 800, q = 0.7, out = 'ambience' } = {}) {
  const a = ac();
  const s = a.createBufferSource();
  s.buffer = noiseBuffer(a);
  s.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = 0;
  s.connect(f).connect(g).connect(bus[out]);
  s.start();
  return {
    set(v, fr = null) {
      const t = a.currentTime;
      g.gain.setTargetAtTime(v, t, 0.3);
      if (fr) f.frequency.setTargetAtTime(fr, t, 0.3);
    },
    stop() {
      try { s.stop(); } catch { /* stopped */ }
    },
  };
}

// Indonesian police siren (fast "wiu-wiu" yelp). set(volume).
export function createSiren() {
  const a = ac();
  const o = a.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 900;
  const lfo = a.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = 2.6;
  const lg = a.createGain();
  lg.gain.value = 330;
  lfo.connect(lg).connect(o.frequency);
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1300;
  f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.value = 0;
  o.connect(f).connect(g).connect(bus.sfx);
  o.start();
  lfo.start();
  return {
    set(v) {
      g.gain.setTargetAtTime(v, a.currentTime, 0.15);
    },
  };
}

// ---------------- Sound effects ----------------
const R = () => Math.random();
export const sfx = {
  coin: () => {
    tone(988, 0.08, { type: 'square', vol: 0.12 });
    tone(1318, 0.18, { type: 'square', vol: 0.12, delay: 0.07 });
  },
  jump: () => tone(300, 0.2, { type: 'triangle', vol: 0.25, slide: 700 }),
  whoosh: () => noise(0.15, { vol: 0.15, freq: 2000, type: 'bandpass' }),
  crash: () => {
    noise(0.6, { vol: 0.5, freq: 600 });
    tone(120, 0.5, { type: 'sawtooth', vol: 0.25, slide: 40 });
  },
  shoot: (v = 1) => {
    noise(0.09, { vol: 0.55 * v, freq: 3200, type: 'bandpass', q: 0.5 });
    noise(0.35, { vol: 0.4 * v, freq: 420, sweep: 90 });
    tone(150, 0.12, { type: 'square', vol: 0.18 * v, slide: 45 });
    noise(0.6, { vol: 0.06 * v, freq: 900, delay: 0.08, sweep: 300 });
  },
  // Spent casing tinkling on the ground.
  casing: () => {
    tone(4200 + R() * 600, 0.05, { type: 'triangle', vol: 0.03, delay: 0.25 });
    tone(3800 + R() * 600, 0.04, { type: 'triangle', vol: 0.02, delay: 0.33 });
  },
  empty: () => tone(1900, 0.03, { type: 'square', vol: 0.07 }),
  reload: () => {
    noise(0.05, { vol: 0.15, freq: 2500, type: 'bandpass' });
    noise(0.06, { vol: 0.2, freq: 1800, type: 'bandpass', delay: 0.45 });
    tone(900, 0.04, { type: 'square', vol: 0.08, delay: 0.95 });
    noise(0.05, { vol: 0.2, freq: 1400, type: 'bandpass', delay: 1.0 });
  },
  ricochet: (v = 1) => tone(2600 + R() * 1500, 0.18, { type: 'sine', vol: 0.06 * v, slide: 900 }),
  impact: (v = 1) => noise(0.06, { vol: 0.18 * v, freq: 1500, type: 'bandpass' }),
  flesh: (v = 1) => noise(0.12, { vol: 0.25 * v, freq: 350 }),
  explosion: (v = 1) => {
    noise(2.2, { vol: 0.9 * v, freq: 900, sweep: 60 });
    noise(0.25, { vol: 0.7 * v, freq: 2500, type: 'bandpass' });
    tone(70, 1.4, { type: 'sine', vol: 0.6 * v, slide: 28 });
    noise(1.5, { vol: 0.12 * v, freq: 3000, type: 'highpass', delay: 0.3 });
  },
  hit: () => noise(0.1, { vol: 0.25, freq: 500 }),
  hurt: () => tone(220, 0.25, { type: 'sawtooth', vol: 0.2, slide: 90 }),
  pickup: () => {
    tone(523, 0.1, { vol: 0.2 });
    tone(659, 0.1, { vol: 0.2, delay: 0.08 });
    tone(784, 0.2, { vol: 0.2, delay: 0.16 });
  },
  eat: () => {
    for (let i = 0; i < 4; i++) noise(0.07, { vol: 0.12, freq: 1200 + R() * 800, type: 'bandpass', delay: i * 0.18 });
    tone(660, 0.15, { type: 'triangle', vol: 0.12, delay: 0.8 });
    tone(880, 0.25, { type: 'triangle', vol: 0.12, delay: 0.92 });
  },
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.12 })),
  thud: (v = 0.3) => noise(0.12, { vol: v, freq: 250 }),
  // Footsteps: dull soil/asphalt taps, splashy in shallow water.
  step: (v = 1, wet = false) => {
    if (wet) noise(0.12, { vol: 0.09 * v, freq: 1600 + R() * 800, type: 'bandpass', q: 1.5 });
    else noise(0.05, { vol: 0.07 * v, freq: 500 + R() * 400, type: 'lowpass' });
  },
  splash: (v = 1) => {
    noise(0.9, { vol: 0.45 * v, freq: 2600, sweep: 400, type: 'lowpass' });
    noise(0.3, { vol: 0.25 * v, freq: 5000, type: 'highpass' });
  },
  stroke: () => noise(0.35, { vol: 0.08, freq: 1400 + R() * 600, type: 'bandpass', attack: 0.08 }),
  door: (open = true) => {
    noise(0.06, { vol: 0.15, freq: open ? 1600 : 700, type: 'bandpass' });
    if (!open) noise(0.1, { vol: 0.22, freq: 260, delay: 0.02 });
  },
  horn: (moto) => {
    if (moto) {
      tone(620, 0.09, { type: 'square', vol: 0.12 });
      tone(620, 0.09, { type: 'square', vol: 0.12, delay: 0.14 });
    } else {
      tone(340, 0.3, { type: 'square', vol: 0.12 });
      tone(428, 0.3, { type: 'square', vol: 0.08 });
    }
  },
  bell: () => {
    for (const d of [0, 0.16]) {
      tone(2350, 0.35, { type: 'sine', vol: 0.08, delay: d });
      tone(3125, 0.3, { type: 'sine', vol: 0.04, delay: d });
    }
  },
  thunder: (v = 1) => {
    noise(3.5, { vol: 0.6 * v, freq: 220, sweep: 50, attack: 0.15 });
    noise(0.4, { vol: 0.25 * v, freq: 1200, type: 'bandpass', delay: 0.05 });
  },
  ui: () => tone(1250, 0.05, { type: 'triangle', vol: 0.08 }),
  uiBack: () => tone(700, 0.06, { type: 'triangle', vol: 0.08 }),
  star: () => {
    tone(880, 0.12, { type: 'square', vol: 0.08 });
    tone(660, 0.18, { type: 'square', vol: 0.08, delay: 0.1 });
  },
  busted: () => [523, 494, 392, 262].forEach((f, i) => tone(f, 0.35, { type: 'square', vol: 0.1, delay: i * 0.16 })),
  // Animals.
  chicken: (v = 1) => {
    for (let i = 0; i < 3; i++) tone(900 + R() * 300, 0.07, { type: 'square', vol: 0.05 * v, slide: 620, delay: i * 0.11 });
    tone(1250, 0.22, { type: 'square', vol: 0.05 * v, slide: 700, delay: 0.36 });
  },
  rooster: (v = 1) => {
    tone(520, 0.2, { type: 'sawtooth', vol: 0.05 * v, slide: 760 });
    tone(780, 0.55, { type: 'sawtooth', vol: 0.05 * v, slide: 640, delay: 0.22, vibrato: 0.02 });
    tone(640, 0.45, { type: 'sawtooth', vol: 0.04 * v, slide: 420, delay: 0.78 });
  },
  cat: (v = 1) => tone(700, 0.55, { type: 'sawtooth', vol: 0.04 * v, slide: 480, attack: 0.08, vibrato: 0.01 }),
  goat: (v = 1) => tone(330, 0.6, { type: 'sawtooth', vol: 0.05 * v, slide: 300, attack: 0.04, vibrato: 0.06 }),
  cow: (v = 1) => tone(150, 1.3, { type: 'sawtooth', vol: 0.07 * v, slide: 110, attack: 0.25, vibrato: 0.01 }),
  duck: (v = 1) => {
    tone(520, 0.12, { type: 'square', vol: 0.04 * v, slide: 380 });
    tone(500, 0.12, { type: 'square', vol: 0.04 * v, slide: 360, delay: 0.18 });
  },
  bird: (v = 1) => {
    const f = 2600 + R() * 1800;
    for (let i = 0; i < 2 + Math.floor(R() * 3); i++) tone(f * (0.9 + R() * 0.25), 0.06, { type: 'sine', vol: 0.025 * v, slide: f * 1.3, delay: i * 0.09, out: 'ambience' });
  },
  cricket: (v = 1) => {
    const f = 4300 + R() * 600;
    for (let i = 0; i < 3; i++) tone(f, 0.025, { type: 'sine', vol: 0.018 * v, delay: i * 0.045, out: 'ambience' });
  },
  frog: (v = 1) => {
    for (let i = 0; i < 2; i++) tone(170 + R() * 40, 0.09, { type: 'square', vol: 0.025 * v, slide: 130, delay: i * 0.13, out: 'ambience' });
  },
};

// ---------------- Procedural music ----------------
// Styles: 'title' (Bugis kecapi plucks over a soft pad, suling flute phrases), and radio stations
// 'pop' (pop daerah), 'dangdut' (gendang "tak-dut", suling, bass) and 'lofi'.
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const STYLES = {
  title: { bpm: 78, root: 50, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -2, 2]], drums: 'soft', lead: 'suling', arp: 'kecapi' },
  pop: { bpm: 104, root: 52, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], drums: 'pop', lead: 'kecapi', arp: 'keys' },
  dangdut: { bpm: 128, root: 48, scale: [0, 1, 4, 5, 7, 8, 10], chords: [[0, 3, 7], [5, 8, 12], [7, 10, 14], [0, 3, 7]], drums: 'dangdut', lead: 'suling', arp: 'mandolin' },
  lofi: { bpm: 80, root: 53, scale: [0, 2, 3, 7, 10], chords: [[0, 3, 7, 10], [5, 8, 12, 15], [-2, 2, 5, 9], [3, 7, 10, 14]], drums: 'lofi', lead: null, arp: 'keys' },
};
export const RADIO = [
  { id: null, name: 'Radio mati' },
  { id: 'pop', name: 'Maros FM · Pop Daerah' },
  { id: 'dangdut', name: 'Butta Salewangang · Dangdut' },
  { id: 'lofi', name: 'Lo-fi Pettuadae' },
];

export function createMusic() {
  let style = null;
  let timer = null;
  let next = 0;
  let step = 0;
  let level = 1;
  let crackle = null;
  const out = () => bus.music;
  const pluck = (f, t, v, kind) => {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    const fl = a.createBiquadFilter();
    o.type = kind === 'keys' ? 'triangle' : 'sawtooth';
    o.frequency.setValueAtTime(f * (kind === 'kecapi' ? 1.01 : 1), t);
    if (kind === 'kecapi') o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(kind === 'keys' ? 2200 : 3600, t);
    fl.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const dur = kind === 'keys' ? 0.9 : kind === 'mandolin' ? 0.25 : 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(out());
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const pad = (notes, t, dur) => {
    for (const f of notes) tone(f, dur, { type: 'sawtooth', vol: 0.012 * level, at: t, attack: dur * 0.35, out: 'music' });
  };
  const flute = (f, t, dur) => tone(f, dur, { type: 'sine', vol: 0.05 * level, at: t, attack: 0.06, vibrato: 0.012, out: 'music' });
  const drum = (kind, t, v = 1) => {
    const L = level * v;
    if (kind === 'kick') tone(110, 0.25, { type: 'sine', vol: 0.3 * L, slide: 42, at: t, out: 'music' });
    if (kind === 'snare') noise(0.16, { vol: 0.12 * L, freq: 1800, type: 'bandpass', at: t, out: 'music' });
    if (kind === 'hat') noise(0.04, { vol: 0.05 * L, freq: 8000, type: 'highpass', at: t, out: 'music' });
    if (kind === 'dut') tone(150, 0.3, { type: 'sine', vol: 0.3 * L, slide: 70, at: t, out: 'music' });
    if (kind === 'tak') {
      noise(0.07, { vol: 0.14 * L, freq: 900, type: 'bandpass', q: 2, at: t, out: 'music' });
      tone(420, 0.06, { type: 'triangle', vol: 0.08 * L, at: t, out: 'music' });
    }
    if (kind === 'shaker') noise(0.06, { vol: 0.03 * L, freq: 6000, type: 'highpass', at: t, out: 'music' });
    if (kind === 'gendang') tone(95, 0.35, { type: 'sine', vol: 0.18 * L, slide: 60, at: t, out: 'music' });
  };
  function schedule() {
    const a = ac();
    const S = STYLES[style];
    const spb = 60 / S.bpm / 2; // eighth notes
    while (next < a.currentTime + 0.25) {
      const t = next;
      const bar = Math.floor(step / 8) % S.chords.length;
      const e = step % 8;
      const ch = S.chords[bar].map((n) => midi(S.root + 12 + n));
      if (e === 0) {
        pad(ch.map((f) => f / 2), t, spb * 8);
        tone(midi(S.root + S.chords[bar][0] - 12 + 12), spb * 3, { type: 'triangle', vol: 0.14 * level, at: t, out: 'music' });
      }
      if (S.drums !== 'soft' && e === 4) tone(midi(S.root + S.chords[bar][0]), spb * 2, { type: 'triangle', vol: 0.1 * level, at: t, out: 'music' });
      // Arpeggio.
      const arpOn = S.arp === 'kecapi' ? [0, 2, 3, 5, 6] : S.arp === 'mandolin' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 3, 6];
      if (arpOn.includes(e)) {
        const f = ch[(e + bar) % ch.length] * (e > 4 ? 2 : 1);
        pluck(f, t, S.arp === 'keys' ? 0.05 : 0.06, S.arp);
      }
      // Drums.
      if (S.drums === 'pop') {
        if (e === 0 || e === 5) drum('kick', t);
        if (e === 2 || e === 6) drum('snare', t);
        drum('hat', t, e % 2 ? 0.6 : 1);
      } else if (S.drums === 'dangdut') {
        // Classic gendang: tak - dut - tak tak - dut.
        if (e === 0 || e === 3 || e === 6) drum('dut', t);
        if (e === 2 || e === 4 || e === 5 || e === 7) drum('tak', t, e === 5 ? 0.6 : 1);
        drum('shaker', t);
      } else if (S.drums === 'lofi') {
        if (e === 0 || e === 5) drum('kick', t, 0.6);
        if (e === 4) drum('snare', t, 0.6);
        if (e % 2 === 0) drum('hat', t, 0.5);
      } else {
        if (e === 0) drum('gendang', t, 0.6);
        if (e === 5) drum('gendang', t, 0.35);
        if (e % 2) drum('shaker', t, 0.6);
      }
      // Lead phrases every other bar.
      if (S.lead && Math.floor(step / 8) % 2 === 1 && (e === 0 || e === 3 || e === 5) && Math.random() < 0.8) {
        const n = S.scale[Math.floor(Math.random() * S.scale.length)];
        const f = midi(S.root + 24 + n);
        if (S.lead === 'suling') flute(f, t, spb * (e === 5 ? 3 : 2.5));
        else pluck(f, t, 0.07, 'kecapi');
      }
      next += spb * (S.drums === 'lofi' && e % 2 ? 1.12 : S.drums === 'lofi' ? 0.88 : 1);
      step++;
    }
  }
  return {
    get style() {
      return style;
    },
    play(s) {
      if (s === style) return;
      this.stop();
      if (!s) return;
      const a = ac();
      style = s;
      step = 0;
      next = a.currentTime + 0.1;
      timer = setInterval(schedule, 60);
      if (s === 'lofi') {
        crackle = noiseLoop({ type: 'highpass', freq: 5000, out: 'music' });
        crackle.set(0.012);
      }
    },
    setLevel(v) {
      level = v;
    },
    stop() {
      clearInterval(timer);
      timer = null;
      style = null;
      crackle?.stop();
      crackle = null;
    },
  };
}

// ---------------- Ambience ----------------
// Day: birds and distant traffic. Night: crickets and (near water) frogs. Rain: a noise bed.
export function createAmbience() {
  let bed = null;
  let rain = null;
  let wind = null;
  let t = 0;
  let nextBird = 1;
  let nextCricket = 0.5;
  let nextFrog = 2;
  return {
    update(dt, { night = 0, rain: r = 0, water = false, indoor = false, muted = false }) {
      if (!ctx) return;
      if (!bed) {
        bed = noiseLoop({ type: 'lowpass', freq: 300 });
        rain = noiseLoop({ type: 'bandpass', freq: 2400, q: 0.4 });
        wind = noiseLoop({ type: 'bandpass', freq: 600, q: 0.6 });
      }
      const m = muted ? 0 : 1;
      bed.set(m * (0.05 + 0.04 * (1 - night)) * (indoor ? 0.4 : 1));
      rain.set(m * r * (indoor ? 0.18 : 0.32), 1800 + r * 1400);
      wind.set(m * (0.015 + r * 0.05));
      if (muted) return;
      t += dt;
      if (t > nextBird && night < 0.5 && r < 0.5) {
        sfx.bird(1 - night);
        nextBird = t + 0.6 + Math.random() * 3.5;
      }
      if (t > nextCricket && night > 0.4) {
        sfx.cricket(night * (indoor ? 0.3 : 1));
        nextCricket = t + 0.12 + Math.random() * 0.5;
      }
      if (t > nextFrog && night > 0.3 && (water || r > 0.3)) {
        sfx.frog(night);
        nextFrog = t + 0.8 + Math.random() * 2.5;
      }
    },
  };
}
