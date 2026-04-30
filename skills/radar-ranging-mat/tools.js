// skills/radar-ranging-mat/tools.ts
import { execFile } from "node:child_process";
import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var EXPERIMENT_ROOT = resolve(
  process.env.HOME ?? "~",
  "Polarisor/macbook/Class/\u96F7\u8FBE\u5B9E\u9A8C"
);
var SUBDIR = "\u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387";
var WORK = join(EXPERIMENT_ROOT, SUBDIR);
var DATA_DIR = join(EXPERIMENT_ROOT, "\u7B2C4\u7EC4\u91C7\u96C6\u5B9E\u9A8C\u6570\u636E");
var DEMO_DIR = join(EXPERIMENT_ROOT, "\u5B9E\u9A8C\u6570\u636E\u91C7\u96C6 - \u5B66\u751F");
var CODE_MAT = join(WORK, "code_mat");
var OUTPUT_MAT = join(CODE_MAT, "output_mat");
var REPORT_MAT = join(WORK, "report_mat");
var TEMPLATE = join(EXPERIMENT_ROOT, "\u5B9E\u9A8C\u62A5\u544A\u6A21\u677F.docx");
var VENV_PYTHON = join(WORK, ".venv_mat/bin/python3");
var PROCESS_SCRIPT = join(CODE_MAT, "process_mat.py");
var MATLAB_APP_CANDIDATES = [
  "/Applications/MATLAB_R2026a.app",
  "/Applications/MATLAB_R2025b.app"
];
async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
async function resolveMatlabApp() {
  for (const app of MATLAB_APP_CANDIDATES) {
    if (await fileExists(join(app, "bin/matlab"))) return app;
  }
  return null;
}
async function shell(cmd, args, opts) {
  try {
    return await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 6e5,
      cwd: opts?.cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...opts?.env }
    });
  } catch (err) {
    const e = err;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err) };
  }
}
function generateProcessScript() {
  return `#!/usr/bin/env python3
"""MATLAB Bridge \u2014 Radar Experiment Processing (MATLAB _mat route)

Starts MATLAB Engine, runs all 4 demo experiments via eng.eval(),
saves figures to output_mat/ and results to results_mat.json.
"""

import matlab.engine
import json
import os
import sys
import traceback

# \u2500\u2500\u2500 Paths \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

EXPERIMENT_ROOT = os.path.expanduser("~/Polarisor/macbook/Class/\u96F7\u8FBE\u5B9E\u9A8C")
DATA_DIR = os.path.join(EXPERIMENT_ROOT, "\u7B2C4\u7EC4\u91C7\u96C6\u5B9E\u9A8C\u6570\u636E")
DEMO_DIR = os.path.join(EXPERIMENT_ROOT, "\u5B9E\u9A8C\u6570\u636E\u91C7\u96C6 - \u5B66\u751F")
OUTPUT_DIR = os.path.join(EXPERIMENT_ROOT, "\u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387/code_mat/output_mat")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# \u2500\u2500\u2500 Experiment configs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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


# \u2500\u2500\u2500 Experiment-specific extractors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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


# \u2500\u2500\u2500 Main \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

def main():
    print("=" * 60)
    print("MATLAB Radar Experiment Processing (_mat route)")
    print("=" * 60)
    
    print("\\nStarting MATLAB Engine (this may take ~30s) ...")
    eng = matlab.engine.start_matlab("-nodisplay -nosplash")
    print("MATLAB Engine started OK\\n")
    
    try:
        # \u2500\u2500 1. Recycle (\u56DE\u73AF\u6D4B\u8BD5) \u2500\u2500
        print("=== [1/4] Recycle (\u56DE\u73AF\u6D4B\u8BD5) ===")
        for cfg in RECYCLE_FILES:
            overrides = {
                "tx_sel": 1, "rx_sel": 1, "N_frame": 15,
                "Nfft_Range": "numSamples*8",
                "ignore_dc": "true",
                "f0": cfg.get("f0", 24.05e9),
            }
            # Recycle uses squeeze for single channel
            run_experiment(
                eng, "\u56DE\u73AF\u6D4B\u8BD5", 
                "adc_data = squeeze(adc_data(:,(tx_sel-1)*4+rx_sel,:)); pRecycle_Demo;",
                cfg, overrides, extract_recycle, "Recycle"
            )
        
        # \u2500\u2500 2. Range (\u6D4B\u8DDD) \u2500\u2500
        print("\\n=== [2/4] Range (\u6D4B\u8DDD) ===")
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
                eng, "\u6D4B\u8DDD",
                "pRange_Demo;",
                cfg, overrides, extract_range, "Range"
            )
        
        # \u2500\u2500 3. Speed (\u6D4B\u901F) \u2500\u2500
        print("\\n=== [3/4] Speed (\u6D4B\u901F CFAR MTI) ===")
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
                eng, "\u6D4B\u901F_CFAR_MTI",
                "pSpeeding_CFAR_MTI_Demo;",
                cfg, overrides, extract_speed, "Speed"
            )
        
        # \u2500\u2500 4. Angle (\u6D4B\u89D2) \u2500\u2500
        print("\\n=== [4/4] Angle (\u6D4B\u89D2) ===")
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
                eng, "\u6D4B\u89D2",
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
    
    # \u2500\u2500 Save results JSON \u2500\u2500
    results_path = os.path.join(OUTPUT_DIR, "results_mat.json")
    with open(results_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\\nResults saved to {results_path}")
    
    # \u2500\u2500 Summary \u2500\u2500
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
var radarMatProcess = {
  name: "radar_mat_process",
  description: "MATLAB \u8DEF\u7EBF\u6570\u636E\u5904\u7406 \u2014 \u542F\u52A8 MATLAB Engine\uFF0C\u8FD0\u884C 4 \u7C7B\u96F7\u8FBE\u5B9E\u9A8C\uFF08\u56DE\u73AF/\u6D4B\u8DDD/\u6D4B\u901F/\u6D4B\u89D2\uFF09\u7684 .p \u52A0\u5BC6\u7B97\u6CD5\uFF0C\u8F93\u51FA\u56FE\u8868\u5230 code_mat/output_mat/ \u548C results_mat.json\u3002\u9700\u8981 .venv_mat \u5DF2\u914D\u7F6E\u3002",
  parameters: {
    type: "object",
    properties: {
      regenerate_script: {
        type: "boolean",
        description: "\u662F\u5426\u91CD\u65B0\u751F\u6210 process_mat.py\uFF08\u9ED8\u8BA4\u4EC5\u5728\u4E0D\u5B58\u5728\u65F6\u751F\u6210\uFF09"
      }
    }
  },
  async handler(args) {
    await mkdir(OUTPUT_MAT, { recursive: true });
    const regen = Boolean(args?.regenerate_script);
    if (regen || !await fileExists(PROCESS_SCRIPT)) {
      const script = generateProcessScript();
      await writeFile(PROCESS_SCRIPT, script, "utf8");
    }
    if (!await fileExists(VENV_PYTHON)) {
      const matlabApp = await resolveMatlabApp();
      const engineDir = matlabApp ? join(matlabApp, "extern/engines/python") : "/Applications/MATLAB_R2026a.app/extern/engines/python";
      return {
        success: false,
        error: `venv not found: ${VENV_PYTHON}. Run: python3 -m venv ${join(WORK, ".venv_mat")} && cd ${engineDir} && ${VENV_PYTHON} -m pip install .`
      };
    }
    if (!await fileExists(DATA_DIR)) {
      return { success: false, error: `Data dir not found: ${DATA_DIR}` };
    }
    const { stdout, stderr } = await shell(VENV_PYTHON, [PROCESS_SCRIPT], {
      cwd: CODE_MAT,
      timeout: 6e5
      // MATLAB startup + 13 files can take a while
    });
    let outputs = [];
    try {
      outputs = (await readdir(OUTPUT_MAT)).filter(
        (f) => f.endsWith(".png") || f.endsWith(".json")
      );
    } catch {
    }
    const ok = outputs.length >= 10;
    return {
      success: ok,
      outputs,
      output_count: outputs.length,
      stdout: stdout.slice(-2e3),
      stderr: stderr.slice(-1e3)
    };
  }
};
var radarMatReport = {
  name: "radar_mat_report",
  description: "MATLAB\u8DEF\u7EBF\u62A5\u544A \u2014 \u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387\u5B9E\u9A8C\u62A5\u544A.docx",
  parameters: {
    type: "object",
    properties: {}
  },
  async handler(_args, context) {
    let outputs = [];
    try {
      outputs = (await readdir(OUTPUT_MAT)).filter((f) => f.endsWith(".png") && (f.startsWith("range_") || f === "resolution_theory.png")).sort();
    } catch {
      return { success: false, error: "No charts in output_mat/. Run radar_mat_process first." };
    }
    if (outputs.length < 5) {
      return { success: false, error: `Only ${outputs.length} chart(s). Need at least 5.` };
    }
    let resultsJson = "{}";
    try {
      resultsJson = await readFile(join(OUTPUT_MAT, "results_mat.json"), "utf8");
    } catch {
    }
    const experimentContext = `# \u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387\u5B9E\u9A8C\uFF08MATLAB\u8DEF\u7EBF\uFF09
\u8BBE\u5907\uFF1A24GHz LFMCW\u96F7\u8FBE(2\u53D14\u6536MIMO)\uFF0Cf0=24.05GHz\uFF0CADC 10MHz\uFF0C512\u91C7\u6837\uFF0CT_eff=51.2us
\u539F\u7406\uFF1AR=f_beat*c*T_eff/(2B), \u0394R=c/(2B)
\u6539\u8FDB\u7B97\u6CD5\uFF1A\u6C49\u5B81\u7A97\u964D\u65C1\u74E3+CA-CFAR\u81EA\u9002\u5E94\u68C0\u6D4B+\u629B\u7269\u7EBF\u63D2\u503C\u4E9A\u8DDD\u79BB\u5355\u5143\u7CBE\u5EA6
6\u7EC4\u53CC\u76EE\u6807\u6D4B\u8DDD: 100MHz(2.0m/3.0m/4.0m\u95F4\u8DDD)\xD73 + 150MHz(2.0m/3.0m/5.0m\u95F4\u8DDD)\xD73
\u5904\u7406\u7ED3\u679C:
${resultsJson}`;
    const sections = [
      { key: "purpose", heading: "\u4E00\u3001\u5B9E\u9A8C\u76EE\u7684", prompt: "\u64B0\u5199LFMCW\u96F7\u8FBE\u6D4B\u8DDD\u548C\u8DDD\u79BB\u5206\u8FA8\u7387\u5B9E\u9A8C\u76EE\u7684\uFF1A\u638C\u63E1\u6D4B\u8DDD\u539F\u7406\u3001\u7406\u89E3\u8DDD\u79BB\u5206\u8FA8\u7387\u3001\u638C\u63E1FFT\u5904\u7406\u3001\u5B66\u4F1A\u6539\u8FDB\u7B97\u6CD5\u3002200\u5B57\u3002" },
      { key: "principle", heading: "\u4E8C\u3001\u5B9E\u9A8C\u539F\u7406", prompt: "\u63CF\u8FF0LFMCW\u6D4B\u8DDD\u539F\u7406\uFF1A\u7EBF\u6027\u8C03\u9891\u4FE1\u53F7\u6A21\u578B\u3001\u5DEE\u62CD\u4FE1\u53F7\u63A8\u5BFC\u3001R=f_beat*c*T/(2B)\u3001\u0394R=c/(2B)\u63A8\u5BFC\u3001\u6C49\u5B81\u7A97\u51CF\u5C11\u9891\u8C31\u6CC4\u9732\u539F\u7406\u3001\u629B\u7269\u7EBF\u63D2\u503C\u514B\u670DFFT\u6805\u680F\u6548\u5E94\u3001CA-CFAR\u81EA\u9002\u5E94\u68C0\u6D4B\u539F\u7406\u3002\u542B\u516C\u5F0F\u63A8\u5BFC\u3002800\u5B57\u3002", max_tokens: 5e3 },
      { key: "equipment", heading: "\u4E09\u3001\u5B9E\u9A8C\u8BBE\u5907", prompt: "\u5217\u51FA24GHz LFMCW\u96F7\u8FBE\u7CFB\u7EDF\u53C2\u6570\u548C\u89D2\u53CD\u5C04\u5668\u3002150\u5B57\u3002" },
      { key: "procedure", heading: "\u56DB\u3001\u5B9E\u9A8C\u6B65\u9AA4", prompt: "\u63CF\u8FF0\uFF1A\u96F7\u8FBE\u53C2\u6570\u914D\u7F6E\u2192bin\u6570\u636E\u8BFB\u53D6\u91CD\u6784radar cube\u2192\u8DDD\u79BB\u7EF4FFT(\u6C49\u5B81\u7A97+4096\u70B9\u96F6\u586B\u5145+\u975E\u76F8\u53C2\u79EF\u7D2F)\u2192CA-CFAR\u68C0\u6D4B\u2192\u629B\u7269\u7EBF\u63D2\u503C\u21926\u7EC4\u6570\u636E(100MHz\xD73+150MHz\xD73)\u5206\u522B\u5904\u7406\u5BF9\u6BD4\u3002300\u5B57\u3002" },
      { key: "analysis", heading: "\u4E94\u3001\u6570\u636E\u5206\u6790", prompt: "\u6839\u636E\u7ED3\u679C\u5206\u6790\uFF1A(1)\u5404\u7EC4\u6D4B\u8DDD\u7ED3\u679C\u4E0E\u771F\u503C\u5BF9\u6BD4\u8868(2)100MHz(\u0394R=1.5m)vs150MHz(\u0394R=1.0m)\u5206\u8FA8\u7387(3)\u52A0\u7A97vs\u4E0D\u52A0\u7A97(4)CFAR vs\u56FA\u5B9A\u9608\u503C(5)\u63D2\u503C\u7CBE\u5EA6\u63D0\u5347(6)\u8BEF\u5DEE\u6765\u6E90\u3002700\u5B57\u3002", max_tokens: 5e3 },
      { key: "thinking", heading: "\u516D\u3001\u601D\u8003\u9898", prompt: "\u56DE\u7B543\u9898\uFF1A(1)\u8DDD\u79BB\u5206\u8FA8\u7387\u7531\u5E26\u5BBDB\u51B3\u5B9A\uFF0C\u63A8\u5BFC\u0394R=c/(2B)\uFF0C\u7B9750MHz\u21923m\u3001100MHz\u21921.5m\u3001150MHz\u21921.0m\uFF0C\u5206\u6790\u5B9E\u6D4B\u5DEE\u5F02\u56E0\u7D20(\u591A\u5F84\u3001\u65C1\u74E3)\u3002(2)\u6C49\u5B81\u7A97\u9488\u5BF9\u9891\u8C31\u6CC4\u9732,\u4E0D\u52A0\u7A97\u65C1\u74E3\u9AD8\u5F71\u54CD\u591A\u76EE\u6807\u5206\u8FA8;\u629B\u7269\u7EBF\u63D2\u503C\u9488\u5BF9FFT\u6805\u680F\u6548\u5E94,3\u70B9\u62DF\u5408\u83B7\u5F97\u4E9Abin\u7CBE\u5EA6\u3002(3)CA-CFAR:\u8BBE\u4FDD\u62A4\u5355\u51438\u3001\u53C2\u8003\u5355\u514332\u3001\u9608\u503C\u56E0\u5B508dB,\u6ED1\u52A8\u7A97\u53E3\u4F30\u8BA1\u566A\u58F0,\u81EA\u9002\u5E94\u9608\u503C\u6BD4\u56FA\u5B9A\u9608\u503C\u5728\u4F4ESNR\u4E0B\u66F4\u9C81\u68D2\u3002\u6BCF\u9898300\u5B57\u3002", max_tokens: 6e3 },
      { key: "conclusion", heading: "\u4E03\u3001\u7ED3\u8BBA", prompt: "\u603B\u7ED3\uFF1ALFMCW\u6D4B\u8DDD\u539F\u7406\u9A8C\u8BC1\u3001\u5E26\u5BBD\u4E0E\u5206\u8FA8\u7387\u5173\u7CFB\u9A8C\u8BC1\u3001\u6539\u8FDB\u7B97\u6CD5\u6548\u679C\u3002200\u5B57\u3002" }
    ];
    const images = outputs.map((fname) => ({
      path: join(OUTPUT_MAT, fname),
      caption: `MATLAB\u5904\u7406\u7ED3\u679C: ${fname.replace(".png", "").replace(/_/g, " ")}`,
      width: "14cm"
    }));
    if (context?.callTool) {
      const result = await context.callTool("lab_report_generate", {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_MAT, "\u5B9E\u9A8C\u62A5\u544A_\u96F7\u8FBE\u6D4B\u8DDD_mat.docx"),
        images
      });
      return { success: true, report: result };
    }
    return {
      success: true,
      message: "Report config prepared. Call lab_report_generate manually.",
      lab_report_params: {
        experiment_context: experimentContext,
        sections,
        template_path: TEMPLATE,
        output_path: join(REPORT_MAT, "\u5B9E\u9A8C\u62A5\u544A_\u96F7\u8FBE\u6D4B\u8DDD_mat.docx"),
        images
      }
    };
  }
};
var radarMatRun = {
  name: "radar_mat_run",
  description: "MATLAB \u8DEF\u7EBF\u5B8C\u6574\u6D41\u7A0B\uFF1A\u6570\u636E\u5904\u7406\uFF08MATLAB Engine\uFF09\u2192 \u5B9E\u9A8C\u62A5\u544A\u751F\u6210\u3002",
  parameters: {
    type: "object",
    properties: {
      skip_report: {
        type: "boolean",
        description: "\u8DF3\u8FC7\u62A5\u544A\u751F\u6210\uFF08\u4EC5\u505A MATLAB \u6570\u636E\u5904\u7406\uFF09"
      }
    }
  },
  async handler(args, context) {
    const results = {};
    const proc = await radarMatProcess.handler({ regenerate_script: true });
    results.process = proc;
    if (!proc.success) {
      return { success: false, phase: "process", ...results };
    }
    if (!args?.skip_report) {
      const rpt = await radarMatReport.handler({}, context);
      results.report = rpt;
    }
    return { success: true, ...results };
  }
};
var radarMatHealth = {
  name: "radar_mat_health",
  description: "\u68C0\u67E5 MATLAB \u8DEF\u7EBF\u4F9D\u8D56\uFF1Avenv\u3001matlab.engine\u3001MATLAB binary\u3001\u6570\u636E\u6587\u4EF6\u3001demo \u811A\u672C\u3002",
  parameters: { type: "object", properties: {} },
  async handler() {
    const checks = {};
    const matlabApp = await resolveMatlabApp();
    checks.matlab_binary = {
      exists: Boolean(matlabApp),
      app: matlabApp,
      binary: matlabApp ? join(matlabApp, "bin/matlab") : null
    };
    checks.venv_python = { exists: await fileExists(VENV_PYTHON) };
    if (await fileExists(VENV_PYTHON)) {
      try {
        const { stdout, stderr } = await shell(VENV_PYTHON, [
          "-c",
          'import matlab.engine; print("ok")'
        ], { timeout: 1e4 });
        checks.matlab_engine = { available: stdout.includes("ok"), stderr: stderr.slice(-200) };
      } catch {
        checks.matlab_engine = { available: false };
      }
    }
    checks.data_dir = { exists: await fileExists(DATA_DIR) };
    if (await fileExists(DATA_DIR)) {
      try {
        const { stdout } = await shell("find", [DATA_DIR, "-name", "*.bin"], { timeout: 5e3 });
        checks.bin_files = stdout.trim().split("\n").filter(Boolean).length;
      } catch {
      }
    }
    const demos = ["\u56DE\u73AF\u6D4B\u8BD5/pRecycle_Demo.p", "\u6D4B\u8DDD/pRange_Demo.p", "\u6D4B\u901F_CFAR_MTI/pSpeeding_CFAR_MTI_Demo.p", "\u6D4B\u89D2/pRadarSignalProcessing_LFMCW.p"];
    const demoStatus = {};
    for (const d of demos) {
      demoStatus[d] = await fileExists(join(DEMO_DIR, d));
    }
    checks.demo_scripts = demoStatus;
    checks.output_dir = { exists: await fileExists(OUTPUT_MAT) };
    if (await fileExists(OUTPUT_MAT)) {
      try {
        const files = await readdir(OUTPUT_MAT);
        checks.output_files = files;
      } catch {
      }
    }
    return checks;
  }
};
var radarRangingMatTools = [
  radarMatProcess,
  radarMatReport,
  radarMatRun,
  radarMatHealth
];
export {
  radarMatHealth,
  radarMatProcess,
  radarMatReport,
  radarMatRun,
  radarRangingMatTools
};
