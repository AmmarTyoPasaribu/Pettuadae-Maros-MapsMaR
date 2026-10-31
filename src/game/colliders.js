// Static collision world: boxes, circles, polygons (building footprints) and wall segments
// in a uniform grid. Used by the player, vehicles and the camera.

export function pointInPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// [distance, qx, qz] from point to segment.
export function closestOnSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const k = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  const qx = ax + vx * k, qz = az + vz * k;
  return [Math.hypot(px - qx, pz - qz), qx, qz];
}

export class Colliders {
  constructor(cell = 24) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }

  _key(cx, cz) {
    return (cx + 512) * 1024 + (cz + 512);
  }

  _insert(item, x0, x1, z0, z1) {
    const c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++) {
        const k = this._key(cx, cz);
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(item);
      }
    }
  }

  addBox(x0, x1, z0, z1, h) {
    this._insert({ t: 0, x0, x1, z0, z1, h, s: 0 }, x0, x1, z0, z1);
  }

  addCircle(x, z, r) {
    this._insert({ t: 1, x, z, r, s: 0 }, x - r, x + r, z - r, z + r);
  }

  // Solid polygon (building footprint), points as [x, z].
  addPolygon(pts, h) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    this._insert({ t: 2, pts, h, x0, x1, z0, z1, s: 0 }, x0, x1, z0, z1);
  }

  // Thin wall (river bank, interior wall). It only blocks bodies whose height lies in [y0, h],
  // so walls on one floor do not block someone standing on another floor.
  addSegment(ax, az, bx, bz, h = 3, y0 = -Infinity) {
    this._insert({ t: 3, ax, az, bx, bz, h, y0, s: 0 }, Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz));
  }

  // First hit (0..1 along a->b) of a horizontal ray at height y against wall segments.
  rayCast(ax, az, bx, bz, y) {
    this.stamp++;
    let best = 1;
    const c = this.cell;
    for (let cx = Math.floor(Math.min(ax, bx) / c); cx <= Math.floor(Math.max(ax, bx) / c); cx++) {
      for (let cz = Math.floor(Math.min(az, bz) / c); cz <= Math.floor(Math.max(az, bz) / c); cz++) {
        const a = this.cells.get(this._key(cx, cz));
        if (!a) continue;
        for (const it of a) {
          if (it.s === this.stamp) continue;
          it.s = this.stamp;
          if (it.t !== 3 || y < it.y0 || y > it.h) continue;
          const rx = bx - ax, rz = bz - az, sx = it.bx - it.ax, sz = it.bz - it.az;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const qx = it.ax - ax, qz = it.az - az;
          const t = (qx * sz - qz * sx) / den;
          const u = (qx * rz - qz * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
        }
      }
    }
    return best;
  }

  // Is the point inside any solid polygon?
  containsPoint(x, z) {
    const a = this.cells.get(this._key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!a) return false;
    for (const it of a) if (it.t === 2 && x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1 && pointInPoly(x, z, it.pts)) return true;
    return false;
  }

  // Pushes circle `p` ({x,z}) out of everything it overlaps. Returns the
  // averaged contact normal, or null when nothing was hit.
  resolve(p, r) {
    this.stamp++;
    const c = this.cell;
    let nx = 0;
    let nz = 0;
    let hit = false;
    for (let cx = Math.floor((p.x - r) / c); cx <= Math.floor((p.x + r) / c); cx++) {
      for (let cz = Math.floor((p.z - r) / c); cz <= Math.floor((p.z + r) / c); cz++) {
        const a = this.cells.get(this._key(cx, cz));
        if (!a) continue;
        for (const it of a) {
          if (it.s === this.stamp) continue;
          it.s = this.stamp;
          if (it.t === 3 && p.y !== undefined && (p.y < it.y0 || p.y > it.h)) continue;
          let dx;
          let dz;
          if (it.t === 0) {
            const qx = Math.max(it.x0, Math.min(p.x, it.x1));
            const qz = Math.max(it.z0, Math.min(p.z, it.z1));
            dx = p.x - qx;
            dz = p.z - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 < 1e-8) {
              // Centre is inside the box: leave through the nearest face.
              const l = p.x - it.x0, rr = it.x1 - p.x, tt = p.z - it.z0, bb = it.z1 - p.z;
              const m = Math.min(l, rr, tt, bb);
              if (m === l) { dx = -1; dz = 0; p.x = it.x0 - r; }
              else if (m === rr) { dx = 1; dz = 0; p.x = it.x1 + r; }
              else if (m === tt) { dx = 0; dz = -1; p.z = it.z0 - r; }
              else { dx = 0; dz = 1; p.z = it.z1 + r; }
            } else {
              const d = Math.sqrt(d2);
              dx /= d;
              dz /= d;
              p.x = qx + dx * r;
              p.z = qz + dz * r;
            }
          } else if (it.t >= 2) {
            // Polygon boundary (t=2, solid inside) or single wall segment (t=3).
            let bd = Infinity, qx = 0, qz = 0;
            if (it.t === 3) {
              [bd, qx, qz] = closestOnSegment(p.x, p.z, it.ax, it.az, it.bx, it.bz);
            } else {
              if (p.x < it.x0 - r || p.x > it.x1 + r || p.z < it.z0 - r || p.z > it.z1 + r) continue;
              const pts = it.pts;
              for (let k = 0, n = pts.length; k < n; k++) {
                const e = closestOnSegment(p.x, p.z, pts[k][0], pts[k][1], pts[(k + 1) % n][0], pts[(k + 1) % n][1]);
                if (e[0] < bd) { bd = e[0]; qx = e[1]; qz = e[2]; }
              }
            }
            const inside = it.t === 2 && pointInPoly(p.x, p.z, it.pts);
            if (!inside && bd >= r) continue;
            if (inside) {
              // Leave through the nearest edge.
              const ox = qx - p.x, oz = qz - p.z;
              const d = Math.hypot(ox, oz) || 1e-4;
              dx = ox / d;
              dz = oz / d;
              p.x = qx + dx * r;
              p.z = qz + dz * r;
            } else {
              dx = (p.x - qx) / (bd || 1e-4);
              dz = (p.z - qz) / (bd || 1e-4);
              p.x = qx + dx * r;
              p.z = qz + dz * r;
            }
          } else {
            dx = p.x - it.x;
            dz = p.z - it.z;
            let d = Math.hypot(dx, dz);
            const min = r + it.r;
            if (d >= min) continue;
            if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
            dx /= d;
            dz /= d;
            p.x = it.x + dx * min;
            p.z = it.z + dz * min;
          }
          nx += dx;
          nz += dz;
          hit = true;
        }
      }
    }
    if (!hit) return null;
    const l = Math.hypot(nx, nz) || 1;
    return { nx: nx / l, nz: nz / l };
  }

  // Is this 3D point inside a building? (Camera occlusion test.)
  inside(x, z, y) {
    const a = this.cells.get(this._key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!a) return false;
    for (const it of a) {
      if (y >= it.h) continue;
      if (it.t === 0 && x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1) return true;
      if (it.t === 2 && x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1 && pointInPoly(x, z, it.pts)) return true;
    }
    return false;
  }
}
