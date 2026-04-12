/**
 * LLMWiki adapter — REQ-E08
 * Generates interactive Mermaid-based Wiki sites from topics and source material.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LLMWIKI_DIR =
  "/Users/mac/Library/Mobile Documents/com~apple~CloudDocs/Tools/LLM Wiki";

export function createLLMWikiAdapter(options = {}) {
  const projectDir = options.projectDir ?? LLMWIKI_DIR;
  const timeout = options.timeoutMs ?? 120_000;

  function isAvailable() {
    return existsSync(join(projectDir, "scripts/build.js"));
  }

  /**
   * Create a wiki page from Markdown content.
   * @param {{ slug: string, title: string, content: string, tags?: string[] }} params
   */
  async function createPage(params) {
    if (!isAvailable()) {
      return { ok: false, error: "LLMWiki project not found" };
    }

    const { slug, title, content, tags = [] } = params;
    if (!slug || !title || !content) {
      return { ok: false, error: "slug, title, and content are required" };
    }

    const wikiDir = join(projectDir, "wiki");
    mkdirSync(wikiDir, { recursive: true });

    const frontmatter = [
      "---",
      `title: "${title}"`,
      `slug: "${slug}"`,
      tags.length ? `tags: [${tags.map(t => `"${t}"`).join(", ")}]` : null,
      `created: "${new Date().toISOString()}"`,
      "---",
    ].filter(Boolean).join("\n");

    const filePath = join(wikiDir, `${slug}.md`);
    writeFileSync(filePath, `${frontmatter}\n\n${content}`, "utf-8");

    return { ok: true, filePath, slug };
  }

  /**
   * Build the static wiki site.
   */
  async function buildSite() {
    if (!isAvailable()) {
      return { ok: false, error: "LLMWiki project not found" };
    }

    try {
      const cmd = `cd "${projectDir}" && node scripts/build.js`;
      const output = execSync(cmd, { encoding: "utf-8", timeout });
      return {
        ok: true,
        outputDir: join(projectDir, "output"),
        log: output.trim().slice(-500),
      };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Generate a Mermaid graph definition for a topic structure.
   * @param {{ rootTitle: string, children: Array<{ title: string, children?: string[] }> }} tree
   */
  function generateMermaidGraph(tree) {
    const lines = ["graph TD"];
    const rootId = "root";
    lines.push(`  ${rootId}["${tree.rootTitle}"]`);

    for (let i = 0; i < tree.children.length; i++) {
      const child = tree.children[i];
      const childId = `n${i}`;
      lines.push(`  ${rootId} --> ${childId}["${child.title}"]`);

      if (child.children) {
        for (let j = 0; j < child.children.length; j++) {
          const leafId = `n${i}_${j}`;
          lines.push(`  ${childId} --> ${leafId}["${child.children[j]}"]`);
        }
      }
    }

    return lines.join("\n");
  }

  return {
    isAvailable,
    createPage,
    buildSite,
    generateMermaidGraph,
    projectDir,
  };
}
