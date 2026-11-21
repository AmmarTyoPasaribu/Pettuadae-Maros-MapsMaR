import { unlockAudio, sfx } from './audio.js';

// Game shell: loading screen, title menu (Mainkan / Pengaturan / Kontrol / Tentang), pause menu,
// GTA-style HUD containers, big cinematic messages (WASTED / BUSTED), toasts and a help box.
//
// settings: [{ id, label, type: 'range'|'toggle'|'cycle', min, max, step, get(), set(v), text?() }]
// pauseItems: [{ id, label, onClick }]

const TIPS = [
  'Tekan M untuk membuka peta dan klik di mana saja untuk memasang tujuan GPS.',
  'Warung dan gerobak makanan memulihkan darah. Dekati lalu tekan E.',
  'Sungai Maros cukup dalam untuk berenang. Shift untuk berenang lebih cepat.',
  'Polisi berhenti mengejar kalau kamu menghilang dari pandangan mereka cukup lama.',
  'Klik kanan untuk membidik, klik kiri untuk menembak, R untuk mengisi peluru.',
  'Ambil sepeda di depan rumah warga. Bunyikan bel dengan H.',
  'Di dalam mobil, tekan B untuk mengganti stasiun radio.',
  'Saat hujan jalan menjadi licin dan jarak pandang berkurang.',
  'Kantor BPS Kabupaten Maros bisa dimasuki lewat pintu depan.',
];

export function createShell(container, { title, subtitle, controls = [], accent = '#22c55e', hasSave = false, onStart, onPause, onKey, pauseItems = [], credits = '', settings = [], about = '' }) {
  const root = document.createElement('div');
  root.className = 'shell';
  root.style.setProperty('--accent', accent);
  const [t1, t2] = title.split(',').map((s) => s.trim());
  const controlList = controls.map(([k, v]) => `<li><kbd>${k}</kbd><span>${v}</span></li>`).join('');
  root.innerHTML = `
    <div class="hud-tr"></div>
    <div class="hud"></div>
    <div class="help-box" hidden></div>
    <div class="topbar"><button class="btn-icon btn-pause" title="Jeda (P / Esc)" hidden>❚❚</button></div>
    <div class="toast"></div>
    <div class="bigmsg" hidden><b></b><span></span></div>
    <div class="loading-screen">
      <div class="ld-inner">
        <div class="eyebrow">Open World · Sulawesi Selatan</div>
        <div class="logo">${t1.toUpperCase()}<span>${(t2 || '').toUpperCase()}</span></div>
        <div class="ld-bar"><i></i></div>
        <div class="ld-label">Menyiapkan…</div>
        <div class="ld-tip"></div>
      </div>
      <div class="ld-by">Dibuat oleh <b>Ammar Tyo Pasaribu</b></div>
    </div>
    <div class="title-screen" hidden>
      <div class="ts-left">
        <div class="eyebrow">Open World · Sulawesi Selatan</div>
        <h1 class="logo">${t1.toUpperCase()}<span>${(t2 || '').toUpperCase()}</span></h1>
        <p class="tagline">${subtitle}</p>
        <nav class="menu">
          ${hasSave ? '<button data-act="continue">Lanjutkan</button>' : ''}
          <button data-act="new">${hasSave ? 'Mulai Baru' : 'Mainkan'}</button>
          <button data-act="settings">Pengaturan</button>
          <button data-act="controls">Kontrol</button>
          <button data-act="about">Tentang</button>
        </nav>
        <div class="made-by">Dibuat oleh <b>Ammar Tyo Pasaribu</b></div>
      </div>
      <div class="ts-panel" hidden>
        <section data-panel="settings"><h2>Pengaturan</h2><div class="settings"></div></section>
        <section data-panel="controls"><h2>Kontrol</h2><ul class="controls">${controlList}</ul></section>
        <section data-panel="about"><h2>Tentang</h2><div class="about">${about}<p class="credits">${credits}</p></div></section>
        <button class="btn-ghost ts-close">Kembali</button>
      </div>
      <div class="ts-hint">Tekan <kbd>Enter</kbd> untuk bermain</div>
    </div>
    <div class="panel panel-pause" hidden>
      <div class="pause-card">
        <div class="eyebrow">Jeda</div>
        <h1>${t1}</h1>
        <nav class="menu menu-small">
          <button class="btn-resume">Lanjut</button>
          <button data-act="p-settings">Pengaturan</button>
          <button data-act="p-controls">Kontrol</button>
          ${pauseItems.map((p) => `<button data-id="${p.id}">${p.label}</button>`).join('')}
        </nav>
        <div class="pause-sub" hidden>
          <div class="settings"></div>
          <ul class="controls">${controlList}</ul>
          <button class="btn-ghost p-back">Kembali</button>
        </div>
      </div>
    </div>`;
  container.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const hud = $('.hud');
  const pauseBtn = $('.btn-pause');
  let paused = false;
  let playing = false;
  let toastTimer = 0;
  let tipTimer = 0;

  // ---------------- Settings widgets (rendered in both menus) ----------------
  function renderSettings(el) {
    el.innerHTML = '';
    for (const s of settings) {
      const row = document.createElement('label');
      row.className = 'set-row';
      row.innerHTML = `<span>${s.label}</span>`;
      if (s.type === 'range') {
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = s.min ?? 0;
        inp.max = s.max ?? 1;
        inp.step = s.step ?? 0.05;
        inp.value = s.get();
        const out = document.createElement('output');
        out.textContent = s.text ? s.text(s.get()) : Math.round(s.get() * 100) + '%';
        inp.addEventListener('input', () => {
          s.set(+inp.value);
          out.textContent = s.text ? s.text(+inp.value) : Math.round(+inp.value * 100) + '%';
        });
        row.append(inp, out);
      } else {
        const b = document.createElement('button');
        b.className = 'set-btn';
        const label = () => (s.type === 'toggle' ? (s.get() ? 'Aktif' : 'Mati') : s.text ? s.text() : s.get());
        b.textContent = label();
        b.addEventListener('click', (e) => {
          e.preventDefault();
          s.set(s.type === 'toggle' ? !s.get() : null);
          b.textContent = label();
          sfx.ui();
        });
        row.append(b);
      }
      el.appendChild(row);
    }
  }

  // ---------------- Title menu ----------------
  const titleEl = $('.title-screen');
  const tsPanel = $('.ts-panel');
  const openPanel = (name) => {
    tsPanel.hidden = !name;
    for (const sec of tsPanel.querySelectorAll('section')) sec.hidden = sec.dataset.panel !== name;
    if (name === 'settings') renderSettings(tsPanel.querySelector('.settings'));
    titleEl.classList.toggle('with-panel', !!name);
  };
  const start = (fresh) => {
    unlockAudio();
    titleEl.hidden = true;
    pauseBtn.hidden = false;
    playing = true;
    root.classList.add('playing');
    onStart(fresh);
  };
  for (const b of titleEl.querySelectorAll('.menu button')) {
    b.addEventListener('mouseenter', () => sfx.ui());
    b.addEventListener('click', () => {
      unlockAudio();
      const a = b.dataset.act;
      if (a === 'continue') start(false);
      else if (a === 'new') start(true);
      else {
        const sec = tsPanel.querySelector(`[data-panel="${a}"]`);
        openPanel(!tsPanel.hidden && !sec.hidden ? null : a);
        sfx.ui();
      }
    });
  }
  $('.ts-close').addEventListener('click', () => { openPanel(null); sfx.uiBack(); });

  // ---------------- Pause menu ----------------
  const pauseSub = $('.pause-sub');
  const setPaused = (v) => {
    if (!playing) return;
    paused = v;
    $('.panel-pause').hidden = !v;
    pauseSub.hidden = true;
    $('.menu-small').hidden = false;
    onPause?.(v);
  };
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  $('.btn-resume').addEventListener('click', () => setPaused(false));
  for (const p of pauseItems) root.querySelector(`[data-id="${p.id}"]`).addEventListener('click', () => { sfx.ui(); p.onClick(); });
  const showSub = (what) => {
    $('.menu-small').hidden = true;
    pauseSub.hidden = false;
    pauseSub.querySelector('.settings').hidden = what !== 'settings';
    pauseSub.querySelector('.controls').hidden = what !== 'controls';
    if (what === 'settings') renderSettings(pauseSub.querySelector('.settings'));
  };
  root.querySelector('[data-act="p-settings"]').addEventListener('click', () => { sfx.ui(); showSub('settings'); });
  root.querySelector('[data-act="p-controls"]').addEventListener('click', () => { sfx.ui(); showSub('controls'); });
  $('.p-back').addEventListener('click', () => { sfx.uiBack(); pauseSub.hidden = true; $('.menu-small').hidden = false; });

  const handleKey = (e) => {
    if (onKey?.(e)) return;
    if (!playing) {
      if (e.code === 'Enter' && !titleEl.hidden) {
        e.preventDefault();
        start(!hasSave);
      } else if (e.code === 'Escape') openPanel(null);
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
  };
  window.addEventListener('keydown', handleKey);

  const helpEl = $('.help-box');
  let helpTimer = 0;
  const big = $('.bigmsg');

  return {
    root,
    hud,
    hudTR: $('.hud-tr'),
    get paused() {
      return paused;
    },
    get playing() {
      return playing;
    },
    setPaused,
    setHud(html) {
      hud.innerHTML = html;
    },
    setPauseLabel(id, label) {
      const b = root.querySelector(`[data-id="${id}"]`);
      if (b) b.textContent = label;
    },
    // Loading progress 0..1 with a stage label.
    loading(frac, label) {
      const ls = $('.loading-screen');
      ls.querySelector('.ld-bar i').style.width = `${Math.round(frac * 100)}%`;
      if (label) ls.querySelector('.ld-label').textContent = label;
      if (!tipTimer) {
        const tip = () => (ls.querySelector('.ld-tip').textContent = 'Tips: ' + TIPS[Math.floor(Math.random() * TIPS.length)]);
        tip();
        tipTimer = setInterval(tip, 4000);
      }
    },
    // Loading done: fade into the title menu.
    ready() {
      clearInterval(tipTimer);
      const ls = $('.loading-screen');
      ls.classList.add('done');
      setTimeout(() => ls.remove(), 700);
      titleEl.hidden = false;
    },
    toast(text, ms = 1200) {
      const t = $('.toast');
      t.textContent = text;
      t.classList.remove('show');
      void t.offsetWidth;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    },
    // GTA-style help box in the top-left corner.
    help(html, ms = 5000) {
      helpEl.innerHTML = html;
      helpEl.hidden = !html;
      clearTimeout(helpTimer);
      if (html && ms) helpTimer = setTimeout(() => (helpEl.hidden = true), ms);
    },
    // Big cinematic message (WASTED / BUSTED / MISI SELESAI).
    big(text, sub = '', kind = 'wasted', ms = 3200) {
      big.className = `bigmsg ${kind}`;
      big.querySelector('b').textContent = text;
      big.querySelector('span').textContent = sub;
      big.hidden = false;
      clearTimeout(big.t);
      big.t = setTimeout(() => (big.hidden = true), ms);
    },
    dispose() {
      window.removeEventListener('keydown', handleKey);
      clearTimeout(toastTimer);
      clearInterval(tipTimer);
      root.remove();
    },
  };
}
