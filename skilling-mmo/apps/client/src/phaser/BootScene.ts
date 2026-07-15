import Phaser from "phaser";

/** Generate placeholder tileset + sprites at runtime (no external art). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    // procedural textures
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
    g.clear();

    g.fillStyle(0xc4a35a);
    g.fillCircle(12, 12, 10);
    g.fillStyle(0x3a2a10);
    g.fillCircle(8, 10, 2);
    g.fillCircle(14, 10, 2);
    g.generateTexture("player", 24, 24);
    g.destroy();

    // Minimal Tiled JSON map (embedded)
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
