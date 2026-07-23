import type { ReactNode } from "react";
import type {
  InventorySlotDto,
  SkillProgressDto,
  Appearance,
  ProfessionId,
  TraitId,
  ChatMessageDto,
  ChatInboxThreadDto,
  PlayerSnapshot,
} from "@skilling-mmo/shared";
import { PROFESSION_LABELS, TRAIT_DEFS } from "@skilling-mmo/shared";
import { PixelAvatarPreview } from "./PixelAvatarPreview";
import { InventoryPanel } from "./InventoryPanel";
import { BankPanel } from "./BankPanel";
import { MarketPanel } from "./MarketPanel";
import { ChatPanel } from "./ChatPanel";

export type HudPanel = "inventory" | "bank" | "market";

export function GameHud({
  displayName,
  username,
  profession,
  traits,
  appearance,
  coins,
  status,
  skills,
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
}: {
  displayName: string;
  username: string;
  profession: ProfessionId;
  traits: TraitId[];
  appearance: Appearance;
  coins: number;
  status: string;
  skills: SkillProgressDto[];
  panel: HudPanel;
  onPanel: (p: HudPanel) => void;
  inventory: InventorySlotDto[];
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
}) {
  const traitName =
    traits[0] && TRAIT_DEFS[traits[0]] ? TRAIT_DEFS[traits[0]].name : null;

  let body: ReactNode = null;
  if (panel === "inventory") {
    body = <InventoryPanel slots={inventory} embedded />;
  } else if (panel === "bank") {
    body = (
      <BankPanel
        embedded
        inventory={inventory}
        bank={bank}
        token={token}
        apiBase={apiBase}
        onRefresh={onRefreshBank}
      />
    );
  } else {
    body = <MarketPanel embedded token={token} apiBase={apiBase} coins={coins} />;
  }

  return (
    <aside className="game-hud">
      <div className="hud-brand">Skilling MMO</div>

      <div className="hud-account">
        <PixelAvatarPreview appearance={appearance} scale={3} />
        <div className="hud-account-text">
          <strong>{displayName}</strong>
          <span className="muted">{PROFESSION_LABELS[profession]}</span>
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
          className={panel === "bank" ? "active" : ""}
          onClick={() => onPanel("bank")}
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
        <button type="button" onClick={onProfiles}>
          Profiles
        </button>
        <button type="button" className="danger-btn" onClick={onLogout}>
          Log out
        </button>
      </div>

      <div className="hud-section">
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
  );
}
