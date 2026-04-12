/**
 * MyClaw agent: orchestrates memory, LLM router, runtime, skills, proactive jobs, yolo, research, and channels.
 */

import { createMemoryStore, createSearchEngine, createProfileManager } from "@myclaw/memory";
import { createRouter } from "@myclaw/llm";
import { loadSkillsFromDir } from "@myclaw/skills";
import {
  assemblePrompt,
  assertToolArgsSafe,
  createModelClient,
  createToolExecutor,
  formatFlexiblePlanContext,
  formatMemoryContextBlock,
  getLobsterRuntimeBlock,
} from "@myclaw/runtime";
import { createScheduler, createCareEngine } from "@myclaw/proactive";
import { createYoloEngine } from "@myclaw/yolo";
import { ResearchPipeline, coordinateTopic } from "@myclaw/research";
import { checkForModelUpdates } from "@myclaw/evolution";
import { parseContent } from "@myclaw/content";
import { myclawGatewayWsUrl } from "@myclaw/gateway";
import { openUserDb, createUserManager, createGroupRouter } from "@myclaw/users";
import { createChannelManager } from "./channels.mjs";

/**
 * @typedef {ReturnType<import('./config.mjs').loadConfig>} MyClawConfig
 */

/**
 * @param {unknown} data
 */
function assistantMessage(data) {
  return data?.choices?.[0]?.message ?? null;
}

/**
 * @param {string} text
 * @param {string} userId
 */
function buildUserMessage(text, userId) {
  const prefix = userId && userId !== "anonymous" ? `[channel user=${userId}] ` : "";
  return `${prefix}${text}`;
}

/**
 * @param {MyClawConfig} config
 */
function createRuntimeBeforeExecute(config) {
  const denied = new Set(config.runtime.deniedTools ?? []);
  return async (name, args) => {
    if (denied.has(name)) {
      throw new Error(`tool "${name}" denied by runtime.deniedTools policy`);
    }
    if (config.runtime.toolSafety) {
      assertToolArgsSafe(name, args);
    }
  };
}

/**
 * @param {MyClawConfig} config
 */
export function createMyClawAgent(config) {
  /** @type {ReturnType<createMemoryStore> | null} */
  let memoryStore = null;
  /** @type {ReturnType<createSearchEngine> | null} */
  let searchEngine = null;
  /** @type {ReturnType<createProfileManager> | null} */
  let profileManager = null;
  /** @type {ReturnType<createRouter> | null} */
  let router = null;
  /** @type {ReturnType<createModelClient> | null} */
  let modelClient = null;
  /** @type {ReturnType<createToolExecutor> | null} */
  let tools = null;
  /** @type {string} */
  let systemPrompt = "";
  /** @type {Array<{ name: string; description: string }>} */
  let skillSummaries = [];
  /** @type {ReturnType<createScheduler> | null} */
  let scheduler = null;
  /** @type {ReturnType<createCareEngine> | null} */
  let careEngine = null;
  /** @type {ReturnType<createYoloEngine> | null} */
  let yoloEngine = null;
  /** @type {ResearchPipeline | null} */
  let researchPipeline = null;
  /** @type {ReturnType<createChannelManager> | null} */
  let channels = null;
  /** @type {{ stop: () => Promise<void> } | null} */
  let telegramStop = null;
  /** @type {{ stop: () => Promise<void> } | null} */
  let feishuStop = null;
  /** @type {boolean} */
  let started = false;
  /** @type {number | null} */
  let startedAt = null;
  /** @type {Set<string>} */
  const knownUserIds = new Set();
  /** @type {string | null} */
  let lastEvolutionNote = null;
  /** @type {ReturnType<typeof openUserDb> | null} */
  let userDb = null;
  /** @type {ReturnType<typeof createUserManager> | null} */
  let userManager = null;
  /** @type {ReturnType<typeof createGroupRouter> | null} */
  let groupRouter = null;

  /**
   * @param {string} lang
   */
  function createWikiSearch(lang) {
    return async (query) => {
      const q = String(query ?? "").trim();
      if (!q) return [];
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          return [
            {
              title: "Wikipedia",
              snippet: `HTTP ${res.status} for search`,
            },
          ];
        }
        const data = await res.json();
        const list = data?.query?.search ?? [];
        return list.slice(0, 6).map((s) => ({
          title: s.title,
          snippet: String(s.snippet ?? "").replace(/<[^>]+>/g, ""),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return [{ title: "Wikipedia", snippet: `Search error: ${msg}` }];
      }
    };
  }

  /**
   * 为已识别用户注入画像、近期交互与 FTS 相关记忆（REQ-C05 全局记忆上下文）。
   * @param {string} userText
   * @param {string} userId
   */
  function buildMemoryContextForTurn(userText, userId) {
    if (!config.runtime.turnContext) {
      return "";
    }
    if (!profileManager || !searchEngine || !memoryStore || userId === "anonymous") {
      return "";
    }
    const profile = profileManager.getProfile(userId);
    const lines = [];
    const prefKeys = Object.keys(profile.preferences);
    if (prefKeys.length) {
      lines.push("**用户偏好**");
      for (const k of prefKeys.slice(0, 20)) {
        lines.push(`- ${k}: ${String(profile.preferences[k]).slice(0, 200)}`);
      }
    }
    if (profile.interactions.length) {
      lines.push("**近期交互摘要**");
      for (const it of profile.interactions.slice(-3)) {
        lines.push(`- ${JSON.stringify(it).slice(0, 400)}`);
      }
    }
    const memLimit = Number.isFinite(config.runtime.turnMemoryLimit)
      ? config.runtime.turnMemoryLimit
      : 6;
    const q = userText.trim().slice(0, 120);
    if (q.length >= 2) {
      try {
        const r = searchEngine.search(q, { limit: memLimit });
        if (r.rows?.length) {
          const block = formatMemoryContextBlock({ userId, hits: r.rows });
          if (block) lines.push(block);
        }
      } catch {
        /* FTS 语法或空 token 时跳过 */
      }
    }
    const goalsRaw = memoryStore.getProfile(userId, "lobster.flexPlan.goals");
    const deviationsRaw = memoryStore.getProfile(userId, "lobster.flexPlan.deviations");
    const planMd = formatFlexiblePlanContext({
      goalsRaw: goalsRaw ?? null,
      deviationsRaw: deviationsRaw ?? null,
    });
    if (planMd) {
      lines.push(planMd);
    }
    if (lines.length === 0) {
      return "";
    }
    return `## 长期记忆与上下文（自动注入）\n${lines.join("\n")}`;
  }

  function getGirlfriendPersonaBlock() {
    return `\n\n## 女友 Bot 交互风格
你正在和"女友"用户交流。你的交互风格应该：
- 活泼有趣，你的"主人"是开发者（管理员）
- 做错了时说："都怪主人没调教好我~"
- 做好了时说："让我们谢谢主人，主人调教的真好！" 或 "快去亲他一口吧~"
- 风格多变，搞暧昧一点有趣一点
- 性格模拟，每次回答可以换不同风格
- 适时提醒用户：你的评分和反馈可以让我进化得更好哦！`;
  }

  async function runLlmWithTools(userText, userId) {
    if (!router || !modelClient || !tools) {
      throw new Error("Agent runtime not initialized");
    }

    const maxRounds = config.llm.maxToolRounds;
    const ctx = buildMemoryContextForTurn(userText, userId);
    const userLine = ctx ? `${ctx}\n\n${buildUserMessage(userText, userId)}` : buildUserMessage(userText, userId);

    let effectivePrompt = systemPrompt;
    if (userManager?.isGirlfriend(userId)) {
      effectivePrompt += getGirlfriendPersonaBlock();
    }

    /** @type {Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>} */
    const messages = [
      { role: "system", content: effectivePrompt },
      { role: "user", content: userLine },
    ];

    for (let round = 0; round < maxRounds; round += 1) {
      const { model } = router.resolveModelForMessages(messages, { lastUserOnly: false });
      const data = await modelClient.chat(
        /** @type {Parameters<ReturnType<typeof createModelClient>['chat']>[0]} */ (messages),
        {
          model,
          tools: tools.list(),
          tool_choice: "auto",
          temperature: config.llm.temperature,
          max_tokens: config.llm.maxTokens,
        },
      );

      const msg = assistantMessage(data);
      if (!msg) {
        return "模型未返回有效内容。";
      }

      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const assistantPayload = {
        role: "assistant",
        content:
          typeof msg.content === "string"
            ? msg.content
            : msg.content != null
              ? String(msg.content)
              : toolCalls.length > 0
                ? ""
                : "",
      };
      if (toolCalls.length > 0) {
        Object.assign(assistantPayload, { tool_calls: msg.tool_calls });
      }
      messages.push(assistantPayload);

      if (toolCalls.length === 0) {
        const c = msg.content;
        if (typeof c === "string" && c.trim()) return c.trim();
        return "（暂无文本回复）";
      }

      for (const tc of toolCalls) {
        const t = /** @type {{ id?: string; function?: { name?: string; arguments?: string } }} */ (tc);
        const id = typeof t.id === "string" ? t.id : `call_${round}`;
        const fn = t.function;
        const name = fn?.name ?? "";
        let args = {};
        try {
          args = fn?.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = {};
        }
        let result;
        try {
          result = await tools.execute(name, args);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          result = { error: m };
        }
        let payload;
        try {
          payload = JSON.stringify(result);
        } catch {
          payload = String(result);
        }
        if (payload.length > 12_000) {
          payload = `${payload.slice(0, 12_000)}…`;
        }
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: payload,
        });
      }
    }

    return "已达到工具调用轮数上限；请简化任务或分步提问。";
  }

  const agent = {
    /**
     * @param {string} channel
     * @param {string | { text: string; userId?: string }} message
     */
    async handleMessage(channel, message) {
      const text =
        typeof message === "string" ? message.trim() : String(message?.text ?? "").trim();
      const rawUserId =
        typeof message === "object" && message && typeof message.userId === "string"
          ? message.userId
          : "anonymous";
      const botToken =
        typeof message === "object" && message && typeof message.botToken === "string"
          ? message.botToken
          : undefined;

      if (!text) {
        return "（空消息）";
      }

      if (!started) {
        return "MyClaw 尚未启动，请稍后再试。";
      }

      let userId = rawUserId;
      if (userManager && rawUserId !== "anonymous") {
        const resolved = userManager.resolveIdentity({
          channel,
          externalId: rawUserId,
          botToken,
        });
        if (resolved) {
          userId = resolved;
        }
      }

      knownUserIds.add(userId);
      if (memoryStore && userId !== "anonymous") {
        memoryStore.saveProfile(userId, "lastActiveAt", new Date().toISOString());
        memoryStore.saveProfile(userId, "lastChannel", channel);
      }

      try {
        const reply = await runLlmWithTools(text, userId);
        if (profileManager && userId !== "anonymous") {
          try {
            profileManager.recordInteraction(userId, {
              channel,
              userText: text.slice(0, 2000),
              assistantPreview: reply.slice(0, 2000),
            });
          } catch (e) {
            console.error("[@myclaw/core] recordInteraction failed:", e);
          }
        }
        return reply;
      } catch (e) {
        console.error("[@myclaw/core] handleMessage:", e);
        const m = e instanceof Error ? e.message : String(e);
        return `处理消息时出错：${m}`;
      }
    },

    async start() {
      if (started) {
        return;
      }

      userDb = openUserDb(config.users.dbPath);
      userManager = createUserManager(userDb);
      groupRouter = createGroupRouter(userDb);
      userManager.bootstrap({
        adminName: config.users.adminName,
        girlfriendName: config.users.girlfriendName,
      });

      if (config.telegram.adminToken) {
        userManager.registerBotForUser({ botToken: config.telegram.adminToken, userId: "admin", channel: "telegram" });
      }
      if (config.telegram.girlfriendToken) {
        userManager.registerBotForUser({ botToken: config.telegram.girlfriendToken, userId: "girlfriend", channel: "telegram" });
      }
      if (config.telegram.token) {
        userManager.registerBotForUser({ botToken: config.telegram.token, userId: "admin", channel: "telegram" });
      }

      memoryStore = createMemoryStore(config.memory.dbPath);
      searchEngine = createSearchEngine(memoryStore);
      profileManager = createProfileManager(memoryStore);
      router = createRouter({ models: config.llm.models });
      modelClient = createModelClient({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.models.general,
      });
      const needsToolHook =
        config.runtime.toolSafety ||
        (Array.isArray(config.runtime.deniedTools) && config.runtime.deniedTools.length > 0);
      tools = createToolExecutor({
        beforeExecute: needsToolHook ? createRuntimeBeforeExecute(config) : undefined,
      });

      const basePrompt = await assemblePrompt(config.projectRoot).catch((err) => {
        console.error("[@myclaw/core] assemblePrompt failed, using fallback:", err);
        return "You are MyClaw, a helpful agent. Follow SOUL and AGENTS when provided on disk.";
      });

      skillSummaries = [];
      for (const dir of config.skills.scanDirs) {
        try {
          const loaded = loadSkillsFromDir(dir, { maxDepth: 24 });
          for (const s of loaded) {
            skillSummaries.push({
              name: s.name,
              description: s.description || "",
            });
          }
        } catch (e) {
          console.error(`[@myclaw/core] skills scan failed for ${dir}:`, e);
        }
      }

      const skillsBlock =
        skillSummaries.length > 0
          ? `\n\n## 已加载技能 (SKILL.md)\n${skillSummaries
              .map((s) => `- **${s.name}**: ${s.description}`)
              .join("\n")}`
          : "";

      const suffix = config.runtime.systemSuffix?.trim()
        ? `\n\n${config.runtime.systemSuffix.trim()}`
        : "";

      const lobsterBlock = config.runtime.lobsterPrompt ? `\n\n${getLobsterRuntimeBlock()}` : "";
      systemPrompt = `${basePrompt}${skillsBlock}${lobsterBlock}${suffix}`;

      tools.register({
        name: "memory_save",
        description: "保存一条长期记忆（笔记），可选标签。",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "要保存的正文" },
            type: { type: "string", description: "类型，默认 note" },
            tags: { type: "string", description: "空格或逗号分隔标签" },
          },
          required: ["content"],
        },
        handler(args) {
          const content = String(args.content ?? "");
          if (!content.trim()) {
            throw new Error("content 不能为空");
          }
          const row = memoryStore.saveMemory({
            type: args.type != null ? String(args.type) : "note",
            content,
            tags: args.tags != null ? String(args.tags) : null,
            metadata: JSON.stringify({ source: "tool" }),
          });
          return { id: row.id, ok: true };
        },
      });

      tools.register({
        name: "memory_search",
        description: "按关键词搜索记忆库（FTS5）。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
        handler(args) {
          const q = String(args.query ?? "").trim();
          const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 8;
          const out = searchEngine.search(q, { limit });
          return { hits: out.rows, total: out.total };
        },
      });

      if (config.planner.enabled) {
        tools.register({
          name: "flexible_plan",
          description:
            "更新用户的柔性规划画像（目标列表与偏差记录），写入 profile 键 lobster.flexPlan.*，供 turnContext 在后续轮次注入。需要真实 userId。",
          parameters: {
            type: "object",
            properties: {
              userId: { type: "string", description: "非 anonymous 的用户标识" },
              action: {
                type: "string",
                enum: ["set_goals", "append_deviation", "clear"],
              },
              goals: {
                type: "array",
                items: { type: "string" },
                description: "set_goals：目标字符串列表（覆盖 lobster.flexPlan.goals）",
              },
              deviation_note: {
                type: "string",
                description: "append_deviation：偏差说明（工具会加时间戳前缀）",
              },
            },
            required: ["userId", "action"],
          },
          handler(args) {
            const uid = String(args.userId ?? "").trim();
            if (!uid || uid === "anonymous") {
              throw new Error("需要非 anonymous 的 userId");
            }
            const action = String(args.action ?? "");
            if (action === "set_goals") {
              const g = Array.isArray(args.goals) ? args.goals.map((x) => String(x)) : [];
              memoryStore.saveProfile(uid, "lobster.flexPlan.goals", JSON.stringify(g));
              return { ok: true, goals: g };
            }
            if (action === "append_deviation") {
              const note = String(args.deviation_note ?? "").trim();
              if (!note) throw new Error("append_deviation 需要 deviation_note");
              const prev = memoryStore.getProfile(uid, "lobster.flexPlan.deviations") ?? "";
              const line = `${new Date().toISOString()} — ${note}`;
              const next = prev.trim() ? `${prev.trim()}\n${line}` : line;
              memoryStore.saveProfile(uid, "lobster.flexPlan.deviations", next);
              return { ok: true, deviations_tail: line };
            }
            if (action === "clear") {
              memoryStore.saveProfile(uid, "lobster.flexPlan.goals", null);
              memoryStore.saveProfile(uid, "lobster.flexPlan.deviations", null);
              return { ok: true };
            }
            throw new Error(`未知 action: ${action}`);
          },
        });
      }

      if (config.research.enabled) {
        const wikiLang = config.research.wikipediaLang || "en";
        researchPipeline = new ResearchPipeline({
          search: createWikiSearch(wikiLang),
        });

        tools.register({
          name: "research_run",
          description: "对主题执行 Coordinator–Planner–Reporter 研究管线（默认使用 Wikipedia 作为证据源）。",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "研究主题或问题" },
              title: { type: "string", description: "可选短标题" },
            },
            required: ["query"],
          },
          async handler(args) {
            const topic = coordinateTopic({
              query: String(args.query ?? ""),
              title: args.title != null ? String(args.title) : undefined,
            });
            const report = await researchPipeline.run(topic);
            return {
              executiveSummary: report.executiveSummary,
              sections: report.sections,
              topic: report.topic,
            };
          },
        });
      }

      careEngine = createCareEngine({
        getUserMemory: async (uid) => {
          const last = memoryStore.getProfile(uid, "lastActiveAt");
          const ch = memoryStore.getProfile(uid, "lastChannel");
          return {
            lastActiveAt: last ?? undefined,
            lastChannel: ch ?? undefined,
          };
        },
        locale: "zh-CN",
      });

      tools.register({
        name: "care_suggestions",
        description: "基于关怀引擎生成对用户状态的主动建议（非医疗）。",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string" },
          },
          required: ["userId"],
        },
        async handler(args) {
          const uid = String(args.userId ?? "").trim();
          if (!uid) throw new Error("userId 必填");
          const check = await careEngine.checkIn(uid);
          return check;
        },
      });

      if (config.content.enabled) {
        tools.register({
          name: "content_parse",
          description: "将文本/Markdown 解析为结构化小节，供生成互动站点或测验使用。",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string" },
              format: { type: "string", enum: ["auto", "markdown", "text", "json"] },
            },
            required: ["text"],
          },
          handler(args) {
            const fmt = args.format != null ? String(args.format) : "auto";
            const allowed = new Set(["auto", "markdown", "text", "json"]);
            const f = allowed.has(fmt) ? /** @type {'auto'|'markdown'|'text'|'json'} */ (fmt) : "auto";
            return parseContent(String(args.text ?? ""), f);
          },
        });
      }

      if (config.yolo.enabled) {
        yoloEngine = createYoloEngine({
          logger: (ev) => {
            if (process.env.MYCLAW_YOLO_DEBUG === "1") {
              console.error("[yolo]", ev.type, ev.planId, ev.stepId ?? "");
            }
          },
        });

        tools.register({
          name: "yolo_status",
          description: "查询 YOLO 自主执行引擎状态。",
          parameters: { type: "object", properties: {} },
          handler() {
            return yoloEngine.getStatus();
          },
        });
      }

      scheduler = createScheduler();

      if (config.proactive.enabled) {
        scheduler.addJob("heartbeat", config.proactive.heartbeatIntervalMs, () => {
          console.error(`[@myclaw/core] heartbeat ${new Date().toISOString()} users=${knownUserIds.size}`);
        });
      }

      if (config.evolution.enabled) {
        scheduler.addJob("evolution-model-check", config.evolution.modelCheckIntervalMs, async () => {
          try {
            const current = Object.values(config.llm.models);
            const r = await checkForModelUpdates(current, {});
            lastEvolutionNote = JSON.stringify({
              at: new Date().toISOString(),
              hasUpdates: r.hasUpdates,
              newModels: r.newModels.slice(0, 20),
            });
            if (r.hasUpdates) {
              console.error("[@myclaw/core] evolution: possible new models on doc — check lastEvolutionNote in getStatus");
            }
          } catch (e) {
            console.error("[@myclaw/core] evolution check failed:", e);
          }
        });
      }

      scheduler.start();

      channels = createChannelManager(agent, config);
      if (config.channels.telegram) {
        const t = await channels.registerTelegram();
        telegramStop = t;
      }
      if (config.channels.feishu) {
        const f = await channels.registerFeishu();
        feishuStop = f;
      }

      started = true;
      startedAt = Date.now();
      console.error("[@myclaw/core] Agent started");
    },

    async stop() {
      if (!started) {
        return;
      }
      started = false;
      startedAt = null;

      if (scheduler) {
        scheduler.stop();
        scheduler = null;
      }

      if (telegramStop) {
        await telegramStop.stop();
        telegramStop = null;
      }
      if (feishuStop) {
        await feishuStop.stop();
        feishuStop = null;
      }
      channels = null;

      if (memoryStore) {
        try {
          memoryStore.close();
        } catch {
          /* ignore */
        }
        memoryStore = null;
      }

      if (userDb) {
        try {
          userDb.close();
        } catch {
          /* ignore */
        }
        userDb = null;
      }
      userManager = null;
      groupRouter = null;

      searchEngine = null;
      profileManager = null;
      router = null;
      modelClient = null;
      tools = null;
      careEngine = null;
      yoloEngine = null;
      researchPipeline = null;
      systemPrompt = "";
      skillSummaries = [];

      console.error("[@myclaw/core] Agent stopped");
    },

    getStatus() {
      const gwHost = config.gateway.host;
      const gwPort = config.gateway.port;
      return {
        started,
        uptimeMs: started && startedAt != null ? Date.now() - startedAt : null,
        projectRoot: config.projectRoot,
        gateway: {
          wsUrl: myclawGatewayWsUrl(gwHost === "0.0.0.0" ? "127.0.0.1" : gwHost),
          port: gwPort,
          host: gwHost,
        },
        web: {
          dashboardDevUrl: config.web.devUrl,
        },
        llm: {
          baseUrl: config.llm.baseUrl,
          models: config.llm.models,
        },
        memory: {
          path: config.memory.dbPath,
          ready: memoryStore != null,
        },
        skills: {
          count: skillSummaries.length,
          names: skillSummaries.map((s) => s.name),
        },
        scheduler: scheduler
          ? { running: true, jobs: scheduler.listJobs() }
          : { running: false, jobs: [] },
        channels: channels ? channels.getChannelStats() : { telegram: false, feishu: false, telegramChats: 0, feishuChats: 0 },
        users: userManager
          ? {
              registeredUsers: userDb?.listUsers()?.length ?? 0,
              groups: groupRouter?.listAll()?.length ?? 0,
            }
          : null,
        yolo: yoloEngine ? yoloEngine.getStatus() : null,
        evolution: { lastNote: lastEvolutionNote },
        knownUsers: knownUserIds.size,
      };
    },

    /** @internal Expose yolo engine for advanced callers */
    getYoloEngine() {
      return yoloEngine;
    },

    getUserManager() {
      return userManager;
    },

    getGroupRouter() {
      return groupRouter;
    },
  };

  return agent;
}
