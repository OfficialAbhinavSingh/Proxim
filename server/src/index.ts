import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { sessionRouter } from "./routes/session.js";
import { createWsHandler } from "./websocket/wsHandler.js";

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "proxim-server" });
});

app.use("/session", sessionRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server });
const handleWs = createWsHandler();

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    void handleWs(ws, String(data));
  });
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log(`Proxim server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
