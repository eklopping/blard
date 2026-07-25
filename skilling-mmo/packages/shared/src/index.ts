/** Skill / XP / item constants and client↔server protocol. */

import type { TraitId } from "./traits.js";
import type { Appearance } from "./avatar.js";

export const TICK_MS = 600;

export const MAX_CHARACTERS_PER_ACCOUNT = 3;

export const PROFESSIONS = {
  WOODSMAN: "woodsman",
  FARMER: "farmer",
  MINER: "miner",
} as const;

export type ProfessionId = (typeof PROFESSIONS)[keyof typeof PROFESSIONS];

export const PROFESSION_LABELS: Record<ProfessionId, string> = {
  [PROFESSIONS.WOODSMAN]: "Woodsman",
  [PROFESSIONS.FARMER]: "Farmer",
  [PROFESSIONS.MINER]: "Miner",
};

export const PROFESSION_DESCRIPTIONS: Record<ProfessionId, string> = {
  [PROFESSIONS.WOODSMAN]: "Harvest timber and craft from the forest.",
  [PROFESSIONS.FARMER]: "Grow crops and tend the land.",
  [PROFESSIONS.MINER]: "Extract ore and gems from the earth.",
};

/** Skills available to every profession. */
export const GENERAL_SKILLS = {
  // TODO: combat, trading, survival
} as const;

export type GeneralSkillId = (typeof GENERAL_SKILLS)[keyof typeof GENERAL_SKILLS];

export const SKILLS = {
  WOODCUTTING: "woodcutting",
  FARMING: "farming",
  MINING: "mining",
} as const;

export type SkillId = (typeof SKILLS)[keyof typeof SKILLS] | GeneralSkillId;

/** Starting profession skills (level 1 at character creation). */
export const PROFESSION_STARTING_SKILLS: Record<ProfessionId, SkillId[]> = {
  [PROFESSIONS.WOODSMAN]: [SKILLS.WOODCUTTING],
  [PROFESSIONS.FARMER]: [SKILLS.FARMING],
  [PROFESSIONS.MINER]: [SKILLS.MINING],
};

export {
  TRAITS,
  TRAIT_DEFS,
  STARTER_TRAIT_IDS,
  hasTrait,
  applyActionSpeedTicks,
  applyXpGain,
  applyOutputQty,
  type TraitId,
  type TraitDef,
} from "./traits.js";

export {
  DEFAULT_APPEARANCE,
  HAIR_COLORS,
  SKIN_COLORS,
  SHIRT_COLORS,
  PANTS_COLORS,
  PIXEL_TEMPLATE,
  PIXEL_W,
  PIXEL_H,
  EYE_COLOR,
  parseHex,
  colorForPixel,
  pixelAvatarRgba,
  appearanceKey,
  type Appearance,
} from "./avatar.js";

export {
  TILE_SIZE,
  WORLD_TILES_W,
  WORLD_TILES_H,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
  MOVE_SPEED_PX_PER_SEC,
  MOVE_TICK_MS,
  ARRIVE_EPSILON_PX,
  ACTION_REPEAT_COOLDOWN_MS,
  RESOURCE_SIDE_OFFSET_PX,
  createOpenWalkGrid,
  worldToTile,
  tileToWorldCenter,
  clampToWorld,
  isWalkable,
  snapToTileCenter,
  stepToward,
  findApproachPoint,
  findClosestSideApproach,
  type Vec2,
  type TileCoord,
  type WalkGrid,
} from "./nav.js";

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

export const DEFAULT_MAX_STACK = 100;

export const ITEM_DEFS: Record<string, ItemDef> = {
  [ITEMS.LOGS]: { id: ITEMS.LOGS, name: "Logs", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.OAK_LOGS]: { id: ITEMS.OAK_LOGS, name: "Oak logs", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.COINS]: { id: ITEMS.COINS, name: "Coins", stackable: true, maxStack: DEFAULT_MAX_STACK },
};

export function maxStackFor(itemId: string): number {
  return ITEM_DEFS[itemId]?.maxStack ?? DEFAULT_MAX_STACK;
}

/** Paper-doll equipment slots (UI + future equip rules). */
export const EQUIPMENT_SLOT_IDS = [
  "back",
  "helmet",
  "chestplate",
  "leggings",
  "boots",
  "cape",
  "accessory_1",
  "accessory_2",
  "accessory_3",
  "accessory_4",
  "accessory_5",
  "primary",
] as const;

export type EquipmentSlotId = (typeof EQUIPMENT_SLOT_IDS)[number];

export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlotId, string> = {
  back: "Back (Bag)",
  helmet: "Helmet",
  chestplate: "Chestplate",
  leggings: "Leggings",
  boots: "Boots",
  cape: "Overcoat / Cape",
  accessory_1: "Accessory",
  accessory_2: "Accessory",
  accessory_3: "Accessory",
  accessory_4: "Accessory",
  accessory_5: "Accessory",
  primary: "Weapon / Tool",
};

export type EquipmentLoadout = Partial<Record<EquipmentSlotId, { itemId: string; quantity: number } | null>>;

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

export const CHAT_MAX_BODY = 200;
export const CHAT_PUBLIC_RATE_MS = 1000;
export const CHAT_DM_RATE_MS = 500;
export const CHAT_HISTORY_LIMIT = 50;

export type ChatChannel = "PUBLIC" | "DIRECT";

export interface ChatMessageDto {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  threadKey: string | null;
  body: string;
  createdAt: string;
}

export interface ChatInboxThreadDto {
  threadKey: string;
  otherPlayerId: string;
  otherPlayerName: string;
  lastBody: string;
  lastAt: string;
}

export function dmThreadKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function validateChatBody(
  raw: string,
): { ok: true; body: string } | { ok: false; error: "empty" | "too_long" } {
  const body = raw.trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > CHAT_MAX_BODY) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

/** Client → server intents */
export type ClientMessage =
  | { type: "Move"; x: number; y: number }
  | { type: "InteractResource"; resourceId: string }
  | { type: "CancelAction" }
  | { type: "ChatPublic"; body: string }
  | { type: "ChatDm"; recipientId: string; body: string };

/** Server → client events */
export type ServerMessage =
  | { type: "StateSnapshot"; players: PlayerSnapshot[]; resources: ResourceSnapshot[]; you: SelfSnapshot }
  | { type: "StateDelta"; players?: PlayerSnapshot[]; resources?: ResourceSnapshot[] }
  | {
      type: "ActionResult";
      ok: boolean;
      reason?: string;
      action?: string;
      resourceId?: string;
      /** Flat skill fields (preferred over nested `skill`) */
      skillId?: SkillId;
      skillLevel?: number;
      skillXp?: number;
      inventoryJson?: string;
      skill?: SkillProgressDto;
      inventory?: InventorySlotDto[];
    }
  | { type: "InventoryUpdate"; slots: InventorySlotDto[] }
  | { type: "SkillUpdate"; skill: SkillId; level: number; xp: number }
  | { type: "BankUpdate"; slots: BankSlotDto[] }
  | { type: "ChatMessage"; message: ChatMessageDto }
  | { type: "ChatError"; error: string };

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  action?: string | null;
  appearance?: Appearance;
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
  profession?: ProfessionId;
  traits?: TraitId[];
  appearance?: Appearance;
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
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

/** Account-level session (no character selected yet). */
export interface AccountAuthResponse {
  accessToken: string;
  username: string;
}

/** Character selected — includes playerId for game/API routes. */
export interface CharacterAuthResponse {
  accessToken: string;
  username: string;
  playerId: string;
  displayName: string;
  profession: ProfessionId;
  traits: TraitId[];
  appearance: Appearance;
}

export type AuthResponse = AccountAuthResponse | CharacterAuthResponse;

export function isCharacterSession(
  auth: AuthResponse,
): auth is CharacterAuthResponse {
  return "playerId" in auth && typeof auth.playerId === "string";
}

export interface CharacterSummary {
  id: string;
  name: string;
  profession: ProfessionId;
  coins: number;
  createdAt: string;
  sortOrder: number;
  traits: TraitId[];
  appearance: Appearance;
}

export interface CharacterListResponse {
  characters: CharacterSummary[];
  maxCharacters: number;
  slotsRemaining: number;
}

export interface CreateCharacterRequest {
  name: string;
  profession: ProfessionId;
  trait: TraitId;
  appearance: Appearance;
}

export interface RenameCharacterRequest {
  name: string;
}

export interface ReorderCharactersRequest {
  orderedIds: string[];
}

export interface SelectCharacterRequest {
  playerId: string;
}
