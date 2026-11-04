// Annotations are stored as fractions (0..1) of the image's own width and height,
// so they stay attached to the same image pixel at any rendered size.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Convert a client-space click to normalized image coordinates, or null if it falls outside the image. */
export function toNormalized(clientX: number, clientY: number, rect: Rect): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: clamp01(round6(x)), y: clamp01(round6(y)) };
}

/** CSS position for an element anchored at a normalized point inside the image frame. */
export function toPercentStyle(x: number, y: number): { left: string; top: string } {
  return { left: `${x * 100}%`, top: `${y * 100}%` };
}

/** Which way a popover anchored at (x, y) should open so it stays over the image. */
export function popoverPlacement(x: number, y: number): { flipX: boolean; flipY: boolean } {
  return { flipX: x > 0.6, flipY: y > 0.7 };
}
