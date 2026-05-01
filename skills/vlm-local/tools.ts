import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function imageToBase64Url(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) throw new Error(`不支持的图片格式: ${ext}`);

  const data = readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function callVisionLLM(
  imageBase64Url: string,
  query: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageBase64Url } },
          { type: 'text', text: query },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VLM API ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '(无输出)';
  } finally {
    clearTimeout(timer);
  }
}

export const tools: IToolHandler[] = [
  {
    name: 'vlm_analyze',
    description: '使用 vision LLM 分析本地图片文件。可用于评估图表质量、审查文档页面、理解图片内容。',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '本地图片文件路径（PNG/JPG/WebP）' },
        query: { type: 'string', description: '分析问题或评估维度（如"评估图表质量"、"描述图片内容"、"检查公式格式"）' },
      },
      required: ['image_path', 'query'],
    },
    async handler(args) {
      const imagePath = String(args.image_path);
      const query = String(args.query || '请描述这张图片的内容');

      if (!existsSync(imagePath)) {
        throw new Error(`图片文件不存在: ${imagePath}`);
      }

      const base64Url = imageToBase64Url(imagePath);

      const baseUrl = process.env.POLARCLAW_LLM_BASE_URL
        || `${process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790'}/v1`;
      const apiKey = process.env.POLARCLAW_LLM_API_KEY
        || process.env.DASHSCOPE_API_KEY
        || 'proxy-managed';
      const model = process.env.POLARCLAW_MODEL_VISION || 'qwen3.6-plus';

      const analysis = await callVisionLLM(base64Url, query, baseUrl, apiKey, model);

      return {
        image: imagePath,
        query,
        analysis,
        model,
      };
    },
  },
];
