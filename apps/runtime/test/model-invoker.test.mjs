import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createModelClient } from "../src/model-invoker.mjs";

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 */
function listenOnce(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

test("createModelClient validates config", () => {
  assert.throws(() => createModelClient(null), TypeError);
  assert.throws(() => createModelClient({}), /apiKey/);
  assert.throws(() => createModelClient({ apiKey: "k" }), /model/);
  assert.throws(
    () => createModelClient({ apiKey: "k", model: "m" }),
    /baseUrl/
  );
});

test("chat posts non-streaming JSON and returns body", async () => {
  const payload = {
    choices: [
      {
        message: { role: "assistant", content: "hi" },
        finish_reason: "stop",
      },
    ],
  };

  const { server, port } = await listenOnce((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.stream, false);
      assert.equal(parsed.model, "test-model");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });

  try {
    const client = createModelClient({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "sk-test",
      model: "test-model",
    });
    const data = await client.chat([{ role: "user", content: "hello" }]);
    assert.equal(data.choices[0].message.content, "hi");
  } finally {
    server.close();
  }
});

test("stream parses SSE chunks", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
    "data: [DONE]\n\n";

  const { server, port } = await listenOnce((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.end(sse);
  });

  try {
    const client = createModelClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "sk-test",
      model: "m",
    });
    const chunks = [];
    for await (const ev of client.stream([{ role: "user", content: "x" }])) {
      chunks.push(ev);
    }
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].choices[0].delta.content, "a");
    assert.equal(chunks[1].choices[0].delta.content, "b");
  } finally {
    server.close();
  }
});

test("chat throws on HTTP error", async () => {
  const { server, port } = await listenOnce((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad key" } }));
  });

  try {
    const client = createModelClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "x",
      model: "m",
    });
    await assert.rejects(
      () => client.chat([{ role: "user", content: "q" }]),
      /401.*bad key/
    );
  } finally {
    server.close();
  }
});
