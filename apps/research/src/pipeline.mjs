/**
 * DeerFlow-style research pipeline: Coordinator → Planner → Reporter.
 * LLM and search are injectable so Gateway/Runtime can wire real providers later.
 */

/**
 * @typedef {{ query: string; title?: string }} ResearchTopicInput
 */

/**
 * @typedef {{ id: string; question: string; rationale?: string }} ResearchSubQuestion
 */

/**
 * @typedef {{ subQuestions: ResearchSubQuestion[]; notes?: string }} ResearchPlan
 */

/**
 * @typedef {{ url?: string; title?: string; snippet: string }} SearchHit
 */

/**
 * @typedef {{ subQuestionId: string; hits: SearchHit[] }} GatheredEvidence
 */

/**
 * @typedef {{
 *   topic: string;
 *   plan: ResearchPlan;
 *   evidence: GatheredEvidence[];
 *   sections: { heading: string; body: string }[];
 *   executiveSummary: string;
 * }} ResearchReport
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Default planner when no LLM is provided: one sub-question per sentence in the topic.
 * @param {ResearchTopicInput} topic
 * @returns {Promise<ResearchPlan>}
 */
export async function defaultPlan(topic) {
  const q = topic.query.trim();
  const sentences = q.split(/(?<=[.!?。！？])\s+/).filter((s) => s.length > 2);
  const chunks = sentences.length ? sentences : [q];
  const subQuestions = chunks.map((question, i) => ({
    id: `sq-${i + 1}`,
    question,
    rationale: 'Derived from user topic',
  }));
  return { subQuestions, notes: 'Heuristic plan (no LLM)' };
}

/**
 * LLM-powered planner: asks the model to decompose the research topic into
 * structured sub-questions. Falls back to heuristic if the LLM call fails.
 *
 * @param {(messages: Array<{role: string, content: string}>) => Promise<string>} chatFn
 *   A function that takes chat messages and returns the assistant's text reply.
 * @returns {(topic: ResearchTopicInput) => Promise<ResearchPlan>}
 */
export function createLlmPlanner(chatFn) {
  return async function llmPlan(topic) {
    const q = topic.query.trim();
    try {
      const reply = await chatFn([
        {
          role: "system",
          content: [
            "You are a research planner. Given a research topic, decompose it into 3-6 focused sub-questions.",
            "Respond ONLY with a JSON array of objects: [{\"question\": \"...\", \"rationale\": \"...\"}]",
            "No markdown fences, no explanation — just the JSON array.",
          ].join(" "),
        },
        { role: "user", content: q },
      ]);

      const parsed = JSON.parse(reply.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, ""));
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return defaultPlan(topic);
      }

      const subQuestions = parsed.map((item, i) => ({
        id: `sq-${i + 1}`,
        question: String(item.question ?? item.q ?? "").trim(),
        rationale: String(item.rationale ?? item.reason ?? "LLM-generated").trim(),
      })).filter((sq) => sq.question.length > 0);

      if (subQuestions.length === 0) return defaultPlan(topic);
      return { subQuestions, notes: "LLM-powered plan" };
    } catch {
      return defaultPlan(topic);
    }
  };
}

/**
 * Gather evidence for all sub-questions. Uses Promise.allSettled for parallel
 * execution (matching DeerFlow's sub-agent parallelism pattern).
 *
 * @param {ResearchPlan} plan
 * @param {(q: string) => Promise<SearchHit[]>} search
 * @param {{ parallel?: boolean }} [opts]
 * @returns {Promise<GatheredEvidence[]>}
 */
export async function gatherEvidence(plan, search, opts = {}) {
  const parallel = opts.parallel !== false;

  if (parallel) {
    const results = await Promise.allSettled(
      plan.subQuestions.map((sq) =>
        search(sq.question).then((hits) => ({ subQuestionId: sq.id, hits })),
      ),
    );
    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { subQuestionId: plan.subQuestions[i].id, hits: [] },
    );
  }

  const out = [];
  for (const sq of plan.subQuestions) {
    try {
      const hits = await search(sq.question);
      out.push({ subQuestionId: sq.id, hits });
    } catch {
      out.push({ subQuestionId: sq.id, hits: [] });
    }
  }
  return out;
}

/**
 * @param {ResearchTopicInput} topic
 * @param {ResearchPlan} plan
 * @param {GatheredEvidence[]} evidence
 * @returns {ResearchReport}
 */
export function synthesizeReport(topic, plan, evidence) {
  const sections = evidence.map((ev) => {
    const sq = plan.subQuestions.find((s) => s.id === ev.subQuestionId);
    const heading = sq?.question ?? ev.subQuestionId;
    const bullets = ev.hits.map((h) => {
      const cite = h.url ? ` (${h.url})` : '';
      return `- ${h.snippet}${cite}`;
    });
    const body =
      bullets.length > 0 ? bullets.join('\n') : '_No sources returned for this sub-question._';
    return { heading, body };
  });

  const firstSnip = evidence[0]?.hits[0]?.snippet ?? topic.query;
  const executiveSummary = `Summary for “${topic.query.slice(0, 120)}”: ${firstSnip.slice(0, 400)}`;

  return {
    topic: topic.query,
    plan,
    evidence,
    sections,
    executiveSummary,
  };
}

/**
 * @typedef {{
 *   plan?: (topic: ResearchTopicInput) => Promise<ResearchPlan>;
 *   search: (query: string) => Promise<SearchHit[]>;
 * }} ResearchPipelineOptions
 */

export class ResearchPipeline {
  /**
   * @param {ResearchPipelineOptions} options
   */
  constructor(options) {
    this.plan = options.plan ?? defaultPlan;
    this.search = options.search;
  }

  /**
   * Full run: plan → gather → report.
   * @param {ResearchTopicInput} topic
   * @returns {Promise<ResearchReport>}
   */
  async run(topic) {
    if (!topic?.query?.trim()) {
      throw new Error('research: empty topic.query');
    }
    const plan = await this.plan(topic);
    if (!plan.subQuestions?.length) {
      throw new Error('research: plan produced no subQuestions');
    }
    const evidence = await gatherEvidence(plan, this.search);
    return synthesizeReport(topic, plan, evidence);
  }
}

/**
 * Coordinator hook: normalize external input (future: locale, safety filters).
 * @param {ResearchTopicInput} raw
 * @returns {ResearchTopicInput}
 */
export function coordinateTopic(raw) {
  const query = String(raw.query ?? '').trim();
  const title = raw.title?.trim();
  return title ? { query, title } : { query };
}
