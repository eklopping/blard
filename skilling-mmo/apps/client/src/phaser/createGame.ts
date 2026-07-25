import Phaser from "phaser";
import { BootScene } from "./BootScene";
import { WorldScene } from "./WorldScene";
import type { ServerMessage } from "@skilling-mmo/shared";

export interface GameCallbacks {
  onMove: (x: number, y: number) => void;
  onInteractTree: (resourceId: string) => void;
}

export interface GameBridge {
  destroy: () => void;
  applySnapshot: (snap: Extract<ServerMessage, { type: "StateSnapshot" }>) => void;
  reconcilePlayer: (id: string, x: number, y: number) => void;
  removePlayer: (id: string) => void;
  clearPlayers: () => void;
  getLocalPos: () => { x: number; y: number };
  onActionResult: (msg: Extract<ServerMessage, { type: "ActionResult" }>) => void;
}

export function createGame(parent: HTMLElement, callbacks: GameCallbacks): GameBridge {
  let world: WorldScene | null = null;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#1a2e1a",
    scene: [BootScene, WorldScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    callbacks: {
      preBoot: (g) => {
        g.registry.set("gameCallbacks", callbacks);
        g.registry.set("setWorldScene", (s: WorldScene) => {
          world = s;
        });
      },
    },
  });

  const onVisibility = () => {
    if (document.hidden) {
      world?.onTabHidden();
    } else {
      world?.onTabVisible();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    destroy: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      game.destroy(true);
    },
    applySnapshot: (snap) => world?.applySnapshot(snap),
    reconcilePlayer: (id, x, y) => world?.reconcilePlayer(id, x, y),
    removePlayer: (id) => world?.removePlayer(id),
    clearPlayers: () => world?.clearPlayers(),
    getLocalPos: () => world?.getLocalPos() ?? { x: 160, y: 160 },
    onActionResult: (msg) => world?.onActionResult(msg),
  };
}
