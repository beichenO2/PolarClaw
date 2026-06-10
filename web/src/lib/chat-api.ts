import { API_BASE } from './base-url'

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
  const res = await fetch(`${API_BASE}/api/deployments`)
  if (!res.ok) return []
  return res.json()
}

export async function sendWorkflowChat(opts: {
  workflow_id: string
  conversation_id: string
  message: string
  user_id?: string
}): Promise<{ content: string | null; error?: string }> {
  const res = await fetch(`${API_BASE}/api/workflow/chat`, {
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

export function newConversationId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
