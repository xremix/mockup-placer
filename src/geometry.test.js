import test from "node:test";
import assert from "node:assert/strict";
import { inverseHomography, initialCorners, iphoneRadius, isConvex } from "./geometry.js";

test("inverse homography maps all perspective corners exactly to the screenshot", () => {
  const points = [{ x: 0.21, y: 0.18 }, { x: 0.66, y: 0.08 }, { x: 0.8, y: 0.83 }, { x: 0.29, y: 0.91 }];
  const m = inverseHomography(points);
  const targets = [[0, 0], [1, 0], [1, 1], [0, 1]];
  points.forEach(({ x, y }, i) => {
    const divisor = m[2] * x + m[5] * y + m[8];
    const u = (m[0] * x + m[3] * y + m[6]) / divisor;
    const v = (m[1] * x + m[4] * y + m[7]) / divisor;
    assert.ok(Math.abs(u - targets[i][0]) < 1e-6);
    assert.ok(Math.abs(v - targets[i][1]) < 1e-6);
  });
});
test("crossing or degenerate corners are rejected", () => {
  assert.equal(isConvex([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), true);
  assert.equal(isConvex([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]), false);
  assert.throws(() => inverseHomography(Array(4).fill({ x: 0, y: 0 })), /too close/);
});
test("automatic iPhone radius follows screenshot resolution and orientation", () => {
  assert.equal(iphoneRadius(390, 844), 48);
  assert.equal(iphoneRadius(1170, 2532), 144);
  assert.equal(iphoneRadius(2532, 1170), 144);
});
test("initial placement preserves aspect ratio for portrait and landscape images", () => {
  for (const [mw, mh, sw, sh] of [[1600, 1200, 390, 844], [800, 1400, 2400, 900], [2000, 500, 300, 1800]]) {
    const points = initialCorners({ width: mw, height: mh }, { width: sw, height: sh });
    assert.ok(isConvex(points));
    assert.ok(points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
    const width = (points[1].x - points[0].x) * mw;
    const height = (points[3].y - points[0].y) * mh;
    assert.ok(Math.abs(width / height - sw / sh) < 1e-9);
  }
});
