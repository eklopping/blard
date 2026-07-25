/** Zone layout, NPCs, portals, and shop catalog for the town hub.

Each zone is its own full-size map (same WORLD dimensions). Coordinates are
local to that map — players only see the zone they are currently in.
Spawns and POIs are intentionally offset so travel is visually obvious.
*/

import type { Vec2 } from "./nav.js";
import { WORLD_WIDTH_PX, WORLD_HEIGHT_PX } from "./nav.js";

export const ZONES = {
  TOWN: "town",
  WOODS: "woods",
  MINES: "mines",
  FARM: "farm",
} as const;

export type ZoneId = (typeof ZONES)[keyof typeof ZONES];

export const ZONE_LABELS: Record<ZoneId, string> = {
  [ZONES.TOWN]: "Town",
  [ZONES.WOODS]: "Woods",
  [ZONES.MINES]: "Mines",
  [ZONES.FARM]: "Farm",
};

/** Gather destinations reachable from the town exit travel map. */
export const TRAVEL_ZONES: ZoneId[] = [ZONES.WOODS, ZONES.MINES, ZONES.FARM];

export const NPC_KINDS = {
  SHOPKEEPER: "shopkeeper",
  STOREHOUSE: "storehouse",
  EXIT: "exit",
  RETURN: "return",
} as const;

export type NpcKind = (typeof NPC_KINDS)[keyof typeof NPC_KINDS];

export interface ZoneNpcDef {
  id: string;
  kind: NpcKind;
  name: string;
  x: number;
  y: number;
  interactRange: number;
}

export interface ZoneResourceDef {
  id: string;
  kind: string;
  x: number;
  y: number;
}

export interface ZoneDef {
  id: ZoneId;
  label: string;
  /** Player spawn when entering this zone (local map coords) */
  spawn: Vec2;
  npcs: ZoneNpcDef[];
  resources: ZoneResourceDef[];
  /** Soft ground tint (Phaser hex) for this map */
  groundTint: number;
  /** Camera / clear color for this map */
  skyColor: number;
}

export const NPC_INTERACT_RANGE = 56;

const CX = Math.floor(WORLD_WIDTH_PX / 2);
const CY = Math.floor(WORLD_HEIGHT_PX / 2);

/**
 * Each zone reuses the full world map bounds with its own local placements.
 * Travel teleports the player between maps (same room, different zone state).
 */
export const ZONE_DEFS: Record<ZoneId, ZoneDef> = {
  [ZONES.TOWN]: {
    id: ZONES.TOWN,
    label: "Town",
    spawn: { x: CX, y: CY - 40 },
    groundTint: 0x5a8a45,
    skyColor: 0x1a2e1a,
    npcs: [
      {
        id: "npc_shopkeeper",
        kind: NPC_KINDS.SHOPKEEPER,
        name: "Shopkeeper",
        x: CX - 180,
        y: CY - 100,
        interactRange: NPC_INTERACT_RANGE,
      },
      {
        id: "npc_storehouse",
        kind: NPC_KINDS.STOREHOUSE,
        name: "Storehouse",
        x: CX + 180,
        y: CY - 100,
        interactRange: NPC_INTERACT_RANGE,
      },
      {
        id: "portal_town_exit",
        kind: NPC_KINDS.EXIT,
        name: "Town Exit",
        x: CX,
        y: CY + 220,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [],
  },
  [ZONES.WOODS]: {
    id: ZONES.WOODS,
    label: "Woods",
    // West side of the map — clearly different from town center
    spawn: { x: 280, y: CY },
    groundTint: 0x1e4a28,
    skyColor: 0x0a1810,
    npcs: [
      {
        id: "portal_woods_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: 160,
        y: CY - 120,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "tree_normal", kind: "tree", x: 980, y: CY + 40 }],
  },
  [ZONES.MINES]: {
    id: ZONES.MINES,
    label: "Mines",
    // South side
    spawn: { x: CX, y: WORLD_HEIGHT_PX - 200 },
    groundTint: 0x555555,
    skyColor: 0x121212,
    npcs: [
      {
        id: "portal_mines_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: CX,
        y: 160,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "stone_chunk", kind: "rock", x: CX + 120, y: CY }],
  },
  [ZONES.FARM]: {
    id: ZONES.FARM,
    label: "Farm",
    // East side
    spawn: { x: WORLD_WIDTH_PX - 280, y: CY },
    groundTint: 0x8a7030,
    skyColor: 0x2a220e,
    npcs: [
      {
        id: "portal_farm_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: WORLD_WIDTH_PX - 160,
        y: CY - 120,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "wheat_plot", kind: "crop", x: 300, y: CY + 40 }],
  },
};

export function isZoneId(value: string): value is ZoneId {
  return Object.values(ZONES).includes(value as ZoneId);
}

export function allZoneNpcs(): ZoneNpcDef[] {
  return Object.values(ZONE_DEFS).flatMap((z) => z.npcs);
}

export function findNpc(npcId: string): (ZoneNpcDef & { zoneId: ZoneId }) | undefined {
  for (const zone of Object.values(ZONE_DEFS)) {
    const npc = zone.npcs.find((n) => n.id === npcId);
    if (npc) return { ...npc, zoneId: zone.id };
  }
  return undefined;
}

export function zoneForResource(resourceId: string): ZoneId | undefined {
  for (const zone of Object.values(ZONE_DEFS)) {
    if (zone.resources.some((r) => r.id === resourceId)) return zone.id;
  }
  return undefined;
}

/** Town spawn used for new characters and returns. */
export const TOWN_SPAWN = ZONE_DEFS[ZONES.TOWN].spawn;

/** Fixed-price shop: buy equipment / sell gatherables. */
export const SHOP_BUY: { itemId: string; price: number }[] = [
  { itemId: "basic_axe", price: 50 },
  { itemId: "basic_pickaxe", price: 50 },
  { itemId: "basic_scythe", price: 50 },
  { itemId: "basic_backpack", price: 75 },
];

export const SHOP_SELL: { itemId: string; price: number }[] = [
  { itemId: "logs", price: 2 },
  { itemId: "stone", price: 2 },
  { itemId: "wheat", price: 2 },
];

export function shopBuyPrice(itemId: string): number | undefined {
  return SHOP_BUY.find((e) => e.itemId === itemId)?.price;
}

export function shopSellPrice(itemId: string): number | undefined {
  return SHOP_SELL.find((e) => e.itemId === itemId)?.price;
}

export type OpenPanelKind = "shop" | "bank" | "travel";
