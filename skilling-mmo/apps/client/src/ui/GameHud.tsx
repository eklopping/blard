import { useState, type ReactNode } from "react";
import type {
  InventorySlotDto,
  SkillProgressDto,
  ClassProgressDto,
  ClassId,
  Appearance,
  ProfessionId,
  TraitId,
  ChatMessageDto,
  ChatInboxThreadDto,
  PlayerSnapshot,
  EquipmentLoadout,
  ItemLocation,
} from "@skilling-mmo/shared";
import { PROFESSION_LABELS, CLASS_LABELS, TRAIT_DEFS } from "@skilling-mmo/shared";
import { PixelAvatarPreview } from "./PixelAvatarPreview";
import { InventoryPanel } from "./InventoryPanel";
import { MarketPanel } from "./MarketPanel";
import { ChatPanel } from "./ChatPanel";
import { EquipmentWindow } from "./EquipmentWindow";
import { BankWindow } from "./BankWindow";

export type HudPanel = "inventory" | "market";

export function GameHud({
  displayName,
  username,
  profession,
  traits,
  appearance,
  coins,
  status,
  skills,
  classes,
  activeClass,
  onSetActiveClass,
  panel,
  onPanel,
  inventory,
  bank,
  token,
  apiBase,
  onRefreshBank,
  onProfiles,
  onLogout,
  selfId,
  chatMessages,
  chatInbox,
  mutedIds,
  onlinePlayers,
  chatError,
  onSendPublic,
  onSendDm,
  onOpenThread,
  onRefreshInbox,
  onMutePlayer,
  onUnmutePlayer,
  onLoadPublicChat,
  equipment,
  inventoryCapacity,
  onItemDrag,
  bankOpen,
  onBankOpen,
}: {
  displayName: string;
  username: string;
  profession: ProfessionId;
  traits: TraitId[];
  appearance: Appearance;
  coins: number;
  status: string;
  skills: SkillProgressDto[];
  classes: ClassProgressDto[];
  activeClass: ClassId | "";
  onSetActiveClass: (classId: ClassId) => void;
  panel: HudPanel;
  onPanel: (p: HudPanel) => void;
  inventory: InventorySlotDto[];
  inventoryCapacity: number;
  bank: InventorySlotDto[];
  token: string;
  apiBase: string;
  onRefreshBank: () => Promise<void>;
  onProfiles: () => void;
  onLogout: () => void;
  selfId: string;
  chatMessages: ChatMessageDto[];
  chatInbox: ChatInboxThreadDto[];
  mutedIds: Set<string>;
  onlinePlayers: PlayerSnapshot[];
  chatError: string;
  onSendPublic: (body: string) => void;
  onSendDm: (recipientId: string, body: string) => void;
  onOpenThread: (threadKey: string, otherPlayerId: string) => void;
  onRefreshInbox: () => void;
  onMutePlayer: (playerId: string) => void;
  onUnmutePlayer: (playerId: string) => void;
  onLoadPublicChat: () => void;
  equipment?: EquipmentLoadout;
  onItemDrag?: (from: ItemLocation, to: ItemLocation) => void;
  bankOpen: boolean;
  onBankOpen: (open: boolean) => void;
}) {
  const [equipOpen, setEquipOpen] = useState(false);
  const unlockedClasses = classes.filter((c) => c.unlocked);
  const selectedClass =
    (activeClass && unlockedClasses.some((c) => c.classId === activeClass)
      ? activeClass
      : unlockedClasses[0]?.classId) ?? "";
  const traitName =
    traits[0] && TRAIT_DEFS[traits[0]] ? TRAIT_DEFS[traits[0]].name : null;

  let body: ReactNode = null;
  if (panel === "inventory") {
    body = (
      <InventoryPanel
        slots={inventory}
        capacity={inventoryCapacity}
        embedded
        onItemDrag={onItemDrag}
      />
    );
  } else {
    body = <MarketPanel embedded token={token} apiBase={apiBase} coins={coins} />;
  }

  return (
    <>
      <aside className="game-hud">
        <div className="hud-brand">Skilling MMO</div>

        <div className="hud-account">
          <PixelAvatarPreview appearance={appearance} scale={3} />
          <div className="hud-account-text">
            <strong>{displayName}</strong>
            {unlockedClasses.length > 0 ? (
              <label className="hud-class-picker">
                <span className="hud-class-picker-label">Class</span>
                <select
                  value={selectedClass}
                  onChange={(e) => {
                    const next = e.target.value as ClassId;
                    if (next && next !== selectedClass) onSetActiveClass(next);
                  }}
                  aria-label="Active class"
                >
                  {unlockedClasses.map((c) => (
                    <option key={c.classId} value={c.classId}>
                      {CLASS_LABELS[c.classId]} · Lv {c.level}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted">{PROFESSION_LABELS[profession]}</span>
            )}
            {traitName && <span className="muted">{traitName}</span>}
            <span className="muted">@{username}</span>
            <span className="hud-coins">{coins}c · {status}</span>
          </div>
        </div>

        <div className="hud-nav-grid">
          <button
            type="button"
            className={panel === "inventory" ? "active" : ""}
            onClick={() => onPanel("inventory")}
          >
            Inventory
          </button>
          <button
            type="button"
            className={`equip-nav-btn ${bankOpen ? "active" : ""}`}
            onClick={() => {
              const next = !bankOpen;
              onBankOpen(next);
              if (next) void onRefreshBank();
            }}
          >
            Bank
          </button>
          <button
            type="button"
            className={panel === "market" ? "active" : ""}
            onClick={() => onPanel("market")}
          >
            Market
          </button>
          <button
            type="button"
            className={`equip-nav-btn ${equipOpen ? "active" : ""}`}
            onClick={() => setEquipOpen((v) => !v)}
          >
            Equipment
          </button>
          <button type="button" onClick={onProfiles}>
            Profiles
          </button>
          <button type="button" className="danger-btn" onClick={onLogout}>
            Log out
          </button>
        </div>

        <div className="hud-section hud-skills-section">
          <h2>Classes</h2>
          <ul className="hud-skills-list">
            {classes.filter((c) => c.unlocked).length === 0 ? (
              <li className="muted">No classes unlocked</li>
            ) : (
              classes
                .filter((c) => c.unlocked)
                .slice()
                .sort((a, b) => a.classId.localeCompare(b.classId))
                .map((c) => (
                  <li key={c.classId} className={c.classId === selectedClass ? "active-class" : ""}>
                    <span className="skill-name">{CLASS_LABELS[c.classId]}</span>
                    <span className="skill-level">Lv {c.level}</span>
                    <span className="skill-xp">{c.xp} xp</span>
                  </li>
                ))
            )}
          </ul>
        </div>

        <div className="hud-section hud-skills-section">
          <h2>Skills</h2>
          <ul className="hud-skills-list">
            {skills.length === 0 ? (
              <li className="muted">No skills yet</li>
            ) : (
              skills
                .slice()
                .sort((a, b) => a.skill.localeCompare(b.skill))
                .map((s) => (
                  <li key={s.skill}>
                    <span className="skill-name">{s.skill}</span>
                    <span className="skill-level">Lv {s.level}</span>
                    <span className="skill-xp">{s.xp} xp</span>
                  </li>
                ))
            )}
          </ul>
        </div>

        <div className="hud-section hud-chat-section">
          <h2>Chat</h2>
          <ChatPanel
            selfId={selfId}
            messages={chatMessages}
            inbox={chatInbox}
            mutedIds={mutedIds}
            onlinePlayers={onlinePlayers}
            error={chatError}
            onSendPublic={onSendPublic}
            onSendDm={onSendDm}
            onOpenThread={onOpenThread}
            onRefreshInbox={onRefreshInbox}
            onMute={onMutePlayer}
            onUnmute={onUnmutePlayer}
            onLoadPublic={onLoadPublicChat}
          />
        </div>

        <div className="hud-section hud-panel-body">{body}</div>
      </aside>

      <EquipmentWindow
        open={equipOpen}
        onClose={() => setEquipOpen(false)}
        loadout={equipment ?? {}}
        onItemDrag={onItemDrag}
      />

      <BankWindow
        open={bankOpen}
        onClose={() => onBankOpen(false)}
        bank={bank}
        onItemDrag={onItemDrag}
      />
    </>
  );
}
