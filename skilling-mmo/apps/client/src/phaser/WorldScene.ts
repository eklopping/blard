import Phaser from "phaser";
import {
  DEFAULT_APPEARANCE,
  MOVE_SPEED_PX_PER_SEC,
  ARRIVE_EPSILON_PX,
  ACTION_REPEAT_COOLDOWN_MS,
  ZONE_DEFS,
  ZONES,
  NPC_KINDS,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
  snapToTileCenter,
  findClosestSideApproach,
  stepToward,
  zoneForResource,
  isZoneId,
  type Appearance,
  type NpcSnapshot,
  type ResourceSnapshot,
  type ZoneId,
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

function textureForResourceKind(kind: string): string {
  if (kind === "rock") return "rock";
  if (kind === "crop") return "crop";
  return "tree";
}

function textureForNpcKind(kind: string): string {
  if (kind === NPC_KINDS.SHOPKEEPER) return "npc_shop";
  if (kind === NPC_KINDS.STOREHOUSE) return "npc_store";
  if (kind === NPC_KINDS.RETURN) return "portal_return";
  return "portal_exit";
}

export class WorldScene extends Phaser.Scene {
  private localPlayer?: Phaser.GameObjects.Image;
  private remotePlayers = new Map<string, Phaser.GameObjects.Image>();
  private remoteTweens = new Map<string, Phaser.Tweens.Tween>();
  private walkState = new Map<string, WalkState>();
  private lastServerPos = new Map<string, { x: number; y: number }>();
  private playerZones = new Map<string, ZoneId>();
  private resourceSprites = new Map<string, Phaser.GameObjects.Image>();
  private npcSprites = new Map<string, Phaser.GameObjects.Image>();
  private allResources: ResourceSnapshot[] = [];
  private allNpcs: NpcSnapshot[] = [];
  private groundOverlay?: Phaser.GameObjects.Rectangle;
  private groundLayer?: Phaser.Tilemaps.TilemapLayer | null;
  private localZone: ZoneId = ZONES.TOWN;
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
      this.groundLayer = map.createLayer("ground", tileset, 0, 0);
    }

    // Full-map tint — color swaps per zone so each area reads as its own map
    this.groundOverlay = this.add.rectangle(
      WORLD_WIDTH_PX / 2,
      WORLD_HEIGHT_PX / 2,
      WORLD_WIDTH_PX,
      WORLD_HEIGHT_PX,
      ZONE_DEFS[ZONES.TOWN].groundTint,
      0.35,
    );
    this.groundOverlay.setDepth(1);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.applyZoneVisuals(ZONES.TOWN);
    this.cameras.main.setRoundPixels(true);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (this.hitWorldEntity(pointer.worldX, pointer.worldY)) return;
      const snapped = snapToTileCenter(pointer.worldX, pointer.worldY);
      if (!snapped) return;
      this.cancelEngagement();
      this.predictedTarget = snapped;
      this.callbacks.onMove(snapped.x, snapped.y);
    });
  }

  private applyZoneVisuals(zone: ZoneId) {
    const def = ZONE_DEFS[zone];
    this.cameras.main.setBackgroundColor(def.skyColor);
    this.groundOverlay?.setFillStyle(def.groundTint, 0.35);
    this.groundLayer?.setTint(def.groundTint);
  }

  /** Switch the active map view (only entities in this zone are shown). */
  setLocalZone(zone: string) {
    if (!isZoneId(zone)) return;
    if (zone === this.localZone) return;
    this.localZone = zone;
    this.applyZoneVisuals(zone);
    this.cancelEngagement();
    this.predictedTarget = undefined;
    this.syncResources(this.allResources);
    this.syncNpcs(this.allNpcs);
    this.refreshPlayerVisibility();
  }

  private hitWorldEntity(wx: number, wy: number): boolean {
    for (const sprite of this.resourceSprites.values()) {
      if (sprite.visible && sprite.getBounds().contains(wx, wy)) return true;
    }
    for (const sprite of this.npcSprites.values()) {
      if (sprite.visible && sprite.getBounds().contains(wx, wy)) return true;
    }
    return false;
  }

  onTabHidden() {
    this.tabHidden = true;
    this.predictedTarget = undefined;
    if (this.localId) this.setWalking(this.localId, false);
    this.stopAllRemoteTweens();
  }

  onTabVisible() {
    this.tabHidden = false;
    this.predictedTarget = undefined;
    this.stopAllRemoteTweens();

    for (const [id, pos] of this.lastServerPos) {
      if (!this.isPlayerVisible(id)) continue;
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

    if (this.tabHidden || document.hidden) return;

    this.tickWalkAnims(dt);

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
    if (snap.you.zone && isZoneId(snap.you.zone)) {
      this.setLocalZone(snap.you.zone);
    }

    const present = new Set(snap.players.map((p) => p.id));

    for (const id of [...this.remotePlayers.keys()]) {
      if (!present.has(id)) this.removePlayer(id);
    }

    for (const p of snap.players) {
      if (p.zone && isZoneId(p.zone)) this.playerZones.set(p.id, p.zone);
      else if (p.id === this.localId) this.playerZones.set(p.id, this.localZone);

      this.lastServerPos.set(p.id, { x: p.x, y: p.y });
      if (p.id === this.localId) this.serverPos = { x: p.x, y: p.y };

      if (!this.isPlayerVisible(p.id)) {
        this.hidePlayerSprite(p.id);
        continue;
      }

      this.ensurePlayer(
        p.id,
        p.name,
        p.x,
        p.y,
        p.id === this.localId,
        p.appearance ?? snap.you.appearance ?? DEFAULT_APPEARANCE,
      );
    }

    this.allResources = snap.resources ?? [];
    this.allNpcs = snap.npcs ?? [];
    this.syncResources(this.allResources);
    this.syncNpcs(this.allNpcs);
    this.refreshResourceAlpha();
  }

  private isPlayerVisible(id: string): boolean {
    if (id === this.localId) return true;
    const z = this.playerZones.get(id);
    return !z || z === this.localZone;
  }

  private hidePlayerSprite(id: string) {
    if (id === this.localId) return;
    this.remoteTweens.get(id)?.stop();
    this.remoteTweens.delete(id);
    const sprite = this.remotePlayers.get(id);
    if (sprite) {
      sprite.destroy();
      this.remotePlayers.delete(id);
    }
    this.walkState.delete(id);
  }

  private refreshPlayerVisibility() {
    for (const id of [...this.remotePlayers.keys()]) {
      if (!this.isPlayerVisible(id)) this.hidePlayerSprite(id);
    }
  }

  private syncResources(resources: ResourceSnapshot[]) {
    const seen = new Set<string>();
    for (const r of resources) {
      const resZone = zoneForResource(r.id);
      if (resZone && resZone !== this.localZone) continue;
      seen.add(r.id);
      let sprite = this.resourceSprites.get(r.id);
      const tex = textureForResourceKind(r.kind);
      if (!sprite) {
        sprite = this.add.image(r.x, r.y, tex);
        sprite.setOrigin(0.5, 1);
        sprite.setDepth(5);
        sprite.setInteractive({ useHandCursor: true });
        sprite.on("pointerdown", () => {
          this.tryEngageResource(r.id);
        });
        this.resourceSprites.set(r.id, sprite);
      } else {
        sprite.setTexture(tex);
        sprite.setPosition(r.x, r.y);
      }
      sprite.setVisible(r.available);
      sprite.setData("resourceId", r.id);
    }
    for (const [id, sprite] of this.resourceSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.resourceSprites.delete(id);
      }
    }
  }

  private syncNpcs(npcs: NpcSnapshot[]) {
    const seen = new Set<string>();
    for (const n of npcs) {
      if (n.zoneId !== this.localZone) continue;
      seen.add(n.id);
      let sprite = this.npcSprites.get(n.id);
      const tex = textureForNpcKind(n.kind);
      if (!sprite) {
        sprite = this.add.image(n.x, n.y, tex);
        sprite.setOrigin(0.5, 1);
        sprite.setDepth(6);
        sprite.setInteractive({ useHandCursor: true });
        const npcId = n.id;
        sprite.on("pointerdown", () => {
          this.tryEngageNpc(npcId, n.x, n.y);
        });
        this.npcSprites.set(n.id, sprite);
      } else {
        sprite.setTexture(tex);
        sprite.setPosition(n.x, n.y);
      }
    }
    for (const [id, sprite] of this.npcSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.npcSprites.delete(id);
      }
    }
  }

  reconcilePlayer(id: string, x: number, y: number, zone?: string) {
    if (zone && isZoneId(zone)) {
      this.playerZones.set(id, zone);
      if (id === this.localId && zone !== this.localZone) {
        this.setLocalZone(zone);
      }
      if (id !== this.localId && zone !== this.localZone) {
        this.hidePlayerSprite(id);
        this.lastServerPos.set(id, { x, y });
        return;
      }
      if (id !== this.localId && zone === this.localZone && !this.remotePlayers.has(id)) {
        this.ensurePlayer(id, "", x, y, false, DEFAULT_APPEARANCE);
      }
    }

    if (!this.isPlayerVisible(id)) {
      this.hidePlayerSprite(id);
      this.lastServerPos.set(id, { x, y });
      return;
    }

    const sprite = this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
    if (!sprite) {
      this.lastServerPos.set(id, { x, y });
      return;
    }

    this.lastServerPos.set(id, { x, y });

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
        if (dist > ARRIVE_EPSILON_PX) sprite.setPosition(x, y);
        this.setWalking(id, false);
        return;
      }

      // Teleports / zone travel
      if (dist > 128) {
        sprite.setPosition(x, y);
        this.predictedTarget = undefined;
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

    if (dist > 128) {
      sprite.setPosition(x, y);
      this.remoteTweens.delete(id);
      this.setWalking(id, false);
      return;
    }

    const prevX = sprite.x;
    this.noteMotion(id, prevX, x, true);
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
    const spawn = ZONE_DEFS[this.localZone].spawn;
    return { x: this.localPlayer?.x ?? spawn.x, y: this.localPlayer?.y ?? spawn.y };
  }

  onActionResult(msg: ActionResultMsg) {
    if (msg.ok && msg.action === "gather") {
      this.acting = true;
      this.predictedTarget = undefined;
      if (this.localId) this.setWalking(this.localId, false);
      this.startChopVfx();
      return;
    }

    if (msg.ok && msg.action === "gather_complete") {
      this.acting = false;
      this.stopChopVfx(true, msg.resourceId);
      const resourceId = msg.resourceId ?? this.engagedResourceId;
      if (resourceId) {
        this.beginClientCooldown(resourceId);
        if (this.engagedResourceId === resourceId) {
          this.scheduleRepeat(resourceId);
        }
      }
      return;
    }

    if (msg.ok && msg.action === "travel") {
      this.cancelEngagement();
      this.predictedTarget = undefined;
      this.acting = false;
      this.stopChopVfx(false);
      if (this.localPlayer && this.serverPos) {
        this.localPlayer.setPosition(this.serverPos.x, this.serverPos.y);
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

    const sprite = this.resourceSprites.get(resourceId);
    if (this.localPlayer && sprite) {
      const from = { x: this.localPlayer.x, y: this.localPlayer.y };
      const res = { x: sprite.x, y: sprite.y };
      const approach = findClosestSideApproach(from, res);
      if (approach) {
        const atStand =
          Math.hypot(from.x - approach.x, from.y - approach.y) <= ARRIVE_EPSILON_PX + 4;
        this.predictedTarget = atStand ? undefined : approach;
      }
    }

    this.callbacks.onInteractResource(resourceId);
  }

  private tryEngageNpc(npcId: string, x: number, y: number) {
    this.cancelEngagement();
    if (this.localPlayer) {
      const from = { x: this.localPlayer.x, y: this.localPlayer.y };
      const approach = findClosestSideApproach(from, { x, y });
      if (approach) {
        const atStand =
          Math.hypot(from.x - approach.x, from.y - approach.y) <= ARRIVE_EPSILON_PX + 4;
        this.predictedTarget = atStand ? undefined : approach;
      }
    }
    this.callbacks.onInteractNpc(npcId);
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
      this.callbacks.onInteractResource(resourceId);
    }, delay);
  }

  private clearRepeatTimer() {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = undefined;
    }
  }

  private refreshResourceAlpha() {
    for (const [id, sprite] of this.resourceSprites) {
      sprite.setAlpha(this.isOnCooldown(id) ? COOLDOWN_ALPHA : 1);
    }
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

  private stopChopVfx(bounceResource: boolean, resourceId?: string | null) {
    this.chopTween?.stop();
    this.chopTween = undefined;
    if (this.localPlayer) this.localPlayer.angle = 0;
    const id = resourceId ?? this.engagedResourceId;
    const sprite = id ? this.resourceSprites.get(id) : undefined;
    if (bounceResource && sprite) {
      this.tweens.add({
        targets: sprite,
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

      if (id === this.localId && this.predictedTarget && !this.acting) {
        st.moving = true;
      }

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
      if (
        sprite.texture.key !== textures.idle &&
        sprite.texture.key !== textures.walk0 &&
        sprite.texture.key !== textures.walk1
      ) {
        sprite.setTexture(textures.idle);
      }
      if (!isLocal || (!this.predictedTarget && !this.acting)) {
        sprite.setPosition(x, y);
      }
    }
  }

  removePlayer(id: string) {
    this.remoteTweens.get(id)?.stop();
    this.remoteTweens.delete(id);
    this.walkState.delete(id);
    this.lastServerPos.delete(id);
    this.playerZones.delete(id);
    const sprite = this.remotePlayers.get(id);
    if (sprite) {
      sprite.destroy();
      this.remotePlayers.delete(id);
    }
    if (id === this.localId) {
      this.localPlayer = undefined;
    }
  }

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
    this.playerZones.clear();
    this.localZone = ZONES.TOWN;
    this.stopChopVfx(false);
  }

  private stopAllRemoteTweens() {
    for (const [id, tween] of this.remoteTweens) {
      tween.stop();
      this.remoteTweens.delete(id);
    }
  }
}
