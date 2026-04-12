/**
 * Health check HTTP server for MyClaw agent.
 * Provides /health, /api/status, /api/tasks endpoints.
 */

import { createServer } from "node:http";

/**
 * @param {{ agent: ReturnType<import('./agent.mjs').createMyClawAgent>, port?: number, host?: string }} options
 */
export function createHealthServer(options) {
  const { agent, port = 18790, host = "127.0.0.1" } = options;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = url.pathname;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === "/health") {
        const status = agent.getStatus();
        res.writeHead(status.started ? 200 : 503);
        res.end(JSON.stringify({
          status: status.started ? "healthy" : "starting",
          uptime: status.uptimeMs,
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      if (path === "/api/status") {
        const status = agent.getStatus();
        res.writeHead(200);
        res.end(JSON.stringify(status));
        return;
      }

      if (path === "/api/research/latest") {
        res.writeHead(200);
        res.end(JSON.stringify({ sections: [], message: "No recent research" }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found", paths: ["/health", "/api/status"] }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message ?? "Internal error" }));
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.listen(port, host, () => {
          console.error(`[@myclaw/core] Health server on http://${host}:${port}/health`);
          resolve({ port, host });
        });
        server.on("error", reject);
      });
    },
    stop() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
    get address() {
      return `http://${host}:${port}`;
    },
  };
}
