import Phaser from "phaser";
import { WOODCUTTING, DEFAULT_APPEARANCE, type Appearance } from "@skilling-mmo/shared";
import type { ServerMessage } from "@skilling-mmo/shared";
import type { GameCallbacks } from "./createGame";
import { ensurePlayerTexture } from "./playerTexture";

export class WorldScene extends Phaser.Scene {
  private localPlayer?: Phaser.GameObjects.Image;
  private remotePlayers = new Map<string, Phaser.GameObjects.Image>();
  private tree?: Phaser.GameObjects.Image;
  private predictedTarget?: { x: number; y: number };
  private chopTween?: Phaser.Tweens.Tween;
  private localId?: string;
  private callbacks!: GameCallbacks;

  constructor() {
    super("world");
  }

  create() {
    this.callbacks = this.registry.get("gameCallbacks");
    const setWorld = this.registry.get("setWorldScene") as (s: WorldScene) => void;
    setWorld(this);

    const map = this.make.tilemap({ key: "world" });
    const tileset = map.addTilesetImage("grass", "tile_grass");
    if (tileset) {
      map.createLayer("ground", tileset, 0, 0);
    }

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBackgroundColor("#1a2e1a");
    this.cameras.main.setRoundPixels(true);

    this.tree = this.add.image(320, 240, "tree");
    this.tree.setInteractive({ useHandCursor: true });
    this.tree.on("pointerdown", () => {
      if (this.localPlayer) {
        this.predictedTarget = { x: this.tree!.x - 24, y: this.tree!.y };
        this.callbacks.onMove(this.predictedTarget.x, this.predictedTarget.y);
      }
      this.callbacks.onInteractTree(WOODCUTTING.NORMAL_TREE.resourceId);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (this.tree && this.tree.getBounds().contains(pointer.worldX, pointer.worldY)) return;
      const x = pointer.worldX;
      const y = pointer.worldY;
      this.predictedTarget = { x, y };
      if (this.localPlayer) {
        this.tweens.add({
          targets: this.localPlayer,
          x,
          y,
          duration: 280,
          ease: "Sine.easeInOut",
        });
      }
      this.callbacks.onMove(x, y);
    });
  }

  update(_t: number, dt: number) {
    if (this.localPlayer && this.predictedTarget) {
      const dx = this.predictedTarget.x - this.localPlayer.x;
      const dy = this.predictedTarget.y - this.localPlayer.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const speed = 0.18 * dt;
        const step = Math.min(speed, dist);
        this.localPlayer.x += (dx / dist) * step;
        this.localPlayer.y += (dy / dist) * step;
      }
    }
  }

  applySnapshot(snap: Extract<ServerMessage, { type: "StateSnapshot" }>) {
    this.localId = snap.you.playerId;
    for (const p of snap.players) {
      this.ensurePlayer(
        p.id,
        p.name,
        p.x,
        p.y,
        p.id === this.localId,
        p.appearance ?? snap.you.appearance ?? DEFAULT_APPEARANCE,
      );
    }
    for (const r of snap.resources) {
      if (r.kind === "tree" && this.tree) {
        this.tree.setPosition(r.x, r.y);
        this.tree.setAlpha(r.available ? 1 : 0.4);
      }
    }
  }

  reconcilePlayer(id: string, x: number, y: number) {
    const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
    if (!sprite) return;
    if (id === this.localId) {
      const dist = Math.hypot(sprite.x - x, sprite.y - y);
      if (dist > 64) {
        sprite.setPosition(x, y);
        this.predictedTarget = undefined;
      }
      return;
    }
    this.tweens.add({ targets: sprite, x, y, duration: 200, ease: "Linear" });
  }

  getLocalPos() {
    return { x: this.localPlayer?.x ?? 160, y: this.localPlayer?.y ?? 160 };
  }

  predictChopStart() {
    if (!this.localPlayer) return;
    this.chopTween?.stop();
    this.chopTween = this.tweens.add({
      targets: this.localPlayer,
      angle: { from: -8, to: 8 },
      duration: 200,
      yoyo: true,
      repeat: -1,
    });
  }

  predictChopEnd() {
    this.chopTween?.stop();
    if (this.localPlayer) this.localPlayer.angle = 0;
    if (this.tree) {
      this.tweens.add({
        targets: this.tree,
        scaleX: 1.1,
        scaleY: 0.9,
        duration: 80,
        yoyo: true,
      });
    }
  }

  private ensurePlayer(
    id: string,
    _name: string,
    x: number,
    y: number,
    isLocal: boolean,
    look: Appearance,
  ) {
    const key = ensurePlayerTexture(this, look);
    let sprite = this.remotePlayers.get(id);
    if (!sprite) {
      sprite = this.add.image(x, y, key);
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(10);
      this.remotePlayers.set(id, sprite);
      if (isLocal) {
        this.localPlayer = sprite;
        this.cameras.main.startFollow(sprite, true, 0.12, 0.12);
      }
    } else {
      if (sprite.texture.key !== key) sprite.setTexture(key);
      sprite.setPosition(x, y);
    }
  }
}
