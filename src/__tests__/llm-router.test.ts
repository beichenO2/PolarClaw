import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createLLMRouter } from '../adapters/llm/llm-router.js';
import http from 'node:http';

let mockServer: http.Server;
let serverPort: number;
let requestCount = 0;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    requestCount++;
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const data = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: `Response to: ${data.model}`, tool_calls: [] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address() as { port: number };
      serverPort = addr.port;
      resolve();
    });
  });
});

afterAll(() => { mockServer.close(); });

describe('createLLMRouter', () => {
  it('routes coding intent to coding model', async () => {
    const router = createLLMRouter({
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      apiKey: 'test',
      models: { coding: 'code-model', research: 'res-model', vision: 'vis-model', general: 'gen-model' },
    });

    const result = await router.chat([
      { role: 'user', content: '帮我写一个函数' },
    ]);
    expect(result.content).toContain('code-model');
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('routes general intent for non-specific messages', async () => {
    const router = createLLMRouter({
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      apiKey: 'test',
      models: { coding: 'code', research: 'res', vision: 'vis', general: 'gen' },
    });

    const result = await router.chat([
      { role: 'user', content: '你好，今天天气怎么样？' },
    ]);
    expect(result.content).toContain('gen');
  });

  it('resolveModel returns correct model and intent', () => {
    const router = createLLMRouter({
      baseUrl: 'http://localhost:9999/v1',
      apiKey: 'test',
      models: { coding: 'c', research: 'r', vision: 'v', general: 'g' },
    });

    const coding = router.resolveModel([{ role: 'user', content: '写代码实现排序' }]);
    expect(coding.intent).toBe('coding');
    expect(coding.model).toBe('c');

    const research = router.resolveModel([{ role: 'user', content: '研究一下这篇论文' }]);
    expect(research.intent).toBe('research');
  });
});
