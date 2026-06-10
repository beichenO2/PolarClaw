import { API_BASE } from './base-url'

export type AgentSSEEvent =
  | { type: 'thinking'; round: number; model?: string; message_count?: number }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; call_id?: string }
  | { type: 'tool_result'; tool: string; result: string; success?: boolean; duration_ms?: number }
  | { type: 'chunk'; content: string }
  | { type: 'done'; content: string; model?: string }
  | { type: 'error'; message: string }

export interface AgentStreamHandlers {
  onEvent: (ev: AgentSSEEvent) => void
}

/**
 * POST to /api/agent/chat/stream and consume named SSE events.
 * Returns the final content from the 'done' event.
 */
export interface UploadedFile {
  name: string
  path: string
  type: string
  size: number
}

export async function uploadChatFiles(files: File[]): Promise<UploadedFile[]> {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  const res = await fetch(`${API_BASE}/api/chat/upload`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const data = (await res.json()) as { ok: boolean; files: UploadedFile[] }
  return data.files
}

export async function sendAgentChatStream(
  opts: {
    message: string
    conversation_id: string
    attachments?: { name: string; path: string; type: string }[]
  },
  handlers: AgentStreamHandlers,
  signal?: AbortSignal,
): Promise<{ content: string | null; error?: string }> {
  const res = await fetch(`${API_BASE}/api/agent/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    signal,
  })

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
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

    let cursor = 0
    while (cursor < buf.length) {
      const blockEnd = buf.indexOf('\n\n', cursor)
      if (blockEnd < 0) break

      const block = buf.slice(cursor, blockEnd)
      cursor = blockEnd + 2

      if (block.startsWith(':')) continue

      let eventType = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          data += line.slice(6)
        } else if (line.startsWith('data:')) {
          data += line.slice(5)
        }
      }

      if (!data) continue
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        if (!parsed.type) parsed.type = eventType
        const ev = parsed as unknown as AgentSSEEvent
        handlers.onEvent(ev)
        if (ev.type === 'done') content = ev.content
        if (ev.type === 'error') error = ev.message
      } catch {
        /* skip malformed */
      }
    }

    buf = buf.slice(cursor)
  }

  return { content, error }
}

import type { TraceLine } from './chat-stream'

export function agentEventToTraceLine(ev: AgentSSEEvent): TraceLine | null {
  switch (ev.type) {
    case 'thinking':
      return { kind: 'step_start', text: `● 思考中… (round ${ev.round}${ev.model ? ` · ${ev.model}` : ''})` }
    case 'tool_call':
      return { kind: 'tool_use', text: `  ▸ ${ev.tool}(${JSON.stringify(ev.args).slice(0, 120)})` }
    case 'tool_result':
      return {
        kind: 'tool_result',
        text: `  ${ev.success === false ? '⎿ ✗ ' : '⎿ '}${ev.result.slice(0, 400)}${ev.duration_ms != null ? ` · ${ev.duration_ms}ms` : ''}`,
      }
    case 'done':
      return { kind: 'step_done', text: `✓ 完成${ev.model ? ` · ${ev.model}` : ''}` }
    case 'error':
      return { kind: 'error', text: ev.message }
    default:
      return null
  }
}
