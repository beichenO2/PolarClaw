/**
 * PolarUI LG run 摘要 — PolarClaw React Dashboard 消费
 * 读 run-trace-bridge :3922（dev proxy /api/runs）或静态 ecosystem-status.json
 */

export interface LGRunSummary {
  run_id?: string
  workflow_id?: string
  status?: string
  steps?: number
  started_at?: string
}

export interface EcosystemStatus {
  updated_at?: string
  services?: Array<{ name: string; status: string; online?: boolean }>
  last_lg_run?: LGRunSummary
}

export async function fetchLatestLGRun(): Promise<LGRunSummary | null> {
  try {
    const res = await fetch('/api/runs/latest')
    if (!res.ok) return null
    return await res.json() as LGRunSummary
  } catch {
    return null
  }
}

export async function fetchEcosystemStatus(): Promise<EcosystemStatus | null> {
  try {
    const res = await fetch('/data/ecosystem-status.json')
    if (!res.ok) return null
    return await res.json() as EcosystemStatus
  } catch {
    return null
  }
}
