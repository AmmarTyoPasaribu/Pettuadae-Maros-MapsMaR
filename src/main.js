import './style.css';

// The app is a single game: Pettuadae, Maros. Boot straight into it.
const root = document.getElementById('game-root');
root.hidden = false;
root.innerHTML = '<div class="loading"><div class="spinner"></div>Memuat Pettuadae, Maros…</div>';

import('./game/index.js').then((mod) => {
  root.innerHTML = '';
  mod.start(root);
});
