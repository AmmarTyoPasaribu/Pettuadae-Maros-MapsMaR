import { startOpenWorld } from './openworld.js';
import { marosMap } from './maros/map.js';

export function start(container) {
  return startOpenWorld(container, marosMap);
}
