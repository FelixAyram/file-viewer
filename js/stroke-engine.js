/**
 * Shape recognition: geometric heuristics + $1 Unistroke (Excalidraw / Wobbrock).
 * Supports line and circle snap from a single freehand stroke.
 */

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

export function rdp(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let idx = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i += 1) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

export function filterPoints(points, minDist = 1.5) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (distance(points[i], out[out.length - 1]) >= minDist) {
      out.push(points[i]);
    }
  }
  return out;
}

function boundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points) {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function avgRadius(points, center) {
  let sum = 0;
  for (const p of points) sum += distance(p, center);
  return sum / points.length;
}

function lineError(points, a, b) {
  const len = distance(a, b) || 1;
  let err = 0;
  for (const p of points) {
    err += Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
  }
  return err / points.length;
}

const DOLLAR_N = 64;

function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) {
    len += distance(points[i - 1], points[i]);
  }
  return len;
}

function resample(points, n = DOLLAR_N) {
  if (points.length < 2) return points.slice();
  const I = pathLength(points) / (n - 1);
  let D = 0;
  const out = [points[0]];
  let pts = points.slice();
  for (let i = 1; i < pts.length; ) {
    const d = distance(pts[i - 1], pts[i]);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
      i += 1;
    }
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out.slice(0, n);
}

function centroidDollar(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function rotateBy(points, radians) {
  const c = centroidDollar(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function indicativeAngle(points) {
  const c = centroidDollar(points);
  return Math.atan2(points[0].y - c.y, points[0].x - c.x);
}

function scaleTo(points, size) {
  const box = boundingBox(points);
  const scale = size / Math.max(box.width, box.height, 1);
  const c = centroidDollar(points);
  return points.map((p) => ({
    x: (p.x - c.x) * scale,
    y: (p.y - c.y) * scale,
  }));
}

function translateTo(points, pt) {
  const c = centroidDollar(points);
  return points.map((p) => ({ x: p.x - c.x + pt.x, y: p.y - c.y + pt.y }));
}

function normalize(points) {
  let pts = resample(points, DOLLAR_N);
  const angle = indicativeAngle(pts);
  pts = rotateBy(pts, -angle);
  pts = scaleTo(pts, 250);
  pts = translateTo(pts, { x: 0, y: 0 });
  return pts;
}

function pathDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    d += distance(a[i], b[i]);
  }
  return d / a.length;
}

function makeCircleTemplate() {
  const pts = [];
  const r = 100;
  for (let i = 0; i < DOLLAR_N; i += 1) {
    const a = (i / DOLLAR_N) * Math.PI * 2;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return normalize(pts);
}

function makeLineTemplate() {
  const pts = [];
  for (let i = 0; i < DOLLAR_N; i += 1) {
    pts.push({ x: i * (200 / (DOLLAR_N - 1)), y: 0 });
  }
  return normalize(pts);
}

const TEMPLATE_CIRCLE = makeCircleTemplate();
const TEMPLATE_LINE = makeLineTemplate();
const DOLLAR_THRESHOLD = 0.42;

function recognizeDollar(points) {
  const pts = filterPoints(points, 1.5);
  if (pts.length < 8) return null;
  const box = boundingBox(pts);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 14) return null;

  const norm = normalize(pts);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const closed = distance(start, end) < diag * 0.35;

  const lineDist = pathDistance(norm, TEMPLATE_LINE);
  const circleDist = pathDistance(norm, TEMPLATE_CIRCLE);

  if (!closed && lineDist < DOLLAR_THRESHOLD) {
    return { type: "line", from: start, to: end };
  }
  if (closed && circleDist < DOLLAR_THRESHOLD * 1.15) {
    const center = centroid(pts);
    const radius = avgRadius(pts, center);
    if (radius >= 6) return { type: "circle", center, radius };
  }
  return null;
}

function recognizeGeometric(points) {
  const pts = filterPoints(points, 1.5);
  if (pts.length < 4) return null;

  const box = boundingBox(pts);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 14) return null;

  const simplified = rdp(pts, Math.max(2, diag * 0.018));
  const start = pts[0];
  const end = pts[pts.length - 1];
  const closed = distance(start, end) < diag * 0.32;

  const lineErr = lineError(pts, start, end);
  if (!closed && (lineErr < diag * 0.11 || simplified.length <= 3)) {
    return { type: "line", from: start, to: end };
  }

  if (!closed) return null;

  const center = centroid(pts);
  const rAvg = avgRadius(pts, center);
  if (rAvg < 6) return null;

  let radialVar = 0;
  for (const p of pts) radialVar += Math.abs(distance(p, center) - rAvg);
  radialVar /= pts.length;

  const aspect = box.width / (box.height || 1);
  if (aspect > 0.55 && aspect < 1.8 && radialVar < rAvg * 0.32) {
    return { type: "circle", center, radius: rAvg };
  }
  return null;
}

/** Detect line or circle from a freehand stroke. */
export function recognizeLineAndCircle(points) {
  return recognizeDollar(points) ?? recognizeGeometric(points);
}

export function smoothStroke(points, { streamline = 0.5 } = {}) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = points[i];
    out.push({
      x: cur.x + (prev.x - cur.x) * streamline,
      y: cur.y + (prev.y - cur.y) * streamline,
    });
  }
  return out;
}

export function shapeToPoints(shape) {
  switch (shape.type) {
    case "line":
      return [shape.from, shape.to];
    case "circle": {
      const pts = [];
      const n = 72;
      for (let i = 0; i <= n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        pts.push({
          x: shape.center.x + Math.cos(a) * shape.radius,
          y: shape.center.y + Math.sin(a) * shape.radius,
        });
      }
      return pts;
    }
    default:
      return [];
  }
}
