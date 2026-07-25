import Phaser from "phaser";
import {
  WOODCUTTING,
  DEFAULT_APPEARANCE,
  MOVE_SPEED_PX_PER_SEC,
  ARRIVE_EPSILON_PX,
  ACTION_REPEAT_COOLDOWN_MS,
  snapToTileCenter,
  findClosestSideApproach,
  stepToward,
  type Appearance,
} from "@skilling-mmo/shared";
import type { ServerMessage } from "@skilling-mmo/shared";
import type { GameCallbacks } from "./createGame";
import { ensurePlayerTexture } from "./playerTexture";

type ActionResultMsg = Extract<ServerMessage, { type: "ActionResult" }>;

const COOLDOWN_ALPHA = 0.4;

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

  /** Resource the local player is engaged with (continuous gather loop). */
  private engagedResourceId: string | null = null;
  /** True while server reports an in-progress skill action. */
  private acting = false;
  /** Client-only cooldown end times (ms since epoch) per resource. */
  private cooldownUntil = new Map<string, number>();
  private repeatTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super("world");
  }

  create() {
    this.callbacks = this.registry.get("gameCallbacks");
    const setWorld = this.registry.get("setWorldScene") as (s: WorldScene) => void;
    setWorld(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearRepeatTimer();
      this.cancelEngagement();
    });

    const map = this.make.tilemap({ key: "world" });
    const tileset = map.addTilesetImage("grass", "tile_grass");
    if (tileset) {
      map.createLayer("ground", tileset, 0, 0);
    }

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBackgroundColor("#1a2e1a");
    this.cameras.main.setRoundPixels(true);

    this.tree = this.add.image(320, 240, "tree");
    this.tree.setOrigin(0.5, 1);
    this.tree.setInteractive({ useHandCursor: true });
    this.tree.on("pointerdown", () => {
      this.tryEngageResource(WOODCUTTING.NORMAL_TREE.resourceId);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (this.tree && this.tree.getBounds().contains(pointer.worldX, pointer.worldY)) return;
      const snapped = snapToTileCenter(pointer.worldX, pointer.worldY);
      if (!snapped) return;
      // Click away cancels the gather loop and any in-progress action
      this.cancelEngagement();
      this.predictedTarget = snapped;
      this.callbacks.onMove(snapped.x, snapped.y);
    });
  }

  update(_t: number, dt: number) {
    this.refreshResourceAlpha();

    // Stay locked in place while performing an action
    if (this.acting) return;
    if (!this.localPlayer || !this.predictedTarget) return;

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
      }
    }
    this.refreshResourceAlpha();
  }

  reconcilePlayer(id: string, x: number, y: number) {
    const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
    if (!sprite) return;

    if (id === this.localId) {
      this.serverPos = { x, y };
      const dist = Math.hypot(sprite.x - x, sprite.y - y);

      if (this.acting) {
        // Hard-lock local sprite to server while acting
        if (dist > ARRIVE_EPSILON_PX) sprite.setPosition(x, y);
        return;
      }

      if (this.predictedTarget) {
        if (dist > 256) {
          sprite.setPosition(x, y);
          this.predictedTarget = undefined;
        }
        return;
      }

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

  /** Handle server ActionResult — drives chop VFX and the client gather loop. */
  onActionResult(msg: ActionResultMsg) {
    if (msg.ok && msg.action === "woodcutting") {
      this.acting = true;
      this.predictedTarget = undefined;
      // Snap visually to the lined-up side stand
      if (this.localPlayer && this.tree) {
        const stand = findClosestSideApproach(
          { x: this.localPlayer.x, y: this.localPlayer.y },
          { x: this.tree.x, y: this.tree.y },
        );
        if (stand) this.localPlayer.setPosition(stand.x, stand.y);
      }
      this.startChopVfx();
      return;
    }

    if (msg.ok && msg.action === "woodcutting_complete") {
      this.acting = false;
      this.stopChopVfx(true);
      const resourceId = msg.resourceId ?? this.engagedResourceId ?? WOODCUTTING.NORMAL_TREE.resourceId;
      this.beginClientCooldown(resourceId);
      if (this.engagedResourceId === resourceId) {
        this.scheduleRepeat(resourceId);
      }
      return;
    }

    if (msg.ok && msg.action === "cancel") {
      this.acting = false;
      this.stopChopVfx(false);
      return;
    }

    if (!msg.ok) {
      // Failed start (too_far, etc.) — keep engagement so walk-in can retry via server pending,
      // but if we thought we were acting, clear VFX.
      this.acting = false;
      this.stopChopVfx(false);
    }
  }

  private tryEngageResource(resourceId: string) {
    // Client-only cooldown: resource is unusable until the timer elapses
    if (this.isOnCooldown(resourceId)) return;
    if (this.acting && this.engagedResourceId === resourceId) return;

    this.engagedResourceId = resourceId;
    this.clearRepeatTimer();

    if (this.localPlayer && this.tree && resourceId === WOODCUTTING.NORMAL_TREE.resourceId) {
      const from = { x: this.localPlayer.x, y: this.localPlayer.y };
      const res = { x: this.tree.x, y: this.tree.y };
      const approach = findClosestSideApproach(from, res);
      if (approach) {
        const atStand =
          Math.hypot(from.x - approach.x, from.y - approach.y) <= ARRIVE_EPSILON_PX + 4;
        this.predictedTarget = atStand ? undefined : approach;
      }
    }

    this.callbacks.onInteractTree(resourceId);
  }

  private cancelEngagement() {
    this.engagedResourceId = null;
    this.acting = false;
    this.clearRepeatTimer();
    this.stopChopVfx(false);
  }

  private beginClientCooldown(resourceId: string) {
    this.cooldownUntil.set(resourceId, Date.now() + ACTION_REPEAT_COOLDOWN_MS);
    this.refreshResourceAlpha();
  }

  private isOnCooldown(resourceId: string): boolean {
    const until = this.cooldownUntil.get(resourceId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldownUntil.delete(resourceId);
      return false;
    }
    return true;
  }

  private scheduleRepeat(resourceId: string) {
    this.clearRepeatTimer();
    const until = this.cooldownUntil.get(resourceId) ?? Date.now();
    const delay = Math.max(0, until - Date.now());
    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = undefined;
      if (this.engagedResourceId !== resourceId) return;
      this.cooldownUntil.delete(resourceId);
      this.refreshResourceAlpha();
      this.callbacks.onInteractTree(resourceId);
    }, delay);
  }

  private clearRepeatTimer() {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = undefined;
    }
  }

  private refreshResourceAlpha() {
    if (!this.tree) return;
    const id = WOODCUTTING.NORMAL_TREE.resourceId;
    this.tree.setAlpha(this.isOnCooldown(id) ? COOLDOWN_ALPHA : 1);
  }

  private startChopVfx() {
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

  private stopChopVfx(bounceTree: boolean) {
    this.chopTween?.stop();
    this.chopTween = undefined;
    if (this.localPlayer) this.localPlayer.angle = 0;
    if (bounceTree && this.tree) {
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
      if (!isLocal || (!this.predictedTarget && !this.acting)) {
        sprite.setPosition(x, y);
      }
    }
  }
}
