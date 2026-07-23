/** Tiny pixel person template (7×14) + recolor helpers. */

export interface Appearance {
  hairColor: string;
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  hairColor: "#1a1a1a",
  skinColor: "#e899a3",
  shirtColor: "#0f1e3d",
  pantsColor: "#4b250a",
};

export const HAIR_COLORS = [
  "#1a1a1a",
  "#3b2a1a",
  "#6b4423",
  "#c4a35a",
  "#8a3030",
  "#e8e0d0",
  "#2a4a6a",
];

export const SKIN_COLORS = [
  "#e899a3",
  "#f0c4a8",
  "#d4a574",
  "#a67c52",
  "#6b4a32",
  "#8d5524",
];

export const SHIRT_COLORS = [
  "#0f1e3d",
  "#3d6b3d",
  "#8a3030",
  "#c4a35a",
  "#2a4a6a",
  "#5a3a6a",
  "#1a1a1a",
];

export const PANTS_COLORS = [
  "#4b250a",
  "#2a2a2a",
  "#3a4a5a",
  "#3d5a30",
  "#5a4030",
  "#1a1a2a",
];

/**
 * Pixel keys:
 * . empty  H hair  E eye  S skin  T shirt  P pants  L legs (skin)
 */
export const PIXEL_TEMPLATE: string[] = [
  ".HHHHH.",
  ".ESSSE.",
  ".SSSSS.",
  ".SSSSS.",
  "TTTTTTT",
  "STTTTTS",
  "STTTTTS",
  "STTTTTS",
  ".PPPPP.",
  ".PPPPP.",
  ".PPPPP.",
  ".L...L.",
  ".L...L.",
  ".L...L.",
];

export const PIXEL_W = 7;
export const PIXEL_H = 14;
export const EYE_COLOR = "#6b5344";

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorForPixel(ch: string, look: Appearance): string | null {
  switch (ch) {
    case "H":
      return look.hairColor;
    case "S":
    case "L":
      return look.skinColor;
    case "E":
      return EYE_COLOR;
    case "T":
      return look.shirtColor;
    case "P":
      return look.pantsColor;
    default:
      return null;
  }
}

/** RGBA buffer for Phaser / offscreen drawing (scale ≥ 1). */
export function pixelAvatarRgba(look: Appearance, scale = 3): Uint8ClampedArray {
  const w = PIXEL_W * scale;
  const h = PIXEL_H * scale;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < PIXEL_H; y++) {
    const row = PIXEL_TEMPLATE[y];
    for (let x = 0; x < PIXEL_W; x++) {
      const hex = colorForPixel(row[x], look);
      if (!hex) continue;
      const [r, g, b] = parseHex(hex);
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          const i = (py * w + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    }
  }
  return data;
}

export function appearanceKey(look: Appearance): string {
  return `${look.hairColor}_${look.skinColor}_${look.shirtColor}_${look.pantsColor}`;
}
