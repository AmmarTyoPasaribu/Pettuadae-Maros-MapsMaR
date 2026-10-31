// Progress and settings in localStorage. Every access is guarded: storage can be unavailable.
const SAVE_KEY = 'pettuadae:save:v1';
const SETTINGS_KEY = 'pettuadae:settings:v1';

const read = (k) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

export const loadSave = () => read(SAVE_KEY);
export const writeSave = (s) => write(SAVE_KEY, s);
export const clearSave = () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
};

export const loadSettings = (defaults) => ({ ...defaults, ...(read(SETTINGS_KEY) || {}) });
export const writeSettings = (s) => write(SETTINGS_KEY, s);
