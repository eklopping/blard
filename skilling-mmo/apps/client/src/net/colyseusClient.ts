import { Client, Room } from "colyseus.js";
import type {
  ClientMessage,
  ServerMessage,
  InventorySlotDto,
  SkillProgressDto,
} from "@skilling-mmo/shared";

function defaultWsUrl(): string {
  if (typeof window !== "undefined" && window.location?.host) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}`;
  }
  return "ws://127.0.0.1:2567";
}

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined)?.trim() || defaultWsUrl();

export interface GameConnection {
  sendIntent: (msg: ClientMessage) => void;
  leave: () => void;
}

export interface ConnectHandlers {
  onSnapshot: (snap: Extract<ServerMessage, { type: "StateSnapshot" }>) => void;
  onInventory: (slots: InventorySlotDto[]) => void;
  onSkill: (s: SkillProgressDto) => void;
  onAction: (msg: Extract<ServerMessage, { type: "ActionResult" }>) => void;
  onStatus: (status: string) => void;
  getPredictedPos: () => { x: number; y: number };
  reconcilePlayer: (id: string, x: number, y: number) => void;
}

export async function connectGame(
  token: string,
  handlers: ConnectHandlers,
): Promise<GameConnection> {
  const endpoint = WS_URL.replace(/\/$/, "");
  const client = new Client(endpoint.startsWith("ws") ? endpoint : `ws://${endpoint}`);

  let room: Room | null = null;
  let intentionalLeave = false;
  let reconnectAttempt = 0;

  async function join() {
    handlers.onStatus(reconnectAttempt ? `reconnecting (${reconnectAttempt})…` : "joining…");
    room = await client.joinOrCreate("world", { token });
    reconnectAttempt = 0;
    handlers.onStatus("connected");

    room.onMessage("StateSnapshot", (msg) => handlers.onSnapshot(msg));
    room.onMessage("InventoryUpdate", (msg) => handlers.onInventory(msg.slots));
    room.onMessage("SkillUpdate", (msg) =>
      handlers.onSkill({ skill: msg.skill, level: msg.level, xp: msg.xp }),
    );
    room.onMessage("ActionResult", (msg) => handlers.onAction(msg));

    room.onStateChange((state: any) => {
      // Reconcile positions from authoritative schema state
      state.players?.forEach((p: any, id: string) => {
        handlers.reconcilePlayer(id, p.x, p.y);
      });
    });

    room.onLeave((code) => {
      handlers.onStatus(`disconnected (${code})`);
      room = null;
      if (!intentionalLeave) {
        scheduleReconnect();
      }
    });

    room.onError((code, message) => {
      handlers.onStatus(`error ${code}: ${message}`);
    });
  }

  function scheduleReconnect() {
    reconnectAttempt += 1;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt, 5));
    handlers.onStatus(`reconnect in ${delay}ms…`);
    setTimeout(() => {
      if (intentionalLeave) return;
      join().catch((e) => {
        handlers.onStatus(`reconnect failed: ${e.message ?? e}`);
        scheduleReconnect();
      });
    }, delay);
  }

  await join();

  return {
    sendIntent(msg) {
      room?.send("intent", msg);
    },
    leave() {
      intentionalLeave = true;
      room?.leave();
      room = null;
    },
  };
}
