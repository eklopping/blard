/** Zone layout, NPCs, portals, and shop catalog for the town hub. */

import type { Vec2 } from "./nav.js";

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
  /** Player spawn when entering this zone */
  spawn: Vec2;
  npcs: ZoneNpcDef[];
  resources: ZoneResourceDef[];
  /** Soft ground tint (Phaser hex) for bare-bones visual region */
  groundTint: number;
}

export const NPC_INTERACT_RANGE = 48;

export const ZONE_DEFS: Record<ZoneId, ZoneDef> = {
  [ZONES.TOWN]: {
    id: ZONES.TOWN,
    label: "Town",
    spawn: { x: 208, y: 208 },
    groundTint: 0x4a6b3d,
    npcs: [
      {
        id: "npc_shopkeeper",
        kind: NPC_KINDS.SHOPKEEPER,
        name: "Shopkeeper",
        x: 144,
        y: 176,
        interactRange: NPC_INTERACT_RANGE,
      },
      {
        id: "npc_storehouse",
        kind: NPC_KINDS.STOREHOUSE,
        name: "Storehouse",
        x: 272,
        y: 176,
        interactRange: NPC_INTERACT_RANGE,
      },
      {
        id: "portal_town_exit",
        kind: NPC_KINDS.EXIT,
        name: "Town Exit",
        x: 208,
        y: 304,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [],
  },
  [ZONES.WOODS]: {
    id: ZONES.WOODS,
    label: "Woods",
    spawn: { x: 880, y: 208 },
    groundTint: 0x2d5530,
    npcs: [
      {
        id: "portal_woods_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: 800,
        y: 176,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "tree_normal", kind: "tree", x: 960, y: 240 }],
  },
  [ZONES.MINES]: {
    id: ZONES.MINES,
    label: "Mines",
    spawn: { x: 208, y: 720 },
    groundTint: 0x4a4a4a,
    npcs: [
      {
        id: "portal_mines_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: 144,
        y: 672,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "stone_chunk", kind: "rock", x: 288, y: 752 }],
  },
  [ZONES.FARM]: {
    id: ZONES.FARM,
    label: "Farm",
    spawn: { x: 880, y: 720 },
    groundTint: 0x6b5a30,
    npcs: [
      {
        id: "portal_farm_return",
        kind: NPC_KINDS.RETURN,
        name: "Return to Town",
        x: 800,
        y: 672,
        interactRange: NPC_INTERACT_RANGE,
      },
    ],
    resources: [{ id: "wheat_plot", kind: "crop", x: 960, y: 752 }],
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
