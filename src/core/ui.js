import { unlockAudio } from './audio.js';

// Overlay shell for the game: HUD, title screen, pause menu and toasts.
// pauseItems: [{ id, label, onClick }] rendered as buttons in the pause menu.
export function createShell(container, { title, subtitle, controls = [], accent = '#22c55e', hasSave = false, onStart, onPause, onKey, pauseItems = [], credits = '' }) {
  const root = document.createElement('div');
  root.className = 'shell';
  root.style.setProperty('--accent', accent);
  root.innerHTML = `
    <div class="hud"></div>
    <div class="topbar">
      <button class="btn-icon btn-pause" title="Pause (P / Esc)" hidden>❚❚</button>
    </div>
    <div class="toast"></div>
    <div class="panel panel-menu">
      <div class="card card-wide">
        <div class="eyebrow">Open World · Sulawesi Selatan</div>
        <h1>${title}</h1>
        <p class="sub">${subtitle}</p>
        <ul class="controls">${controls.map(([k, v]) => `<li><kbd>${k}</kbd><span>${v}</span></li>`).join('')}</ul>
        <div class="menu-buttons">
          ${hasSave ? '<button class="btn-primary btn-continue">Lanjutkan</button>' : ''}
          <button class="${hasSave ? 'btn-ghost' : 'btn-primary'} btn-new">${hasSave ? 'Mulai Baru' : 'Mainkan'}</button>
        </div>
        <p class="credits">${credits}</p>
      </div>
    </div>
    <div class="panel panel-pause" hidden>
      <div class="card">
        <h1>Pause</h1>
        <button class="btn-primary btn-resume">Lanjut</button>
        ${pauseItems.map((p) => `<button class="btn-ghost" data-id="${p.id}">${p.label}</button>`).join('')}
      </div>
    </div>`;
  container.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const hud = $('.hud');
  const pauseBtn = $('.btn-pause');
  let paused = false;
  let playing = false;
  let toastTimer = 0;

  const start = (fresh) => {
    unlockAudio();
    $('.panel-menu').hidden = true;
    pauseBtn.hidden = false;
    playing = true;
    onStart(fresh);
  };
  $('.btn-new').addEventListener('click', () => start(true));
  $('.btn-continue')?.addEventListener('click', () => start(false));

  const setPaused = (v) => {
    if (!playing) return;
    paused = v;
    $('.panel-pause').hidden = !v;
    onPause?.(v);
  };
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  $('.btn-resume').addEventListener('click', () => setPaused(false));
  for (const p of pauseItems) root.querySelector(`[data-id="${p.id}"]`).addEventListener('click', () => p.onClick());

  const handleKey = (e) => {
    if (onKey?.(e)) return;
    if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
    if ((e.code === 'Enter' || e.code === 'Space') && !playing) {
      e.preventDefault();
      start(!hasSave);
    }
  };
  window.addEventListener('keydown', handleKey);

  return {
    root,
    hud,
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
    toast(text, ms = 1200) {
      const t = $('.toast');
      t.textContent = text;
      t.classList.remove('show');
      void t.offsetWidth;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    },
    dispose() {
      window.removeEventListener('keydown', handleKey);
      clearTimeout(toastTimer);
      root.remove();
    },
  };
}
