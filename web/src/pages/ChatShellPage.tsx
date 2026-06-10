import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { MessageList } from '../components/chat/MessageList'
import { ChatComposer } from '../components/chat/ChatComposer'
import { WorkflowPicker } from '../components/chat/WorkflowPicker'
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
import {
  sendWorkflowChatStream,
  streamEventToTraceLine,
  type TraceLine,
} from '../lib/chat-stream'
import { sendAgentChatStream, agentEventToTraceLine, uploadChatFiles, type UploadedFile } from '../lib/agent-stream'
import { RunTracePanel } from '../components/chat/RunTracePanel'

type ChatMode = 'agent' | 'workflow'

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

  const [chatMode, setChatMode] = useState<ChatMode>(
    () => (localStorage.getItem('mc-chat-mode') as ChatMode) || 'agent',
  )
  const [deployments, setDeployments] = useState<ChatDeployment[]>([])
  const [workflowId, setWorkflowId] = useState(searchParams.get('workflow') ?? '')
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => loadConversations())
  const [conversationId, setConversationId] = useState(routeConvId ?? newConversationId())
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(conversationId))
  const [input, setInput] = useState('')
  const [pendingAnnotations, setPendingAnnotations] = useState<ChatAnnotation[]>([])
  const [sending, setSending] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [traceLines, setTraceLines] = useState<TraceLine[]>([])
  const [streamPreview, setStreamPreview] = useState('')
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem('mc-chat-mode', chatMode)
  }, [chatMode])

  useEffect(() => {
    if (chatMode === 'workflow') {
      fetchDeployments().then(list => {
        setDeployments(list)
        if (!workflowId && list[0]) setWorkflowId(list[0].id)
      })
    }
  }, [chatMode])

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
      workflowId: chatMode === 'workflow' ? workflowId : '__agent__',
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
    setStreamPreview('')
    setTraceLines([])
    setPendingFiles([])
    if (nextWorkflowId) setWorkflowId(nextWorkflowId)
    navigate(`/chat/${id}${chatMode === 'workflow' && wf ? `?workflow=${encodeURIComponent(wf)}` : ''}`)
  }

  function switchConversation(id: string) {
    setConversationId(id)
    setMessages(loadMessages(id))
    setPendingAnnotations([])
    setStreamPreview('')
    setTraceLines([])
    setPendingFiles([])
    const conv = conversations.find(c => c.id === id)
    if (conv?.workflowId && conv.workflowId !== '__agent__') setWorkflowId(conv.workflowId)
    navigate(`/chat/${id}`)
  }

  async function handleAddFiles(rawFiles: File[]) {
    setUploading(true)
    try {
      const uploaded = await uploadChatFiles(rawFiles)
      setPendingFiles(prev => [...prev, ...uploaded])
    } catch (err) {
      console.error('File upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if ((!text && pendingFiles.length === 0) || sending) return
    if (chatMode === 'workflow' && !workflowId) return

    const fileNames = pendingFiles.map(f => f.name)
    const displayContent = fileNames.length > 0
      ? `${buildUserPayload(text || '请分析这些文件', pendingAnnotations)}\n\n📎 ${fileNames.join(', ')}`
      : buildUserPayload(text, pendingAnnotations)

    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      role: 'user',
      content: displayContent,
    }
    setMessages(prev => [...prev, userMsg])

    const attachments = pendingFiles.map(f => ({ name: f.name, path: f.path, type: f.type }))

    setInput('')
    setPendingAnnotations([])
    setPendingFiles([])
    persistConversationMeta(text || fileNames[0] || '新对话')
    setSending(true)
    setTraceLines([])
    setStreamPreview('')

    const ac = new AbortController()
    abortRef.current = ac

    let assistantContent = ''

    if (chatMode === 'agent') {
      const messageText = text ? buildUserPayload(text, pendingAnnotations) : '请分析这些文件'
      const { content, error } = await sendAgentChatStream(
        {
          message: messageText,
          conversation_id: conversationId,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        {
          onEvent: (ev) => {
            const trace = agentEventToTraceLine(ev)
            if (trace) setTraceLines(prev => [...prev, trace].slice(-200))
            if (ev.type === 'chunk') {
              setStreamPreview(prev => prev + ev.content)
              assistantContent += ev.content
            }
            if (ev.type === 'done') assistantContent = ev.content
          },
        },
        ac.signal,
      ).catch(() => ({ content: null as string | null, error: '请求失败' }))

      const finalText = error
        ? `错误：${error}`
        : (content ?? (assistantContent || streamPreview || '（无回复）'))

      const assistantMsg: ChatMessage = {
        id: `m_${Date.now()}_a`,
        role: 'assistant',
        content: finalText,
      }
      setMessages(prev => [...prev, assistantMsg])
    } else {
      const { content, error } = await sendWorkflowChatStream(
        {
          workflow_id: workflowId,
          conversation_id: conversationId,
          message: userMsg.content,
        },
        {
          onEvent: (ev) => {
            const result = streamEventToTraceLine(ev)
            if (result) {
              const lines = Array.isArray(result) ? result : [result]
              setTraceLines(prev => [...prev, ...lines].slice(-200))
            }
            if (ev.type === 'text_delta') {
              setStreamPreview(prev => prev + ev.delta)
              assistantContent += ev.delta
            }
            if (ev.type === 'final' && ev.content) assistantContent = ev.content
          },
        },
      ).catch(async () => {
        return sendWorkflowChat({
          workflow_id: workflowId,
          conversation_id: conversationId,
          message: userMsg.content,
        })
      })

      const finalText = error
        ? `错误：${error}`
        : (content ?? (assistantContent || streamPreview || '（无回复）'))

      const assistantMsg: ChatMessage = {
        id: `m_${Date.now()}_a`,
        role: 'assistant',
        content: finalText,
      }
      setMessages(prev => [...prev, assistantMsg])
    }

    setSending(false)
    setStreamPreview('')
    abortRef.current = null
  }

  function handleStop() {
    abortRef.current?.abort()
    setSending(false)
    setStreamPreview('')
  }

  function handleAnnotate(_messageId: string, annotation: ChatAnnotation) {
    setPendingAnnotations(prev => [...prev, annotation])
  }

  const selectedDeployment = deployments.find(d => d.id === workflowId)

  return (
    <div className="h-screen flex bg-[#212121] text-[#ececec] overflow-hidden">
      {/* Sidebar */}
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
        <header className="h-12 flex items-center gap-3 px-4 border-b border-[#444654] shrink-0">
          <button
            type="button"
            className="text-[#8e8ea0] hover:text-white text-lg"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="切换侧栏"
          >
            ☰
          </button>

          {/* Mode toggle */}
          <div className="flex items-center bg-[#2f2f2f] rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setChatMode('agent')}
              className={clsx(
                'px-3 py-1 rounded-md transition-colors',
                chatMode === 'agent'
                  ? 'bg-[#10a37f] text-white'
                  : 'text-[#8e8ea0] hover:text-white',
              )}
            >
              Agent
            </button>
            <button
              type="button"
              onClick={() => setChatMode('workflow')}
              className={clsx(
                'px-3 py-1 rounded-md transition-colors',
                chatMode === 'workflow'
                  ? 'bg-[#10a37f] text-white'
                  : 'text-[#8e8ea0] hover:text-white',
              )}
            >
              Workflow
            </button>
          </div>

          {chatMode === 'workflow' && (
            <>
              <WorkflowPicker
                deployments={deployments}
                value={workflowId}
                onChange={id => startNewChat(id)}
              />
              {selectedDeployment && (
                <span className="text-xs text-[#8e8ea0] hidden sm:inline">
                  {selectedDeployment.library}
                </span>
              )}
            </>
          )}

          {chatMode === 'agent' && (
            <span className="text-xs text-[#8e8ea0]">PolarClaw Agent</span>
          )}
        </header>

        <MessageList
          messages={messages}
          pending={sending}
          streamPreview={streamPreview}
          onAnnotate={handleAnnotate}
        />

        <RunTracePanel lines={traceLines} />

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={sending ? handleStop : undefined}
          disabled={sending || (chatMode === 'workflow' && !workflowId)}
          pendingAnnotations={pendingAnnotations}
          onRemoveAnnotation={id => setPendingAnnotations(prev => prev.filter(a => a.id !== id))}
          pendingFiles={pendingFiles}
          onAddFiles={handleAddFiles}
          onRemoveFile={i => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
          uploading={uploading}
        />
      </div>
    </div>
  )
}
