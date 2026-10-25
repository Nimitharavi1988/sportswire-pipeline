/**
 * Does the big-photo crop keep the subject? (2026-10-17.) The 4:5 crop of a wide photo keeps only the middle ~45% of its
 * width, and was switched off on 2026-09-29 for cutting off raised arms and second players. Rather than all or nothing,
 * each photo is checked: where is the detail? If clearly MORE detail (edges, faces, kit, a ball) sits in the part the crop
 * throws away than in the part it keeps, the crop would cut the subject off and the reel keeps the whole photo.
 *
 * Detail = the sum of horizontal and vertical pixel differences of a small greyscale copy, per column. All pure.
 */

// Per-column detail of a greyscale image (row-major, one byte per pixel).
export function columnDetail(gray: ArrayLike<number>, w: number, h: number): number[] {
  const out = new Array<number>(w).fill(0);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      out[x] += Math.abs(gray[i] - gray[i + 1]) + Math.abs(gray[i] - gray[i + w]);
    }
  }
  return out;
}

export interface CropFit {
  insideDensity: number;
  outsideDensity: number;
  // outside / inside, per column: 1 = the cut-off sides are as busy as what is kept; above 1 = busier.
  ratio: number;
}

// left / width are the crop's position in the same columns as `detail`.
export function cropFit(detail: number[], left: number, width: number): CropFit {
  const total = detail.length;
  const l = Math.max(0, Math.min(total, Math.round(left)));
  const r = Math.max(l, Math.min(total, Math.round(left + width)));
  const inside = detail.slice(l, r).reduce((s, v) => s + v, 0);
  const outside = detail.reduce((s, v) => s + v, 0) - inside;
  const insideCols = r - l;
  const outsideCols = total - insideCols;
  const insideDensity = insideCols > 0 ? inside / insideCols : 0;
  const outsideDensity = outsideCols > 0 ? outside / outsideCols : 0;
  return { insideDensity, outsideDensity, ratio: insideDensity > 0 ? outsideDensity / insideDensity : outsideDensity > 0 ? Infinity : 1 };
}

// The crop is used while the discarded sides are not clearly busier than what it keeps (pure, unit-tested).
export const MAX_OUTSIDE_RATIO = 0.8;
export function cropKeepsSubject(fit: CropFit, maxRatio = MAX_OUTSIDE_RATIO): boolean {
  return fit.ratio <= maxRatio;
}
