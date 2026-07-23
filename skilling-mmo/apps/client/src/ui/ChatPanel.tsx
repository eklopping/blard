import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessageDto,
  ChatInboxThreadDto,
  PlayerSnapshot,
} from "@skilling-mmo/shared";
import { CHAT_MAX_BODY } from "@skilling-mmo/shared";

type ChatView = "public" | "inbox" | "thread";

export function ChatPanel({
  selfId,
  messages,
  inbox,
  mutedIds,
  onlinePlayers,
  error,
  onSendPublic,
  onSendDm,
  onOpenThread,
  onRefreshInbox,
  onMute,
  onUnmute,
  onLoadPublic,
}: {
  selfId: string;
  messages: ChatMessageDto[];
  inbox: ChatInboxThreadDto[];
  mutedIds: Set<string>;
  onlinePlayers: PlayerSnapshot[];
  error: string;
  onSendPublic: (body: string) => void;
  onSendDm: (recipientId: string, body: string) => void;
  onOpenThread: (threadKey: string, otherPlayerId: string) => void;
  onRefreshInbox: () => void;
  onMute: (playerId: string) => void;
  onUnmute: (playerId: string) => void;
  onLoadPublic: () => void;
}) {
  const [view, setView] = useState<ChatView>("public");
  const [draft, setDraft] = useState("");
  const [threadOtherId, setThreadOtherId] = useState<string | null>(null);
  const [threadOtherName, setThreadOtherName] = useState("");
  const [dmPick, setDmPick] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, view]);

  const othersOnline = useMemo(
    () => onlinePlayers.filter((p) => p.id !== selfId),
    [onlinePlayers, selfId],
  );

  function submit() {
    const body = draft.trim();
    if (!body) return;
    if (view === "public") onSendPublic(body);
    else if (view === "thread" && threadOtherId) onSendDm(threadOtherId, body);
    setDraft("");
  }

  function openPublic() {
    setView("public");
    onLoadPublic();
  }

  function openInbox() {
    setView("inbox");
    onRefreshInbox();
  }

  function openThread(t: ChatInboxThreadDto) {
    setThreadOtherId(t.otherPlayerId);
    setThreadOtherName(t.otherPlayerName);
    setView("thread");
    onOpenThread(t.threadKey, t.otherPlayerId);
  }

  function startDmFromPick() {
    const p = othersOnline.find((x) => x.id === dmPick || x.name.toLowerCase() === dmPick.toLowerCase());
    if (!p) return;
    setThreadOtherId(p.id);
    setThreadOtherName(p.name);
    setView("thread");
    onOpenThread(
      [selfId, p.id].sort().join(":"),
      p.id,
    );
  }

  return (
    <div className="hud-chat">
      <div className="hud-chat-tabs">
        <button type="button" className={view === "public" ? "active" : ""} onClick={openPublic}>
          Public
        </button>
        <button type="button" className={view === "inbox" || view === "thread" ? "active" : ""} onClick={openInbox}>
          Inbox
        </button>
      </div>

      {view === "inbox" && (
        <div className="hud-chat-inbox">
          <div className="hud-chat-new-dm">
            <input
              list="online-players"
              placeholder="DM player…"
              value={dmPick}
              onChange={(e) => setDmPick(e.target.value)}
            />
            <datalist id="online-players">
              {othersOnline.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <button type="button" onClick={startDmFromPick}>
              Open
            </button>
          </div>
          <ul>
            {inbox.length === 0 && <li className="muted">No DMs yet</li>}
            {inbox.map((t) => (
              <li key={t.threadKey}>
                <button type="button" className="linkish" onClick={() => openThread(t)}>
                  <strong>{t.otherPlayerName}</strong>
                  <span className="muted">{t.lastBody}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(view === "public" || view === "thread") && (
        <>
          {view === "thread" && (
            <div className="hud-chat-thread-head">
              <span>DM: {threadOtherName}</span>
              {threadOtherId &&
                (mutedIds.has(threadOtherId) ? (
                  <button type="button" onClick={() => onUnmute(threadOtherId)}>
                    Unmute
                  </button>
                ) : (
                  <button type="button" onClick={() => onMute(threadOtherId)}>
                    Mute
                  </button>
                ))}
            </div>
          )}
          <ul className="hud-chat-feed">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="chat-name"
                  onClick={() => {
                    if (m.senderId === selfId) return;
                    setThreadOtherId(m.senderId);
                    setThreadOtherName(m.senderName);
                    setView("thread");
                    onOpenThread([selfId, m.senderId].sort().join(":"), m.senderId);
                  }}
                  title="Open DM"
                >
                  {m.senderName}
                </button>
                {m.senderId !== selfId && (
                  <button
                    type="button"
                    className="chat-mute"
                    onClick={() =>
                      mutedIds.has(m.senderId) ? onUnmute(m.senderId) : onMute(m.senderId)
                    }
                  >
                    {mutedIds.has(m.senderId) ? "Unmute" : "Mute"}
                  </button>
                )}
                <span className="chat-body">{m.body}</span>
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
          <div className="hud-chat-compose">
            <input
              maxLength={CHAT_MAX_BODY}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={view === "public" ? "Say something…" : "Message…"}
            />
            <button type="button" onClick={submit}>
              Send
            </button>
          </div>
        </>
      )}
      {error && <div className="hud-chat-error">{error}</div>}
    </div>
  );
}
