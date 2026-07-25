import Phaser from "phaser";
import {
  DEFAULT_APPEARANCE,
  PIXEL_H,
  PIXEL_W,
  PIXEL_TEMPLATE,
  PIXEL_WALK_A,
  PIXEL_WALK_B,
  appearanceKey,
  pixelAvatarRgba,
  type Appearance,
} from "@skilling-mmo/shared";

const SCALE = 3;

export interface PlayerTextures {
  idle: string;
  walk0: string;
  walk1: string;
}

function putTemplate(
  scene: Phaser.Scene,
  key: string,
  look: Appearance,
  template: string[],
): string {
  if (scene.textures.exists(key)) return key;

  const w = PIXEL_W * SCALE;
  const h = PIXEL_H * SCALE;
  const rgba = pixelAvatarRgba(look, SCALE, template);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return "player";
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

/** Ensure idle + walk-cycle textures exist for this look. */
export function ensurePlayerTextures(
  scene: Phaser.Scene,
  look: Appearance = DEFAULT_APPEARANCE,
): PlayerTextures {
  const base = appearanceKey(look);
  return {
    idle: putTemplate(scene, `player_${base}`, look, PIXEL_TEMPLATE),
    walk0: putTemplate(scene, `player_${base}_w0`, look, PIXEL_WALK_A),
    walk1: putTemplate(scene, `player_${base}_w1`, look, PIXEL_WALK_B),
  };
}

/** @deprecated Prefer ensurePlayerTextures — kept for preview panels. */
export function ensurePlayerTexture(scene: Phaser.Scene, look: Appearance = DEFAULT_APPEARANCE): string {
  return ensurePlayerTextures(scene, look).idle;
}
