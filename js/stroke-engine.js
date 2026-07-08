/**
 * Stroke smoothing + shape recognition (iPad-style hold-to-beautify).
 * Catmull-Rom smoothing inspired by perfect-freehand streamline.
 */

export function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Reduce noisy mouse samples */
export function filterPoints(points, minDist = 2) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distance(points[i], out[out.length - 1]) >= minDist) {
      out.push(points[i]);
    }
  }
  return out;
}

/** Streamline: pull each point toward previous smoothed position */
export function streamlinePoints(points, strength = 0.55) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    out.push({
      x: lerp(cur.x, prev.x, strength),
      y: lerp(cur.y, prev.y, strength),
    });
  }
  return out;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Dense smooth curve through control points */
export function smoothStroke(points, { streamline = 0.55, smoothing = 0.5 } = {}) {
  let pts = filterPoints(points, 1.5);
  if (pts.length < 2) return pts;
  pts = streamlinePoints(pts, streamline);
  if (pts.length < 3) return pts;

  const samples = Math.max(8, Math.floor(pts.length * (2 + smoothing * 4)));
  const result = [];
  const n = pts.length - 1;
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * n;
    const seg = Math.min(Math.floor(t), n - 1);
    const localT = t - seg;
    const p0 = pts[Math.max(seg - 1, 0)];
    const p1 = pts[seg];
    const p2 = pts[seg + 1];
    const p3 = pts[Math.min(seg + 2, pts.length - 1)];
    result.push(catmullRom(p0, p1, p2, p3, localT));
  }
  return result;
}

function boundingBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points) {
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
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

function cornerCount(points) {
  if (points.length < 4) return 0;
  let corners = 0;
  const step = Math.max(1, Math.floor(points.length / 24));
  for (let i = step; i < points.length - step; i += step) {
    const a = points[i - step];
    const b = points[i];
    const c = points[i + step];
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * bc.x + ab.y * bc.y;
    const mag = Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y) || 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
    if (angle > 0.65) corners++;
  }
  return corners;
}

/**
 * Detect line | circle | ellipse | rectangle from raw stroke.
 * Returns { type, points? } or null.
 */
export function recognizeShape(points) {
  const pts = filterPoints(points, 3);
  if (pts.length < 6) return null;

  const box = boundingBox(pts);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 24) return null;

  const start = pts[0];
  const end = pts[pts.length - 1];
  const closed = distance(start, end) < diag * 0.22;

  // Line
  const lineErr = lineError(pts, start, end);
  if (lineErr < diag * 0.06 && !closed) {
    return { type: "line", from: start, to: end };
  }

  if (!closed) return null;

  const center = centroid(pts);
  const rAvg = avgRadius(pts, center);
  let radialVar = 0;
  for (const p of pts) {
    const d = distance(p, center);
    radialVar += Math.abs(d - rAvg);
  }
  radialVar /= pts.length;

  const aspect = box.width / (box.height || 1);
  const isRoundish = aspect > 0.55 && aspect < 1.8;

  // Circle / ellipse
  if (isRoundish && radialVar < rAvg * 0.22) {
    if (aspect > 0.82 && aspect < 1.22) {
      return { type: "circle", center, radius: rAvg };
    }
    const rx = box.width / 2;
    const ry = box.height / 2;
    return {
      type: "ellipse",
      center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      rx,
      ry,
    };
  }

  // Rectangle
  const corners = cornerCount(pts);
  if (corners >= 2 && box.width > 20 && box.height > 20) {
    return {
      type: "rectangle",
      x: box.minX,
      y: box.minY,
      width: box.width,
      height: box.height,
    };
  }

  return null;
}

export function shapeToPoints(shape) {
  switch (shape.type) {
    case "line":
      return [shape.from, shape.to];
    case "circle": {
      const pts = [];
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({
          x: shape.center.x + Math.cos(a) * shape.radius,
          y: shape.center.y + Math.sin(a) * shape.radius,
        });
      }
      return pts;
    }
    case "ellipse": {
      const pts = [];
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({
          x: shape.center.x + Math.cos(a) * shape.rx,
          y: shape.center.y + Math.sin(a) * shape.ry,
        });
      }
      return pts;
    }
    case "rectangle": {
      const { x, y, width, height } = shape;
      return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
        { x, y },
      ];
    }
    default:
      return [];
  }
}
