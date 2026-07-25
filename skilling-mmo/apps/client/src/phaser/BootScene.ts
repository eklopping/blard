import Phaser from "phaser";
import { DEFAULT_APPEARANCE, WORLD_TILES_W, WORLD_TILES_H, TILE_SIZE } from "@skilling-mmo/shared";
import { ensurePlayerTexture } from "./playerTexture";

/** Generate placeholder tileset + sprites at runtime (no external art). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(0x3d6b3d);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.fillStyle(0x2f5530);
    g.fillRect(0, 0, TILE_SIZE / 2, TILE_SIZE / 2);
    g.fillRect(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2);
    g.generateTexture("tile_grass", TILE_SIZE, TILE_SIZE);
    g.clear();

    g.fillStyle(0x5a4030);
    g.fillRect(12, 16, 8, 16);
    g.fillStyle(0x2d6a2d);
    g.fillCircle(16, 14, 14);
    g.generateTexture("tree", 32, 48);
    g.destroy();

    ensurePlayerTexture(this, DEFAULT_APPEARANCE);

    const map = {
      width: WORLD_TILES_W,
      height: WORLD_TILES_H,
      tilewidth: TILE_SIZE,
      tileheight: TILE_SIZE,
      type: "map",
      orientation: "orthogonal",
      renderorder: "right-down",
      layers: [
        {
          type: "tilelayer",
          name: "ground",
          width: WORLD_TILES_W,
          height: WORLD_TILES_H,
          data: Array.from({ length: WORLD_TILES_W * WORLD_TILES_H }, () => 1),
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          name: "grass",
          tilewidth: TILE_SIZE,
          tileheight: TILE_SIZE,
          image: "tile_grass",
          imagewidth: TILE_SIZE,
          imageheight: TILE_SIZE,
          tilecount: 1,
          columns: 1,
        },
      ],
    };
    this.cache.tilemap.add("world", { format: Phaser.Tilemaps.Formats.TILED_JSON, data: map });
  }

  create() {
    this.scene.start("world");
  }
}
