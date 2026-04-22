export interface AgentStatus {
  name: string
  version: string
  channels: { name: string; connected: boolean }[]
  uptime: number
  memory: { totalEntries: number; dbSizeBytes: number }
  skills: { count: number; names: string[] }
  yolo: { activeSessions: number }
}

export interface ReviewItem {
  id: string
  type: 'pdf' | 'ppt'
  filename: string
  status: 'pending' | 'reviewed' | 'approved'
  agent_id: string
  annotations: Annotation[]
  created_at: string
  updated_at: string
}

export interface Annotation {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  comment: string
  author: string
  created_at: string
}

export interface PptDiff {
  slide_index: number
  change_type: 'add' | 'remove' | 'modify'
  target: string
  before: string
  after: string
}

export interface PptReview extends ReviewItem {
  type: 'ppt'
  slides: { index: number; image_url: string }[]
  agent_diffs: PptDiff[]
}

export interface AlignmentSection {
  name: string
  confirmed: boolean
  comment?: string
}

export interface AlignmentDoc {
  id: string
  agent_id: string
  status: string
  goal: string
  work_logic: string
  plan_markdown: string
  sections: AlignmentSection[]
  version: number
  created_at: string
  updated_at: string
}

export interface HubPrompt {
  id: string
  agent_id: string
  prompt: string
  options?: string[]
  answered: boolean
  answer?: string
  created_at: string
}

const BASE = ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  status: () => get<AgentStatus>('/api/status'),

  review: {
    list: () => get<ReviewItem[]>('/api/review'),
    get: (id: string) => get<ReviewItem>(`/api/review/${id}`),
    annotate: (id: string, annotation: Omit<Annotation, 'id' | 'created_at'>) =>
      post<{ ok: boolean; annotation: Annotation }>(`/api/review/${id}/annotate`, annotation),
    approve: (id: string) =>
      post<{ ok: boolean }>(`/api/review/${id}/approve`),
    submitDiff: (id: string, diffs: PptDiff[]) =>
      post<{ ok: boolean }>(`/api/review/${id}/diff`, { diffs }),
    async upload(file: File, agentId = 'local'): Promise<{ ok: boolean; id: string; slides: number }> {
      const form = new FormData()
      form.append('file', file)
      form.append('agent_id', agentId)
      const res = await fetch(`${BASE}/api/review/upload`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      return res.json()
    },
    delete: (id: string) =>
      fetch(`${BASE}/api/review/${id}`, { method: 'DELETE' }).then((r) => r.json() as Promise<{ ok: boolean }>),
  },

  hub: {
    alignment: {
      list: () => get<AlignmentDoc[]>('/hub-api/alignment'),
      get: (id: string) => get<AlignmentDoc>(`/hub-api/alignment/${id}`),
      update: (id: string, data: Partial<AlignmentDoc> & { changed_by?: string }) =>
        patch<{ ok: boolean; version: number }>(`/hub-api/alignment/${id}`, data),
      confirmSection: (id: string, sectionName: string, confirmed: boolean) =>
        post<{ ok: boolean }>(`/hub-api/alignment/${id}/confirm-section`, { section_name: sectionName, confirmed }),
      approve: (id: string) =>
        post<{ ok: boolean }>(`/hub-api/alignment/${id}/approve`, { force: false }),
      reject: (id: string, comment?: string) =>
        post<{ ok: boolean }>(`/hub-api/alignment/${id}/reject`, { comment }),
    },
    prompts: {
      pending: () => get<HubPrompt[]>('/hub-api/prompts/pending'),
      answer: (id: string, answer: string) =>
        post<{ ok: boolean }>(`/hub-api/prompts/${id}/answer`, { answer }),
    },
  },
}
