import './style.css';
import './ui.css';

// The app is a single game: Pettuadae, Maros. Boot straight into it.
const root = document.getElementById('game-root');
root.hidden = false;
root.innerHTML = '<div class="loading"><div class="spinner"></div>Memuat Pettuadae, Maros…</div>';
// The game builds its own loading screen as soon as the code has arrived.

import('./game/index.js').then((mod) => {
  root.innerHTML = '';
  mod.start(root);
});
