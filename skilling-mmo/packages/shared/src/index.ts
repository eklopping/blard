/** Skill / XP / item constants and client↔server protocol. */

export const TICK_MS = 600;

export const SKILLS = {
  WOODCUTTING: "woodcutting",
  // TODO: mining, fishing, crafting
} as const;

export type SkillId = (typeof SKILLS)[keyof typeof SKILLS];

/** XP required to reach level (index = level). Level 1 starts with 0 XP. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += Math.floor(l + 300 * Math.pow(2, l / 7));
  }
  return Math.floor(total / 4);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 99 && xpForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}

export const ITEMS = {
  LOGS: "logs",
  COINS: "coins",
  OAK_LOGS: "oak_logs",
} as const;

export type ItemId = (typeof ITEMS)[keyof typeof ITEMS] | string;

export interface ItemDef {
  id: ItemId;
  name: string;
  stackable: boolean;
  maxStack: number;
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  [ITEMS.LOGS]: { id: ITEMS.LOGS, name: "Logs", stackable: true, maxStack: 1000 },
  [ITEMS.OAK_LOGS]: { id: ITEMS.OAK_LOGS, name: "Oak logs", stackable: true, maxStack: 1000 },
  [ITEMS.COINS]: { id: ITEMS.COINS, name: "Coins", stackable: true, maxStack: 2_147_483_647 },
};

export const WOODCUTTING = {
  NORMAL_TREE: {
    resourceId: "tree_normal",
    requiredLevel: 1,
    ticksToChop: 5,
    xp: 25,
    itemId: ITEMS.LOGS,
    itemQty: 1,
    interactRange: 48,
  },
  // TODO: oak, willow, etc.
} as const;

export const INVENTORY_SIZE = 28;
export const BANK_SIZE = 100;

/** Client → server intents */
export type ClientMessage =
  | { type: "Move"; x: number; y: number }
  | { type: "InteractResource"; resourceId: string }
  | { type: "CancelAction" };

/** Server → client events */
export type ServerMessage =
  | { type: "StateSnapshot"; players: PlayerSnapshot[]; resources: ResourceSnapshot[]; you: SelfSnapshot }
  | { type: "StateDelta"; players?: PlayerSnapshot[]; resources?: ResourceSnapshot[] }
  | { type: "ActionResult"; ok: boolean; reason?: string; action?: string }
  | { type: "InventoryUpdate"; slots: InventorySlotDto[] }
  | { type: "SkillUpdate"; skill: SkillId; level: number; xp: number }
  | { type: "BankUpdate"; slots: BankSlotDto[] };

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  action?: string | null;
}

export interface ResourceSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  available: boolean;
}

export interface SelfSnapshot {
  playerId: string;
  inventory: InventorySlotDto[];
  skills: SkillProgressDto[];
  coins: number;
}

export interface InventorySlotDto {
  slot: number;
  itemId: string | null;
  quantity: number;
}

export interface BankSlotDto {
  slot: number;
  itemId: string | null;
  quantity: number;
}

export interface SkillProgressDto {
  skill: SkillId;
  level: number;
  xp: number;
}

/** Marketplace DTOs (mirrored by API) */
export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";

export interface MarketOrderDto {
  id: string;
  playerId: string;
  side: OrderSide;
  itemId: string;
  price: number;
  quantity: number;
  filledQty: number;
  status: OrderStatus;
  createdAt: string;
}

export interface PlaceOrderRequest {
  side: OrderSide;
  itemId: string;
  price: number;
  quantity: number;
}

export interface AuthRegisterRequest {
  username: string;
  password: string;
  displayName?: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  playerId: string;
  username: string;
  displayName: string;
}
