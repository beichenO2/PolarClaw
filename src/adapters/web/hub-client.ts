/**
 * PolarClaw Hub Web Client
 *
 * 用于注册到 Hub Web 并进行用户交互。
 */

// Node.js EventSource polyfill
import { EventSource } from 'eventsource';

export interface HubClientConfig {
  hubUrl: string;
  agentType: 'polarclaw';
  mainModel: 'glm-5.1' | 'qwen-3.6-plus';
  subagentModel: 'glm-5.1' | 'qwen-3.6-plus' | 'minimax-2.7-highspeed';
}

export interface AgentInfo {
  agent_id: string;
  hub_port: number;
}

export class HubClient {
  private hubUrl: string;
  private agentId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private aliveConnection: EventSource | null = null;

  constructor(hubUrl: string) {
    this.hubUrl = hubUrl;
  }

  async register(config: HubClientConfig): Promise<AgentInfo> {
    const resp = await fetch(`${this.hubUrl}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_type: config.agentType,
        agent_name: 'PolarClaw',
        main_model: config.mainModel,
        subagent_model: config.subagentModel,
        capabilities: ['chat', 'yolo', 'tools', 'memory'],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Hub registration failed: ${resp.status} ${text}`);
    }

    const data = (await resp.json()) as AgentInfo;
    this.agentId = data.agent_id;

    // 启动 SSE 长连接（优先）或回退到 HTTP 心跳
    this.startAliveConnection();

    console.error(`[HubClient] Registered as ${this.agentId}`);
    return data;
  }

  // SSE 长连接心跳
  private startAliveConnection() {
    if (!this.agentId) return;

    this.aliveConnection = new EventSource(`${this.hubUrl}/api/agents/${this.agentId}/alive`);

    this.aliveConnection.onopen = () => {
      console.error('[HubClient] SSE alive connection established');
    };

    this.aliveConnection.onerror = (_err) => {
      console.error('[HubClient] SSE error, falling back to HTTP heartbeat');
      this.aliveConnection?.close();
      this.startHeartbeat();
    };

    this.aliveConnection.addEventListener('heartbeat', (_e) => {
      // 收到心跳，连接正常
    });
  }

  // HTTP 心跳（回退方案）
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(async () => {
      if (!this.agentId) return;
      try {
        await fetch(`${this.hubUrl}/api/agents/${this.agentId}/heartbeat`, {
          method: 'POST',
        });
      } catch (err) {
        console.error('[HubClient] Heartbeat failed:', err);
      }
    }, 30000);
  }

  async sendPrompt(prompt: string, options: string[]): Promise<string> {
    if (!this.agentId) {
      throw new Error('Not registered with Hub');
    }

    // 发送 prompt
    const resp = await fetch(`${this.hubUrl}/api/ui/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: this.agentId,
        prompt,
        options,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Send prompt failed: ${resp.status} ${text}`);
    }

    const { id } = (await resp.json()) as { id: string };

    // 轮询等待回答
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));

      const pollResp = await fetch(`${this.hubUrl}/api/ui/prompts/${id}`, {
        headers: { 'X-Agent-Id': this.agentId! },
      });

      if (!pollResp.ok) {
        continue;
      }

      const data = (await pollResp.json()) as {
        answered: boolean;
        answer?: string;
        freeform_text?: string;
      };

      if (data.answered) {
        // 返回 answer + freeform_text
        const parts = [data.answer].filter(Boolean);
        if (data.freeform_text) {
          parts.push(data.freeform_text);
        }
        return parts.join('\n');
      }
    }
  }

  async unregister() {
    // 关闭 SSE 连接
    if (this.aliveConnection) {
      this.aliveConnection.close();
      this.aliveConnection = null;
    }

    // 关闭 HTTP 心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.agentId) {
      try {
        await fetch(`${this.hubUrl}/api/agents/${this.agentId}/unregister`, {
          method: 'POST',
        });
      } catch {
        // ignore
      }
      this.agentId = null;
    }
  }

  getAgentId(): string | null {
    return this.agentId;
  }
}