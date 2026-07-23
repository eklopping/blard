import Phaser from "phaser";
import { DEFAULT_APPEARANCE } from "@skilling-mmo/shared";
import { ensurePlayerTexture } from "./playerTexture";

/** Generate placeholder tileset + sprites at runtime (no external art). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(0x3d6b3d);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x2f5530);
    g.fillRect(0, 0, 16, 16);
    g.fillRect(16, 16, 16, 16);
    g.generateTexture("tile_grass", 32, 32);
    g.clear();

    g.fillStyle(0x5a4030);
    g.fillRect(12, 16, 8, 16);
    g.fillStyle(0x2d6a2d);
    g.fillCircle(16, 14, 14);
    g.generateTexture("tree", 32, 48);
    g.destroy();

    ensurePlayerTexture(this, DEFAULT_APPEARANCE);

    const map = {
      width: 40,
      height: 30,
      tilewidth: 32,
      tileheight: 32,
      type: "map",
      orientation: "orthogonal",
      renderorder: "right-down",
      layers: [
        {
          type: "tilelayer",
          name: "ground",
          width: 40,
          height: 30,
          data: Array.from({ length: 40 * 30 }, () => 1),
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          name: "grass",
          tilewidth: 32,
          tileheight: 32,
          image: "tile_grass",
          imagewidth: 32,
          imageheight: 32,
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
