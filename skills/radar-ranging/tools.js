// skills/radar-ranging/tools.ts
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var EXPERIMENT_ROOT = resolve(
  process.env.HOME ?? "/Users/mac",
  "Polarisor/macbook/Class/\u96F7\u8FBE\u5B9E\u9A8C"
);
var SUBDIR = "\u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387";
var WORK = join(EXPERIMENT_ROOT, SUBDIR);
var RAR_FILE = join(EXPERIMENT_ROOT, "\u7B2C4\u7EC4\u91C7\u96C6\u5B9E\u9A8C\u6570\u636E.rar");
var DATA_DIR = join(WORK, "data");
var CODE_DIR = join(WORK, "code");
var OUTPUT_DIR = join(CODE_DIR, "output");
var REPORT_DIR = join(WORK, "report");
var TEMPLATE = join(EXPERIMENT_ROOT, "\u5B9E\u9A8C\u62A5\u544A\u6A21\u677F.docx");
async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
async function shell(cmd, args, opts) {
  try {
    return await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 3e5,
      cwd: opts?.cwd,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (err) {
    const e = err;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err) };
  }
}
var radarRangingExtract = {
  name: "radar_ranging_extract",
  description: "Phase 1 \u2014 \u89E3\u538B\u96F7\u8FBE\u5B9E\u9A8C RAR \u6570\u636E\u5230 data/ \u76EE\u5F55\u3002\u4F7F\u7528 unar \u5904\u7406 Windows GBK \u7F16\u7801\u7684\u4E2D\u6587\u6587\u4EF6\u540D\u3002",
  parameters: {
    type: "object",
    properties: {
      force: {
        type: "boolean",
        description: "\u5982\u679C data/ \u5DF2\u5B58\u5728\uFF0C\u662F\u5426\u5F3A\u5236\u91CD\u65B0\u89E3\u538B\uFF08\u9ED8\u8BA4 false\uFF09"
      }
    }
  },
  async handler(args) {
    const force = Boolean(args?.force);
    if (!force && await fileExists(DATA_DIR)) {
      const files = await readdir(DATA_DIR, { recursive: true });
      const bins = files.filter((f) => String(f).endsWith(".bin"));
      if (bins.length > 0) {
        return {
          success: true,
          skipped: true,
          message: `data/ already contains ${bins.length} .bin files`
        };
      }
    }
    if (!await fileExists(RAR_FILE)) {
      return { success: false, error: `RAR not found: ${RAR_FILE}` };
    }
    const { stdout, stderr } = await shell("/opt/homebrew/bin/unar", [
      "-e",
      "GBK",
      "-o",
      DATA_DIR,
      RAR_FILE
    ]);
    const ok = stdout.includes("Successfully extracted");
    return { success: ok, stdout: stdout.slice(-500), stderr: stderr.slice(-300) };
  }
};
var radarRangingProcess = {
  name: "radar_ranging_process",
  description: "Phase 2+3 \u2014 \u6267\u884C Python \u811A\u672C\u5904\u7406\u96F7\u8FBE\u539F\u59CB\u6570\u636E\uFF1AFFT\u3001\u8DDD\u79BB\u8C31\u3001Range-Doppler Map\u3001\u89D2\u5EA6\u5206\u6790\uFF0C\u751F\u6210\u56FE\u8868\u5230 code/output/\u3002\u9700\u8981 data/ \u5DF2\u89E3\u538B\u3002",
  parameters: {
    type: "object",
    properties: {}
  },
  async handler() {
    const script = join(CODE_DIR, "process.py");
    if (!await fileExists(script)) {
      return { success: false, error: `Script not found: ${script}` };
    }
    if (!await fileExists(DATA_DIR)) {
      return {
        success: false,
        error: "data/ not found. Run radar_ranging_extract first."
      };
    }
    const { stdout, stderr } = await shell("python3", [script], {
      cwd: CODE_DIR,
      timeout: 12e4
    });
    let outputs = [];
    try {
      outputs = (await readdir(OUTPUT_DIR)).filter(
        (f) => f.endsWith(".png") || f.endsWith(".json")
      );
    } catch {
    }
    const ok = outputs.length >= 4;
    return {
      success: ok,
      outputs,
      stdout: stdout.slice(-1e3),
      stderr: stderr.slice(-500)
    };
  }
};
var radarRangingReport = {
  name: "radar_ranging_report",
  description: "Phase 4 \u2014 \u8C03\u7528 lab_report_generate \u751F\u6210\u96F7\u8FBE\u6D4B\u8DDD\u5B9E\u9A8C\u62A5\u544A .docx\u3002\u9700\u8981 code/output/ \u4E2D\u7684\u56FE\u8868\u5DF2\u751F\u6210\u3002",
  parameters: {
    type: "object",
    properties: {}
  },
  async handler(_args, context) {
    let outputs = [];
    try {
      outputs = (await readdir(OUTPUT_DIR)).filter((f) => f.endsWith(".png"));
    } catch {
      return { success: false, error: "No output charts found. Run radar_ranging_process first." };
    }
    if (outputs.length < 3) {
      return { success: false, error: `Only ${outputs.length} chart(s) in output/. Need at least 3.` };
    }
    let resultsJson = "{}";
    try {
      resultsJson = await readFile(join(OUTPUT_DIR, "results.json"), "utf8");
    } catch {
    }
    const experimentContext = `
# \u96F7\u8FBE\u6D4B\u8DDD\u4E0E\u8DDD\u79BB\u5206\u8FA8\u7387\u5B9E\u9A8C

## \u5B9E\u9A8C\u8BBE\u5907
- 24GHz FMCW \u96F7\u8FBE\u7CFB\u7EDF\uFF082\u53D14\u6536 TDM-MIMO\uFF09
- \u8F7D\u6CE2\u9891\u7387 f0 = 24.05 GHz
- ADC \u91C7\u6837\u7387 10MHz\uFF0CChirp \u5468\u671F 70\u03BCs\uFF0C\u6709\u6548\u91C7\u6837\u65F6\u957F 51.2\u03BCs
- \u89D2\u53CD\u5C04\u5668\u4F5C\u4E3A\u6807\u51C6\u76EE\u6807

## \u5B9E\u9A8C\u539F\u7406
FMCW\uFF08\u8C03\u9891\u8FDE\u7EED\u6CE2\uFF09\u96F7\u8FBE\u901A\u8FC7\u53D1\u5C04\u7EBF\u6027\u8C03\u9891\u4FE1\u53F7\uFF0C\u63A5\u6536\u56DE\u6CE2\u6DF7\u9891\u4EA7\u751F\u5DEE\u9891\u4FE1\u53F7\uFF1A
- \u76EE\u6807\u8DDD\u79BB\uFF1AR = f_beat \xD7 c \xD7 T_eff / (2B)
- \u8DDD\u79BB\u5206\u8FA8\u7387\uFF1A\u0394R = c / (2B)
- \u901F\u5EA6\u6D4B\u91CF\uFF1A\u901A\u8FC7\u591A Chirp \u5E8F\u5217\u7684\u591A\u666E\u52D2\u9891\u79FB
- \u89D2\u5EA6\u6D4B\u91CF\uFF1A\u5229\u7528 MIMO \u865A\u62DF\u9635\u5217\u7684\u6CE2\u675F\u5F62\u6210

## \u5B9E\u9A8C\u5185\u5BB9
1. \u6D4B\u8DDD\u5B9E\u9A8C\uFF1A\u4E0D\u540C\u5E26\u5BBD\uFF08100MHz/150MHz\uFF09\u4E0B\u7684\u53CC\u76EE\u6807\u6D4B\u8DDD
2. \u8DDD\u79BB\u5206\u8FA8\u7387\uFF1A150MHz\uFF08\u0394R=1m\uFF09\u548C 250MHz\uFF08\u0394R=0.6m\uFF09\u56DE\u73AF\u6D4B\u8BD5\u5BF9\u6BD4
3. \u591A\u666E\u52D2\u6D4B\u901F\uFF1A\u6B65\u884C\uFF08~1.5m/s\uFF09\u548C\u8DD1\u6B65\uFF08~4m/s\uFF09
4. \u89D2\u5EA6\u6D4B\u91CF\uFF1A\u4E0D\u540C\u89D2\u5EA6\uFF0812\xB0/18.2\xB0/30.5\xB0\uFF09\u7684\u53CC\u76EE\u6807\u5206\u8FA8

## \u6570\u636E\u5904\u7406\u7ED3\u679C
${resultsJson}
`;
    const sections = [
      {
        key: "purpose",
        heading: "\u4E00\u3001\u5B9E\u9A8C\u76EE\u7684",
        prompt: "\u64B0\u5199\u5B9E\u9A8C\u76EE\u7684\uFF0C\u5305\u62EC\uFF1A(1)\u638C\u63E1FMCW\u96F7\u8FBE\u6D4B\u8DDD\u539F\u7406 (2)\u7406\u89E3\u8DDD\u79BB\u5206\u8FA8\u7387\u6982\u5FF5 (3)\u638C\u63E1FFT\u4FE1\u53F7\u5904\u7406\u65B9\u6CD5 (4)\u4E86\u89E3\u591A\u666E\u52D2\u6D4B\u901F\u548CMIMO\u6D4B\u89D2\u3002200\u5B57\u4EE5\u5185\u3002"
      },
      {
        key: "principle",
        heading: "\u4E8C\u3001\u5B9E\u9A8C\u539F\u7406",
        prompt: "\u8BE6\u7EC6\u63CF\u8FF0FMCW\u96F7\u8FBE\u6D4B\u8DDD\u539F\u7406\uFF0C\u5305\u62EC\uFF1A\u7EBF\u6027\u8C03\u9891\u4FE1\u53F7\u6A21\u578B\u3001\u5DEE\u9891\u4FE1\u53F7\u63A8\u5BFC\u3001\u8DDD\u79BB\u516C\u5F0F R=f_beat*c*T/(2B)\u3001\u8DDD\u79BB\u5206\u8FA8\u7387\u516C\u5F0F \u0394R=c/(2B)\u3001\u591A\u666E\u52D2\u6D4B\u901F\u539F\u7406\u3002\u9700\u5305\u542B\u516C\u5F0F\u63A8\u5BFC\uFF0C800\u5B57\u5DE6\u53F3\u3002",
        max_tokens: 4e3
      },
      {
        key: "equipment",
        heading: "\u4E09\u3001\u5B9E\u9A8C\u8BBE\u5907",
        prompt: "\u5217\u51FA\u5B9E\u9A8C\u8BBE\u5907\uFF1A24GHz\u7F51\u7EDC\u5316FMCW\u96F7\u8FBE\u3001\u89D2\u53CD\u5C04\u5668\u3001\u5C04\u9891\u7EBF\u7F06\u3001\u8BA1\u7B97\u673A\u3002\u7B80\u8981\u8BF4\u660E\u96F7\u8FBE\u53C2\u6570\uFF1Af0=24.05GHz\uFF0C2\u53D14\u6536MIMO\uFF0CADC 10MHz\u3002150\u5B57\u4EE5\u5185\u3002"
      },
      {
        key: "procedure",
        heading: "\u56DB\u3001\u5B9E\u9A8C\u5185\u5BB9\u4E0E\u6B65\u9AA4",
        prompt: "\u63CF\u8FF0\u5B9E\u9A8C\u6B65\u9AA4\uFF1A(1)\u5BA4\u5185\u6709\u7EBF\u56DE\u73AF\u6D4B\u8BD5(B=150MHz/250MHz) (2)\u5BA4\u5916\u53CC\u76EE\u6807\u6D4B\u8DDD(100MHz/150MHz\u5E26\u5BBD\uFF0C\u4E0D\u540C\u76EE\u6807\u95F4\u8DDD) (3)\u6D4B\u901F\u5B9E\u9A8C(\u6B65\u884C/\u8DD1\u6B65) (4)\u6D4B\u89D2\u5B9E\u9A8C(\u4E0D\u540C\u89D2\u5EA6)\u3002300\u5B57\u5DE6\u53F3\u3002"
      },
      {
        key: "analysis",
        heading: "\u4E94\u3001\u5B9E\u9A8C\u6570\u636E\u4E0E\u5206\u6790",
        prompt: "\u6839\u636E\u6570\u636E\u5904\u7406\u7ED3\u679C\uFF0C\u5206\u6790\uFF1A(1)\u6D4B\u8DDD\u7CBE\u5EA6\u2014\u2014\u6BD4\u8F83\u6D4B\u91CF\u8DDD\u79BB\u4E0E\u771F\u5B9E\u8DDD\u79BB (2)\u8DDD\u79BB\u5206\u8FA8\u7387\u2014\u2014\u4E0D\u540C\u5E26\u5BBD\u7684\u5206\u8FA8\u80FD\u529B\u5DEE\u5F02 (3)\u6D4B\u901F\u7ED3\u679C\u2014\u2014\u6B65\u884C\u548C\u8DD1\u6B65\u7684\u591A\u666E\u52D2\u9891\u79FB (4)\u6D4B\u89D2\u7ED3\u679C\u3002\u8BA8\u8BBA\u8BEF\u5DEE\u6765\u6E90\uFF08\u591A\u5F84\u3001\u65C1\u74E3\u3001FFT\u6805\u680F\u6548\u5E94\uFF09\u3002500\u5B57\u5DE6\u53F3\u3002",
        max_tokens: 4e3
      },
      {
        key: "conclusion",
        heading: "\u516D\u3001\u5B9E\u9A8C\u7ED3\u8BBA",
        prompt: "\u603B\u7ED3\u5B9E\u9A8C\u7ED3\u8BBA\uFF1A(1)FMCW\u96F7\u8FBE\u6D4B\u8DDD\u9A8C\u8BC1 (2)\u5E26\u5BBD\u4E0E\u8DDD\u79BB\u5206\u8FA8\u7387\u5173\u7CFB\u9A8C\u8BC1 (3)\u591A\u666E\u52D2\u6D4B\u901F\u53EF\u884C\u6027 (4)MIMO\u6D4B\u89D2\u80FD\u529B\u3002200\u5B57\u4EE5\u5185\u3002"
      }
    ];
    const images = outputs.map((fname) => ({
      path: join(OUTPUT_DIR, fname),
      caption: fname.replace(".png", "").replace(/_/g, " "),
      width: "14cm"
    }));
    if (context?.callTool) {
      const result = await context.callTool("lab_report_generate", {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_DIR, "\u5B9E\u9A8C\u62A5\u544A_\u96F7\u8FBE\u6D4B\u8DDD.docx"),
        template_map: {
          principle: { headingParaId: "0010000E", removeParaIds: [] },
          purpose: { headingParaId: "00100098", removeParaIds: [] },
          equipment: { headingParaId: "001000A4", removeParaIds: [] },
          procedure: { headingParaId: "001000A8", removeParaIds: [] },
          analysis: { headingParaId: "001000B2", removeParaIds: [] },
          conclusion: { headingParaId: "001000C6", removeParaIds: [] }
        },
        image_anchor_para_id: "001000B2",
        images
      });
      return { success: true, report: result };
    }
    return {
      success: true,
      message: "Report config prepared. Call lab_report_generate with the returned params.",
      lab_report_params: {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_DIR, "\u5B9E\u9A8C\u62A5\u544A_\u96F7\u8FBE\u6D4B\u8DDD.docx"),
        template_map: {
          principle: { headingParaId: "0010000E", removeParaIds: [] },
          purpose: { headingParaId: "00100098", removeParaIds: [] },
          equipment: { headingParaId: "001000A4", removeParaIds: [] },
          procedure: { headingParaId: "001000A8", removeParaIds: [] },
          analysis: { headingParaId: "001000B2", removeParaIds: [] },
          conclusion: { headingParaId: "001000C6", removeParaIds: [] }
        },
        image_anchor_para_id: "001000B2",
        images
      }
    };
  }
};
var radarRangingRun = {
  name: "radar_ranging_run",
  description: "\u5B8C\u6574\u6D41\u7A0B\uFF1A\u89E3\u538B RAR \u2192 \u6570\u636E\u5904\u7406/\u56FE\u8868 \u2192 \u751F\u6210\u5B9E\u9A8C\u62A5\u544A\u3002\u4E32\u8054 extract \u2192 process \u2192 report \u4E09\u4E2A\u9636\u6BB5\u3002",
  parameters: {
    type: "object",
    properties: {
      skip_extract: {
        type: "boolean",
        description: "\u8DF3\u8FC7\u89E3\u538B\uFF08data/ \u5DF2\u5B58\u5728\u65F6\uFF09"
      },
      skip_report: {
        type: "boolean",
        description: "\u8DF3\u8FC7\u62A5\u544A\u751F\u6210\uFF08\u4EC5\u505A\u6570\u636E\u5904\u7406\uFF09"
      }
    }
  },
  async handler(args, context) {
    const results = {};
    if (!args?.skip_extract) {
      const ext = await radarRangingExtract.handler({});
      results.extract = ext;
      if (!ext.success) {
        return { success: false, phase: "extract", ...results };
      }
    }
    const proc = await radarRangingProcess.handler({});
    results.process = proc;
    if (!proc.success) {
      return { success: false, phase: "process", ...results };
    }
    if (!args?.skip_report) {
      const rpt = await radarRangingReport.handler({}, context);
      results.report = rpt;
    }
    return { success: true, ...results };
  }
};
var radarRangingHealth = {
  name: "radar_ranging_health",
  description: "\u68C0\u67E5 radar-ranging skill \u4F9D\u8D56\u72B6\u6001\uFF1Aunar\u3001python3\u3001\u6570\u636E\u6587\u4EF6\u3001\u6A21\u677F\u3002",
  parameters: { type: "object", properties: {} },
  async handler() {
    const checks = {};
    try {
      const { stdout } = await shell("/opt/homebrew/bin/unar", ["--version"]);
      checks.unar = { available: true, version: stdout.trim().split("\n")[0] };
    } catch {
      checks.unar = { available: false };
    }
    try {
      const { stdout } = await shell("python3", ["--version"]);
      checks.python3 = { available: true, version: stdout.trim() };
    } catch {
      checks.python3 = { available: false };
    }
    try {
      const { stdout } = await shell("python3", [
        "-c",
        'import numpy, scipy, matplotlib; print("ok")'
      ]);
      checks.python_deps = { available: stdout.includes("ok") };
    } catch {
      checks.python_deps = { available: false };
    }
    checks.rar_file = { exists: await fileExists(RAR_FILE) };
    checks.template = { exists: await fileExists(TEMPLATE) };
    checks.data_dir = { exists: await fileExists(DATA_DIR) };
    checks.process_script = { exists: await fileExists(join(CODE_DIR, "process.py")) };
    checks.output_dir = { exists: await fileExists(OUTPUT_DIR) };
    if (await fileExists(OUTPUT_DIR)) {
      try {
        const files = await readdir(OUTPUT_DIR);
        checks.output_files = files;
      } catch {
      }
    }
    return checks;
  }
};
var radarRangingTools = [
  radarRangingExtract,
  radarRangingProcess,
  radarRangingReport,
  radarRangingRun,
  radarRangingHealth
];
export {
  radarRangingExtract,
  radarRangingHealth,
  radarRangingProcess,
  radarRangingReport,
  radarRangingRun,
  radarRangingTools
};
