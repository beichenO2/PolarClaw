import { useState, useEffect } from 'react'

const BACKEND = 'http://localhost:8000'

const STATUS_STYLE = {
  ok:       { color: '#16a34a', label: 'ok' },
  failed:   { color: '#dc2626', label: 'failed' },
  checking: { color: '#6b7280', label: 'checking…' },
}

function App() {
  // --- health ---
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    const check = () => {
      fetch(`${BACKEND}/health`)
        .then((r) => r.json())
        .then((d) => setStatus(d.status === 'ok' ? 'ok' : 'failed'))
        .catch(() => setStatus('failed'))
    }
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])

  const { color, label } = STATUS_STYLE[status] ?? STATUS_STYLE.failed

  // --- chat ---
  const [message, setMessage]     = useState('')
  const [response, setResponse]   = useState(null)
  const [chatError, setChatError] = useState(null)
  const [loading, setLoading]     = useState(false)

  const sendMessage = async () => {
    if (!message.trim() || loading) return
    setLoading(true)
    setChatError(null)
    setResponse(null)
    try {
      const r = await fetch(`${BACKEND}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, params: {} }),
      })
      const data = await r.json()
      if (!r.ok) {
        setChatError(data?.error?.message ?? `HTTP ${r.status}`)
      } else {
        setResponse(data)
      }
    } catch (e) {
      setChatError('Network error: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 520 }}>
      <h1 style={{ marginBottom: '0.5rem' }}>PolarClaw</h1>

      {/* health */}
      <p style={{ fontSize: '1.05rem', margin: '0 0 1.5rem' }}>
        Backend health:{' '}
        <strong style={{ color }}>{label}</strong>
      </p>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', marginBottom: '1.5rem' }} />

      {/* chat */}
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem', color: '#374151' }}>
        Chat
      </h2>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message and press Enter…"
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: '0.95rem',
            outline: 'none',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !message.trim()}
          style={{
            padding: '0.5rem 1.1rem',
            background: loading || !message.trim() ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: loading || !message.trim() ? 'not-allowed' : 'pointer',
            fontSize: '0.95rem',
          }}
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>

      {chatError && (
        <p style={{ marginTop: '0.75rem', color: '#dc2626', fontSize: '0.9rem' }}>
          Error: {chatError}
        </p>
      )}

      {response && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem 1rem',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.95rem', wordBreak: 'break-word' }}>
            {response.text}
          </p>
          {response.meta && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
              model: {response.meta.model ?? '—'} &nbsp;·&nbsp; {response.meta.latency_ms ?? '—'} ms
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default App
