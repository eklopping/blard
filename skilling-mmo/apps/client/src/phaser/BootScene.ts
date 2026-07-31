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

    // Tree
    g.fillStyle(0x5a4030);
    g.fillRect(12, 16, 8, 16);
    g.fillStyle(0x2d6a2d);
    g.fillCircle(16, 14, 14);
    g.generateTexture("tree", 32, 48);
    g.clear();

    // Rock
    g.fillStyle(0x6a6a6a);
    g.fillCircle(16, 20, 14);
    g.fillStyle(0x8a8a8a);
    g.fillCircle(12, 16, 8);
    g.generateTexture("rock", 32, 32);
    g.clear();

    // Crop / wheat
    g.fillStyle(0x5a4020);
    g.fillRect(4, 24, 24, 6);
    g.fillStyle(0xc9a227);
    g.fillRect(8, 8, 4, 18);
    g.fillRect(14, 6, 4, 20);
    g.fillRect(20, 10, 4, 16);
    g.generateTexture("crop", 32, 32);
    g.clear();

    // Forage bush
    g.fillStyle(0x3a6a28);
    g.fillCircle(16, 18, 12);
    g.fillStyle(0x2a4a1a);
    g.fillCircle(10, 16, 7);
    g.fillStyle(0x7a2a4a);
    g.fillCircle(18, 14, 3);
    g.fillCircle(12, 20, 2);
    g.generateTexture("bush", 32, 32);
    g.clear();

    // Timberworking bench
    g.fillStyle(0x6b4423);
    g.fillRect(2, 18, 28, 10);
    g.fillStyle(0x8a5a30);
    g.fillRect(4, 10, 24, 10);
    g.fillStyle(0x4a3018);
    g.fillRect(6, 12, 8, 6);
    g.generateTexture("bench", 32, 32);
    g.clear();

    // Mill stone
    g.fillStyle(0x7a7a7a);
    g.fillCircle(16, 16, 13);
    g.fillStyle(0x555555);
    g.fillCircle(16, 16, 5);
    g.fillStyle(0x9a9a9a);
    g.fillRect(14, 4, 4, 24);
    g.generateTexture("mill", 32, 32);
    g.clear();

    // Bake oven
    g.fillStyle(0x6a4030);
    g.fillRect(4, 6, 24, 24);
    g.fillStyle(0x3a2018);
    g.fillRect(10, 14, 12, 12);
    g.fillStyle(0xd45a20);
    g.fillRect(12, 18, 8, 6);
    g.generateTexture("oven", 32, 32);
    g.clear();

    // Gem vein
    g.fillStyle(0x5a5a6a);
    g.fillCircle(16, 18, 13);
    g.fillStyle(0x5ad4c4);
    g.fillCircle(12, 14, 4);
    g.fillStyle(0xc45ad4);
    g.fillCircle(20, 18, 3);
    g.generateTexture("gem", 32, 32);
    g.clear();

    // Ore vein
    g.fillStyle(0x5a4a3a);
    g.fillCircle(16, 18, 13);
    g.fillStyle(0xb87333);
    g.fillCircle(14, 14, 5);
    g.fillStyle(0xd4a050);
    g.fillCircle(20, 20, 3);
    g.generateTexture("ore", 32, 32);
    g.clear();

    // Shopkeeper NPC
    g.fillStyle(0x8b5a2b);
    g.fillRect(8, 8, 16, 24);
    g.fillStyle(0xe8b090);
    g.fillCircle(16, 8, 7);
    g.fillStyle(0xc9a227);
    g.fillRect(6, 18, 20, 6);
    g.generateTexture("npc_shop", 32, 36);
    g.clear();

    // Storehouse NPC
    g.fillStyle(0x4a3728);
    g.fillRect(4, 10, 24, 22);
    g.fillStyle(0x6b5344);
    g.fillRect(10, 16, 12, 16);
    g.fillStyle(0xc9a227);
    g.fillRect(14, 20, 4, 4);
    g.generateTexture("npc_store", 32, 36);
    g.clear();

    // Town exit portal
    g.fillStyle(0x2a4a6a);
    g.fillRect(4, 4, 24, 28);
    g.fillStyle(0x5a9ad4);
    g.fillRect(8, 8, 16, 20);
    g.generateTexture("portal_exit", 32, 36);
    g.clear();

    // Return portal
    g.fillStyle(0x3a2a4a);
    g.fillRect(4, 4, 24, 28);
    g.fillStyle(0xa57ad4);
    g.fillRect(8, 8, 16, 20);
    g.generateTexture("portal_return", 32, 36);
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
