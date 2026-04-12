/**
 * AutoOffice (自动化办公) adapter — REQ-E09
 * Generates reports in PPT, PDF, Word, and LaTeX formats.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const AUTOOFFICE_DIR =
  "/Users/mac/Library/Mobile Documents/com~apple~CloudDocs/Tools/AutoOffice";

const SUPPORTED_FORMATS = ["pptx", "pdf", "docx", "latex", "html"];

export function createAutoOfficeAdapter(options = {}) {
  const projectDir = options.projectDir ?? AUTOOFFICE_DIR;
  const timeout = options.timeoutMs ?? 180_000;
  const apiPort = options.apiPort ?? 3100;
  const apiBaseUrl = options.apiBaseUrl ?? `http://127.0.0.1:${apiPort}`;

  function isAvailable() {
    return (
      existsSync(join(projectDir, "dist/cli.js")) ||
      existsSync(join(projectDir, "src/cli.ts"))
    );
  }

  /**
   * Generate a report from structured content.
   * @param {{
   *   title: string,
   *   content: string,
   *   format: 'pptx' | 'pdf' | 'docx' | 'latex',
   *   outputDir?: string,
   *   template?: string,
   *   metadata?: Record<string, string>
   * }} params
   */
  async function generateReport(params) {
    const { title, content, format, outputDir, template, metadata } = params;
    if (!SUPPORTED_FORMATS.includes(format)) {
      return { ok: false, error: `Unsupported format: ${format}. Use: ${SUPPORTED_FORMATS.join(", ")}` };
    }
    if (!title || !content) {
      return { ok: false, error: "title and content are required" };
    }
    if (!isAvailable()) {
      return { ok: false, error: "AutoOffice project not found" };
    }

    try {
      const apiRes = await fetch(`${apiBaseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, format, outputDir, template, metadata }),
        signal: AbortSignal.timeout(timeout),
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        return { ok: true, ...data, mode: "http-api" };
      }
    } catch { /* HTTP API not available, fall back to CLI */ }

    try {
      const outDir = outputDir ?? join(projectDir, "output");
      const tmpInput = join(projectDir, ".tmp-input.json");

      const sections = content.split(/\n(?=##?\s)/).filter(Boolean).map((s) => {
        const lines = s.split("\n");
        const heading = lines[0].replace(/^#+\s*/, "").trim() || "Section";
        const body = lines.slice(1).join("\n").trim();
        return { heading, body: body || heading };
      });

      const formatKey = format === "pptx" || format === "ppt" ? "pptx" : format;
      const themeMap = { pdf: "academic", pptx: "business", docx: "business", html: "minimal", latex: "academic" };

      const payload = {
        [formatKey === "pptx" ? "pptx" : formatKey]: {
          theme: themeMap[formatKey] ?? "minimal",
          locale: "zh-CN",
          title,
          subtitle: metadata?.subtitle ?? "",
          author: metadata?.author ?? "MyClaw",
          date: new Date().toISOString().slice(0, 10),
          sections,
          ...(formatKey === "pptx" ? { slides: sections.map(s => ({ title: s.heading, bullets: s.body.split("\n").filter(Boolean) })) } : {}),
        },
      };
      writeFileSync(tmpInput, JSON.stringify(payload, null, 2), "utf-8");

      const outFile = join(outDir, `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.${format}`);
      const cmd = `cd "${projectDir}" && node dist/cli.js generate -i "${tmpInput}" -f ${format} -o "${outFile}"`;
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout,
        maxBuffer: 20 * 1024 * 1024,
      });
      try { unlinkSync(tmpInput); } catch {}
      return { ok: true, output: output.trim(), format, outputFile: outFile, mode: "cli" };
    } catch (err) {
      const msg = err.stderr?.trim() || err.message?.split("\n").pop() || String(err);
      return { ok: false, error: msg.slice(0, 200) };
    }
  }

  /**
   * Summarize and organize input content.
   * @param {{ content: string, type?: 'brief' | 'detailed' | 'outline' }} params
   */
  async function summarize(params) {
    if (!isAvailable()) {
      return { ok: false, error: "AutoOffice project not found" };
    }

    const { content, type = "brief" } = params;
    try {
      const cmd = `cd "${projectDir}" && echo '${content.slice(0, 50000).replace(/'/g, "'\\''")}' | node dist/cli.js summarize --type ${type}`;
      const output = execSync(cmd, { encoding: "utf-8", timeout });
      return { ok: true, summary: output.trim(), type };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  function listTemplates() {
    if (!isAvailable()) return [];
    try {
      const templatesDir = join(projectDir, "templates");
      if (!existsSync(templatesDir)) return [];
      const output = execSync(`ls "${templatesDir}"`, { encoding: "utf-8" });
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  return {
    isAvailable,
    generateReport,
    summarize,
    listTemplates,
    supportedFormats: SUPPORTED_FORMATS,
    projectDir,
  };
}
