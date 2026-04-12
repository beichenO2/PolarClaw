/**
 * KnowLeverage (知识杠杆) adapter — REQ-E07
 * Bridges MyClaw to the RAG engine and Skill distillation system.
 *
 * Uses KnowLeverageClient from lobster_adapter.py (the official adapter
 * that KnowLeverage wrote specifically for Lobster/MyClaw integration).
 *
 * Two modes:
 *   1. REST API (preferred) — if KnowLeverage server is running on port 8200
 *   2. Python subprocess — falls back to direct KnowLeverageClient calls
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const KNOWLEVER_DIR =
  "/Users/mac/Library/Mobile Documents/com~apple~CloudDocs/Tools/KnowLever";

const DEFAULT_API_PORT = 8200;

export function createKnowLeverageAdapter(options = {}) {
  const projectDir = options.projectDir ?? KNOWLEVER_DIR;
  const apiPort = options.apiPort ?? DEFAULT_API_PORT;
  const apiBaseUrl = options.apiBaseUrl ?? `http://127.0.0.1:${apiPort}`;
  const timeout = options.timeoutMs ?? 120_000;
  const pythonBin = options.pythonBin ?? "python3";
  const persistPath = options.persistPath ?? null;

  function isAvailable() {
    return existsSync(join(projectDir, "knowleverage"));
  }

  /**
   * Try REST API first, fall back to Python subprocess.
   * @param {string} endpoint e.g. "/api/v2/ingest"
   * @param {object} body
   */
  async function tryApi(endpoint, body) {
    try {
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return { ok: true, data: await res.json(), mode: "rest-api" };
    } catch { /* API not available */ }
    return null;
  }

  /**
   * Run a KnowLeverageClient method via Python subprocess.
   * @param {string} code Python code using `client` variable
   */
  function runClient(code) {
    const persistArg = persistPath ? `persist_path="${persistPath}"` : "";
    const fullCode = [
      "import json",
      "from knowleverage.lobster_adapter import KnowLeverageClient",
      `client = KnowLeverageClient(${persistArg})`,
      code,
    ].join("\n");

    return execSync(`cd "${projectDir}" && ${pythonBin} -c '${fullCode.replace(/'/g, "'\"'\"'")}'`, {
      encoding: "utf-8",
      timeout,
      env: {
        ...process.env,
        PYTHONPATH: join(projectDir, "knowleverage/src"),
      },
    }).trim();
  }

  /**
   * Ingest a document into the RAG engine.
   * @param {{ text: string, docId: string, metadata?: Record<string, string> }} params
   */
  async function ingestDocument(params) {
    if (!isAvailable()) {
      return { ok: false, error: "KnowLeverage project not found" };
    }

    const { text, docId, metadata } = params;
    if (!text || !docId) {
      return { ok: false, error: "text and docId are required" };
    }

    const apiResult = await tryApi("/api/v2/ingest", {
      text,
      doc_id: docId,
      extra_meta: metadata ?? {},
    });
    if (apiResult) return apiResult;

    try {
      const safeText = text.slice(0, 50000).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      const output = runClient(
        `result = client.ingest("${safeText}", "${docId}")\nprint(json.dumps({"doc_id": result.doc_id, "num_chunks": result.num_chunks}))`,
      );
      return { ok: true, data: JSON.parse(output), mode: "subprocess" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Build context for a query using RAG + skill context.
   * @param {{ query: string, topK?: number }} params
   */
  async function buildContext(params) {
    if (!isAvailable()) {
      return { ok: false, error: "KnowLeverage project not found" };
    }

    const { query, topK = 5 } = params;
    if (!query) return { ok: false, error: "query is required" };

    const apiResult = await tryApi("/api/v2/query", {
      query,
      top_k: topK,
    });
    if (apiResult) return apiResult;

    try {
      const safeQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const output = runClient(
        `ctx = client.query("${safeQuery}", top_k=${topK})\nprint(json.dumps({"query": ctx.query, "rag_context": ctx.rag_context, "skill_context": ctx.skill_context, "combined_prompt": ctx.combined_prompt, "num_chunks": ctx.num_chunks}))`,
      );
      return { ok: true, data: JSON.parse(output), mode: "subprocess" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Distill knowledge into a Skill.
   * @param {{ topic: string, corpus: string }} params
   */
  async function distillSkill(params) {
    if (!isAvailable()) {
      return { ok: false, error: "KnowLeverage project not found" };
    }

    const { topic, corpus } = params;
    if (!topic || !corpus) return { ok: false, error: "topic and corpus are required" };

    try {
      const safeTopic = topic.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const safeCorpus = corpus.slice(0, 50000).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      const output = runClient(
        `result = client.distill("${safeCorpus}", title="${safeTopic}")\nprint(result)`,
      );
      return { ok: true, skill: output, mode: "subprocess" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Ingest an LLMWiki project into the knowledge base.
   * @param {{ wikiProjectDir: string }} params
   */
  async function ingestWiki(params) {
    if (!isAvailable()) {
      return { ok: false, error: "KnowLeverage project not found" };
    }
    const { wikiProjectDir } = params;
    if (!wikiProjectDir) return { ok: false, error: "wikiProjectDir is required" };

    try {
      const output = runClient(
        `result = client.ingest_wiki("${wikiProjectDir}")\nprint(json.dumps({"num_pages": result.num_pages, "num_chunks": result.num_chunks}))`,
      );
      return { ok: true, data: JSON.parse(output), mode: "subprocess" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Build a knowledge graph visualization.
   * @param {{ query?: string, topK?: number }} params
   */
  async function knowledgeGraph(params = {}) {
    if (!isAvailable()) {
      return { ok: false, error: "KnowLeverage project not found" };
    }

    try {
      const q = (params.query ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const topK = params.topK ?? 50;
      const output = runClient(
        `kg = client.knowledge_graph(query="${q}", top_k=${topK})\nprint(json.dumps(kg, ensure_ascii=False, default=str))`,
      );
      return { ok: true, data: JSON.parse(output), mode: "subprocess" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  return {
    isAvailable,
    ingestDocument,
    buildContext,
    distillSkill,
    ingestWiki,
    knowledgeGraph,
    projectDir,
  };
}
