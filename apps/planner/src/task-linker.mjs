/**
 * @param {ReturnType<import('../../memory/src/search.mjs').createSearchEngine>} searchEngine
 * @param {ReturnType<import('./plan-engine.mjs').createPlanEngine>} planEngine
 */
export function createTaskLinker(searchEngine, planEngine) {
  if (!searchEngine?.search) throw new TypeError("createTaskLinker: searchEngine with .search() required");
  if (!planEngine?.listPlans) throw new TypeError("createTaskLinker: planEngine with .listPlans() required");

  /**
   * Find related memories and plan steps for a task description.
   * @param {string} description
   * @returns {{ relatedMemories: object[], relatedSteps: object[], suggestions: string[] }}
   */
  function findRelated(description) {
    if (!description || typeof description !== "string") return { relatedMemories: [], relatedSteps: [], suggestions: [] };

    const keywords = description
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 6)
      .join(" ");

    let relatedMemories = [];
    if (keywords) {
      try {
        const { rows } = searchEngine.search(keywords, { limit: 5 });
        relatedMemories = rows.map((r) => ({ id: r.id, type: r.type, content: r.content.slice(0, 200), tags: r.tags }));
      } catch { /* search may fail */ }
    }

    const activePlans = planEngine.listPlans("active");
    const relatedSteps = [];
    const descLower = description.toLowerCase();

    for (const plan of activePlans) {
      const full = planEngine.getPlan(plan.id);
      if (!full) continue;
      for (const step of full.steps) {
        if (step.status === "done" || step.status === "skipped") continue;
        const titleLower = step.title.toLowerCase();
        const overlap = descLower.split(/\s+/).filter((w) => w.length > 2 && titleLower.includes(w));
        if (overlap.length >= 2) {
          relatedSteps.push({ planId: plan.id, planGoal: plan.goal, stepId: step.id, stepTitle: step.title, overlapWords: overlap });
        }
      }
    }

    const suggestions = [];
    if (relatedMemories.length > 0) suggestions.push(`Found ${relatedMemories.length} related memory(ies) — consider reviewing before starting`);
    if (relatedSteps.length > 0) suggestions.push(`${relatedSteps.length} existing plan step(s) overlap — consider merging`);

    return { relatedMemories, relatedSteps, suggestions };
  }

  /**
   * Suggest whether two tasks should be merged.
   * @param {{ title: string, description?: string }} taskA
   * @param {{ title: string, description?: string }} taskB
   */
  function suggestMerge(taskA, taskB) {
    const wordsA = new Set((taskA.title + " " + (taskA.description || "")).toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set((taskB.title + " " + (taskB.description || "")).toLowerCase().split(/\s+/).filter((w) => w.length > 2));

    const intersection = [...wordsA].filter((w) => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);
    const similarity = union.size > 0 ? intersection.length / union.size : 0;

    return {
      shouldMerge: similarity > 0.3,
      similarity: Math.round(similarity * 100) / 100,
      sharedTerms: intersection.slice(0, 10),
      reason: similarity > 0.3 ? "High term overlap suggests these tasks address similar concerns" : "Low overlap — tasks appear distinct",
    };
  }

  /**
   * Generate a notification message for related items.
   * @param {string} taskDescription
   */
  function notifyRelated(taskDescription) {
    const { relatedMemories, relatedSteps, suggestions } = findRelated(taskDescription);
    if (suggestions.length === 0) return null;

    return {
      type: "related_items_found",
      message: suggestions.join("; "),
      memoriesCount: relatedMemories.length,
      stepsCount: relatedSteps.length,
      details: { relatedMemories, relatedSteps },
    };
  }

  return { findRelated, suggestMerge, notifyRelated };
}
