import Phaser from "phaser";
import {
  WOODCUTTING,
  DEFAULT_APPEARANCE,
  MOVE_SPEED_PX_PER_SEC,
  ARRIVE_EPSILON_PX,
  snapToTileCenter,
  findApproachPoint,
  stepToward,
  type Appearance,
} from "@skilling-mmo/shared";
import type { ServerMessage } from "@skilling-mmo/shared";
import type { GameCallbacks } from "./createGame";
import { ensurePlayerTexture } from "./playerTexture";

export class WorldScene extends Phaser.Scene {
  private localPlayer?: Phaser.GameObjects.Image;
  private remotePlayers = new Map<string, Phaser.GameObjects.Image>();
  private remoteTweens = new Map<string, Phaser.Tweens.Tween>();
  private tree?: Phaser.GameObjects.Image;
  private predictedTarget?: { x: number; y: number };
  private serverPos?: { x: number; y: number };
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
      // Server walks into range; client only predicts when out of range
      if (this.localPlayer) {
        const from = { x: this.localPlayer.x, y: this.localPlayer.y };
        const res = { x: this.tree!.x, y: this.tree!.y };
        const dist = Math.hypot(from.x - res.x, from.y - res.y);
        if (dist > WOODCUTTING.NORMAL_TREE.interactRange) {
          const approach = findApproachPoint(from, res, WOODCUTTING.NORMAL_TREE.interactRange);
          if (approach) this.predictedTarget = approach;
        } else {
          this.predictedTarget = undefined;
        }
      }
      this.callbacks.onInteractTree(WOODCUTTING.NORMAL_TREE.resourceId);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (this.tree && this.tree.getBounds().contains(pointer.worldX, pointer.worldY)) return;
      const snapped = snapToTileCenter(pointer.worldX, pointer.worldY);
      if (!snapped) return;
      this.predictedTarget = snapped;
      this.callbacks.onMove(snapped.x, snapped.y);
    });
  }

  update(_t: number, dt: number) {
    if (!this.localPlayer || !this.predictedTarget) return;

    // Do not soft-correct toward server while predicting — patch lag would
    // rubber-band the local sprite back into a small box around the last ACK.
    const { pos, arrived } = stepToward(
      { x: this.localPlayer.x, y: this.localPlayer.y },
      this.predictedTarget,
      MOVE_SPEED_PX_PER_SEC,
      dt,
    );
    this.localPlayer.setPosition(pos.x, pos.y);
    if (arrived) this.predictedTarget = undefined;
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
      if (p.id === this.localId) {
        this.serverPos = { x: p.x, y: p.y };
      }
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
      this.serverPos = { x, y };
      const dist = Math.hypot(sprite.x - x, sprite.y - y);

      if (this.predictedTarget) {
        // Only correct gross desync while walking; keep prediction otherwise
        if (dist > 256) {
          sprite.setPosition(x, y);
          this.predictedTarget = undefined;
        }
        return;
      }

      // Idle: snap to authoritative server position
      if (dist > ARRIVE_EPSILON_PX) {
        sprite.setPosition(x, y);
      }
      return;
    }

    const prev = this.remoteTweens.get(id);
    prev?.stop();
    const dist = Math.hypot(sprite.x - x, sprite.y - y);
    if (dist < ARRIVE_EPSILON_PX) {
      sprite.setPosition(x, y);
      this.remoteTweens.delete(id);
      return;
    }
    const duration = Math.max(40, Math.min(400, (dist / MOVE_SPEED_PX_PER_SEC) * 1000));
    const tween = this.tweens.add({
      targets: sprite,
      x,
      y,
      duration,
      ease: "Linear",
    });
    this.remoteTweens.set(id, tween);
  }

  getLocalPos() {
    return { x: this.localPlayer?.x ?? 160, y: this.localPlayer?.y ?? 160 };
  }

  predictChopStart() {
    if (!this.localPlayer) return;
    this.predictedTarget = undefined;
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
      if (!isLocal || !this.predictedTarget) {
        sprite.setPosition(x, y);
      }
    }
  }
}
