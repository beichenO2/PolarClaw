/**
 * 端口层导出 — 所有接口定义的统一入口
 *
 * 端口-适配器架构：
 * - ports/ 定义接口（本目录）
 * - adapters/ 实现接口
 * - core/ 只依赖 ports/，不依赖 adapters/
 */

export type {
  IChannelAdapter,
  IInboundMessage,
  IOutboundMessage,
  IAttachment,
} from './channel.js';

export type {
  IPrivacyGateway,
  IPrivacyEntity,
  ISanitizeResult,
} from './privacy.js';

export type {
  IMemoryStore,
  IMemoryEntry,
  ISearchResult,
  IUserProfile,
  IConversationHistory,
  IChatMessage,
  IToolCall,
} from './memory.js';

export type {
  ILLMRouter,
  ILLMResponse,
  ILLMOptions,
  IToolDefinition,
  IntentType,
} from './llm.js';

export type {
  IToolExecutor,
  IToolHandler,
} from './tools.js';

export type {
  ISkillLoader,
  ISkillMeta,
} from './skills.js';
