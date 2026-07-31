import Phaser from "phaser";
import {
  DEFAULT_APPEARANCE,
  MOVE_SPEED_PX_PER_SEC,
  ARRIVE_EPSILON_PX,
  ACTION_REPEAT_COOLDOWN_MS,
  ZONE_DEFS,
  ZONES,
  ZONE_LABELS,
  NPC_KINDS,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
  snapToTileCenter,
  isInsideWorld,
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
  switch (kind) {
    case "rock":
      return "rock";
    case "crop":
      return "crop";
    case "bush":
      return "bush";
    case "bench":
      return "bench";
    case "mill":
      return "mill";
    case "oven":
      return "oven";
    case "gem":
      return "gem";
    case "ore":
      return "ore";
    default:
      return "tree";
  }
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
  /** Authoritative pose remotes are lerping toward (real-time movement). */
  private remoteTargets = new Map<string, { x: number; y: number }>();
  private walkState = new Map<string, WalkState>();
  private lastServerPos = new Map<string, { x: number; y: number }>();
  private playerZones = new Map<string, ZoneId>();
  private resourceSprites = new Map<string, Phaser.GameObjects.Image>();
  private npcSprites = new Map<string, Phaser.GameObjects.Image>();
  private allResources: ResourceSnapshot[] = [];
  private allNpcs: NpcSnapshot[] = [];
  private groundOverlay?: Phaser.GameObjects.Rectangle;
  private groundLayer?: Phaser.Tilemaps.TilemapLayer | null;
  private zoneLabel?: Phaser.GameObjects.Text;
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
  /** Gather started on server but local sprite still walking into range — hold chop VFX. */
  private gatherVfxPending = false;
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

    this.zoneLabel = this.add
      .text(16, 16, ZONE_LABELS[ZONES.TOWN], {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#e6c84a",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.applyZoneVisuals(ZONES.TOWN);
    this.cameras.main.setRoundPixels(true);

    this.input.on(
      "pointerdown",
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (pointer.rightButtonDown()) return;
        // Ignore clicks that didn't land on the game canvas (HUD / off-window)
        const target = pointer.event?.target as HTMLElement | undefined;
        if (target && this.game.canvas && target !== this.game.canvas && !this.game.canvas.contains(target)) {
          return;
        }
        // Don't also issue Move when clicking resources/NPCs (and avoid stealing the gesture)
        if (currentlyOver && currentlyOver.length > 0) return;
        if (!isInsideWorld(pointer.worldX, pointer.worldY)) return;
        if (this.hitWorldEntity(pointer.worldX, pointer.worldY)) return;
        // No edge-clamp — off-map clicks are ignored above
        const snapped = snapToTileCenter(pointer.worldX, pointer.worldY, undefined, false);
        if (!snapped) return;
        this.cancelEngagement();
        this.predictedTarget = snapped;
        this.callbacks.onMove(snapped.x, snapped.y);
      },
    );
  }

  /** HTML overlays (travel/shop) can steal pointerup — reset so world clicks keep working. */
  releaseInput() {
    try {
      const mgr = this.input?.manager;
      if (!mgr?.pointers) return;
      for (const pointer of mgr.pointers) {
        pointer?.reset?.();
      }
      this.input.enabled = true;
    } catch {
      // ignore — best-effort unlock after modal overlays
    }
  }

  private applyZoneVisuals(zone: ZoneId) {
    const def = ZONE_DEFS[zone];
    this.cameras.main.setBackgroundColor(def.skyColor);
    this.groundOverlay?.setFillStyle(def.groundTint, 0.45);
    this.groundLayer?.setTint(def.groundTint);
    this.zoneLabel?.setText(def.label);
  }

  /** Switch the active map view (only entities in this zone are shown). */
  setLocalZone(zone: string, force = false) {
    if (!isZoneId(zone)) return;
    if (!force && zone === this.localZone) return;
    this.localZone = zone;
    this.applyZoneVisuals(zone);
    this.cancelEngagement();
    this.predictedTarget = undefined;
    this.syncResources(this.allResources);
    this.syncNpcs(this.allNpcs);
    this.refreshPlayerVisibility();
    this.releaseInput();
  }

  /** Hard apply a server travel — zone + pose, even if coords look unchanged. */
  applyTravel(zone: string, x: number, y: number) {
    if (!isZoneId(zone)) return;
    if (this.localId) this.playerZones.set(this.localId, zone);
    this.setLocalZone(zone, true);
    this.serverPos = { x, y };
    if (this.localId) this.lastServerPos.set(this.localId, { x, y });
    if (this.localPlayer) {
      this.localPlayer.setPosition(x, y);
    }
    if (this.localId) this.setWalking(this.localId, false);
    this.releaseInput();
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
    for (const id of this.remotePlayers.keys()) {
      this.setWalking(id, false);
    }
  }

  onTabVisible() {
    this.tabHidden = false;
    this.predictedTarget = undefined;

    for (const [id, pos] of this.lastServerPos) {
      if (!this.isPlayerVisible(id)) continue;
      const sprite =
        this.remotePlayers.get(id) ?? (id === this.localId ? this.localPlayer : undefined);
      if (!sprite) continue;
      sprite.setPosition(pos.x, pos.y);
      this.remoteTargets.set(id, { x: pos.x, y: pos.y });
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

    this.tickRemoteMotion(dt);
    this.tickWalkAnims(dt);

    // Keep walking into gather range even after server already started the action
    if (this.localPlayer && this.predictedTarget) {
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
        if (this.gatherVfxPending) {
          this.gatherVfxPending = false;
          if (this.acting) this.startChopVfx();
        }
      }
      return;
    }

    if (this.acting) return;
  }

  /** Lerp other players toward latest server poses each frame. */
  private tickRemoteMotion(dt: number) {
    for (const [id, target] of this.remoteTargets) {
      if (id === this.localId) continue;
      const sprite = this.remotePlayers.get(id);
      if (!sprite || !this.isPlayerVisible(id)) continue;

      const prevX = sprite.x;
      const { pos, arrived } = stepToward(
        { x: sprite.x, y: sprite.y },
        target,
        MOVE_SPEED_PX_PER_SEC * 1.15,
        dt,
      );
      sprite.setPosition(pos.x, pos.y);
      this.noteMotion(id, prevX, pos.x, !arrived);
      if (arrived) this.setWalking(id, false);
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
    this.remoteTargets.delete(id);
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
        sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          pointer.event?.stopPropagation?.();
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
        const created = this.add.image(n.x, n.y, tex);
        created.setOrigin(0.5, 1);
        created.setDepth(6);
        created.setInteractive({ useHandCursor: true });
        const npcId = n.id;
        created.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          pointer.event?.stopPropagation?.();
          this.tryEngageNpc(npcId, created.x, created.y);
        });
        const label = this.add
          .text(n.x, n.y - 40, n.name, {
            fontFamily: "monospace",
            fontSize: "11px",
            color: "#f0e6c0",
            backgroundColor: "#00000088",
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setDepth(7);
        created.setData("label", label);
        this.npcSprites.set(n.id, created);
        sprite = created;
      } else {
        sprite.setTexture(tex);
        sprite.setPosition(n.x, n.y);
        const label = sprite.getData("label") as Phaser.GameObjects.Text | undefined;
        label?.setPosition(n.x, n.y - 40);
        label?.setText(n.name);
      }
    }
    for (const [id, sprite] of this.npcSprites) {
      if (!seen.has(id)) {
        const label = sprite.getData("label") as Phaser.GameObjects.Text | undefined;
        label?.destroy();
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
      if (id !== this.localId && this.isPlayerVisible(id)) {
        this.ensurePlayer(id, "", x, y, false, DEFAULT_APPEARANCE);
        this.remoteTargets.set(id, { x, y });
      }
      return;
    }

    this.lastServerPos.set(id, { x, y });

    if (this.tabHidden || document.hidden) {
      if (id === this.localId) this.serverPos = { x, y };
      sprite.setPosition(x, y);
      this.remoteTargets.set(id, { x, y });
      this.setWalking(id, false);
      return;
    }

    if (id === this.localId) {
      this.serverPos = { x, y };
      const dist = Math.hypot(sprite.x - x, sprite.y - y);

      if (this.acting) {
        // Never hard-teleport across the map while chopping — walk to the station stand
        if (dist <= 40) {
          sprite.setPosition(x, y);
          this.predictedTarget = undefined;
          this.setWalking(id, false);
          if (this.gatherVfxPending) {
            this.gatherVfxPending = false;
            this.startChopVfx();
          }
        } else {
          const stand = this.resolveGatherStand(this.engagedResourceId, x, y);
          this.predictedTarget = stand ?? { x, y };
          this.setWalking(id, true);
        }
        return;
      }

      // Hard snap only for real teleports (zone travel), not interact approach
      if (dist > 320 && !this.predictedTarget) {
        sprite.setPosition(x, y);
        this.predictedTarget = undefined;
        this.setWalking(id, false);
        return;
      }

      if (this.predictedTarget) {
        // If we drifted from the server while pathing to a station, retarget the station — not mid-map
        if (dist > 256) {
          const stand = this.resolveGatherStand(this.engagedResourceId, x, y);
          this.predictedTarget = stand ?? { x, y };
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

    // Remotes: update chase target — tickRemoteMotion lerps each frame
    const dist = Math.hypot(sprite.x - x, sprite.y - y);
    if (dist > 160) {
      sprite.setPosition(x, y);
      this.remoteTargets.set(id, { x, y });
      this.setWalking(id, false);
      return;
    }
    this.remoteTargets.set(id, { x, y });
    if (dist > ARRIVE_EPSILON_PX) {
      this.setWalking(id, true);
    }
  }

  getLocalPos() {
    const spawn = ZONE_DEFS[this.localZone].spawn;
    return { x: this.localPlayer?.x ?? spawn.x, y: this.localPlayer?.y ?? spawn.y };
  }

  onActionResult(msg: ActionResultMsg) {
    if (msg.ok && msg.action === "gather") {
      this.acting = true;
      const resourceId = msg.resourceId ?? this.engagedResourceId;
      if (resourceId) this.engagedResourceId = resourceId;

      const stand = this.resolveGatherStand(resourceId, msg.x, msg.y);
      if (this.localPlayer && stand) {
        this.serverPos = { x: stand.x, y: stand.y };
        const dist = Math.hypot(this.localPlayer.x - stand.x, this.localPlayer.y - stand.y);
        if (dist <= 40) {
          this.predictedTarget = undefined;
          this.gatherVfxPending = false;
          this.localPlayer.setPosition(stand.x, stand.y);
          if (this.localId) this.setWalking(this.localId, false);
          this.startChopVfx();
        } else {
          // Always walk to the station side-stand — never a stale mid-map pose
          this.gatherVfxPending = true;
          this.predictedTarget = stand;
          if (this.localId) this.setWalking(this.localId, true);
        }
      } else {
        this.gatherVfxPending = false;
        this.startChopVfx();
      }
      return;
    }

    if (msg.ok && msg.action === "gather_complete") {
      this.acting = false;
      this.gatherVfxPending = false;
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
      this.gatherVfxPending = false;
      this.acting = false;
      this.stopChopVfx(false);
      if (msg.zone && typeof msg.x === "number" && typeof msg.y === "number") {
        this.applyTravel(msg.zone, msg.x, msg.y);
      } else if (this.localPlayer && this.serverPos) {
        this.localPlayer.setPosition(this.serverPos.x, this.serverPos.y);
        this.releaseInput();
      }
      return;
    }

    if (msg.ok && msg.action === "cancel") {
      this.acting = false;
      this.gatherVfxPending = false;
      this.stopChopVfx(false);
      return;
    }

    if (!msg.ok) {
      this.acting = false;
      this.gatherVfxPending = false;
      this.stopChopVfx(false);
    }
  }

  /**
   * Stand pose for gathering: must be beside the resource sprite.
   * Prefer server-provided stand (x/y) only when it is actually in range of the station.
   */
  private resolveGatherStand(
    resourceId: string | null | undefined,
    standX?: number,
    standY?: number,
  ): { x: number; y: number } | undefined {
    const sprite = resourceId ? this.resourceSprites.get(resourceId) : undefined;
    const from = this.localPlayer
      ? { x: this.localPlayer.x, y: this.localPlayer.y }
      : { x: 0, y: 0 };

    if (sprite) {
      const res = { x: sprite.x, y: sprite.y };
      const approach = findClosestSideApproach(from, res);
      if (
        typeof standX === "number" &&
        typeof standY === "number" &&
        Number.isFinite(standX) &&
        Number.isFinite(standY) &&
        Math.hypot(standX - res.x, standY - res.y) <= 56
      ) {
        return { x: standX, y: standY };
      }
      return approach ?? { x: res.x - 28, y: res.y };
    }

    if (typeof standX === "number" && typeof standY === "number") {
      return { x: standX, y: standY };
    }
    return undefined;
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
    this.gatherVfxPending = false;
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
      // Re-use engage path so we walk back into range if we drifted
      this.tryEngageResource(resourceId);
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

      if (id !== this.localId && this.remoteTargets.has(id)) {
        const target = this.remoteTargets.get(id)!;
        const dist = Math.hypot(sprite.x - target.x, sprite.y - target.y);
        if (dist > ARRIVE_EPSILON_PX) st.moving = true;
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
    this.remoteTargets.delete(id);
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
    this.remoteTargets.clear();
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
}
