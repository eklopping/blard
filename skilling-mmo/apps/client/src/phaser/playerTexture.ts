import Phaser from "phaser";
import {
  DEFAULT_APPEARANCE,
  PIXEL_H,
  PIXEL_W,
  appearanceKey,
  pixelAvatarRgba,
  type Appearance,
} from "@skilling-mmo/shared";

const SCALE = 3;

/** Ensure a Phaser texture exists for this look; returns texture key. */
export function ensurePlayerTexture(scene: Phaser.Scene, look: Appearance = DEFAULT_APPEARANCE): string {
  const key = `player_${appearanceKey(look)}`;
  if (scene.textures.exists(key)) return key;

  const w = PIXEL_W * SCALE;
  const h = PIXEL_H * SCALE;
  const rgba = pixelAvatarRgba(look, SCALE);
  // Phaser 3 TextureManager.createCanvas + put data
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return "player";
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}
