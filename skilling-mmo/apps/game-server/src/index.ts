import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { createServer } from "http";
import { WorldRoom } from "./rooms/WorldRoom.js";
// TODO: PvPMatchmaker — Redis list of queued fighter IDs; FightRoom registration when combat ships
// import { FightRoom } from "./rooms/FightRoom.js";
// import { PvPMatchmaker } from "./pvp/matchmaker.js";

const port = Number(process.env.GAME_PORT ?? 2567);
const host = process.env.GAME_HOST ?? "0.0.0.0";

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "game-server" });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("world", WorldRoom);
// TODO: gameServer.define("fight", FightRoom);

httpServer.listen(port, host, () => {
  console.log(`[game-server] Colyseus listening on ${host}:${port}`);
});
