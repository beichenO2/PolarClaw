/**
 * Radar Ranging Experiment — MyClaw PolarClaw Skill
 *
 * Workflow:
 *   Phase 1 — Extract RAR data (unar)
 *   Phase 2 — Run Python data processing (FFT / range spectrum / charts)
 *   Phase 3 — Generate experiment report (.docx via lab-report skill)
 *   Full    — radar_ranging_run chains all three phases
 */

import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';

const execFileAsync = promisify(execFile);

// ─── Paths ─────────────────────────────────────────────────────────────

const EXPERIMENT_ROOT = resolve(
  process.env.HOME ?? '/Users/mac',
  'Polarisor/macbook/Class/雷达实验',
);
const SUBDIR = '雷达测距和距离分辨率';
const WORK = join(EXPERIMENT_ROOT, SUBDIR);
const RAR_FILE = join(EXPERIMENT_ROOT, '第4组采集实验数据.rar');
const DATA_DIR = join(WORK, 'data');
const CODE_DIR = join(WORK, 'code');
const OUTPUT_DIR = join(CODE_DIR, 'output');
const REPORT_DIR = join(WORK, 'report');
const TEMPLATE = join(EXPERIMENT_ROOT, '实验报告模板.docx');

// ─── Tool helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function shell(
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 300_000,
      cwd: opts?.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
}

// ─── Tool: radar_ranging_extract ───────────────────────────────────────

export const radarRangingExtract: IToolHandler = {
  name: 'radar_ranging_extract',
  description:
    'Phase 1 — 解压雷达实验 RAR 数据到 data/ 目录。' +
    '使用 unar 处理 Windows GBK 编码的中文文件名。',
  parameters: {
    type: 'object',
    properties: {
      force: {
        type: 'boolean',
        description: '如果 data/ 已存在，是否强制重新解压（默认 false）',
      },
    },
  },
  async handler(args) {
    const force = Boolean(args?.force);

    if (!force && (await fileExists(DATA_DIR))) {
      const files = await readdir(DATA_DIR, { recursive: true });
      const bins = files.filter((f) => String(f).endsWith('.bin'));
      if (bins.length > 0) {
        return {
          success: true,
          skipped: true,
          message: `data/ already contains ${bins.length} .bin files`,
        };
      }
    }

    if (!(await fileExists(RAR_FILE))) {
      return { success: false, error: `RAR not found: ${RAR_FILE}` };
    }

    const { stdout, stderr } = await shell('/opt/homebrew/bin/unar', [
      '-e', 'GBK', '-o', DATA_DIR, RAR_FILE,
    ]);

    const ok = stdout.includes('Successfully extracted');
    return { success: ok, stdout: stdout.slice(-500), stderr: stderr.slice(-300) };
  },
};

// ─── Tool: radar_ranging_process ───────────────────────────────────────

export const radarRangingProcess: IToolHandler = {
  name: 'radar_ranging_process',
  description:
    'Phase 2+3 — 执行 Python 脚本处理雷达原始数据：FFT、距离谱、Range-Doppler Map、' +
    '角度分析，生成图表到 code/output/。需要 data/ 已解压。',
  parameters: {
    type: 'object',
    properties: {},
  },
  async handler() {
    const script = join(CODE_DIR, 'process.py');
    if (!(await fileExists(script))) {
      return { success: false, error: `Script not found: ${script}` };
    }
    if (!(await fileExists(DATA_DIR))) {
      return {
        success: false,
        error: 'data/ not found. Run radar_ranging_extract first.',
      };
    }

    const { stdout, stderr } = await shell('python3', [script], {
      cwd: CODE_DIR,
      timeout: 120_000,
    });

    // Check outputs
    let outputs: string[] = [];
    try {
      outputs = (await readdir(OUTPUT_DIR)).filter(
        (f) => f.endsWith('.png') || f.endsWith('.json'),
      );
    } catch { /* output dir may not exist on failure */ }

    const ok = outputs.length >= 4;
    return {
      success: ok,
      outputs,
      stdout: stdout.slice(-1000),
      stderr: stderr.slice(-500),
    };
  },
};

// ─── Tool: radar_ranging_report ────────────────────────────────────────

export const radarRangingReport: IToolHandler = {
  name: 'radar_ranging_report',
  description:
    'Phase 4 — 调用 lab_report_generate 生成雷达测距实验报告 .docx。' +
    '需要 code/output/ 中的图表已生成。',
  parameters: {
    type: 'object',
    properties: {},
  },
  async handler(_args, context) {
    // Verify outputs exist
    let outputs: string[] = [];
    try {
      outputs = (await readdir(OUTPUT_DIR)).filter((f) => f.endsWith('.png'));
    } catch {
      return { success: false, error: 'No output charts found. Run radar_ranging_process first.' };
    }
    if (outputs.length < 3) {
      return { success: false, error: `Only ${outputs.length} chart(s) in output/. Need at least 3.` };
    }

    // Load results.json for experiment context
    let resultsJson = '{}';
    try {
      resultsJson = await readFile(join(OUTPUT_DIR, 'results.json'), 'utf8');
    } catch { /* not critical */ }

    // Build experiment context for LLM
    const experimentContext = `
# 雷达测距与距离分辨率实验

## 实验设备
- 24GHz FMCW 雷达系统（2发4收 TDM-MIMO）
- 载波频率 f0 = 24.05 GHz
- ADC 采样率 10MHz，Chirp 周期 70μs，有效采样时长 51.2μs
- 角反射器作为标准目标

## 实验原理
FMCW（调频连续波）雷达通过发射线性调频信号，接收回波混频产生差频信号：
- 目标距离：R = f_beat × c × T_eff / (2B)
- 距离分辨率：ΔR = c / (2B)
- 速度测量：通过多 Chirp 序列的多普勒频移
- 角度测量：利用 MIMO 虚拟阵列的波束形成

## 实验内容
1. 测距实验：不同带宽（100MHz/150MHz）下的双目标测距
2. 距离分辨率：150MHz（ΔR=1m）和 250MHz（ΔR=0.6m）回环测试对比
3. 多普勒测速：步行（~1.5m/s）和跑步（~4m/s）
4. 角度测量：不同角度（12°/18.2°/30.5°）的双目标分辨

## 数据处理结果
${resultsJson}
`;

    // Build sections
    const sections = [
      {
        key: 'purpose',
        heading: '一、实验目的',
        prompt: '撰写实验目的，包括：(1)掌握FMCW雷达测距原理 (2)理解距离分辨率概念 (3)掌握FFT信号处理方法 (4)了解多普勒测速和MIMO测角。200字以内。',
      },
      {
        key: 'principle',
        heading: '二、实验原理',
        prompt: '详细描述FMCW雷达测距原理，包括：线性调频信号模型、差频信号推导、距离公式 R=f_beat*c*T/(2B)、距离分辨率公式 ΔR=c/(2B)、多普勒测速原理。需包含公式推导，800字左右。',
        max_tokens: 4000,
      },
      {
        key: 'equipment',
        heading: '三、实验设备',
        prompt: '列出实验设备：24GHz网络化FMCW雷达、角反射器、射频线缆、计算机。简要说明雷达参数：f0=24.05GHz，2发4收MIMO，ADC 10MHz。150字以内。',
      },
      {
        key: 'procedure',
        heading: '四、实验内容与步骤',
        prompt: '描述实验步骤：(1)室内有线回环测试(B=150MHz/250MHz) (2)室外双目标测距(100MHz/150MHz带宽，不同目标间距) (3)测速实验(步行/跑步) (4)测角实验(不同角度)。300字左右。',
      },
      {
        key: 'analysis',
        heading: '五、实验数据与分析',
        prompt: '根据数据处理结果，分析：(1)测距精度——比较测量距离与真实距离 (2)距离分辨率——不同带宽的分辨能力差异 (3)测速结果——步行和跑步的多普勒频移 (4)测角结果。讨论误差来源（多径、旁瓣、FFT栅栏效应）。500字左右。',
        max_tokens: 4000,
      },
      {
        key: 'conclusion',
        heading: '六、实验结论',
        prompt: '总结实验结论：(1)FMCW雷达测距验证 (2)带宽与距离分辨率关系验证 (3)多普勒测速可行性 (4)MIMO测角能力。200字以内。',
      },
    ];

    // Build images list
    const images = outputs.map((fname) => ({
      path: join(OUTPUT_DIR, fname),
      caption: fname.replace('.png', '').replace(/_/g, ' '),
      width: '14cm',
    }));

    // Call lab_report_generate via context (peer skill invocation)
    if (context?.callTool) {
      const result = await context.callTool('lab_report_generate', {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_DIR, '实验报告_雷达测距.docx'),
        template_map: {
          principle: { headingParaId: '0010000E', removeParaIds: [] },
          purpose: { headingParaId: '00100098', removeParaIds: [] },
          equipment: { headingParaId: '001000A4', removeParaIds: [] },
          procedure: { headingParaId: '001000A8', removeParaIds: [] },
          analysis: { headingParaId: '001000B2', removeParaIds: [] },
          conclusion: { headingParaId: '001000C6', removeParaIds: [] }
        },
        image_anchor_para_id: '001000B2',
        images,
      });
      return { success: true, report: result };
    }

    // Fallback: return config for manual invocation
    return {
      success: true,
      message: 'Report config prepared. Call lab_report_generate with the returned params.',
      lab_report_params: {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_DIR, '实验报告_雷达测距.docx'),
        template_map: {
          principle: { headingParaId: '0010000E', removeParaIds: [] },
          purpose: { headingParaId: '00100098', removeParaIds: [] },
          equipment: { headingParaId: '001000A4', removeParaIds: [] },
          procedure: { headingParaId: '001000A8', removeParaIds: [] },
          analysis: { headingParaId: '001000B2', removeParaIds: [] },
          conclusion: { headingParaId: '001000C6', removeParaIds: [] }
        },
        image_anchor_para_id: '001000B2',
        images,
      },
    };
  },
};

// ─── Tool: radar_ranging_run ───────────────────────────────────────────

export const radarRangingRun: IToolHandler = {
  name: 'radar_ranging_run',
  description:
    '完整流程：解压 RAR → 数据处理/图表 → 生成实验报告。' +
    '串联 extract → process → report 三个阶段。',
  parameters: {
    type: 'object',
    properties: {
      skip_extract: {
        type: 'boolean',
        description: '跳过解压（data/ 已存在时）',
      },
      skip_report: {
        type: 'boolean',
        description: '跳过报告生成（仅做数据处理）',
      },
    },
  },
  async handler(args, context) {
    const results: Record<string, unknown> = {};

    // Phase 1: Extract
    if (!args?.skip_extract) {
      const ext = await radarRangingExtract.handler({});
      results.extract = ext;
      if (!(ext as { success: boolean }).success) {
        return { success: false, phase: 'extract', ...results };
      }
    }

    // Phase 2+3: Process
    const proc = await radarRangingProcess.handler({});
    results.process = proc;
    if (!(proc as { success: boolean }).success) {
      return { success: false, phase: 'process', ...results };
    }

    // Phase 4: Report
    if (!args?.skip_report) {
      const rpt = await radarRangingReport.handler({}, context);
      results.report = rpt;
    }

    return { success: true, ...results };
  },
};

// ─── Tool: radar_ranging_health ────────────────────────────────────────

export const radarRangingHealth: IToolHandler = {
  name: 'radar_ranging_health',
  description: '检查 radar-ranging skill 依赖状态：unar、python3、数据文件、模板。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const checks: Record<string, unknown> = {};

    // unar
    try {
      const { stdout } = await shell('/opt/homebrew/bin/unar', ['--version']);
      checks.unar = { available: true, version: stdout.trim().split('\n')[0] };
    } catch {
      checks.unar = { available: false };
    }

    // python3
    try {
      const { stdout } = await shell('python3', ['--version']);
      checks.python3 = { available: true, version: stdout.trim() };
    } catch {
      checks.python3 = { available: false };
    }

    // numpy / scipy / matplotlib
    try {
      const { stdout } = await shell('python3', [
        '-c', 'import numpy, scipy, matplotlib; print("ok")',
      ]);
      checks.python_deps = { available: stdout.includes('ok') };
    } catch {
      checks.python_deps = { available: false };
    }

    // Files
    checks.rar_file = { exists: await fileExists(RAR_FILE) };
    checks.template = { exists: await fileExists(TEMPLATE) };
    checks.data_dir = { exists: await fileExists(DATA_DIR) };
    checks.process_script = { exists: await fileExists(join(CODE_DIR, 'process.py')) };
    checks.output_dir = { exists: await fileExists(OUTPUT_DIR) };

    if (await fileExists(OUTPUT_DIR)) {
      try {
        const files = await readdir(OUTPUT_DIR);
        checks.output_files = files;
      } catch { /* ignore */ }
    }

    return checks;
  },
};

// ─── Export ────────────────────────────────────────────────────────────

export const radarRangingTools: IToolHandler[] = [
  radarRangingExtract,
  radarRangingProcess,
  radarRangingReport,
  radarRangingRun,
  radarRangingHealth,
];
