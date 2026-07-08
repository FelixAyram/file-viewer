/**
 * Shape recognition inspired by Excalidraw (RDP simplification) and $1 recognizer patterns.
 */

export function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Ramer–Douglas–Peucker — used by Excalidraw shape-assist prototypes */
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

export function filterPoints(points, minDist = 2) {
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
    const cross = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
    err += cross;
  }
  return err / points.length;
}

/** Detect line or circle from a freehand stroke (with RDP pre-pass). */
export function recognizeLineAndCircle(points) {
  const pts = filterPoints(points, 2);
  if (pts.length < 4) return null;

  const box = boundingBox(pts);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 18) return null;

  const simplified = rdp(pts, Math.max(2.5, diag * 0.022));
  const start = pts[0];
  const end = pts[pts.length - 1];
  const closed = distance(start, end) < diag * 0.28;

  const lineErr = lineError(pts, start, end);
  if (!closed && (lineErr < diag * 0.09 || simplified.length <= 3)) {
    return { type: "line", from: start, to: end };
  }

  if (!closed) return null;

  const center = centroid(pts);
  const rAvg = avgRadius(pts, center);
  if (rAvg < 8) return null;

  let radialVar = 0;
  for (const p of pts) {
    radialVar += Math.abs(distance(p, center) - rAvg);
  }
  radialVar /= pts.length;

  const aspect = box.width / (box.height || 1);
  if (aspect > 0.65 && aspect < 1.55 && radialVar < rAvg * 0.28) {
    return { type: "circle", center, radius: rAvg };
  }

  return null;
}

export function smoothStroke(points, { streamline = 0.55 } = {}) {
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
