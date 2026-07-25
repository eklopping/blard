/** Skill / XP / item constants and client↔server protocol. */

import type { TraitId } from "./traits.js";
import type { Appearance } from "./avatar.js";
import type { ZoneId, NpcKind, OpenPanelKind } from "./zones.js";

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
  PIXEL_WALK_A,
  PIXEL_WALK_B,
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
  STONE: "stone",
  WHEAT: "wheat",
  BASIC_BACKPACK: "basic_backpack",
  BASIC_AXE: "basic_axe",
  BASIC_PICKAXE: "basic_pickaxe",
  BASIC_SCYTHE: "basic_scythe",
} as const;

export type ItemId = (typeof ITEMS)[keyof typeof ITEMS] | string;

export interface ItemDef {
  id: ItemId;
  name: string;
  stackable: boolean;
  maxStack: number;
  /** Paper-doll slots this item can be equipped into */
  equipSlots?: EquipmentSlotId[];
  /** Extra inventory slots when equipped to `back` */
  backpackBonusSlots?: number;
  /** Tool bonuses when equipped to `primary` */
  tool?: {
    skills: SkillId[];
    xpMult: number;
    outputMult: number;
  };
}

export const DEFAULT_MAX_STACK = 100;

/** Usable bag slots with nothing equipped. */
export const INVENTORY_BASE_SLOTS = 6;
/** One backpack "row" of storage. */
export const INVENTORY_ROW_SIZE = 6;
/** Max slots persisted per character (base + future backpacks). */
export const INVENTORY_SIZE = INVENTORY_BASE_SLOTS + INVENTORY_ROW_SIZE * 5;

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

export const ITEM_DEFS: Record<string, ItemDef> = {
  [ITEMS.LOGS]: { id: ITEMS.LOGS, name: "Logs", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.OAK_LOGS]: { id: ITEMS.OAK_LOGS, name: "Oak logs", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.STONE]: { id: ITEMS.STONE, name: "Stone", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.WHEAT]: { id: ITEMS.WHEAT, name: "Wheat", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.COINS]: { id: ITEMS.COINS, name: "Coins", stackable: true, maxStack: DEFAULT_MAX_STACK },
  [ITEMS.BASIC_BACKPACK]: {
    id: ITEMS.BASIC_BACKPACK,
    name: "Basic Backpack",
    stackable: false,
    maxStack: 1,
    equipSlots: ["back"],
    backpackBonusSlots: INVENTORY_ROW_SIZE,
  },
  [ITEMS.BASIC_AXE]: {
    id: ITEMS.BASIC_AXE,
    name: "Basic Axe",
    stackable: false,
    maxStack: 1,
    equipSlots: ["primary"],
    tool: { skills: [SKILLS.WOODCUTTING], xpMult: 2, outputMult: 2 },
  },
  [ITEMS.BASIC_PICKAXE]: {
    id: ITEMS.BASIC_PICKAXE,
    name: "Basic Pickaxe",
    stackable: false,
    maxStack: 1,
    equipSlots: ["primary"],
    tool: { skills: [SKILLS.MINING], xpMult: 2, outputMult: 2 },
  },
  [ITEMS.BASIC_SCYTHE]: {
    id: ITEMS.BASIC_SCYTHE,
    name: "Basic Scythe",
    stackable: false,
    maxStack: 1,
    equipSlots: ["primary"],
    tool: { skills: [SKILLS.FARMING], xpMult: 2, outputMult: 2 },
  },
};

export function maxStackFor(itemId: string): number {
  return ITEM_DEFS[itemId]?.maxStack ?? DEFAULT_MAX_STACK;
}

export function isEquipmentSlotId(value: string): value is EquipmentSlotId {
  return (EQUIPMENT_SLOT_IDS as readonly string[]).includes(value);
}

export function canEquipInSlot(itemId: string, slot: EquipmentSlotId): boolean {
  const slots = ITEM_DEFS[itemId]?.equipSlots;
  return Boolean(slots?.includes(slot));
}

export function defaultEquipSlot(itemId: string): EquipmentSlotId | null {
  return ITEM_DEFS[itemId]?.equipSlots?.[0] ?? null;
}

export function backpackBonusFor(itemId: string | null | undefined): number {
  if (!itemId) return 0;
  return ITEM_DEFS[itemId]?.backpackBonusSlots ?? 0;
}

export function inventoryCapacity(equipment: EquipmentLoadout | null | undefined): number {
  const back = equipment?.back?.itemId;
  const bonus = backpackBonusFor(back);
  return Math.min(INVENTORY_SIZE, INVENTORY_BASE_SLOTS + bonus);
}

/** True if any inventory slot at or beyond `capacity` still holds items. */
export function hasItemsBeyondCapacity(
  inventory: { slot: number; itemId: string | null; quantity: number }[],
  capacity: number,
): boolean {
  return inventory.some((s) => s.slot >= capacity && s.itemId && s.quantity > 0);
}

export function professionStarterTool(profession: ProfessionId): string {
  switch (profession) {
    case PROFESSIONS.MINER:
      return ITEMS.BASIC_PICKAXE;
    case PROFESSIONS.FARMER:
      return ITEMS.BASIC_SCYTHE;
    case PROFESSIONS.WOODSMAN:
    default:
      return ITEMS.BASIC_AXE;
  }
}

/** Starter loadout: basic backpack + profession tool (both equipped). */
export function professionStarterEquipment(profession: ProfessionId): EquipmentLoadout {
  return {
    back: { itemId: ITEMS.BASIC_BACKPACK, quantity: 1 },
    primary: { itemId: professionStarterTool(profession), quantity: 1 },
  };
}

/** Starter items placed in the bag so the player equips them themselves. */
export function professionStarterBagItems(
  profession: ProfessionId,
): { itemId: string; quantity: number }[] {
  return [
    { itemId: ITEMS.BASIC_BACKPACK, quantity: 1 },
    { itemId: professionStarterTool(profession), quantity: 1 },
  ];
}

export function toolBonusForSkill(
  equipment: EquipmentLoadout | null | undefined,
  skill: SkillId,
): { xpMult: number; outputMult: number } {
  const toolId = equipment?.primary?.itemId;
  const tool = toolId ? ITEM_DEFS[toolId]?.tool : undefined;
  if (!tool || !tool.skills.includes(skill)) {
    return { xpMult: 1, outputMult: 1 };
  }
  return { xpMult: tool.xpMult, outputMult: tool.outputMult };
}

export function parseEquipmentJson(raw: string | null | undefined): EquipmentLoadout {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as EquipmentLoadout;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function serializeEquipment(loadout: EquipmentLoadout): string {
  return JSON.stringify(loadout);
}

/** Drag-and-drop locations for inventory / equipment / bank management. */
export type ItemLocation =
  | { kind: "inventory"; slot: number }
  | { kind: "equipment"; slot: EquipmentSlotId }
  | { kind: "bank"; slot: number };

export const WOODCUTTING = {
  NORMAL_TREE: {
    resourceId: "tree_normal",
    requiredLevel: 1,
    ticksToChop: 5,
    xp: 1,
    itemId: ITEMS.LOGS,
    itemQty: 1,
    interactRange: 48,
  },
} as const;

export const MINING = {
  STONE: {
    resourceId: "stone_chunk",
    requiredLevel: 1,
    ticksToMine: 5,
    xp: 1,
    itemId: ITEMS.STONE,
    itemQty: 1,
    interactRange: 48,
  },
} as const;

export const FARMING = {
  WHEAT: {
    resourceId: "wheat_plot",
    requiredLevel: 1,
    ticksToHarvest: 5,
    xp: 1,
    itemId: ITEMS.WHEAT,
    itemQty: 1,
    interactRange: 48,
  },
} as const;

export {
  ZONES,
  ZONE_LABELS,
  TRAVEL_ZONES,
  ZONE_DEFS,
  NPC_KINDS,
  NPC_INTERACT_RANGE,
  TOWN_SPAWN,
  SHOP_BUY,
  SHOP_SELL,
  isZoneId,
  allZoneNpcs,
  findNpc,
  zoneForResource,
  shopBuyPrice,
  shopSellPrice,
  type ZoneId,
  type NpcKind,
  type ZoneNpcDef,
  type ZoneResourceDef,
  type ZoneDef,
  type OpenPanelKind,
} from "./zones.js";

export const BANK_SIZE = 100;

export const CHAT_MAX_BODY = 200;
export const CHAT_PUBLIC_RATE_MS = 1000;
export const CHAT_DM_RATE_MS = 500;
export const CHAT_HISTORY_LIMIT = 50;

export type ChatChannel = "PUBLIC" | "DIRECT";

/** Ephemeral notices (login, etc.) — never persisted to chat history. */
export const SYSTEM_CHAT_SENDER_ID = "system";

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

export function isSystemChatMessage(message: Pick<ChatMessageDto, "senderId">): boolean {
  return message.senderId === SYSTEM_CHAT_SENDER_ID;
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
  | { type: "InteractNpc"; npcId: string }
  | { type: "TravelZone"; zone: ZoneId }
  | { type: "ShopBuy"; itemId: string; quantity?: number }
  | { type: "ShopSell"; itemId: string; quantity: number }
  | { type: "SyncInventory" }
  | { type: "CancelAction" }
  | { type: "ChatPublic"; body: string }
  | { type: "ChatDm"; recipientId: string; body: string }
  | { type: "ItemDrag"; from: ItemLocation; to: ItemLocation };

/** Server → client events */
export type ServerMessage =
  | {
      type: "StateSnapshot";
      players: PlayerSnapshot[];
      resources: ResourceSnapshot[];
      npcs: NpcSnapshot[];
      you: SelfSnapshot;
    }
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
      equipmentJson?: string;
      inventoryCapacity?: number;
      coins?: number;
      /** Present on successful travel — client must apply map switch from this */
      zone?: ZoneId;
      x?: number;
      y?: number;
      skill?: SkillProgressDto;
      inventory?: InventorySlotDto[];
    }
  | { type: "OpenPanel"; panel: OpenPanelKind }
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
  zone?: ZoneId;
}

export interface ResourceSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  available: boolean;
}

export interface NpcSnapshot {
  id: string;
  kind: NpcKind;
  name: string;
  x: number;
  y: number;
  zoneId: ZoneId;
}

export interface SelfSnapshot {
  playerId: string;
  inventory: InventorySlotDto[];
  skills: SkillProgressDto[];
  coins: number;
  profession?: ProfessionId;
  traits?: TraitId[];
  appearance?: Appearance;
  equipment?: EquipmentLoadout;
  inventoryCapacity?: number;
  zone?: ZoneId;
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
