export interface ChatDeployment {
  id: string
  workflow_id: string
  library: 'WF' | 'LG'
  display_name: string
  deployed_at: string
  memory?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  annotations?: ChatAnnotation[]
}

export interface ChatAnnotation {
  id: string
  quotedText: string
  note: string
}

export interface ConversationMeta {
  id: string
  title: string
  workflowId: string
  updatedAt: string
}

const STORAGE_CONVERSATIONS = 'polarui_chat_conversations'
const STORAGE_MESSAGES_PREFIX = 'polarui_chat_messages_'

export async function fetchDeployments(): Promise<ChatDeployment[]> {
  const res = await fetch('/api/deployments')
  if (!res.ok) return []
  return res.json()
}

export async function sendWorkflowChat(opts: {
  workflow_id: string
  conversation_id: string
  message: string
  user_id?: string
}): Promise<{ content: string | null; error?: string }> {
  const res = await fetch('/api/workflow/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = await res.json() as { content?: string | null; error?: string }
  if (!res.ok) {
    return { content: null, error: data.error ?? `HTTP ${res.status}` }
  }
  return { content: data.content ?? null }
}

export function loadConversations(): ConversationMeta[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONVERSATIONS) ?? '[]') as ConversationMeta[]
  } catch {
    return []
  }
}

export function saveConversations(list: ConversationMeta[]) {
  localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(list))
}

export function loadMessages(conversationId: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_MESSAGES_PREFIX + conversationId) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export function saveMessages(conversationId: string, messages: ChatMessage[]) {
  localStorage.setItem(STORAGE_MESSAGES_PREFIX + conversationId, JSON.stringify(messages))
}

export const POLARCLAW_DIRECT_ID = '__polarclaw__'

export function isDirectAgent(workflowId: string): boolean {
  return workflowId === POLARCLAW_DIRECT_ID
}

export async function sendAgentChat(opts: {
  conversation_id: string
  message: string
  onProgress?: (text: string) => void
}): Promise<{ content: string | null; error?: string }> {
  try {
    const res = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.message,
        conversation_id: opts.conversation_id,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      return { content: null, error: data.error ?? `HTTP ${res.status}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { content: null, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let finalContent: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7).trim()
          if (eventType === 'done' || eventType === 'error') {
            // next data line has the payload
          }
        }
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6)) as {
              type: string
              content?: string
              message?: string
              text?: string
              round?: number
            }
            if (payload.type === 'done') {
              finalContent = payload.content ?? null
            } else if (payload.type === 'error') {
              return { content: null, error: payload.message ?? 'Agent error' }
            } else if (payload.type === 'thinking') {
              opts.onProgress?.(`思考中 (round ${(payload.round ?? 0) + 1})…`)
            } else if (payload.type === 'tool_start' || payload.type === 'tool_result') {
              opts.onProgress?.(payload.text ?? `${payload.type}…`)
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    }

    return { content: finalContent }
  } catch (err) {
    return { content: null, error: String(err) }
  }
}

export function newConversationId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
