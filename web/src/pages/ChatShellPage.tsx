import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { MessageList } from '../components/chat/MessageList'
import { ChatComposer } from '../components/chat/ChatComposer'
import {
  type ChatAnnotation,
  type ChatDeployment,
  type ChatMessage,
  type ConversationMeta,
  fetchDeployments,
  loadConversations,
  loadMessages,
  newConversationId,
  saveConversations,
  saveMessages,
  sendWorkflowChat,
} from '../lib/chat-api'

function buildUserPayload(text: string, annotations: ChatAnnotation[]): string {
  if (annotations.length === 0) return text
  const annParts = annotations.map(
    (a, i) => `【批注 ${i + 1}】"${a.quotedText}"\n→ ${a.note}`,
  )
  return [text, ...annParts].filter(Boolean).join('\n\n')
}

export function ChatShellPage() {
  const navigate = useNavigate()
  const { conversationId: routeConvId } = useParams()
  const [searchParams] = useSearchParams()

  const [deployments, setDeployments] = useState<ChatDeployment[]>([])
  const [workflowId, setWorkflowId] = useState(searchParams.get('workflow') ?? '')
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => loadConversations())
  const [conversationId, setConversationId] = useState(routeConvId ?? newConversationId())
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(conversationId))
  const [input, setInput] = useState('')
  const [pendingAnnotations, setPendingAnnotations] = useState<ChatAnnotation[]>([])
  const [sending, setSending] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    fetchDeployments().then(list => {
      setDeployments(list)
      if (!workflowId && list[0]) setWorkflowId(list[0].id)
    })
  }, [])

  useEffect(() => {
    if (routeConvId && routeConvId !== conversationId) {
      setConversationId(routeConvId)
      setMessages(loadMessages(routeConvId))
    }
  }, [routeConvId])

  useEffect(() => {
    saveMessages(conversationId, messages)
  }, [conversationId, messages])

  function persistConversationMeta(title: string) {
    const meta: ConversationMeta = {
      id: conversationId,
      title: title.slice(0, 48) || '新对话',
      workflowId,
      updatedAt: new Date().toISOString(),
    }
    const next = [meta, ...conversations.filter(c => c.id !== conversationId)].slice(0, 40)
    setConversations(next)
    saveConversations(next)
  }

  function startNewChat(nextWorkflowId?: string) {
    const wf = nextWorkflowId ?? workflowId
    const id = newConversationId()
    setConversationId(id)
    setMessages([])
    setPendingAnnotations([])
    setInput('')
    if (nextWorkflowId) setWorkflowId(nextWorkflowId)
    navigate(`/chat/${id}${wf ? `?workflow=${encodeURIComponent(wf)}` : ''}`)
  }

  function switchConversation(id: string) {
    setConversationId(id)
    setMessages(loadMessages(id))
    setPendingAnnotations([])
    const conv = conversations.find(c => c.id === id)
    if (conv?.workflowId) setWorkflowId(conv.workflowId)
    navigate(`/chat/${id}`)
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !workflowId || sending) return

    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      role: 'user',
      content: buildUserPayload(text, pendingAnnotations),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingAnnotations([])
    persistConversationMeta(text)
    setSending(true)

    const { content, error } = await sendWorkflowChat({
      workflow_id: workflowId,
      conversation_id: conversationId,
      message: userMsg.content,
    })

    const assistantMsg: ChatMessage = {
      id: `m_${Date.now()}_a`,
      role: 'assistant',
      content: error ? `错误：${error}` : (content ?? '（无回复）'),
    }
    setMessages(prev => [...prev, assistantMsg])
    setSending(false)
  }

  function handleAnnotate(_messageId: string, annotation: ChatAnnotation) {
    setPendingAnnotations(prev => [...prev, annotation])
  }

  const selectedDeployment = deployments.find(d => d.id === workflowId)

  return (
    <div className="h-screen flex bg-[#212121] text-[#ececec] overflow-hidden">
      {/* Sidebar — ChatGPT 左栏 */}
      <aside
        className={clsx(
          'flex flex-col border-r border-[#444654] bg-[#171717] transition-all duration-200',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={() => startNewChat()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[#565869] hover:bg-[#2f2f2f] text-sm"
          >
            + 新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {conversations.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => switchConversation(c.id)}
              className={clsx(
                'w-full text-left px-3 py-2 rounded-lg text-sm truncate',
                c.id === conversationId ? 'bg-[#2f2f2f]' : 'hover:bg-[#2f2f2f]/60 text-[#c9d1d9]',
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — workflow 下拉替代 model 下拉 */}
        <header className="h-12 flex items-center gap-3 px-4 border-b border-[#444654] shrink-0">
          <button
            type="button"
            className="text-[#8e8ea0] hover:text-white text-lg"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="切换侧栏"
          >
            ☰
          </button>
          <select
            value={workflowId}
            onChange={e => startNewChat(e.target.value)}
            className="bg-[#2f2f2f] border border-[#565869] rounded-lg px-3 py-1.5 text-sm text-[#ececec] max-w-xs"
          >
            <option value="">— 选择 workflow —</option>
            {deployments.map(d => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
          {selectedDeployment && (
            <span className="text-xs text-[#8e8ea0] hidden sm:inline">
              {selectedDeployment.library} · 模型在工作流内配置
            </span>
          )}
        </header>

        <MessageList
          messages={messages}
          pending={sending}
          onAnnotate={handleAnnotate}
        />

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={sending || !workflowId}
          pendingAnnotations={pendingAnnotations}
          onRemoveAnnotation={id => setPendingAnnotations(prev => prev.filter(a => a.id !== id))}
        />
      </div>
    </div>
  )
}
