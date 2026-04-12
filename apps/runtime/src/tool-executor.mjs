/**
 * @typedef {object} JsonSchema
 * @property {string} [type]
 * @property {object} [properties]
 * @property {string[]} [required]
 * @property {object} [items]
 * @property {string} [description]
 */

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {JsonSchema} parameters JSON Schema for arguments (OpenAI tools style)
 * @property {(args: object) => unknown | Promise<unknown>} handler
 */

function assertTool(tool) {
  if (!tool || typeof tool !== "object") {
    throw new TypeError("register(tool): tool must be an object");
  }
  const { name, description, parameters, handler } = tool;
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("register(tool): name must be a non-empty string");
  }
  if (typeof description !== "string") {
    throw new TypeError("register(tool): description must be a string");
  }
  if (!parameters || typeof parameters !== "object") {
    throw new TypeError("register(tool): parameters must be a JSON Schema object");
  }
  if (typeof handler !== "function") {
    throw new TypeError("register(tool): handler must be a function");
  }
}

/**
 * @typedef {object} ToolExecutorOptions
 * @property {(name: string, args: object) => void | Promise<void>} [beforeExecute]
 *   Optional gate (security / policy). Throw to block execution.
 */

/**
 * @param {ToolExecutorOptions} [options]
 * @returns {{
 *   register: (tool: ToolDefinition) => void,
 *   execute: (name: string, args: object) => Promise<unknown>,
 *   list: () => { type: 'function', function: { name: string, description: string, parameters: JsonSchema } }[]
 * }}
 */
export function createToolExecutor(options = {}) {
  const { beforeExecute } = options;
  /** @type {Map<string, ToolDefinition>} */
  const tools = new Map();

  return {
    /**
     * @param {ToolDefinition} tool
     */
    register(tool) {
      assertTool(tool);
      if (tools.has(tool.name)) {
        throw new Error(`register: tool "${tool.name}" is already registered`);
      }
      tools.set(tool.name, tool);
    },

    /**
     * @param {string} name
     * @param {object} args
     */
    async execute(name, args) {
      if (typeof name !== "string" || name === "") {
        throw new TypeError("execute(name, args): name must be a non-empty string");
      }
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        throw new TypeError("execute(name, args): args must be a plain object");
      }
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`execute: unknown tool "${name}"`);
      }
      if (typeof beforeExecute === "function") {
        await beforeExecute(name, args);
      }
      try {
        return await tool.handler(args);
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        throw new Error(`execute("${name}"): handler failed — ${cause.message}`, {
          cause,
        });
      }
    },

    /**
     * OpenAI-compatible tool list for chat `tools` parameter.
     */
    list() {
      return [...tools.values()].map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    },
  };
}
