import { useState, useEffect, useRef, useCallback } from 'react'

const BACKEND = 'http://localhost:8000'
const POLL_INTERVAL = 2000  // ms between status polls

// ─── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#0f1117',
  surface: '#1a1d27',
  border: '#2a2d3a',
  borderLight: '#3a3d4a',
  accent: '#6366f1',
  accentHover: '#818cf8',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  muted: '#64748b',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textFaint: '#475569',
}

const STATUS_COLOR = {
  processing: C.warning,
  queued: C.muted,
  done: C.success,
  done_with_issues: C.warning,
  done_echo_fallback: C.warning,
  failed: C.danger,
  blocked: C.danger,
  need_human: C.warning,
}

const JUDGMENT_COLOR = {
  PASS: C.success,
  FAIL: C.danger,
  BLOCKED: C.warning,
  NEED_HUMAN: C.warning,
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const panel = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
}

const label = {
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: C.muted,
  marginBottom: '0.4rem',
}

const badge = (color) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 99,
  fontSize: '0.72rem',
  fontWeight: 600,
  background: color + '22',
  color: color,
  border: `1px solid ${color}44`,
})

// ─── Sub-components ────────────────────────────────────────────────────────────

function HealthDot({ status }) {
  const color = status === 'ok' ? C.success : status === 'checking' ? C.muted : C.danger
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: C.textDim }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: color,
        boxShadow: status === 'ok' ? `0 0 6px ${color}88` : 'none',
      }} />
      backend {status}
    </span>
  )
}

function Section({ title, children, extra }) {
  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={label}>{title}</div>
        {extra}
      </div>
      {children}
    </div>
  )
}

function KeyVal({ k, v, mono }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
      <span style={{ color: C.textFaint, fontSize: '0.8rem', minWidth: 110 }}>{k}</span>
      <span style={{ color: C.text, fontSize: '0.8rem', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{v ?? '—'}</span>
    </div>
  )
}

function ProviderBadge({ info }) {
  if (!info) return null
  const isEcho = info.provider === 'echo'
  const isMinimax = info.provider === 'minimax'
  const color = isEcho ? C.warning : isMinimax ? '#8b5cf6' : C.accent
  const label = info.model || info.provider
  return (
    <span style={badge(color)} title={info.endpoint || ''}>
      {label}{isEcho ? ' (echo)' : ''}
    </span>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  // system
  const [health, setHealth] = useState('checking')
  const [providerInfo, setProviderInfo] = useState(null)

  // task submission
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState('auto')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // active task
  const [activeTask, setActiveTask] = useState(null)   // { task_id, session_id, status, mode, goal }
  const [taskResult, setTaskResult] = useState(null)   // full result object
  const [polling, setPolling] = useState(false)
  const pollRef = useRef(null)

  // task history (recent)
  const [recentTasks, setRecentTasks] = useState([])

  // ── Health check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      fetch(`${BACKEND}/health`)
        .then(r => r.json())
        .then(d => setHealth(d.status === 'ok' ? 'ok' : 'failed'))
        .catch(() => setHealth('failed'))
    }
    check()
    const id = setInterval(check, 8000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetch(`${BACKEND}/api/system/provider`)
      .then(r => r.json())
      .then(setProviderInfo)
      .catch(() => {})
  }, [])

  const [allProviders, setAllProviders] = useState(null)
  useEffect(() => {
    fetch(`${BACKEND}/api/system/providers`)
      .then(r => r.json())
      .then(setAllProviders)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`${BACKEND}/api/tasks`)
      .then(r => r.json())
      .then(d => setRecentTasks(d.tasks || []))
      .catch(() => {})
  }, [activeTask])

  // ── Polling ─────────────────────────────────────────────────────────────────
  const startPolling = useCallback((task_id) => {
    setPolling(true)
    setTaskResult(null)

    const poll = async () => {
      try {
        // Update status
        const statusRes = await fetch(`${BACKEND}/api/tasks/${task_id}`)
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setActiveTask(prev => prev ? { ...prev, ...statusData } : statusData)

          const done = ['done', 'done_with_issues', 'done_echo_fallback', 'failed', 'blocked', 'need_human']
          if (done.includes(statusData.status)) {
            // Fetch result
            const resultRes = await fetch(`${BACKEND}/api/tasks/${task_id}/result`)
            if (resultRes.ok) {
              const resultData = await resultRes.json()
              setTaskResult(resultData)
            }
            setPolling(false)
            clearInterval(pollRef.current)
            return
          }
        }
      } catch (e) {
        // ignore transient errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)
  }, [])

  useEffect(() => () => clearInterval(pollRef.current), [])

  // ── Submit task ─────────────────────────────────────────────────────────────
  const submitTask = async () => {
    if (!goal.trim() || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    setActiveTask(null)
    setTaskResult(null)
    clearInterval(pollRef.current)

    try {
      const body = { goal: goal.trim(), mode: mode === 'auto' ? null : mode }
      const res = await fetch(`${BACKEND}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data?.detail?.message || data?.message || `HTTP ${res.status}`)
      } else {
        setActiveTask(data)
        startPolling(data.task_id)
        setGoal('')
      }
    } catch (e) {
      setSubmitError('Network error: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTask() }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: C.bg,
      minHeight: '100vh',
      color: C.text,
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '0.9rem',
    }}>

      {/* Top bar */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: '0.6rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em', color: C.accent }}>CLAW</span>
          <span style={{ color: C.textFaint, fontSize: '0.75rem' }}>Contextual Layered Agent Workbench</span>
          <span style={{ color: C.textFaint, fontSize: '0.7rem' }}>v0.1 router</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {allProviders && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {/* Provider availability dots */}
              {[
                ['CP', 'coding_plan',    '#6366f1'],
                ['MM', 'minimax',        '#8b5cf6'],
                ['QW', 'qwen_dashscope', '#0ea5e9'],
              ].map(([abbr, key, color]) => {
                const p = allProviders[key]
                const ok = p?.available
                const model = ok ? p.model : 'unavailable'
                return (
                  <span key={key} title={`${key}: ${model}`} style={{
                    fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px',
                    borderRadius: 4, background: ok ? color + '22' : '#33333388',
                    color: ok ? color : '#666', border: `1px solid ${ok ? color + '44' : '#333'}`,
                  }}>{abbr}</span>
                )
              })}
              {/* Active model per task type */}
              {allProviders.task_assignments && (
                <span style={{ color: '#555', fontSize: '0.6rem', marginLeft: 4 }}>|</span>
              )}
              {allProviders.task_assignments && [
                ['code', 'coding'],
                ['route', 'router'],
                ['dbg', 'debug'],
              ].map(([abbr, tt]) => {
                const m = allProviders.task_assignments[tt]
                if (!m) return null
                const short = m.replace('qwen3-', 'q3-').replace('MiniMax-', 'MM-').replace('qwen-plus', 'qw+').replace('kimi-k2.5', 'kimi')
                return (
                  <span key={tt} title={`${tt}: ${m}`} style={{
                    fontSize: '0.58rem', padding: '1px 4px', borderRadius: 3,
                    background: '#1a1a1a', color: '#aaa', border: '1px solid #333',
                  }}>{abbr}:{short}</span>
                )
              })}
            </div>
          )}
          <ProviderBadge info={providerInfo} />
          <HealthDot status={health} />
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 0, minHeight: 'calc(100vh - 46px)' }}>

        {/* Left column */}
        <div style={{
          padding: '1.25rem',
          borderRight: `1px solid ${C.border}`,
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 46px)',
        }}>

          {/* Task Submit */}
          <Section title="Submit Task">
            <div style={{ marginBottom: '0.6rem' }}>
              <div style={{ ...label, marginBottom: '0.3rem' }}>Mode</div>
              <select
                value={mode}
                onChange={e => setMode(e.target.value)}
                style={{
                  width: '100%',
                  background: C.bg,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.85rem',
                  marginBottom: '0.6rem',
                  cursor: 'pointer',
                }}
              >
                <option value="auto">Auto Detect</option>
                <option value="knowledge_mode">Knowledge Mode</option>
                <option value="project_mode">Project Mode</option>
              </select>
            </div>

            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your task… (Enter to submit)"
              rows={4}
              disabled={submitting}
              style={{
                width: '100%',
                background: C.bg,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: '0.6rem 0.75rem',
                fontSize: '0.88rem',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '0.6rem',
                fontFamily: 'inherit',
              }}
            />

            <button
              onClick={submitTask}
              disabled={submitting || !goal.trim()}
              style={{
                width: '100%',
                padding: '0.55rem',
                background: submitting || !goal.trim() ? C.border : C.accent,
                color: submitting || !goal.trim() ? C.muted : '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: submitting || !goal.trim() ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '0.88rem',
                transition: 'background 0.15s',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit Task →'}
            </button>

            {submitError && (
              <div style={{ marginTop: '0.5rem', color: C.danger, fontSize: '0.8rem' }}>
                {submitError}
              </div>
            )}
          </Section>

          {/* Recent Tasks */}
          <Section title={`Recent Tasks (${recentTasks.length})`}>
            {recentTasks.length === 0 ? (
              <div style={{ color: C.textFaint, fontSize: '0.8rem' }}>No tasks yet</div>
            ) : (
              recentTasks.slice(0, 8).map(t => (
                <div
                  key={t.task_id}
                  onClick={() => {
                    setActiveTask(t)
                    setTaskResult(null)
                    if (!['done', 'done_with_issues', 'done_echo_fallback', 'failed'].includes(t.status)) {
                      startPolling(t.task_id)
                    } else {
                      fetch(`${BACKEND}/api/tasks/${t.task_id}/result`)
                        .then(r => r.json())
                        .then(d => d.status !== 'processing' && d.status !== 'queued' ? setTaskResult(d) : null)
                        .catch(() => {})
                    }
                  }}
                  style={{
                    padding: '0.5rem 0.6rem',
                    borderRadius: 6,
                    marginBottom: 4,
                    cursor: 'pointer',
                    background: activeTask?.task_id === t.task_id ? C.border : 'transparent',
                    border: `1px solid ${activeTask?.task_id === t.task_id ? C.borderLight : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: C.text, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                      {t.goal || t.task_id.slice(0, 12)}
                    </span>
                    <span style={badge(STATUS_COLOR[t.status] || C.muted)}>{t.status}</span>
                  </div>
                </div>
              ))
            )}
          </Section>

        </div>

        {/* Right column */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', maxHeight: 'calc(100vh - 46px)' }}>

          {!activeTask ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '60vh', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ fontSize: '2.5rem', opacity: 0.15 }}>⬡</div>
              <div style={{ color: C.textFaint, fontSize: '0.9rem' }}>Submit a task to start</div>
            </div>
          ) : (
            <>
              {/* Run Status */}
              <Section
                title="Run Status"
                extra={
                  polling ? (
                    <span style={{ color: C.warning, fontSize: '0.72rem', animation: 'pulse 1s infinite' }}>
                      ● polling
                    </span>
                  ) : null
                }
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                  <KeyVal k="Task ID" v={activeTask.task_id?.slice(0, 16) + '…'} mono />
                  <KeyVal k="Session" v={activeTask.session_id} mono />
                  <KeyVal k="Mode" v={activeTask.mode} />
                  <KeyVal k="Status" v={
                    <span style={badge(STATUS_COLOR[activeTask.status] || C.muted)}>
                      {activeTask.status}
                    </span>
                  } />
                </div>
                {activeTask.goal && (
                  <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: C.bg, borderRadius: 6, fontSize: '0.85rem', color: C.text }}>
                    {activeTask.goal}
                  </div>
                )}
                {activeTask.error && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: C.danger + '11', border: `1px solid ${C.danger}44`, borderRadius: 6, color: C.danger, fontSize: '0.8rem' }}>
                    {activeTask.error}
                  </div>
                )}
              </Section>

              {/* Router Summary */}
              {taskResult?.router_decision && (
                <Section title="Router Summary">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: '0.75rem' }}>
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                      <div style={{ ...label, marginBottom: '0.3rem' }}>WorkItems</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: C.accent }}>{taskResult.work_items?.length ?? 0}</div>
                    </div>
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                      <div style={{ ...label, marginBottom: '0.3rem' }}>RouteGroups</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: C.accent }}>{taskResult.route_groups?.length ?? 0}</div>
                    </div>
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                      <div style={{ ...label, marginBottom: '0.3rem' }}>Dispatch Ready</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: taskResult.router_decision.dispatch_ready ? C.success : C.warning }}>
                        {taskResult.router_decision.dispatch_ready ? '✓ Yes' : '⚠ No'}
                      </div>
                    </div>
                  </div>
                  {taskResult.router_decision.warnings?.length > 0 && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ ...label, color: C.warning }}>Warnings</div>
                      {taskResult.router_decision.warnings.map((w, i) => (
                        <div key={i} style={{ color: C.warning, fontSize: '0.75rem', marginBottom: 2 }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                  {taskResult.router_decision.required_confirmations?.length > 0 && (
                    <div>
                      <div style={{ ...label, color: C.danger }}>Required Confirmations</div>
                      {taskResult.router_decision.required_confirmations.map((c, i) => (
                        <div key={i} style={{ color: C.danger, fontSize: '0.75rem', marginBottom: 2 }}>✗ {c}</div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* WorkItems */}
              {taskResult?.work_items?.length > 0 && (
                <Section title={`WorkItems (${taskResult.work_items.length})`}>
                  {taskResult.work_items.map((wi, i) => (
                    <div key={wi.work_item_id} style={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: '0.6rem 0.75rem',
                      marginBottom: 6,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: C.textDim, fontSize: '0.72rem', fontFamily: 'monospace' }}>
                          WI-{i + 1} · {wi.work_item_id?.slice(0, 8)}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={badge(C.accent)}>{wi.recommended_mode?.replace('_mode', '')}</span>
                          <span style={badge(wi.priority === 'high' ? C.danger : wi.priority === 'medium' ? C.warning : C.muted)}>{wi.priority}</span>
                          <span style={badge(STATUS_COLOR[wi.status] || C.muted)}>{wi.status}</span>
                          {wi.isolation_required && <span style={badge(C.warning)}>isolated</span>}
                        </div>
                      </div>
                      <div style={{ color: C.text, fontSize: '0.82rem', marginBottom: 4 }}>
                        <strong>{wi.title}</strong>
                      </div>
                      {wi.goal !== wi.title && (
                        <div style={{ color: C.textDim, fontSize: '0.78rem', fontStyle: 'italic' }}>{wi.goal}</div>
                      )}
                    </div>
                  ))}
                </Section>
              )}

              {/* RouteGroups */}
              {taskResult?.route_groups?.length > 0 && (
                <Section title={`RouteGroups (${taskResult.route_groups.length})`}>
                  {taskResult.route_groups.map((rg, i) => (
                    <div key={rg.route_group_id} style={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: '0.6rem 0.75rem',
                      marginBottom: 6,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: C.textDim, fontSize: '0.72rem', fontFamily: 'monospace' }}>
                          RG-{i + 1} · {rg.route_group_id?.slice(0, 8)}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={badge(C.accent)}>{rg.mode?.replace('_mode', '')}</span>
                          <span style={badge(STATUS_COLOR[rg.status] || C.muted)}>{rg.status}</span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        <KeyVal k="Bot" v={rg.bot_name || '—'} />
                        <KeyVal k="FSM" v={rg.fsm_name || 'TBD'} />
                        <KeyVal k="WorkItems" v={rg.work_item_ids?.length} />
                        <KeyVal k="Priority" v={rg.priority} />
                      </div>
                      {/* Per-RG run_ids from RouteGroupRuntime */}
                      {(() => {
                        const rt = taskResult?.route_group_runtimes?.[rg.route_group_id]
                        const runIds = rt?.run_ids || []
                        if (!runIds.length) return null
                        return (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ ...label, marginBottom: 2 }}>Run IDs ({runIds.length})</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {runIds.map(rid => (
                                <span key={rid} style={{ ...badge('#0ea5e9'), fontFamily: 'monospace', fontSize: '0.65rem' }}>
                                  {rid.slice(0, 8)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      {rg.blocking_reason && (
                        <div style={{ marginTop: 4, color: C.danger, fontSize: '0.75rem' }}>⛔ {rg.blocking_reason}</div>
                      )}
                      {rg.work_item_ids?.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ ...label, marginBottom: 2 }}>WorkItem IDs</div>
                          {rg.work_item_ids.map(wid => (
                            <span key={wid} style={{ ...badge(C.muted), marginRight: 4, fontFamily: 'monospace', fontSize: '0.68rem' }}>
                              {wid.slice(0, 8)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}

              {/* Result */}
              {taskResult?.agent_result && (
                <Section title="Agent Result">
                  {taskResult.agent_result.model_gateway_note && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.4rem 0.75rem', background: C.warning + '11', border: `1px solid ${C.warning}44`, borderRadius: 6, color: C.warning, fontSize: '0.75rem' }}>
                      ⚠ {taskResult.agent_result.model_gateway_note}
                    </div>
                  )}
                  <div style={{
                    background: C.bg,
                    borderRadius: 8,
                    padding: '0.85rem 1rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 400,
                    overflowY: 'auto',
                    color: C.text,
                    border: `1px solid ${C.border}`,
                  }}>
                    {taskResult.agent_result.model_response || '(no response)'}
                  </div>

                  {/* Fact status */}
                  {taskResult.agent_result.fact_status && (
                    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        ['Confirmed Facts', taskResult.agent_result.fact_status.confirmed_facts, C.success],
                        ['Inferred', taskResult.agent_result.fact_status.inferred_hypotheses, C.warning],
                        ['Unknowns / TBD', taskResult.agent_result.fact_status.unknowns, C.muted],
                      ].map(([title, items, color]) => (
                        <div key={title} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.6rem 0.75rem' }}>
                          <div style={{ ...label, color, marginBottom: '0.4rem' }}>{title}</div>
                          {(items || []).length === 0
                            ? <div style={{ color: C.textFaint, fontSize: '0.75rem' }}>none</div>
                            : (items || []).map((item, i) => (
                              <div key={i} style={{ color: C.textDim, fontSize: '0.75rem', marginBottom: 2 }}>· {item}</div>
                            ))
                          }
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Validation */}
              {taskResult?.validation_report && (
                <Section title="Validation Report">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem' }}>
                    <span style={{
                      ...badge(JUDGMENT_COLOR[taskResult.validation_report.judgment] || C.muted),
                      fontSize: '0.85rem',
                      padding: '4px 12px',
                    }}>
                      {taskResult.validation_report.judgment}
                    </span>
                    <span style={{ color: C.textDim, fontSize: '0.8rem' }}>
                      {taskResult.validation_report.summary}
                    </span>
                  </div>

                  {/* Criteria */}
                  {taskResult.validation_report.criteria_results?.map(cr => (
                    <div key={cr.criterion_id} style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      padding: '0.35rem 0.5rem',
                      borderRadius: 4,
                      marginBottom: 2,
                      background: cr.result === 'PASS' ? C.success + '08' : cr.result === 'FAIL' ? C.danger + '08' : C.bg,
                    }}>
                      <span style={{
                        minWidth: 40,
                        fontSize: '0.7rem', fontWeight: 700,
                        color: cr.result === 'PASS' ? C.success : cr.result === 'FAIL' ? C.danger : C.muted,
                      }}>{cr.result}</span>
                      <span style={{ color: C.textDim, fontSize: '0.78rem' }}>{cr.criterion_description}</span>
                    </div>
                  ))}

                  {/* Violations */}
                  {taskResult.validation_report.violations?.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ ...label, color: C.danger }}>Violations</div>
                      {taskResult.validation_report.violations.map((v, i) => (
                        <div key={i} style={{ color: C.danger, fontSize: '0.78rem', marginBottom: 4 }}>
                          ✗ [{v.violation_type}] {v.description}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Router Validation sub-report */}
                  {taskResult.validation_report.router_validation && (
                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <div style={{ ...label, marginBottom: '0.4rem' }}>Router Validation</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={badge(JUDGMENT_COLOR[taskResult.validation_report.router_validation.judgment] || C.muted)}>
                          {taskResult.validation_report.router_validation.judgment}
                        </span>
                        <span style={{ color: C.textDim, fontSize: '0.75rem' }}>
                          WorkItems: {taskResult.validation_report.router_validation.work_items_valid ? '✓' : '✗'} ·
                          RouteGroups: {taskResult.validation_report.router_validation.route_groups_valid ? '✓' : '✗'} ·
                          Traceable: {taskResult.validation_report.router_validation.decision_traceable ? '✓' : '✗'}
                        </span>
                      </div>
                      {taskResult.validation_report.router_validation.violations?.map((v, i) => (
                        <div key={i} style={{ color: C.danger, fontSize: '0.73rem' }}>✗ {v}</div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Evidence Pack */}
              {taskResult?.evidence_pack && (
                <Section title="Evidence Pack">
                  <KeyVal k="Pack ID" v={taskResult.evidence_pack.evidence_pack_id?.slice(0, 16) + '…'} mono />
                  <KeyVal k="Items" v={taskResult.evidence_pack.evidence_items?.length} />
                  <KeyVal k="Complete" v={
                    <span style={{ color: taskResult.evidence_pack.completeness_check?.is_complete ? C.success : C.danger }}>
                      {taskResult.evidence_pack.completeness_check?.is_complete ? '✓ yes' : '✗ no'}
                    </span>
                  } />
                </Section>
              )}

              {/* Human Action (reserved) */}
              {(activeTask.status === 'blocked' || activeTask.status === 'need_human') && (
                <Section title="Human Action Required">
                  <div style={{ color: C.warning, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    ⚠ This task requires human input before it can continue.
                  </div>
                  <KeyVal k="Reason" v={activeTask.blocked_reason || taskResult?.blocked_reason || 'See task details'} />
                  <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: C.border, borderRadius: 6, color: C.textFaint, fontSize: '0.78rem' }}>
                    Human Action interface — full implementation in next milestone.
                  </div>
                </Section>
              )}

            </>
          )}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; }
        textarea:focus, select:focus { border-color: ${C.accent} !important; outline: none; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
        ::-webkit-scrollbar { width: 6px; } 
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>
    </div>
  )
}

export default App
