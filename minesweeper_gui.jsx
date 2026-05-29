import React, { useState, useCallback, useEffect, useRef } from "react";

// ─── Solver Engine ───────────────────────────────────────────────────
const UNKNOWN = "?";
const FLAG = "F";
const EMPTY = ".";

function neighbors(r, c, rows, cols) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push([nr, nc]);
    }
  }
  return result;
}

function getConstraints(board, rows, cols) {
  const constraints = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (typeof cell !== "number" || cell === 0) continue;
      const nbrs = neighbors(r, c, rows, cols);
      let flags = 0;
      const unknowns = new Set();
      for (const [nr, nc] of nbrs) {
        if (board[nr][nc] === FLAG) flags++;
        else if (board[nr][nc] === UNKNOWN) unknowns.add(`${nr},${nc}`);
      }
      const remaining = cell - flags;
      if (unknowns.size > 0) {
        constraints.push({ remaining, unknowns, source: [r, c] });
      }
    }
  }
  return constraints;
}

function deterministicStep(board, rows, cols) {
  const constraints = getConstraints(board, rows, cols);
  const newFlags = new Set();
  const newSafe = new Set();

  for (const { remaining, unknowns } of constraints) {
    if (remaining === unknowns.size) {
      for (const k of unknowns) newFlags.add(k);
    } else if (remaining === 0) {
      for (const k of unknowns) newSafe.add(k);
    }
  }

  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = constraints[i], b = constraints[j];
      let aSubB = true;
      for (const k of a.unknowns) if (!b.unknowns.has(k)) { aSubB = false; break; }
      if (aSubB && a.unknowns.size < b.unknowns.size) {
        const diff = new Set([...b.unknowns].filter(x => !a.unknowns.has(x)));
        const diffMines = b.remaining - a.remaining;
        if (diffMines === diff.size) for (const k of diff) newFlags.add(k);
        else if (diffMines === 0) for (const k of diff) newSafe.add(k);
      }
      let bSubA = true;
      for (const k of b.unknowns) if (!a.unknowns.has(k)) { bSubA = false; break; }
      if (bSubA && b.unknowns.size < a.unknowns.size) {
        const diff = new Set([...a.unknowns].filter(x => !b.unknowns.has(x)));
        const diffMines = a.remaining - b.remaining;
        if (diffMines === diff.size) for (const k of diff) newFlags.add(k);
        else if (diffMines === 0) for (const k of diff) newSafe.add(k);
      }
    }
  }

  return { newFlags, newSafe };
}

function solveDeterministic(boardIn, rows, cols) {
  const board = boardIn.map(r => [...r]);
  const allFlags = new Set();
  const allSafe = new Set();
  let iterations = 0;

  while (iterations < 100) {
    iterations++;
    const { newFlags, newSafe } = deterministicStep(board, rows, cols);
    let progress = false;

    for (const k of newFlags) {
      if (allFlags.has(k)) continue;
      const [r, c] = k.split(",").map(Number);
      board[r][c] = FLAG;
      allFlags.add(k);
      progress = true;
    }
    for (const k of newSafe) {
      if (allSafe.has(k) || allFlags.has(k)) continue;
      const [r, c] = k.split(",").map(Number);
      board[r][c] = 0;
      allSafe.add(k);
      progress = true;
    }
    if (!progress) break;
  }
  return { board, allFlags, allSafe };
}

function getFrontierGroups(board, rows, cols) {
  const constraints = getConstraints(board, rows, cols);
  const frontier = new Set();
  for (const { unknowns } of constraints) for (const k of unknowns) frontier.add(k);

  const cellToConstraints = {};
  constraints.forEach((c, idx) => {
    for (const k of c.unknowns) {
      if (!cellToConstraints[k]) cellToConstraints[k] = [];
      cellToConstraints[k].push(idx);
    }
  });

  const visited = new Set();
  const groups = [];
  for (const cell of frontier) {
    if (visited.has(cell)) continue;
    const group = new Set();
    const queue = [cell];
    while (queue.length) {
      const current = queue.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      group.add(current);
      for (const cidx of cellToConstraints[current] || []) {
        for (const nc of constraints[cidx].unknowns) {
          if (!visited.has(nc)) queue.push(nc);
        }
      }
    }
    groups.push(group);
  }
  return { groups, frontier, constraints };
}

function enumerateGroup(board, group, constraints, rows, cols) {
  const relevant = constraints.filter(c => {
    for (const k of c.unknowns) if (group.has(k)) return true;
    return false;
  }).map(c => ({ remaining: c.remaining, unknowns: [...c.unknowns].filter(k => group.has(k)) }));

  const cells = [...group].sort();
  const n = cells.length;
  if (n > 22) return null;

  const validConfigs = [];
  for (let bits = 0; bits < 2 ** n; bits++) {
    let valid = true;
    for (const { remaining, unknowns } of relevant) {
      let mineCount = 0;
      for (const k of unknowns) {
        const idx = cells.indexOf(k);
        if (idx >= 0 && (bits & (1 << idx))) mineCount++;
      }
      if (mineCount !== remaining) { valid = false; break; }
    }
    if (valid) validConfigs.push(bits);
  }
  return { cells, configs: validConfigs };
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
  return result;
}

function computeProbabilities(board, rows, cols, totalMinesRemaining = null) {
  const { groups, frontier, constraints } = getFrontierGroups(board, rows, cols);
  const probabilities = {};

  let existingFlags = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (board[r][c] === FLAG) existingFlags++;

  const allUnknowns = new Set();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (board[r][c] === UNKNOWN) allUnknowns.add(`${r},${c}`);

  const nonFrontier = new Set([...allUnknowns].filter(k => !frontier.has(k)));

  for (const group of groups) {
    const result = enumerateGroup(board, group, constraints, rows, cols);
    if (!result) {
      for (const k of group) {
        const rel = constraints.filter(c => c.unknowns.has(k));
        if (rel.length) {
          const avg = rel.reduce((s, c) => s + c.remaining / c.unknowns.size, 0) / rel.length;
          probabilities[k] = Math.min(1, Math.max(0, avg));
        } else {
          probabilities[k] = 0.5;
        }
      }
      continue;
    }

    const { cells, configs } = result;
    if (configs.length === 0) {
      for (const k of group) probabilities[k] = 0.5;
      continue;
    }

    if (totalMinesRemaining !== null && nonFrontier.size > 0) {
      const configMines = configs.map(bits => {
        let count = 0;
        for (let i = 0; i < cells.length; i++) if (bits & (1 << i)) count++;
        return count;
      });
      const minesLeft = totalMinesRemaining - existingFlags;
      const weights = configMines.map(m => {
        const inNF = minesLeft - m;
        if (inNF < 0 || inNF > nonFrontier.size) return 0;
        return comb(nonFrontier.size, inNF);
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      if (totalWeight > 0) {
        for (let ci = 0; ci < cells.length; ci++) {
          let mineWeight = 0;
          for (let i = 0; i < configs.length; i++) {
            if (configs[i] & (1 << ci)) mineWeight += weights[i];
          }
          probabilities[cells[ci]] = mineWeight / totalWeight;
        }
        continue;
      }
    }

    for (let ci = 0; ci < cells.length; ci++) {
      let mineCount = 0;
      for (const bits of configs) if (bits & (1 << ci)) mineCount++;
      probabilities[cells[ci]] = mineCount / configs.length;
    }
  }

  if (totalMinesRemaining !== null) {
    const minesLeft = totalMinesRemaining - existingFlags;
    let frontierExpectedMines = 0;
    for (const k of frontier) frontierExpectedMines += (probabilities[k] || 0.5);
    const nfMines = Math.max(0, minesLeft - frontierExpectedMines);
    const nfProb = nonFrontier.size > 0 ? nfMines / nonFrontier.size : 0;
    for (const k of nonFrontier) probabilities[k] = Math.min(1, Math.max(0, nfProb));
  } else {
    for (const k of nonFrontier) probabilities[k] = 0.5;
  }

  return probabilities;
}

function fullSolve(boardIn, rows, cols, totalMines) {
  const { board, allFlags, allSafe } = solveDeterministic(boardIn, rows, cols);
  const probabilities = computeProbabilities(board, rows, cols, totalMines);
  return { board, allFlags, allSafe, probabilities };
}


// ─── Image Scanner Engine ────────────────────────────────────────────

function analyzeCell(imageData, x, y, cellW, cellH) {
  const { data, width } = imageData;

  // Sample a region in the center of the cell (inner 60%)
  const margin = 0.2;
  const sx = Math.floor(x + cellW * margin);
  const sy = Math.floor(y + cellH * margin);
  const ex = Math.floor(x + cellW * (1 - margin));
  const ey = Math.floor(y + cellH * (1 - margin));

  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  let minBright = 999, maxBright = 0;

  // Also sample specific spots for better classification
  const centerX = Math.floor(x + cellW / 2);
  const centerY = Math.floor(y + cellH / 2);

  // Full center sample
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < ex; px++) {
      const idx = (py * width + px) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      totalR += r; totalG += g; totalB += b;
      const bright = (r + g + b) / 3;
      if (bright < minBright) minBright = bright;
      if (bright > maxBright) maxBright = bright;
      count++;
    }
  }

  if (count === 0) return { type: EMPTY };

  const avgR = totalR / count;
  const avgG = totalG / count;
  const avgB = totalB / count;
  const avgBright = (avgR + avgG + avgB) / 3;
  const brightRange = maxBright - minBright;

  // Detect the number color by sampling just the very center (text area)
  const textMargin = 0.3;
  const tsx = Math.floor(x + cellW * textMargin);
  const tsy = Math.floor(y + cellH * textMargin);
  const tex = Math.floor(x + cellW * (1 - textMargin));
  const tey = Math.floor(y + cellH * (1 - textMargin));

  let tR = 0, tG = 0, tB = 0, tCount = 0;
  let darkPixels = 0, colorPixels = 0;
  let maxColorR = 0, maxColorG = 0, maxColorB = 0;
  // Saturation-weighted sums for the colour mean. High-sat glyph-core
  // pixels dominate; mid-sat anti-alias edge pixels (which blend with
  // the bluish background and would otherwise tip red 3s into pink 4s)
  // contribute very little.
  let wColorR = 0, wColorG = 0, wColorB = 0, wColorSum = 0;
  let hasRed = 0, hasGreen = 0, hasBlue = 0, hasPurple = 0;

  for (let py = tsy; py < tey; py++) {
    for (let px = tsx; px < tex; px++) {
      const idx = (py * width + px) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      tR += r; tG += g; tB += b; tCount++;

      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat > 40) {
        colorPixels++;
        maxColorR += r; maxColorG += g; maxColorB += b;

        // Squared margin above the noise floor → strongly weights pure
        // glyph pixels over fringe ones.
        const w = (sat - 40) * (sat - 40);
        wColorR += r * w; wColorG += g * w; wColorB += b * w;
        wColorSum += w;

        // Classify color of this pixel (kept for the flag check)
        if (r > 150 && g < 100 && b < 100) hasRed++;
        if (g > 100 && r < 100 && b < 100) hasGreen++;
        if (b > 150 && r < 100 && g < 100) hasBlue++;
        if (b > 100 && r > 80 && g < 80) hasPurple++;
        if (r > 120 && g > 80 && b < 60) hasRed++; // orange-red for 5
      }
      if (r + g + b < 200) darkPixels++;
    }
  }

  if (tCount === 0) return { type: EMPTY };

  const textAvgR = tR / tCount;
  const textAvgG = tG / tCount;
  const textAvgB = tB / tCount;
  const colorRatio = colorPixels / tCount;
  const darkRatio = darkPixels / tCount;

  // Saturation-weighted mean of the saturated pixels. This is the signal
  // used to discriminate red (low B) from magenta (high B).
  const colAvgR = wColorSum > 0 ? wColorR / wColorSum
    : (colorPixels > 0 ? maxColorR / colorPixels : 0);
  const colAvgG = wColorSum > 0 ? wColorG / wColorSum
    : (colorPixels > 0 ? maxColorG / colorPixels : 0);
  const colAvgB = wColorSum > 0 ? wColorB / wColorSum
    : (colorPixels > 0 ? maxColorB / colorPixels : 0);

  // Sample the four cell corners to detect a 3D raised border: covered
  // tiles are brighter at the top-left and darker at the bottom-right.
  // Revealed tiles are flat. This is theme-independent and discriminates
  // covered vs revealed much more reliably than absolute brightness.
  const cornerInset = Math.max(2, Math.floor(Math.min(cellW, cellH) * 0.08));
  const cornerSize = Math.max(2, Math.floor(Math.min(cellW, cellH) * 0.18));
  const sampleCornerBright = (cx, cy) => {
    let sum = 0, n = 0;
    const xEnd = cx + cornerSize, yEnd = cy + cornerSize;
    for (let py = cy; py < yEnd; py++) {
      for (let px = cx; px < xEnd; px++) {
        const idx = (py * width + px) * 4;
        sum += data[idx] + data[idx + 1] + data[idx + 2];
        n++;
      }
    }
    return n ? sum / (3 * n) : 0;
  };
  const tlBright = sampleCornerBright(Math.floor(x + cornerInset), Math.floor(y + cornerInset));
  const trBright = sampleCornerBright(Math.floor(x + cellW - cornerInset - cornerSize), Math.floor(y + cornerInset));
  const blBright = sampleCornerBright(Math.floor(x + cornerInset), Math.floor(y + cellH - cornerInset - cornerSize));
  const brBright = sampleCornerBright(Math.floor(x + cellW - cornerInset - cornerSize), Math.floor(y + cellH - cornerInset - cornerSize));
  // Positive = top-left brighter than bottom-right (raised look)
  const raisedScore = (tlBright + trBright) / 2 - (blBright + brBright) / 2
                    + (tlBright - brBright) * 0.5;

  return {
    type: "raw",
    avgR, avgG, avgB, avgBright, brightRange,
    textAvgR, textAvgG, textAvgB,
    colAvgR, colAvgG, colAvgB,
    colorRatio, darkRatio,
    hasRed, hasGreen, hasBlue, hasPurple,
    colorPixels, darkPixels, tCount,
    raisedScore, tlBright, brBright
  };
}

function classifyCell(raw) {
  if (raw.type !== "raw") return raw.type;

  const { avgBright, brightRange, colorRatio, darkRatio,
    hasRed, hasGreen, hasBlue, hasPurple, colorPixels, tCount, darkPixels,
    textAvgR, textAvgG, textAvgB, avgR, avgG, avgB,
    colAvgR, colAvgG, colAvgB,
    raisedScore } = raw;

  const avgSat = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB);

  // Flag: strong red on a (covered) background. Check before number-3 so
  // a red flag glyph isn't misread as the red "3" number.
  if (hasRed > tCount * 0.08 && colorRatio > 0.05) {
    const redDominance = hasRed / Math.max(1, hasGreen + hasBlue + hasPurple);
    if (redDominance > 2 && hasGreen < hasRed * 0.3) return FLAG;
  }

  // Number detection by averaging the colour of all saturated text pixels.
  // This is more robust than per-pixel bucket counts because anti-aliased
  // edge pixels of a pink "4" can otherwise tip into the red bucket and
  // outvote the real pink core. The decisive feature for 3 vs 4 is the
  // blue level: red sits around B/R ≈ 0.3, magenta around B/R ≈ 0.9.
  if (colorPixels > 3) {
    const cr = colAvgR, cg = colAvgG, cb = colAvgB;
    const mx = Math.max(cr, cg, cb);
    // Blue glyph: 1
    if (cb === mx && cb - cr > 25 && cb - cg > 25) return 1;
    // Green glyph: 2
    if (cg === mx && cg - cr > 15 && cg - cb > 15) return 2;
    // Orange glyph: 5 (R high, G mid, B low). Check before red so red doesn't catch it.
    if (cr > 140 && cg > 90 && cg < cr * 0.8 && cb < 90) return 5;
    // Red-dominant family: split red(3) vs magenta(4) by blue level.
    if (cr > 120 && cg < cr * 0.7) {
      return cb > cr * 0.55 ? 4 : 3;
    }
  }

  // Subtle text colors via the text-region average (fallback for thin glyphs
  // where colorPixels is low). Use the same B/R logic for 3 vs 4.
  const textSat = Math.max(textAvgR, textAvgG, textAvgB) - Math.min(textAvgR, textAvgG, textAvgB);
  if (textSat > 15 && colorRatio > 0.02) {
    if (textAvgB > textAvgR + 20 && textAvgB > textAvgG + 20) return 1;
    if (textAvgG > textAvgR + 15 && textAvgG > textAvgB + 15) return 2;
    if (textAvgR > 130 && textAvgG > 90 && textAvgG < textAvgR * 0.85 && textAvgB < 100) return 5;
    if (textAvgR > textAvgG + 10) {
      return textAvgB > textAvgR * 0.7 ? 4 : 3;
    }
  }

  // Dark glyph on a bright cell = 7 (or 8 — same color in most themes).
  if (darkRatio > 0.15 && avgBright > 150) return 7;

  // Primary covered-vs-revealed discriminator: 3D border. Covered tiles have
  // a noticeable highlight on the top-left edge and shadow on the bottom-right.
  // Revealed cells are flat. raisedScore > ~8 is a confident raised tile.
  if (raisedScore > 8) return UNKNOWN;

  // Conservative fallbacks for themes where the gradient is faint.
  if (avgSat < 30 && avgBright > 60 && avgBright < 200 && brightRange > 25) return UNKNOWN;

  return EMPTY;
}

// Estimate the grid dimensions (rows × cols) inside a rectangle by
// detecting the dominant brightness period along each axis. Works on
// any theme that has a repeating cell pattern (lines or 3D borders).
function detectGridSize(canvas, gridRect, fallbackRows, fallbackCols) {
  const ctx = canvas.getContext("2d");
  const x0 = Math.max(0, Math.floor(gridRect.x));
  const y0 = Math.max(0, Math.floor(gridRect.y));
  const w = Math.min(canvas.width - x0, Math.floor(gridRect.w));
  const h = Math.min(canvas.height - y0, Math.floor(gridRect.h));
  if (w < 16 || h < 16) return { rows: fallbackRows, cols: fallbackCols };

  const imageData = ctx.getImageData(x0, y0, w, h);
  const { data } = imageData;

  // Per-column and per-row mean brightness profiles.
  const colP = new Float32Array(w);
  const rowP = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const b = data[idx] + data[idx + 1] + data[idx + 2];
      colP[x] += b;
      rowSum += b;
    }
    rowP[y] = rowSum / (3 * w);
  }
  for (let x = 0; x < w; x++) colP[x] /= (3 * h);

  // Mean-centred autocorrelation. The true cell pitch shows up as the
  // first significant local maximum after lag 0.
  const findPeriod = (profile, minP, maxP) => {
    const n = profile.length;
    if (maxP <= minP + 2 || n < 32) return null;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += profile[i];
    mean /= n;
    const centered = new Float32Array(n);
    for (let i = 0; i < n; i++) centered[i] = profile[i] - mean;

    const len = maxP + 2;
    const A = new Float32Array(len);
    for (let p = 0; p < len; p++) {
      const pairs = n - p;
      if (pairs <= 0) { A[p] = 0; continue; }
      let s = 0;
      for (let i = 0; i < pairs; i++) s += centered[i] * centered[i + p];
      A[p] = s / pairs;
    }
    if (A[0] <= 0) return null;
    const threshold = A[0] * 0.2;

    let firstPeak = null;
    for (let p = minP; p <= maxP; p++) {
      if (A[p] > A[p - 1] && A[p] > A[p + 1] && A[p] >= threshold) {
        firstPeak = p;
        break;
      }
    }
    return firstPeak;
  };

  const colPeriod = findPeriod(colP, 8, Math.max(9, Math.floor(w / 3)));
  const rowPeriod = findPeriod(rowP, 8, Math.max(9, Math.floor(h / 3)));

  const cols = colPeriod ? Math.max(1, Math.round(w / colPeriod)) : fallbackCols;
  const rows = rowPeriod ? Math.max(1, Math.round(h / rowPeriod)) : fallbackRows;
  if (typeof window !== "undefined" && window.console) {
    // eslint-disable-next-line no-console
    console.log("[grid-detect]", { rectW: w, rectH: h, colPeriod, rowPeriod, cols, rows });
  }
  return { cols, rows };
}

function scanImage(canvas, gridRect, gridRows, gridCols) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const cellW = gridRect.w / gridCols;
  const cellH = gridRect.h / gridRows;

  const board = [];
  const rawData = [];

  for (let r = 0; r < gridRows; r++) {
    const row = [];
    const rawRow = [];
    for (let c = 0; c < gridCols; c++) {
      const cx = gridRect.x + c * cellW;
      const cy = gridRect.y + r * cellH;
      const raw = analyzeCell(imageData, cx, cy, cellW, cellH);
      const classified = classifyCell(raw);
      row.push(classified);
      rawRow.push(raw);
    }
    board.push(row);
    rawData.push(rawRow);
  }

  return { board, rawData };
}


// ─── React GUI ───────────────────────────────────────────────────────

const CELL_STATES = [EMPTY, UNKNOWN, FLAG, 1, 2, 3, 4, 5, 6, 7, 8];
const CELL_COLORS = {
  1: "#5b9bd5", 2: "#6ab04c", 3: "#eb4d4b", 4: "#8e44ad",
  5: "#e67e22", 6: "#00acc1", 7: "#555", 8: "#999"
};
const MODE_LABELS = {
  [EMPTY]: "Empty", [UNKNOWN]: "Unknown", [FLAG]: "Flag",
  1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8"
};

// ─── Scanner Modal ───────────────────────────────────────────────────

function ScannerModal({ image, gridRows, gridCols, onApply, onClose }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [dragging, setDragging] = useState(null); // null | "start" | "end" | "move"
  const [dragStart, setDragStart] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scale, setScale] = useState(1);

  // Draw image on canvas
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const maxW = window.innerWidth * 0.75;
    const maxH = window.innerHeight * 0.7;
    const s = Math.min(1, maxW / image.width, maxH / image.height);
    setScale(s);
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    // Auto-detect: set initial rect to ~90% of image
    const pad = 0.05;
    setRect({
      x: Math.round(image.width * pad),
      y: Math.round(image.height * pad),
      w: Math.round(image.width * (1 - 2 * pad)),
      h: Math.round(image.height * (1 - 2 * pad))
    });
  }, [image]);

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const br = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - br.left) / scale),
      y: Math.round((e.clientY - br.top) / scale)
    };
  }, [scale]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const pos = getPos(e);
    if (!rect) {
      setDragging("draw");
      setDragStart(pos);
      setRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }

    // Check if near corners
    const corners = [
      { name: "tl", x: rect.x, y: rect.y },
      { name: "tr", x: rect.x + rect.w, y: rect.y },
      { name: "bl", x: rect.x, y: rect.y + rect.h },
      { name: "br", x: rect.x + rect.w, y: rect.y + rect.h },
    ];
    const threshold = 15 / scale;
    for (const c of corners) {
      if (Math.abs(pos.x - c.x) < threshold && Math.abs(pos.y - c.y) < threshold) {
        setDragging(c.name);
        setDragStart(pos);
        return;
      }
    }

    // Inside rect = move
    if (pos.x > rect.x && pos.x < rect.x + rect.w && pos.y > rect.y && pos.y < rect.y + rect.h) {
      setDragging("move");
      setDragStart(pos);
    } else {
      // Outside = draw new
      setDragging("draw");
      setDragStart(pos);
      setRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    }
  }, [rect, getPos, scale]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging || !dragStart || !rect) return;
    const pos = getPos(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    if (dragging === "draw") {
      setRect(prev => ({ ...prev, w: pos.x - prev.x, h: pos.y - prev.y }));
    } else if (dragging === "move") {
      setRect(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      setDragStart(pos);
    } else if (dragging === "br") {
      setRect(prev => ({ ...prev, w: prev.w + dx, h: prev.h + dy }));
      setDragStart(pos);
    } else if (dragging === "tl") {
      setRect(prev => ({ x: prev.x + dx, y: prev.y + dy, w: prev.w - dx, h: prev.h - dy }));
      setDragStart(pos);
    } else if (dragging === "tr") {
      setRect(prev => ({ ...prev, y: prev.y + dy, w: prev.w + dx, h: prev.h - dy }));
      setDragStart(pos);
    } else if (dragging === "bl") {
      setRect(prev => ({ ...prev, x: prev.x + dx, w: prev.w - dx, h: prev.h + dy }));
      setDragStart(pos);
    }
  }, [dragging, dragStart, rect, getPos]);

  const handleMouseUp = useCallback(() => {
    // Only invalidate the preview when a drag actually changed the rect,
    // not on any mouseup inside the modal (which would nuke the preview
    // when clicking the Apply button).
    if (dragging) setPreview(null);
    setDragging(null);
    setDragStart(null);
  }, [dragging]);

  const runDetection = useCallback(() => {
    if (!rect || !canvasRef.current) return;
    const normalized = {
      x: Math.min(rect.x, rect.x + rect.w),
      y: Math.min(rect.y, rect.y + rect.h),
      w: Math.abs(rect.w),
      h: Math.abs(rect.h)
    };
    const detected = detectGridSize(canvasRef.current, normalized, gridRows, gridCols);
    const useRows = Math.max(1, Math.min(100, detected.rows));
    const useCols = Math.max(1, Math.min(100, detected.cols));
    const result = scanImage(canvasRef.current, normalized, useRows, useCols);
    setPreview({ ...result, rows: useRows, cols: useCols });
  }, [rect, gridRows, gridCols]);

  const applyDetection = useCallback(() => {
    if (preview) onApply(preview.board);
  }, [preview, onApply]);

  const normalRect = rect ? {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h)
  } : null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center"
      onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>

      {/* Header */}
      <div className="bg-gray-900 w-full p-3 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold text-blue-400">Screenshot Scanner</span>
          <span className="text-xs text-gray-400">
            Drag the rectangle to cover exactly the game grid. Then click Detect.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runDetection}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1.5 px-4 rounded text-sm">
            Detect
          </button>
          {preview && (
            <button onClick={applyDetection}
              className="bg-green-600 hover:bg-green-500 text-white font-bold py-1.5 px-4 rounded text-sm">
              Apply to Board
            </button>
          )}
          <button onClick={onClose}
            className="bg-gray-700 hover:bg-gray-600 text-gray-200 py-1.5 px-3 rounded text-sm">
            Cancel
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto flex gap-4 p-4">
        {/* Image with overlay */}
        <div className="relative flex-shrink-0" style={{ cursor: "crosshair" }}>
          <canvas ref={canvasRef}
            style={{ width: image ? image.width * scale : 0, height: image ? image.height * scale : 0 }}
            onMouseDown={handleMouseDown}
          />

          {/* Grid overlay */}
          {normalRect && (
            <div style={{
              position: "absolute",
              left: normalRect.x * scale, top: normalRect.y * scale,
              width: normalRect.w * scale, height: normalRect.h * scale,
              border: "2px solid #3b82f6",
              background: "rgba(59,130,246,0.1)",
              pointerEvents: "none"
            }}>
              {/* Grid lines (reflect detected dims after Detect) */}
              {(() => {
                const oc = preview?.cols ?? gridCols;
                const orw = preview?.rows ?? gridRows;
                return (
                  <>
                    {Array.from({ length: oc - 1 }, (_, i) => (
                      <div key={`v${i}`} style={{
                        position: "absolute",
                        left: `${((i + 1) / oc) * 100}%`, top: 0,
                        width: "1px", height: "100%",
                        background: "rgba(59,130,246,0.35)"
                      }} />
                    ))}
                    {Array.from({ length: orw - 1 }, (_, i) => (
                      <div key={`h${i}`} style={{
                        position: "absolute",
                        top: `${((i + 1) / orw) * 100}%`, left: 0,
                        height: "1px", width: "100%",
                        background: "rgba(59,130,246,0.35)"
                      }} />
                    ))}
                  </>
                );
              })()}

              {/* Corner handles */}
              {[
                { left: -5, top: -5 }, { right: -5, top: -5 },
                { left: -5, bottom: -5 }, { right: -5, bottom: -5 }
              ].map((pos, i) => (
                <div key={i} style={{
                  position: "absolute", ...pos,
                  width: 10, height: 10,
                  background: "#3b82f6", borderRadius: "50%",
                  pointerEvents: "none"
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Detection preview */}
        {preview && (
          <div className="flex-shrink-0 bg-gray-900 rounded border border-gray-700 p-3 overflow-auto"
            style={{ maxHeight: "70vh" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-400 uppercase">Detection Preview</div>
              <div className="text-xs text-blue-300">
                Detected: <span className="font-mono">{preview.rows ?? gridRows} × {preview.cols ?? gridCols}</span>
              </div>
            </div>
            <div style={{
              display: "inline-grid",
              gridTemplateColumns: `repeat(${preview.cols ?? gridCols}, 20px)`,
              gap: "1px"
            }}>
              {preview.board.map((row, r) =>
                row.map((cell, c) => {
                  let bg, fg, text;
                  if (cell === EMPTY) { bg = "#1a1a2e"; fg = "#555"; text = ""; }
                  else if (cell === UNKNOWN) { bg = "#4a4a5a"; fg = "#ccc"; text = "?"; }
                  else if (cell === FLAG) { bg = "#5c1a1a"; fg = "#ff6b6b"; text = "F"; }
                  else { bg = "#2a2a3e"; fg = CELL_COLORS[cell] || "#fff"; text = String(cell); }

                  return (
                    <div key={`${r}-${c}`} style={{
                      width: 20, height: 20, background: bg, color: fg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", fontWeight: "bold", borderRadius: "1px",
                      border: "1px solid #333"
                    }}>
                      {text}
                    </div>
                  );
                })
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Review the detection above. If it looks correct, click "Apply to Board".
              You can manually correct errors after applying.
            </div>
          </div>
        )}
      </div>

      {/* Tips bar */}
      <div className="bg-gray-900 w-full p-2 border-t border-gray-700 text-xs text-gray-500 text-center">
        Drag corners to resize | Drag inside to move | Click outside to draw new selection |
        Grid: {preview?.rows ?? gridRows} rows x {preview?.cols ?? gridCols} cols
        {preview && <span className="text-blue-400"> (auto-detected)</span>}
      </div>
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────────────

const makeEmptyBoard = (r, c) =>
  Array.from({ length: r }, () => Array(c).fill(EMPTY));

export default function MinesweeperSolver() {
  const [rows, setRows] = useState(28);
  const [cols, setCols] = useState(16);
  const [totalMines, setTotalMines] = useState(75);
  const [board, setBoard] = useState(() => makeEmptyBoard(28, 16));
  const [paintMode, setPaintMode] = useState(UNKNOWN);
  const [results, setResults] = useState(null);
  const [isPainting, setIsPainting] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [scannerImage, setScannerImage] = useState(null);
  const boardRef = useRef(null);

  const resizeRows = useCallback((newRows) => {
    setRows(newRows);
    setBoard(prev => {
      const cs = prev[0]?.length ?? cols;
      return makeEmptyBoard(newRows, cs);
    });
    setResults(null);
  }, [cols]);

  const resizeCols = useCallback((newCols) => {
    setCols(newCols);
    setBoard(prev => makeEmptyBoard(prev.length, newCols));
    setResults(null);
  }, []);

  // Paste handler for screenshots
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          const img = new Image();
          img.onload = () => setScannerImage(img);
          img.src = URL.createObjectURL(blob);
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);

  const setCell = useCallback((r, c, value) => {
    setBoard(prev => {
      if (!prev || r >= prev.length || c >= prev[0].length) return prev;
      const next = prev.map(row => [...row]);
      next[r][c] = value;
      return next;
    });
    setResults(null);
  }, []);

  const handleMouseDown = useCallback((r, c, e) => {
    e.preventDefault();
    if (e.button === 2) {
      const current = board[r][c];
      const idx = CELL_STATES.indexOf(current);
      const next = CELL_STATES[(idx + 1) % CELL_STATES.length];
      setCell(r, c, next);
    } else {
      setIsPainting(true);
      setCell(r, c, paintMode);
    }
  }, [board, paintMode, setCell]);

  const handleMouseEnter = useCallback((r, c) => {
    if (isPainting) setCell(r, c, paintMode);
  }, [isPainting, paintMode, setCell]);

  const handleMouseUp = useCallback(() => setIsPainting(false), []);

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  const solve = useCallback(() => {
    if (!board) return;
    const t0 = performance.now();
    const result = fullSolve(board, rows, cols, totalMines);
    const elapsed = performance.now() - t0;
    setResults({ ...result, elapsed });
  }, [board, rows, cols, totalMines]);

  const clearBoard = useCallback(() => {
    setBoard(makeEmptyBoard(rows, cols));
    setResults(null);
  }, [rows, cols]);

  const handleScanApply = useCallback((scannedBoard) => {
    const newRows = scannedBoard.length;
    const newCols = scannedBoard[0]?.length || 0;
    setRows(newRows);
    setCols(newCols);
    setBoard(scannedBoard);
    setResults(null);
    setScannerImage(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || scannerImage) return;
      const key = e.key;
      if (key === "q" || key === ".") setPaintMode(EMPTY);
      else if (key === "?" || key === "u") setPaintMode(UNKNOWN);
      else if (key === "f") setPaintMode(FLAG);
      else if (key >= "1" && key <= "8") setPaintMode(parseInt(key));
      else if (key === "Enter" || key === "s") solve();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [solve, scannerImage]);

  if (!board) return <div className="p-8 text-white">Loading...</div>;

  const cellSize = Math.max(12, Math.min(28, Math.floor(zoom * 0.22)));
  const fontSize = Math.max(8, cellSize - 6);

  const unknownCount = board.flat().filter(c => c === UNKNOWN).length;
  const flagCount = board.flat().filter(c => c === FLAG).length;
  const minesRemaining = totalMines - flagCount;

  let recommendations = [];
  if (results?.probabilities) {
    recommendations = Object.entries(results.probabilities)
      .map(([k, p]) => ({ key: k, r: +k.split(",")[0], c: +k.split(",")[1], prob: p }))
      .sort((a, b) => a.prob - b.prob);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 select-none" onContextMenu={e => e.preventDefault()}>

      {/* Scanner Modal */}
      {scannerImage && (
        <ScannerModal
          image={scannerImage}
          gridRows={rows}
          gridCols={cols}
          onApply={handleScanApply}
          onClose={() => setScannerImage(null)}
        />
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 p-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-blue-400">Minesweeper Solver</span>
            <span className="text-xs text-gray-500">{rows}x{cols} | {totalMines} mines</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-400">Rows:</label>
            <input type="number" value={rows} min={1} max={100}
              onChange={e => resizeRows(Math.max(1, Math.min(100, +e.target.value)))}
              className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-center" />
            <label className="text-xs text-gray-400">Cols:</label>
            <input type="number" value={cols} min={1} max={100}
              onChange={e => resizeCols(Math.max(1, Math.min(100, +e.target.value)))}
              className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-center" />
            <label className="text-xs text-gray-400">Mines:</label>
            <input type="number" value={totalMines} min={0} max={rows * cols}
              onChange={e => setTotalMines(+e.target.value)}
              className="w-16 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-center" />
            <span className="text-gray-700 mx-1">|</span>
            <label className="text-xs text-gray-400">Zoom:</label>
            <input type="range" min={50} max={200} value={zoom}
              onChange={e => setZoom(+e.target.value)} className="w-20" />
            <span className="text-xs text-gray-500">{zoom}%</span>
            <span className="text-gray-700 mx-1">|</span>
            <button onClick={() => document.dispatchEvent(new Event("trigger-paste-hint"))}
              className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs py-1 px-3 rounded font-semibold">
              Ctrl+V Screenshot
            </button>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-700 p-3 flex flex-col gap-3"
          style={{ maxHeight: "calc(100vh - 52px)", overflowY: "auto" }}>
          {/* Paint tools */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">Paint Tool</div>
            <div className="flex flex-wrap gap-1">
              {CELL_STATES.map(state => (
                <button key={String(state)}
                  onClick={() => setPaintMode(state)}
                  title={MODE_LABELS[state]}
                  className={`flex items-center justify-center rounded transition-all ${paintMode === state ? "ring-2 ring-blue-400" : ""
                    }`}
                  style={{
                    width: 32, height: 32,
                    background: state === EMPTY ? "#1a1a2e" : state === UNKNOWN ? "#4a4a5a" : state === FLAG ? "#7f1d1d" : "#2a2a3e",
                    color: typeof state === "number" ? CELL_COLORS[state] : "#fff",
                    fontSize: "13px", fontWeight: "bold",
                    border: `2px solid ${paintMode === state ? "#60a5fa" : "#444"}`
                  }}>
                  {state === EMPTY ? "." : state === UNKNOWN ? "?" : state === FLAG ? "F" : state}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Selected: <span className="text-gray-300">{MODE_LABELS[paintMode]}</span>
            </div>
          </div>

          {/* Shortcuts */}
          <div className="text-xs text-gray-500 border-t border-gray-700 pt-2">
            <div className="font-semibold text-gray-400 mb-1">Shortcuts</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <div>1-8: numbers</div>
              <div>U: unknown</div>
              <div>F: flag</div>
              <div>.: empty</div>
              <div>S: solve</div>
              <div>Ctrl+V: scan</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 border-t border-gray-700 pt-2">
            <button onClick={solve}
              className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded text-sm transition-all">
              Solve
            </button>
            <button onClick={clearBoard}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 py-1.5 px-3 rounded text-xs">
              Clear Board
            </button>
          </div>

          {/* Stats */}
          <div className="border-t border-gray-700 pt-2">
            <div className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Status</div>
            <div className="text-xs text-gray-300 space-y-0.5">
              <div>Unknown: <span className="text-yellow-400 font-bold">{unknownCount}</span></div>
              <div>Flags: <span className="text-red-400 font-bold">{flagCount}</span></div>
              <div>Remaining: <span className="text-orange-400 font-bold">{minesRemaining}</span></div>
            </div>
          </div>

          {/* Results */}
          {results && (
            <div className="border-t border-gray-700 pt-2">
              <div className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Results</div>
              <div className="text-xs text-gray-300 space-y-0.5">
                <div>Time: {results.elapsed.toFixed(0)}ms</div>
                <div>Mines found: <span className="text-red-400 font-bold">{results.allFlags.size}</span></div>
                <div>Safe found: <span className="text-green-400 font-bold">{results.allSafe.size}</span></div>
              </div>

              {recommendations.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-400 mb-1">Top moves</div>
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {recommendations.slice(0, 12).map(({ r, c, prob }) => (
                      <div key={`${r},${c}`} className="flex items-center gap-1 text-xs">
                        <div className="w-14 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${prob * 100}%`,
                            background: prob < 0.05 ? "#22c55e" : prob > 0.9 ? "#ef4444" : `hsl(${(1 - prob) * 60}, 80%, 50%)`
                          }} />
                        </div>
                        <span className="font-mono w-8 text-right" style={{
                          color: prob < 0.05 ? "#4ade80" : prob > 0.9 ? "#f87171" : "#fbbf24"
                        }}>{(prob * 100).toFixed(0)}%</span>
                        <span className="text-gray-500">({r},{c})</span>
                      </div>
                    ))}
                  </div>
                  {recommendations[0]?.prob < 0.5 && (
                    <div className="mt-2 p-1.5 bg-green-900/30 border border-green-800 rounded text-xs">
                      Best: <span className="text-green-400 font-bold">({recommendations[0].r},{recommendations[0].c})</span>
                      {" "}{(recommendations[0].prob * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Board */}
        <div className="flex-1 overflow-auto p-2" style={{ maxHeight: "calc(100vh - 52px)" }} ref={boardRef}>
          {showHelp && !results && unknownCount === 0 && (
            <div className="mb-3 p-3 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-200 flex justify-between items-start max-w-2xl">
              <div>
                <p className="font-bold mb-1">Quick Start:</p>
                <p><strong>Option A – Screenshot:</strong> Press Ctrl+V with a screenshot of your Minesweeper game. Adjust the grid overlay, click Detect, then Apply.</p>
                <p className="mt-1"><strong>Option B – Manual:</strong> Select a paint tool and click/drag on the grid. You only need the frontier (unknowns + neighboring numbers).</p>
                <p className="mt-1">Then press <strong>Solve</strong> to see mine probabilities.</p>
              </div>
              <button onClick={() => setShowHelp(false)} className="text-blue-400 hover:text-white ml-3 text-lg">x</button>
            </div>
          )}

          <div style={{
            display: "inline-grid",
            gridTemplateColumns: `18px repeat(${cols}, ${cellSize}px)`,
            gap: "1px"
          }}>
            {/* Column headers */}
            <div />
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} className="text-center text-gray-600"
                style={{ fontSize: Math.max(6, fontSize - 4) + "px", lineHeight: "12px" }}>
                {c}
              </div>
            ))}

            {/* Rows */}
            {board.map((row, r) => (
              <React.Fragment key={r}>
                <div className="text-right text-gray-600 pr-0.5 flex items-center justify-end"
                  style={{ fontSize: Math.max(6, fontSize - 4) + "px", height: cellSize + "px" }}>
                  {r}
                </div>
                {row.map((cell, c) => {
                  const key = `${r},${c}`;
                  const prob = results?.probabilities?.[key];
                  const isDeducedFlag = results?.allFlags?.has(key);
                  const isDeducedSafe = results?.allSafe?.has(key);
                  const solvedCell = results?.board?.[r]?.[c];

                  let bg, fg, text, border;

                  if (results && (isDeducedFlag || (solvedCell === FLAG && cell !== FLAG))) {
                    bg = "#7f1d1d"; fg = "#fca5a5"; text = "X"; border = "#dc2626";
                  } else if (results && isDeducedSafe) {
                    bg = "#14532d"; fg = "#86efac"; text = "\u2713"; border = "#22c55e";
                  } else if (results && prob !== undefined && cell === UNKNOWN) {
                    if (prob >= 0.99) {
                      bg = "#7f1d1d"; fg = "#fca5a5"; text = "X"; border = "#dc2626";
                    } else if (prob <= 0.01) {
                      bg = "#14532d"; fg = "#86efac"; text = "\u2713"; border = "#22c55e";
                    } else {
                      const hue = (1 - prob) * 60;
                      bg = `hsla(${hue}, 60%, 25%, 0.8)`;
                      fg = `hsl(${hue}, 80%, 70%)`;
                      text = `${Math.round(prob * 100)}`;
                      border = `hsl(${hue}, 60%, 40%)`;
                    }
                  } else if (cell === EMPTY) {
                    bg = "#1a1a2e"; fg = "#555"; text = ""; border = "#2a2a3e";
                  } else if (cell === UNKNOWN) {
                    bg = "#4a4a5a"; fg = "#ccc"; text = ""; border = "#6a6a7a";
                  } else if (cell === FLAG) {
                    bg = "#5c1a1a"; fg = "#ff6b6b"; text = "F"; border = "#8b2020";
                  } else {
                    bg = "#2a2a3e"; fg = CELL_COLORS[cell] || "#fff"; text = String(cell); border = "#3a3a4e";
                  }

                  return (
                    <div key={c}
                      onMouseDown={(e) => handleMouseDown(r, c, e)}
                      onMouseEnter={() => handleMouseEnter(r, c)}
                      style={{
                        width: cellSize, height: cellSize, background: bg, color: fg,
                        border: `1px solid ${border}`, borderRadius: "2px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: fontSize + "px", fontWeight: "bold", cursor: "crosshair",
                        lineHeight: 1, userSelect: "none"
                      }}>
                      {text}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
