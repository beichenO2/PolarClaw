/**
 * Skills Port — 技能系统抽象
 *
 * 支持 SKILL.md 格式的技能发现、加载、注册。
 * Clock Integration 等外部集成都通过这个接口注入。
 */

/** 技能元数据 */
export interface ISkillMeta {
  name: string;
  description: string;
  version?: string;
  /** 技能依赖（如 clock-backend: "http://127.0.0.1:15550"） */
  requires?: Record<string, string>;
  /** SKILL.md 文件路径 */
  path: string;
}

/** 技能加载器接口 */
export interface ISkillLoader {
  /** 从目录扫描并加载技能 */
  scan(dirs: string[]): ISkillMeta[];

  /** 将技能注册为 Agent 工具（动态导入 tools.ts，需 async） */
  registerTools(skills: ISkillMeta[], register: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }) => void): Promise<void>;
}
