/**
 * Radar Ranging MATLAB Route — MyClaw PolarClaw Skill
 *
 * Uses MATLAB Engine API for Python to invoke teacher-provided .p encrypted
 * algorithms for all 4 radar experiments. Outputs to code_mat/output_mat/.
 */

import { execFile } from 'node:child_process';
import { access, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';

const execFileAsync = promisify(execFile);

// ─── Paths ─────────────────────────────────────────────────────────────

const EXPERIMENT_ROOT = resolve(
  process.env.HOME ?? '/Users/macbook',
  'Polarisor/macbook/Class/雷达实验',
);
const SUBDIR = '雷达测距和距离分辨率';
const WORK = join(EXPERIMENT_ROOT, SUBDIR);
const DATA_DIR = join(EXPERIMENT_ROOT, '第4组采集实验数据');
const DEMO_DIR = join(EXPERIMENT_ROOT, '实验数据采集 - 学生');
const CODE_MAT = join(WORK, 'code_mat');
const OUTPUT_MAT = join(CODE_MAT, 'output_mat');
const REPORT_MAT = join(WORK, 'report_mat');
const TEMPLATE = join(EXPERIMENT_ROOT, '实验报告模板.docx');
const VENV_PYTHON = join(WORK, '.venv_mat/bin/python3');
const PROCESS_SCRIPT = join(CODE_MAT, 'process_mat.py');

// ─── Helpers ───────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function shell(
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 600_000,
      cwd: opts?.cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...opts?.env },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
}

// ─── Python bridge script generator ────────────────────────────────────

function generateProcessScript(): string {
  return `#!/usr/bin/env python3
"""MATLAB Bridge — Radar Experiment Processing (MATLAB _mat route)

Starts MATLAB Engine, runs all 4 demo experiments via eng.eval(),
saves figures to output_mat/ and results to results_mat.json.
"""

import matlab.engine
import json
import os
import sys
import traceback

# ─── Paths ──────────────────────────────────────────────────────────────

EXPERIMENT_ROOT = os.path.expanduser("~/Polarisor/macbook/Class/雷达实验")
DATA_DIR = os.path.join(EXPERIMENT_ROOT, "第4组采集实验数据")
DEMO_DIR = os.path.join(EXPERIMENT_ROOT, "实验数据采集 - 学生")
OUTPUT_DIR = os.path.join(EXPERIMENT_ROOT, "雷达测距和距离分辨率/code_mat/output_mat")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ─── Experiment configs ────────────────────────────────────────────────

RECYCLE_FILES = [
    {"file": "Recycle/B150_recycle1.bin", "B": 150e6, "f0": 24.05e9, "tag": "recycle_B150"},
    {"file": "Recycle/B250_Recycle2.bin", "B": 250e6, "f0": 23.8e9,  "tag": "recycle_B250"},
]

RANGE_FILES = [
    {"file": "Distance/100M_2.0_1.bin", "B": 100e6, "tag": "range_100M_2.0"},
    {"file": "Distance/100M_3.0_1.bin", "B": 100e6, "tag": "range_100M_3.0"},
    {"file": "Distance/100M_4.0_1.bin", "B": 100e6, "tag": "range_100M_4.0"},
    {"file": "Distance/150M_2.0_1.bin", "B": 150e6, "tag": "range_150M_2.0"},
    {"file": "Distance/150M_3.0_1.bin", "B": 150e6, "tag": "range_150M_3.0"},
    {"file": "Distance/150M_5.0_1.bin", "B": 150e6, "tag": "range_150M_5.0"},
]

SPEED_FILES = [
    {"file": "Speed/150M_speed_away_walking1.bin", "B": 150e6, "tag": "speed_walking"},
    {"file": "Speed/150M_speed_away_running1.bin", "B": 150e6, "tag": "speed_running"},
]

ANGLE_FILES = [
    {"file": "Angle/angle_0_12.0_1.bin", "B": 150e6, "tag": "angle_12.0"},
    {"file": "Angle/angle_0_18.2_1.bin", "B": 150e6, "tag": "angle_18.2"},
    {"file": "Angle/angle_0_30.5_1.bin", "B": 150e6, "tag": "angle_30.5"},
]

all_results = {}

def run_experiment(eng, demo_subdir, p_script_call, data_cfg, param_overrides, extract_fn, label):
    """Generic runner for one experiment file."""
    demo_path = os.path.join(DEMO_DIR, demo_subdir)
    bin_path = os.path.join(DATA_DIR, data_cfg["file"])
    tag = data_cfg["tag"]
    out_path = os.path.join(OUTPUT_DIR, f"{tag}.png")
    
    print(f"  [{label}] Processing {data_cfg['file']} ...")
    
    try:
        # 1. cd to demo dir so .p file is findable
        eng.cd(demo_path, nargout=0)
        
        # 2. Clear workspace
        eng.eval("clear; clc; close all;", nargout=0)
        
        # 3. Set common radar parameters
        eng.eval(f"""
fs = 10e6;
numRX_Phys = 4;
numTX = 2;
numRX_Virtual = numRX_Phys * numTX;
numChirps_Total = 256;
numChirps_Per_Tx = numChirps_Total / numTX;
numSamples = 512;
valid_start_idx = 1;
valid_end_idx = 512;
c = 3e8;
lambda = c / {data_cfg.get('f0', 24.05e9)};
d = lambda / 2;
Tchirp_effect = 51.2e-6;
Tchirp_Total = 70e-6;
""", nargout=0)
        
        # 4. Set experiment-specific overrides (all values are MATLAB expressions)
        for k, v in param_overrides.items():
            eng.eval(f"{k} = {v};", nargout=0)
        
        # 5. Override binFilePath and B
        eng.eval(f"binFilePath = '{bin_path}';", nargout=0)
        eng.eval(f"B = {data_cfg['B']};", nargout=0)
        eng.eval("Slope = B / Tchirp_effect;", nargout=0)
        eng.eval("range_resolution = c / (2*B);", nargout=0)
        eng.eval("range_scale = 0.5*fs/Slope*c/2;", nargout=0)
        
        # 6. Read bin file + reshape (common to all demos)
        eng.eval("""
fid = fopen(binFilePath, 'r');
if fid == -1, error('Cannot open file %s', binFilePath); end
raw_data_int16 = fread(fid, 'int16');
fclose(fid);
raw_data = double(raw_data_int16);
expected_len = numSamples * numRX_Phys * numChirps_Total;
raw_data = raw_data(1+(N_frame-1)*expected_len:N_frame*expected_len);
radar_cube_raw = reshape(raw_data, [numSamples, numRX_Virtual, numChirps_Per_Tx]);
adc_data = radar_cube_raw(valid_start_idx:valid_end_idx, :, :);
""", nargout=0)
        
        # 7. Run the .p script
        eng.eval(p_script_call, nargout=0)
        
        # 8. Extract results
        result = extract_fn(eng, data_cfg)
        
        # 9. Save figure
        eng.eval(f"""
set(gcf, 'PaperPositionMode', 'auto');
print(gcf, '-dpng', '-r150', '{out_path}');
""", nargout=0)
        
        result["figure"] = out_path
        result["status"] = "ok"
        print(f"    -> OK: {result}")
        
    except Exception as e:
        result = {"status": "error", "error": str(e)}
        traceback.print_exc()
        print(f"    -> ERROR: {e}")
    
    all_results[tag] = result
    return result


# ─── Experiment-specific extractors ────────────────────────────────────

def _to_float_list(val):
    """Convert matlab.double or scalar to Python float list."""
    try:
        # matlab.double is iterable but nested: [[1.0, 2.0]]
        if hasattr(val, '_data'):
            return [float(x) for x in val._data]
        if hasattr(val, '__iter__'):
            flat = []
            for item in val:
                if hasattr(item, '__iter__'):
                    flat.extend(float(x) for x in item)
                else:
                    flat.append(float(item))
            return flat
        return [float(val)]
    except:
        return [float(val)]

def extract_recycle(eng, cfg):
    d_list = _to_float_list(eng.workspace['d_measure'])
    f = float(eng.eval("f_refined", nargout=1))
    return {"d_measure": d_list, "f_refined": f, "B_MHz": cfg["B"]/1e6}

def extract_range(eng, cfg):
    d_list = _to_float_list(eng.workspace['d_measure'])
    return {"d_measure": d_list, "B_MHz": cfg["B"]/1e6}

def extract_speed(eng, cfg):
    tl = eng.workspace['Target_List']
    targets = []
    if tl is not None:
        # MATLAB matrix -> list of rows
        try:
            nrows = int(eng.eval("size(Target_List, 1)", nargout=1))
            for i in range(1, nrows+1):
                snr = float(eng.eval(f"Target_List({i},1)", nargout=1))
                dist = float(eng.eval(f"Target_List({i},2)", nargout=1))
                vel = float(eng.eval(f"Target_List({i},3)", nargout=1))
                targets.append({"snr_linear": snr, "distance_m": dist, "velocity_ms": vel})
        except:
            pass
    return {"targets": targets}

def extract_angle(eng, cfg):
    ft = eng.workspace['Final_Targets']
    targets = []
    if ft is not None:
        try:
            nrows = int(eng.eval("size(Final_Targets, 1)", nargout=1))
            for i in range(1, nrows+1):
                snr = float(eng.eval(f"Final_Targets({i},1)", nargout=1))
                dist = float(eng.eval(f"Final_Targets({i},2)", nargout=1))
                vel = float(eng.eval(f"Final_Targets({i},3)", nargout=1))
                ang = float(eng.eval(f"Final_Targets({i},4)", nargout=1))
                targets.append({"snr_linear": snr, "distance_m": dist, "velocity_ms": vel, "angle_deg": ang})
        except:
            pass
    return {"targets": targets}


# ─── Main ──────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("MATLAB Radar Experiment Processing (_mat route)")
    print("=" * 60)
    
    print("\\nStarting MATLAB Engine (this may take ~30s) ...")
    eng = matlab.engine.start_matlab("-nodisplay -nosplash")
    print("MATLAB Engine started OK\\n")
    
    try:
        # ── 1. Recycle (回环测试) ──
        print("=== [1/4] Recycle (回环测试) ===")
        for cfg in RECYCLE_FILES:
            overrides = {
                "tx_sel": 1, "rx_sel": 1, "N_frame": 15,
                "Nfft_Range": "numSamples*8",
                "ignore_dc": "true",
                "f0": cfg.get("f0", 24.05e9),
            }
            # Recycle uses squeeze for single channel
            run_experiment(
                eng, "回环测试", 
                "adc_data = squeeze(adc_data(:,(tx_sel-1)*4+rx_sel,:)); pRecycle_Demo;",
                cfg, overrides, extract_recycle, "Recycle"
            )
        
        # ── 2. Range (测距) ──
        print("\\n=== [2/4] Range (测距) ===")
        for cfg in RANGE_FILES:
            overrides = {
                "N_frame": 20,
                "Range_end": 100,
                "factor": 8,
                "Nfft_Range": "numSamples*8",
                "ignore_dc": "true",
                "f0": 24.05e9,
            }
            run_experiment(
                eng, "测距",
                "pRange_Demo;",
                cfg, overrides, extract_range, "Range"
            )
        
        # ── 3. Speed (测速) ──
        print("\\n=== [3/4] Speed (测速 CFAR MTI) ===")
        for cfg in SPEED_FILES:
            overrides = {
                "N_frame": 20,
                "ignore_dc": "true",
                "Range_end": 100,
                "Peak_Ratio_db": -6,
                "factor": 0,
                "Nfft_Range": "numSamples",
                "Nfft_Velocity": "numChirps_Per_Tx",
                "CFAR_start_idx": 2,
                "f0": 24.05e9,
            }
            # CFAR params
            overrides["Para.alpha"] = "10^(14/10)"
            overrides["Para.RefNum"] = 40
            overrides["Para.GuardNum"] = 3
            run_experiment(
                eng, "测速_CFAR_MTI",
                "pSpeeding_CFAR_MTI_Demo;",
                cfg, overrides, extract_speed, "Speed"
            )
        
        # ── 4. Angle (测角) ──
        print("\\n=== [4/4] Angle (测角) ===")
        for cfg in ANGLE_FILES:
            overrides = {
                "N_frame": 20,
                "ignore_dc": "true",
                "Range_end": 100,
                "Peak_Ratio_db": -6,
                "MTIFlag": 0,
                "factor": 4,
                "Nfft_Range": "numSamples*4",
                "Nfft_Velocity": "numChirps_Per_Tx",
                "CFAR_start_idx": 0,
                "f0": 24.05e9,
            }
            overrides["Para.alpha"] = "10^(14/10)"
            overrides["Para.RefNum"] = "40*4"
            overrides["Para.GuardNum"] = "3*4"
            # Channel calibration coefficients
            overrides["cal_data_complex"] = """[12809-30159i; 17034+27991i; 19046+26663i; 25233-20903i; 18173-27265i; 15172+29042i; 19682+26196i; 20751-25358i] / 32767"""
            run_experiment(
                eng, "测角",
                "pRadarSignalProcessing_LFMCW;",
                cfg, overrides, extract_angle, "Angle"
            )
            # Save PPI figure (second figure from angle demo)
            try:
                ppi_path = os.path.join(OUTPUT_DIR, f"{cfg['tag']}_ppi.png")
                eng.eval(f"if length(findall(0,'type','figure')) >= 2; figure(2); print(gcf,'-dpng','-r150','{ppi_path}'); end", nargout=0)
            except:
                pass
    
    finally:
        print("\\nShutting down MATLAB Engine ...")
        eng.quit()
        print("MATLAB Engine closed.")
    
    # ── Save results JSON ──
    results_path = os.path.join(OUTPUT_DIR, "results_mat.json")
    with open(results_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\\nResults saved to {results_path}")
    
    # ── Summary ──
    ok = sum(1 for r in all_results.values() if r.get("status") == "ok")
    fail = sum(1 for r in all_results.values() if r.get("status") == "error")
    print(f"\\n{'='*60}")
    print(f"Done: {ok} OK, {fail} errors, {len(all_results)} total")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'='*60}")
    
    return 0 if fail == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
`;
}

// ─── Tool: radar_mat_process ──────────────────────────────────────────

export const radarMatProcess: IToolHandler = {
  name: 'radar_mat_process',
  description:
    'MATLAB 路线数据处理 — 启动 MATLAB Engine，运行 4 类雷达实验（回环/测距/测速/测角）的 .p 加密算法，' +
    '输出图表到 code_mat/output_mat/ 和 results_mat.json。需要 .venv_mat 已配置。',
  parameters: {
    type: 'object',
    properties: {
      regenerate_script: {
        type: 'boolean',
        description: '是否重新生成 process_mat.py（默认仅在不存在时生成）',
      },
    },
  },
  async handler(args) {
    // Ensure dirs
    await mkdir(OUTPUT_MAT, { recursive: true });

    // Generate Python bridge script if needed
    const regen = Boolean(args?.regenerate_script);
    if (regen || !(await fileExists(PROCESS_SCRIPT))) {
      const script = generateProcessScript();
      await writeFile(PROCESS_SCRIPT, script, 'utf8');
    }

    // Verify prerequisites
    if (!(await fileExists(VENV_PYTHON))) {
      return {
        success: false,
        error: `venv not found: ${VENV_PYTHON}. Run: python3 -m venv ${join(WORK, '.venv_mat')} && cd /Applications/MATLAB_R2025b.app/extern/engines/python && ${VENV_PYTHON} -m pip install .`,
      };
    }
    if (!(await fileExists(DATA_DIR))) {
      return { success: false, error: `Data dir not found: ${DATA_DIR}` };
    }

    // Run the Python-MATLAB bridge
    const { stdout, stderr } = await shell(VENV_PYTHON, [PROCESS_SCRIPT], {
      cwd: CODE_MAT,
      timeout: 600_000, // MATLAB startup + 13 files can take a while
    });

    // Check outputs
    let outputs: string[] = [];
    try {
      outputs = (await readdir(OUTPUT_MAT)).filter(
        (f) => f.endsWith('.png') || f.endsWith('.json'),
      );
    } catch { /* may not exist */ }

    const ok = outputs.length >= 10; // expect 13+ files
    return {
      success: ok,
      outputs,
      output_count: outputs.length,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-1000),
    };
  },
};

// ─── Tool: radar_mat_report ───────────────────────────────────────────

export const radarMatReport: IToolHandler = {
  name: 'radar_mat_report',
  description: 'MATLAB路线报告 — 雷达测距和距离分辨率实验报告.docx',
  parameters: {
    type: 'object',
    properties: {},
  },
  async handler(_args, context) {
    // Verify outputs
    let outputs: string[] = [];
    try {
      outputs = (await readdir(OUTPUT_MAT))
        .filter((f) => f.endsWith('.png') && (f.startsWith('range_') || f === 'resolution_theory.png'))
        .sort();
    } catch {
      return { success: false, error: 'No charts in output_mat/. Run radar_mat_process first.' };
    }
    if (outputs.length < 5) {
      return { success: false, error: `Only ${outputs.length} chart(s). Need at least 5.` };
    }

    // Load results
    let resultsJson = '{}';
    try {
      resultsJson = await readFile(join(OUTPUT_MAT, 'results_mat.json'), 'utf8');
    } catch { /* not critical */ }

    const experimentContext = `# 雷达测距和距离分辨率实验（MATLAB路线）\n设备：24GHz LFMCW雷达(2发4收MIMO)，f0=24.05GHz，ADC 10MHz，512采样，T_eff=51.2us\n原理：R=f_beat*c*T_eff/(2B), ΔR=c/(2B)\n改进算法：汉宁窗降旁瓣+CA-CFAR自适应检测+抛物线插值亚距离单元精度\n6组双目标测距: 100MHz(2.0m/3.0m/4.0m间距)×3 + 150MHz(2.0m/3.0m/5.0m间距)×3\n处理结果:\n${resultsJson}`;

    const sections = [
      { key: 'purpose', heading: '一、实验目的', prompt: '撰写LFMCW雷达测距和距离分辨率实验目的：掌握测距原理、理解距离分辨率、掌握FFT处理、学会改进算法。200字。' },
      { key: 'principle', heading: '二、实验原理', prompt: '描述LFMCW测距原理：线性调频信号模型、差拍信号推导、R=f_beat*c*T/(2B)、ΔR=c/(2B)推导、汉宁窗减少频谱泄露原理、抛物线插值克服FFT栅栏效应、CA-CFAR自适应检测原理。含公式推导。800字。', max_tokens: 5000 },
      { key: 'equipment', heading: '三、实验设备', prompt: '列出24GHz LFMCW雷达系统参数和角反射器。150字。' },
      { key: 'procedure', heading: '四、实验步骤', prompt: '描述：雷达参数配置→bin数据读取重构radar cube→距离维FFT(汉宁窗+4096点零填充+非相参积累)→CA-CFAR检测→抛物线插值→6组数据(100MHz×3+150MHz×3)分别处理对比。300字。' },
      { key: 'analysis', heading: '五、数据分析', prompt: '根据结果分析：(1)各组测距结果与真值对比表(2)100MHz(ΔR=1.5m)vs150MHz(ΔR=1.0m)分辨率(3)加窗vs不加窗(4)CFAR vs固定阈值(5)插值精度提升(6)误差来源。700字。', max_tokens: 5000 },
      { key: 'thinking', heading: '六、思考题', prompt: '回答3题：(1)距离分辨率由带宽B决定，推导ΔR=c/(2B)，算50MHz→3m、100MHz→1.5m、150MHz→1.0m，分析实测差异因素(多径、旁瓣)。(2)汉宁窗针对频谱泄露,不加窗旁瓣高影响多目标分辨;抛物线插值针对FFT栅栏效应,3点拟合获得亚bin精度。(3)CA-CFAR:设保护单元8、参考单元32、阈值因子8dB,滑动窗口估计噪声,自适应阈值比固定阈值在低SNR下更鲁棒。每题300字。', max_tokens: 6000 },
      { key: 'conclusion', heading: '七、结论', prompt: '总结：LFMCW测距原理验证、带宽与分辨率关系验证、改进算法效果。200字。' },
    ];

    const images = outputs.map((fname) => ({
      path: join(OUTPUT_MAT, fname),
      caption: `MATLAB处理结果: ${fname.replace('.png', '').replace(/_/g, ' ')}`,
      width: '14cm',
    }));

    // Call lab_report_generate
    if (context?.callTool) {
      const result = await context.callTool('lab_report_generate', {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_MAT, '实验报告_雷达测距_mat.docx'),
        images,
      });
      return { success: true, report: result };
    }

    return {
      success: true,
      message: 'Report config prepared. Call lab_report_generate manually.',
      lab_report_params: {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_MAT, '实验报告_雷达测距_mat.docx'),
        images,
      },
    };
  },
};

// ─── Tool: radar_mat_run ──────────────────────────────────────────────

export const radarMatRun: IToolHandler = {
  name: 'radar_mat_run',
  description:
    'MATLAB 路线完整流程：数据处理（MATLAB Engine）→ 实验报告生成。',
  parameters: {
    type: 'object',
    properties: {
      skip_report: {
        type: 'boolean',
        description: '跳过报告生成（仅做 MATLAB 数据处理）',
      },
    },
  },
  async handler(args, context) {
    const results: Record<string, unknown> = {};

    // Phase 1: MATLAB processing
    const proc = await radarMatProcess.handler({ regenerate_script: true });
    results.process = proc;
    if (!(proc as { success: boolean }).success) {
      return { success: false, phase: 'process', ...results };
    }

    // Phase 2: Report
    if (!args?.skip_report) {
      const rpt = await radarMatReport.handler({}, context);
      results.report = rpt;
    }

    return { success: true, ...results };
  },
};

// ─── Tool: radar_mat_health ───────────────────────────────────────────

export const radarMatHealth: IToolHandler = {
  name: 'radar_mat_health',
  description: '检查 MATLAB 路线依赖：venv、matlab.engine、MATLAB binary、数据文件、demo 脚本。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const checks: Record<string, unknown> = {};

    // MATLAB binary
    checks.matlab_binary = { exists: await fileExists('/Applications/MATLAB_R2025b.app/bin/matlab') };

    // venv + matlab.engine
    checks.venv_python = { exists: await fileExists(VENV_PYTHON) };
    if (await fileExists(VENV_PYTHON)) {
      try {
        const { stdout, stderr } = await shell(VENV_PYTHON, [
          '-c', 'import matlab.engine; print("ok")',
        ], { timeout: 10_000 });
        checks.matlab_engine = { available: stdout.includes('ok'), stderr: stderr.slice(-200) };
      } catch {
        checks.matlab_engine = { available: false };
      }
    }

    // Data files
    checks.data_dir = { exists: await fileExists(DATA_DIR) };
    if (await fileExists(DATA_DIR)) {
      try {
        const { stdout } = await shell('find', [DATA_DIR, '-name', '*.bin'], { timeout: 5000 });
        checks.bin_files = stdout.trim().split('\n').filter(Boolean).length;
      } catch { /* ignore */ }
    }

    // Demo scripts
    const demos = ['回环测试/pRecycle_Demo.p', '测距/pRange_Demo.p', '测速_CFAR_MTI/pSpeeding_CFAR_MTI_Demo.p', '测角/pRadarSignalProcessing_LFMCW.p'];
    const demoStatus: Record<string, boolean> = {};
    for (const d of demos) {
      demoStatus[d] = await fileExists(join(DEMO_DIR, d));
    }
    checks.demo_scripts = demoStatus;

    // Output
    checks.output_dir = { exists: await fileExists(OUTPUT_MAT) };
    if (await fileExists(OUTPUT_MAT)) {
      try {
        const files = await readdir(OUTPUT_MAT);
        checks.output_files = files;
      } catch { /* ignore */ }
    }

    return checks;
  },
};

// ─── Export ────────────────────────────────────────────────────────────

export const radarRangingMatTools: IToolHandler[] = [
  radarMatProcess,
  radarMatReport,
  radarMatRun,
  radarMatHealth,
];
