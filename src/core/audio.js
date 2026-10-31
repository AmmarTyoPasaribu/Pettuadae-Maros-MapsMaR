// Tiny Web Audio synth for SFX (no audio files).
let ctx = null;
let master = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ac();
}

export function tone(freq, dur = 0.15, { type = 'sine', vol = 0.3, slide = null, delay = 0 } = {}) {
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
export function noise(dur = 0.2, { vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', delay = 0 } = {}) {
  const a = ac();
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + delay;
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

// Continuous engine-like hum; returns controller.
export function loopTone({ type = 'sawtooth', freq = 60, vol = 0.05, filter = 600 } = {}) {
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
  g.gain.value = vol;
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(master);
  o.start();
  o2.start();
  return {
    set(fr, v = vol, fl = filter) {
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
      } catch (e) {
        /* already stopped */
      }
    },
  };
}

export const sfx = {
  coin: () => {
    tone(988, 0.08, { type: 'square', vol: 0.12 });
    tone(1318, 0.18, { type: 'square', vol: 0.12, delay: 0.07 });
  },
  jump: () => tone(300, 0.2, { type: 'triangle', vol: 0.25, slide: 700 }),
  slide: () => noise(0.25, { vol: 0.2, freq: 800, type: 'bandpass' }),
  whoosh: () => noise(0.15, { vol: 0.15, freq: 2000, type: 'bandpass' }),
  crash: () => {
    noise(0.6, { vol: 0.5, freq: 600 });
    tone(120, 0.5, { type: 'sawtooth', vol: 0.25, slide: 40 });
  },
  place: (pitch = 1) => {
    tone(440 * pitch, 0.12, { type: 'sine', vol: 0.3 });
    noise(0.05, { vol: 0.15, freq: 3000 });
  },
  perfect: (pitch = 1) => {
    tone(660 * pitch, 0.12, { type: 'triangle', vol: 0.25 });
    tone(990 * pitch, 0.25, { type: 'triangle', vol: 0.2, delay: 0.06 });
  },
  shoot: () => {
    noise(0.12, { vol: 0.35, freq: 2500, type: 'bandpass', q: 0.6 });
    tone(180, 0.08, { type: 'square', vol: 0.12, slide: 60 });
  },
  hit: () => noise(0.1, { vol: 0.25, freq: 500 }),
  hurt: () => tone(220, 0.25, { type: 'sawtooth', vol: 0.2, slide: 90 }),
  groan: () => tone(90 + Math.random() * 40, 0.6, { type: 'sawtooth', vol: 0.06, slide: 60 }),
  pickup: () => {
    tone(523, 0.1, { vol: 0.2 });
    tone(659, 0.1, { vol: 0.2, delay: 0.08 });
    tone(784, 0.2, { vol: 0.2, delay: 0.16 });
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.2, delay: i * 0.1 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.12 })),
  roll: () => noise(0.1, { vol: 0.05, freq: 300 }),
  thud: (v = 0.3) => noise(0.12, { vol: v, freq: 250 }),
};
