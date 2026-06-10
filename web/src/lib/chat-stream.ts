import { API_BASE } from './base-url'

export type TraceLineKind =
  | 'step_start'
  | 'step_done'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'status'
  | 'data_flow'

export interface TraceLine {
  kind: TraceLineKind
  text: string
}

export type ChatStreamEvent =
  | { type: 'step_start'; node_id: string; class_type: string; attempt?: number }
  | { type: 'text_delta'; delta: string; node_id?: string }
  | { type: 'tool_use'; name: string; input?: unknown; node_id?: string }
  | { type: 'tool_result'; content: string; is_error?: boolean; node_id?: string }
  | { type: 'step_done'; node_id: string; class_type: string; duration_ms?: number; error?: string }
  | { type: 'data_flow'; from_node: string; to_node: string; from_class: string; to_class: string; slot: number; preview: string }
  | { type: 'node_output'; node_id: string; class_type: string; outputs: Record<string, string> }
  | { type: 'final'; content: string | null; status: string; unhealthy_nodes?: unknown[] }
  | { type: 'error'; message: string }

export function streamEventToTraceLine(ev: ChatStreamEvent): TraceLine | TraceLine[] | null {
  switch (ev.type) {
    case 'step_start':
      return { kind: 'step_start', text: `● ${ev.class_type} [${ev.node_id}]${ev.attempt && ev.attempt > 1 ? ` (retry #${ev.attempt})` : ''}` }
    case 'text_delta':
      return { kind: 'text', text: ev.delta }
    case 'tool_use':
      return { kind: 'tool_use', text: `  ▸ ${ev.name}(${JSON.stringify(ev.input ?? {}).slice(0, 120)})` }
    case 'tool_result':
      return { kind: 'tool_result', text: `  ${ev.is_error ? '⎿ ✗ ' : '⎿ '}${ev.content.slice(0, 400)}` }
    case 'data_flow':
      return { kind: 'status', text: `  ┃ ${ev.from_class}[${ev.from_node}] ─slot${ev.slot}→ ${ev.to_class}[${ev.to_node}]: ${ev.preview}` }
    case 'node_output': {
      const entries = Object.entries(ev.outputs)
      if (entries.length === 0) return null
      return entries.map(([k, v]) => ({
        kind: 'status' as TraceLineKind,
        text: `  ┗ ${ev.class_type}.${k} = ${v}`,
      }))
    }
    case 'step_done':
      return {
        kind: ev.error ? 'error' : 'step_done',
        text: ev.error
          ? `✗ ${ev.class_type} [${ev.node_id}]: ${ev.error}`
          : `✓ ${ev.class_type} [${ev.node_id}]${ev.duration_ms != null ? ` · ${ev.duration_ms}ms` : ''}`,
      }
    case 'error':
      return { kind: 'error', text: ev.message }
    default:
      return null
  }
}

export async function sendWorkflowChatStream(
  opts: {
    workflow_id: string
    conversation_id: string
    message: string
    user_id?: string
  },
  handlers: {
    onEvent: (ev: ChatStreamEvent) => void
  },
): Promise<{ content: string | null; error?: string }> {
  const res = await fetch(`${API_BASE}/api/workflow/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...opts, stream: true }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    return { content: null, error: data.error ?? `HTTP ${res.status}` }
  }
  if (!res.body) {
    return { content: null, error: 'no response body' }
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let content: string | null = null
  let error: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line) as ChatStreamEvent
        handlers.onEvent(ev)
        if (ev.type === 'final') content = ev.content
        if (ev.type === 'error') error = ev.message
      } catch {
        /* skip malformed */
      }
    }
  }

  return { content, error }
}
