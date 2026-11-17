export function iphoneRadius(width, height) {
  return Math.round(Math.min(width, height) * 0.123);
}

export function isConvex(points) {
  return points.every((point, index) => {
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    return (b.x - point.x) * (c.y - b.y) - (b.y - point.y) * (c.x - b.x) > 0.00001;
  });
}

// Solve the inverse homography, mapping canvas coordinates into texture space.
export function inverseHomography(points) {
  const targets = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = points.flatMap(({ x, y }, i) => {
    const [u, v] = targets[i];
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-12) throw new Error("The corners are too close together. Spread them out and try again.");
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let k = col; k < 9; k++) matrix[col][k] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let k = col; k < 9; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  const [a, b, c, d, e, f, g, h] = matrix.map(row => row[8]);
  return new Float32Array([a, d, g, b, e, h, c, f, 1]);
}

export function initialCorners(mockup, screenshot) {
  const height = Math.min(0.75, 0.65 * mockup.width / mockup.height * screenshot.height / screenshot.width);
  const width = height * mockup.height / mockup.width * screenshot.width / screenshot.height;
  return [
    { x: (1 - width) / 2, y: (1 - height) / 2 },
    { x: (1 + width) / 2, y: (1 - height) / 2 },
    { x: (1 + width) / 2, y: (1 + height) / 2 },
    { x: (1 - width) / 2, y: (1 + height) / 2 },
  ];
}
