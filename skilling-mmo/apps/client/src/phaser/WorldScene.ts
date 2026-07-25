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
import { ensurePlayerTextures, type PlayerTextures } from "./playerTexture";

type ActionResultMsg = Extract<ServerMessage, { type: "ActionResult" }>;

const COOLDOWN_ALPHA = 0.4;
const WALK_FRAME_MS = 140;
const WALK_MOVE_EPSILON = 0.4;

interface WalkState {
  textures: PlayerTextures;
  phaseMs: number;
  frame: 0 | 1;
  lastX: number;
  lastY: number;
  moving: boolean;
}

export class WorldScene extends Phaser.Scene {
  private localPlayer?: Phaser.GameObjects.Image;
  private remotePlayers = new Map<string, Phaser.GameObjects.Image>();
  private remoteTweens = new Map<string, Phaser.Tweens.Tween>();
  private walkState = new Map<string, WalkState>();
  private lastServerPos = new Map<string, { x: number; y: number }>();
  private tree?: Phaser.GameObjects.Image;
  private predictedTarget?: { x: number; y: number };
  private serverPos?: { x: number; y: number };
  private chopTween?: Phaser.Tweens.Tween;
  private localId?: string;
  private callbacks!: GameCallbacks;
  /** Browser tab hidden — rAF/prediction stall; prefer server poses. */
  private tabHidden = false;

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

  /**
   * Browser backgrounded the tab — stop client prediction so we don't freeze
   * mid-walk while rAF is throttled. Server keeps moving; we follow on resume.
   */
  onTabHidden() {
    this.tabHidden = true;
    this.predictedTarget = undefined;
    if (this.localId) this.setWalking(this.localId, false);
    this.stopAllRemoteTweens();
  }

  /** Tab focused again — snap everyone to the latest server poses. */
  onTabVisible() {
    this.tabHidden = false;
    this.predictedTarget = undefined;
    this.stopAllRemoteTweens();

    for (const [id, pos] of this.lastServerPos) {
      const sprite =
        this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
      if (!sprite) continue;
      sprite.setPosition(pos.x, pos.y);
      this.setWalking(id, false);
    }
    if (this.localPlayer && this.serverPos) {
      this.localPlayer.setPosition(this.serverPos.x, this.serverPos.y);
      if (this.localId) this.setWalking(this.localId, false);
    }
  }

  update(_t: number, dt: number) {
    this.refreshResourceAlpha();

    // Don't run prediction / walk anims while the tab is backgrounded
    if (this.tabHidden || document.hidden) return;

    this.tickWalkAnims(dt);

    // Stay locked in place while performing an action
    if (this.acting) return;
    if (!this.localPlayer || !this.predictedTarget) return;

    const prevX = this.localPlayer.x;
    const { pos, arrived } = stepToward(
      { x: this.localPlayer.x, y: this.localPlayer.y },
      this.predictedTarget,
      MOVE_SPEED_PX_PER_SEC,
      dt,
    );
    this.localPlayer.setPosition(pos.x, pos.y);
    this.noteMotion(this.localId!, prevX, pos.x, !arrived);
    if (arrived) {
      this.predictedTarget = undefined;
      if (this.localId) this.setWalking(this.localId, false);
    }
  }

  applySnapshot(snap: Extract<ServerMessage, { type: "StateSnapshot" }>) {
    this.localId = snap.you.playerId;
    const present = new Set(snap.players.map((p) => p.id));

    // Drop sprites for anyone no longer in the room (disconnects / profile swap)
    for (const id of [...this.remotePlayers.keys()]) {
      if (!present.has(id)) this.removePlayer(id);
    }

    for (const p of snap.players) {
      this.ensurePlayer(
        p.id,
        p.name,
        p.x,
        p.y,
        p.id === this.localId,
        p.appearance ?? snap.you.appearance ?? DEFAULT_APPEARANCE,
      );
      this.lastServerPos.set(p.id, { x: p.x, y: p.y });
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

    this.lastServerPos.set(id, { x, y });

    // While backgrounded, always hard-follow server (no prediction / tweens)
    if (this.tabHidden || document.hidden) {
      if (id === this.localId) this.serverPos = { x, y };
      sprite.setPosition(x, y);
      this.setWalking(id, false);
      return;
    }

    if (id === this.localId) {
      this.serverPos = { x, y };
      const dist = Math.hypot(sprite.x - x, sprite.y - y);

      if (this.acting) {
        // Hard-lock local sprite to server while acting
        if (dist > ARRIVE_EPSILON_PX) sprite.setPosition(x, y);
        this.setWalking(id, false);
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
        const prevX = sprite.x;
        sprite.setPosition(x, y);
        this.noteMotion(id, prevX, x, true);
      } else {
        this.setWalking(id, false);
      }
      return;
    }

    const prev = this.remoteTweens.get(id);
    prev?.stop();
    const dist = Math.hypot(sprite.x - x, sprite.y - y);
    if (dist < ARRIVE_EPSILON_PX) {
      sprite.setPosition(x, y);
      this.remoteTweens.delete(id);
      this.setWalking(id, false);
      return;
    }

    const prevX = sprite.x;
    this.noteMotion(id, prevX, x, true);
    // Match ~50ms Colyseus patches so remotes stay continuous instead of lagging
    const duration = Math.max(40, Math.min(90, (dist / MOVE_SPEED_PX_PER_SEC) * 1000));
    const tween = this.tweens.add({
      targets: sprite,
      x,
      y,
      duration,
      ease: "Linear",
      onComplete: () => {
        this.remoteTweens.delete(id);
        this.setWalking(id, false);
      },
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
      if (this.localId) this.setWalking(this.localId, false);
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
      this.acting = false;
      this.stopChopVfx(false);
    }
  }

  private tryEngageResource(resourceId: string) {
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

  private noteMotion(id: string, fromX: number, toX: number, moving: boolean) {
    const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
    if (!sprite) return;
    const dx = toX - fromX;
    if (Math.abs(dx) > WALK_MOVE_EPSILON) {
      sprite.setFlipX(dx < 0);
    }
    this.setWalking(id, moving);
  }

  private setWalking(id: string, moving: boolean) {
    const st = this.walkState.get(id);
    const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
    if (!st || !sprite) return;
    st.moving = moving;
    if (!moving) {
      st.phaseMs = 0;
      st.frame = 0;
      if (!this.acting || id !== this.localId) {
        sprite.setTexture(st.textures.idle);
        sprite.setScale(1);
        if (!this.chopTween || id !== this.localId) sprite.angle = 0;
      }
    }
  }

  private tickWalkAnims(dt: number) {
    for (const [id, st] of this.walkState) {
      const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
      if (!sprite) continue;

      // Local predicted walk while a target exists
      if (id === this.localId && this.predictedTarget && !this.acting) {
        st.moving = true;
      }

      // Remotes still tweening count as walking
      if (this.remoteTweens.has(id)) {
        st.moving = true;
      }

      if (!st.moving || (id === this.localId && this.acting)) {
        if (sprite.texture.key !== st.textures.idle && !(id === this.localId && this.acting)) {
          sprite.setTexture(st.textures.idle);
          sprite.setScale(1);
        }
        continue;
      }

      st.phaseMs += dt;
      if (st.phaseMs >= WALK_FRAME_MS) {
        st.phaseMs -= WALK_FRAME_MS;
        st.frame = st.frame === 0 ? 1 : 0;
      }
      const tex = st.frame === 0 ? st.textures.walk0 : st.textures.walk1;
      if (sprite.texture.key !== tex) sprite.setTexture(tex);

      // Light bob / squash so the stride reads even at low res
      const t = (st.phaseMs / WALK_FRAME_MS + st.frame) * Math.PI;
      const bob = Math.sin(t) * 0.06;
      sprite.setScale(1, 1 - Math.abs(bob));
      if (!(id === this.localId && this.acting)) {
        sprite.angle = Math.sin(t) * 3;
      }

      st.lastX = sprite.x;
      st.lastY = sprite.y;
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
    const textures = ensurePlayerTextures(this, look);
    let sprite = this.remotePlayers.get(id);
    if (!sprite) {
      sprite = this.add.image(x, y, textures.idle);
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(10);
      this.remotePlayers.set(id, sprite);
      this.walkState.set(id, {
        textures,
        phaseMs: 0,
        frame: 0,
        lastX: x,
        lastY: y,
        moving: false,
      });
      if (isLocal) {
        this.localPlayer = sprite;
        this.cameras.main.startFollow(sprite, true, 0.22, 0.22);
      }
    } else {
      const st = this.walkState.get(id);
      if (st) st.textures = textures;
      else {
        this.walkState.set(id, {
          textures,
          phaseMs: 0,
          frame: 0,
          lastX: x,
          lastY: y,
          moving: false,
        });
      }
      if (sprite.texture.key !== textures.idle && sprite.texture.key !== textures.walk0 && sprite.texture.key !== textures.walk1) {
        sprite.setTexture(textures.idle);
      }
      if (!isLocal || (!this.predictedTarget && !this.acting)) {
        sprite.setPosition(x, y);
      }
    }
  }

  /** Remove a player sprite (disconnect, profile swap, or roster sync). */
  removePlayer(id: string) {
    this.remoteTweens.get(id)?.stop();
    this.remoteTweens.delete(id);
    this.walkState.delete(id);
    this.lastServerPos.delete(id);
    const sprite = this.remotePlayers.get(id);
    if (sprite) {
      sprite.destroy();
      this.remotePlayers.delete(id);
    }
    if (id === this.localId) {
      this.localPlayer = undefined;
    }
  }

  /** Wipe all character sprites — used when leaving the world / swapping profiles. */
  clearPlayers() {
    this.stopAllRemoteTweens();
    for (const id of [...this.remotePlayers.keys()]) {
      this.removePlayer(id);
    }
    this.localPlayer = undefined;
    this.localId = undefined;
    this.predictedTarget = undefined;
    this.serverPos = undefined;
    this.acting = false;
    this.engagedResourceId = null;
    this.stopChopVfx(false);
  }

  private stopAllRemoteTweens() {
    for (const [id, tween] of this.remoteTweens) {
      tween.stop();
      this.remoteTweens.delete(id);
    }
  }
}
