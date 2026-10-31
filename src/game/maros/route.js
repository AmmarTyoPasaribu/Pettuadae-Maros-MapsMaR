// GPS routing on the road graph (A*). Returns a polyline from (fx,fz) to (tx,tz)
// that follows real streets, or null if either point is far from any road.
export function createRouter(M) {
  const nodes = M.nodes;

  function route(fx, fz, tx, tz) {
    const a = M.roadIndex.nearest(fx, fz, 250);
    const b = M.roadIndex.nearest(tx, tz, 250);
    if (!a || !b) return null;
    if (a.edge === b.edge) {
      const [s0, s1] = [a.s, b.s];
      return [[fx, fz], ...slice(a.edge, s0, s1), [b.x, b.z]];
    }
    // Start/goal "virtual" connections to both ends of their edges.
    const g = new Map();
    const prev = new Map();
    const open = [];
    const h = (n) => Math.hypot(n.x - b.x, n.z - b.z);
    const push = (n, cost, from) => {
      if (cost >= (g.get(n.id) ?? Infinity)) return;
      g.set(n.id, cost);
      prev.set(n.id, from);
      open.push({ n, f: cost + h(n) });
    };
    push(a.edge.a, a.s, { start: true, edge: a.edge, dir: -1 });
    push(a.edge.b, a.edge.len - a.s, { start: true, edge: a.edge, dir: 1 });
    const goalCost = new Map([[b.edge.a.id, b.s], [b.edge.b.id, b.edge.len - b.s]]);
    let best = Infinity;
    let bestNode = null;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const { n, f } = open.splice(bi, 1)[0];
      if (f >= best) break;
      const gc = g.get(n.id);
      if (goalCost.has(n.id) && gc + goalCost.get(n.id) < best) {
        best = gc + goalCost.get(n.id);
        bestNode = n;
      }
      for (const { edge, dir } of n.edges) {
        const o = dir > 0 ? edge.b : edge.a;
        push(o, gc + edge.len, { edge, dir, node: n });
      }
    }
    if (!bestNode) return null;

    // Walk back through the edges, then stitch the polyline together.
    const chain = [];
    let cur = bestNode;
    let first = null;
    for (let guard = 0; guard < nodes.length + 5; guard++) {
      const p = prev.get(cur.id);
      if (!p) break;
      if (p.start) { first = p; break; }
      chain.push(p);
      cur = p.node;
    }
    chain.reverse();
    const out = [[fx, fz], [a.x, a.z]];
    if (first) out.push(...slice(a.edge, a.s, first.dir > 0 ? a.edge.len : 0));
    for (const step of chain) {
      const pts = step.dir > 0 ? step.edge.pts : [...step.edge.pts].reverse();
      out.push(...pts);
    }
    const endAtA = bestNode === b.edge.a;
    out.push(...slice(b.edge, endAtA ? 0 : b.edge.len, b.s), [b.x, b.z]);
    return out;
  }

  // Points of an edge between distances s0 and s1 (either order).
  function slice(edge, s0, s1) {
    const out = [];
    const fwd = s1 >= s0;
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    for (let i = 0; i < edge.pts.length; i++) if (edge.cum[i] > lo && edge.cum[i] < hi) out.push(edge.pts[i]);
    return fwd ? out : out.reverse();
  }

  return { route };
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}
