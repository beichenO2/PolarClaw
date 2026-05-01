// skills/vlm-local/tools.ts
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
var MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
function imageToBase64Url(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) throw new Error(`\u4E0D\u652F\u6301\u7684\u56FE\u7247\u683C\u5F0F: ${ext}`);
  const data = readFileSync(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}
async function callVisionLLM(imageBase64Url, query, baseUrl, apiKey, model) {
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64Url } },
          { type: "text", text: query }
        ]
      }
    ],
    max_tokens: 2e3,
    temperature: 0.3
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12e4);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VLM API ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "(\u65E0\u8F93\u51FA)";
  } finally {
    clearTimeout(timer);
  }
}
var tools = [
  {
    name: "vlm_analyze",
    description: "\u4F7F\u7528 vision LLM \u5206\u6790\u672C\u5730\u56FE\u7247\u6587\u4EF6\u3002\u53EF\u7528\u4E8E\u8BC4\u4F30\u56FE\u8868\u8D28\u91CF\u3001\u5BA1\u67E5\u6587\u6863\u9875\u9762\u3001\u7406\u89E3\u56FE\u7247\u5185\u5BB9\u3002",
    parameters: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "\u672C\u5730\u56FE\u7247\u6587\u4EF6\u8DEF\u5F84\uFF08PNG/JPG/WebP\uFF09" },
        query: { type: "string", description: '\u5206\u6790\u95EE\u9898\u6216\u8BC4\u4F30\u7EF4\u5EA6\uFF08\u5982"\u8BC4\u4F30\u56FE\u8868\u8D28\u91CF"\u3001"\u63CF\u8FF0\u56FE\u7247\u5185\u5BB9"\u3001"\u68C0\u67E5\u516C\u5F0F\u683C\u5F0F"\uFF09' }
      },
      required: ["image_path", "query"]
    },
    async handler(args) {
      const imagePath = String(args.image_path);
      const query = String(args.query || "\u8BF7\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\u7684\u5185\u5BB9");
      if (!existsSync(imagePath)) {
        throw new Error(`\u56FE\u7247\u6587\u4EF6\u4E0D\u5B58\u5728: ${imagePath}`);
      }
      const base64Url = imageToBase64Url(imagePath);
      const baseUrl = process.env.POLARCLAW_LLM_BASE_URL || `${process.env.POLARPRIVATE_URL || "http://127.0.0.1:12790"}/v1`;
      const apiKey = process.env.POLARCLAW_LLM_API_KEY || process.env.DASHSCOPE_API_KEY || "proxy-managed";
      const model = process.env.POLARCLAW_MODEL_VISION || "qwen3.6-plus";
      const analysis = await callVisionLLM(base64Url, query, baseUrl, apiKey, model);
      return {
        image: imagePath,
        query,
        analysis,
        model
      };
    }
  }
];
export {
  tools
};
