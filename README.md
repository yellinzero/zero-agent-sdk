# Zero Agent SDK

> Provider 无关的 AI Agent 框架 — 统一模型、工具、MCP 和权限控制

**Zero Agent SDK** 让你用一套 API 构建自主 Agent 应用，支持 39+ 模型服务商、21 个内置工具、MCP 协议集成、权限控制、生命周期钩子和自动上下文压缩。

## 特性

- **Provider 无关** — 一套代码切换 OpenAI / Anthropic / DeepSeek / Google / Azure / 阿里云等 39+ Provider
- **多模态** — 文本、图像生成、语音合成、视频生成、音频转录、向量嵌入
- **内置工具** — Bash、文件读写编辑、Glob、Grep、NotebookEdit、Web 搜索/抓取、任务管理
- **MCP 集成** — stdio / SSE / HTTP / WebSocket / in-process 五种传输
- **权限系统** — allowAll / denyAll / readOnly / default / 自定义规则引擎
- **生命周期钩子** — preToolUse / postToolUse / preQuery / postQuery / onError / onTurnStart / onTurnEnd / onCompact
- **上下文压缩** — micro-compact + LLM 摘要 + 截断 + 断路器保护
- **会话持久化** — 内存 / 文件存储，支持多轮对话
- **预算控制** — Token / 费用 / 轮次限制
- **模型降级** — 主模型过载 (529) 时自动切换到备用模型
- **结构化日志** — 可选 Logger 接口，追踪重试、压缩、权限等关键决策
- **流式响应** — 事件驱动的 AsyncGenerator API
- **Agent 委托** — 子 Agent 编排，支持后台任务
- **追踪** — Chrome Trace Event 格式的分布式追踪
- **ESM + CJS** — 双格式输出，完整类型声明（推荐使用 `createAgentAsync` 异步工厂）

## 安装

```bash
pnpm add zero-agent-sdk
```

### Provider SDK（按需安装）

Provider SDK 作为 **optional peer dependencies**，用到哪个 Provider 就装哪个：

```bash
# OpenAI / DeepSeek / Groq / Together AI / Perplexity / 其他 OpenAI 兼容
pnpm add openai

# Anthropic
pnpm add @anthropic-ai/sdk

# AWS Bedrock
pnpm add @aws-sdk/client-bedrock-runtime

# MCP 协议支持
pnpm add @modelcontextprotocol/sdk
```

> 如果缺少对应的 SDK，运行时会抛出明确的错误提示。

| peer dependency | 适用 Provider |
|----------------|--------------|
| `openai` | OpenAI, DeepSeek, Azure, Groq, Together AI, Perplexity, Fireworks, Cerebras, DeepInfra, Baseten, Cohere, HuggingFace, MoonshotAI, xAI, OpenAI-Compatible |
| `@anthropic-ai/sdk` | Anthropic |
| `@aws-sdk/client-bedrock-runtime` | Amazon Bedrock |
| `@modelcontextprotocol/sdk` | MCP 集成（stdio/SSE/HTTP 传输） |

## 快速开始

### 基础用法

```typescript
import { createAgentAsync } from 'zero-agent-sdk';
import { openai } from 'zero-agent-sdk/providers/openai';
import { builtinTools } from 'zero-agent-sdk/tools';

const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  tools: builtinTools(),
  systemPrompt: '你是一个有用的编程助手。',
});

const result = await agent.run('帮我创建一个 hello world 程序');
console.log(result.text);
```

### 结构化输出

```typescript
import { Output } from 'zero-agent-sdk';
import { z } from 'zod';

const result = await agent.run('提取用户资料', {
  output: Output.object({
    schema: z.object({
      name: z.string(),
      age: z.number(),
    }),
  }),
});

console.log(result.output.name);
```

流式结构化输出：

```typescript
const result = agent.stream('提取用户资料', {
  output: Output.object({
    schema: z.object({
      name: z.string(),
      age: z.number(),
    }),
  }),
});

for await (const partial of result.partialOutputStream) {
  console.log(partial);
}

for await (const event of result.fullStream) {
  if (event.type === 'object') {
    console.log('partial object', event.object);
  }
}

console.log(await result.output);
```

`output` 是结构化输出的主入口。OpenAI / Azure / Gemini / Vertex 会走 native structured decoding；Anthropic / Bedrock 默认走 strict synthesis 路径；其余 OpenAI-compatible provider 会按模型能力显式声明是否支持 `json_object` / `json_schema`，不再依赖默认猜测。需要在 synthesis provider 上同时允许普通工具与结构化输出时，可设置 `structuredOutputMode: 'mixed'`。`fullStream` 事件名对齐为 `text-delta` / `object` / `element` / `finish` / `error`，数组 `elementStream` 会在最终完成时补发最后一个元素。

### 流式执行

```typescript
for await (const event of agent.stream('解释这段代码的作用')) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.text);
      break;
    case 'thinking':
      // 模型的思考过程（需模型支持）
      break;
    case 'tool_use_start':
      console.log(`调用工具: ${event.toolName}`);
      break;
    case 'tool_use_delta':
      // 工具参数流式片段（JSON 字符串）
      process.stdout.write(event.partialJson);
      break;
    case 'tool_use_end':
      console.log(`工具结果: ${event.toolName}`);
      break;
    case 'error':
      console.error(event.error);
      break;
  }
}
```

### 多轮会话

```typescript
const session = agent.createSession();

// 第一轮
for await (const event of session.send('创建一个 Express 服务器')) {
  if (event.type === 'text') process.stdout.write(event.text);
}

// 第二轮（保留上下文）
for await (const event of session.send('加上 CORS 中间件')) {
  if (event.type === 'text') process.stdout.write(event.text);
}

// 获取累计用量
console.log(session.getUsage());

await session.close();
```

### 会话持久化

```typescript
import { createAgentAsync, FileSessionStore } from 'zero-agent-sdk';

const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  sessionStore: new FileSessionStore('./sessions'),
});

// 创建可恢复的会话
const session = await agent.createSession({ id: 'my-session' });
```

## 发布流程

### 稳定版

稳定版通过 Changesets 和 `main` 分支上的 release workflow 管理。

- 仓库版本基线保留在稳定版本
- `.changeset/*.md` 用于声明下一次稳定发布的 semver bump
- 合并到 `main` 后，由 `.github/workflows/release.yml` 负责生成版本变更并发布正式版本

### Beta 版

`0.2.0` 版本线通过 npm `beta` dist-tag 提供 beta 包。

- beta 发布由 `.github/workflows/prerelease.yml` 管理
- workflow 触发方式为 GitHub Actions 页面手动运行 `Prerelease (Beta)`
- workflow 输入参数 `ref` 默认为 `dev`，可指定任意需要发布的 git ref
- beta workflow 会执行 `changeset version --snapshot beta` 生成基于 Changesets 计算版本的临时 prerelease 版本，再发布到 npm `beta` dist-tag
- 发布后可通过 `npm view zero-agent-sdk dist-tags` 或 `npm view zero-agent-sdk@beta version` 验证当前 beta 版本

### Live 测试

Live 集成测试位于 `src/__tests__/live/`。

- `pnpm test:live` 仅执行 `.live.test.ts` 文件
- 未提供对应 provider secrets 时，相关 live 用例会自动跳过
- live 验证范围取决于运行时提供的 provider secrets

## Provider

通过子路径导入按需加载，避免引入不需要的 SDK 依赖。

### 文本/Chat Provider

| Provider | 导入路径 | 工厂函数 |
|----------|---------|---------|
| OpenAI | `zero-agent-sdk/providers/openai` | `openai()` |
| Anthropic | `zero-agent-sdk/providers/anthropic` | `anthropic()` |
| DeepSeek | `zero-agent-sdk/providers/deepseek` | `deepseek()` |
| Google Gemini | `zero-agent-sdk/providers/google` | `google()` |
| Google Vertex | `zero-agent-sdk/providers/google-vertex` | `googleVertex()` |
| Azure OpenAI | `zero-agent-sdk/providers/azure` | `azure()` |
| AWS Bedrock | `zero-agent-sdk/providers/amazon-bedrock` | `amazonBedrock()` |
| Mistral | `zero-agent-sdk/providers/mistral` | `mistral()` |
| 阿里云 | `zero-agent-sdk/providers/alibaba` | `alibaba()` |
| xAI | `zero-agent-sdk/providers/xai` | `xai()` |
| Groq | `zero-agent-sdk/providers/groq` | `groq()` |
| Together AI | `zero-agent-sdk/providers/togetherai` | `togetherai()` |
| HuggingFace | `zero-agent-sdk/providers/huggingface` | `huggingface()` |
| MoonshotAI | `zero-agent-sdk/providers/moonshotai` | `moonshotai()` |
| Perplexity | `zero-agent-sdk/providers/perplexity` | `perplexity()` |
| Fireworks | `zero-agent-sdk/providers/fireworks` | `fireworks()` |
| Cerebras | `zero-agent-sdk/providers/cerebras` | `cerebras()` |
| DeepInfra | `zero-agent-sdk/providers/deepinfra` | `deepinfra()` |
| Baseten | `zero-agent-sdk/providers/baseten` | `baseten()` |
| Cohere | `zero-agent-sdk/providers/cohere` | `cohere()` |
| Open Responses | `zero-agent-sdk/providers/open-responses` | `openResponses()` |

### 多模态 Provider

| Provider | 能力 | 导入路径 |
|----------|------|---------|
| Black Forest Labs | 图像生成 | `zero-agent-sdk/providers/black-forest-labs` |
| Replicate | 图像生成 | `zero-agent-sdk/providers/replicate` |
| Luma | 图像生成 | `zero-agent-sdk/providers/luma` |
| FAL | 图像生成 | `zero-agent-sdk/providers/fal` |
| Prodia | 图像生成 | `zero-agent-sdk/providers/prodia` |
| ByteDance | 视频生成 | `zero-agent-sdk/providers/bytedance` |
| KlingAI | 视频生成 | `zero-agent-sdk/providers/klingai` |
| ElevenLabs | 语音合成 | `zero-agent-sdk/providers/elevenlabs` |
| Deepgram | 语音合成/转录 | `zero-agent-sdk/providers/deepgram` |
| AssemblyAI | 音频转录 | `zero-agent-sdk/providers/assemblyai` |
| Rev AI | 音频转录 | `zero-agent-sdk/providers/revai` |
| Gladia | 音频转录 | `zero-agent-sdk/providers/gladia` |
| LMNT | 语音合成 | `zero-agent-sdk/providers/lmnt` |
| Hume | 语音合成 | `zero-agent-sdk/providers/hume` |

### 自定义 OpenAI 兼容 Provider

```typescript
import { createOpenAICompatibleProvider } from 'zero-agent-sdk/providers/openai-compatible';

const myProvider = createOpenAICompatibleProvider({
  apiKey: 'your-key',
  baseURL: 'https://your-endpoint.com/v1',
});
```

## 工具系统

### 内置工具

```typescript
import { builtinTools } from 'zero-agent-sdk/tools';

// 默认包含: bash, file-read, file-write, file-edit, glob, grep, notebook-edit
const tools = builtinTools();

// 选择性启用
const tools = builtinTools({
  bash: true,
  fileRead: true,
  fileWrite: true,
  fileEdit: true,
  glob: true,
  grep: true,
  notebookEdit: false,
  webSearch: true,     // 默认关闭
  webFetch: true,      // 默认关闭
  askUser: true,       // 默认关闭
  tasks: true,         // 默认关闭
  agent: true,         // 默认关闭
});
```

### 自定义工具

```typescript
import { buildSDKTool } from 'zero-agent-sdk';
import { z } from 'zod';

const weatherTool = buildSDKTool({
  name: 'get-weather',
  description: '获取指定城市的天气',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
  }),
  async call({ city }) {
    const data = await fetchWeather(city);
    return { content: data };
  },
});

const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  tools: [...builtinTools(), weatherTool],
});
```

### 多模态工具

```typescript
import { imageGenerationTool, speechGenerationTool, transcriptionTool } from 'zero-agent-sdk/tools';

// 将图像/语音/转录能力作为工具提供给 Agent
const tools = [
  imageGenerationTool({ model: myImageModel }),
  speechGenerationTool({ model: mySpeechModel }),
  transcriptionTool({ model: myTranscriptionModel }),
];
```

## MCP 集成

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  mcpServers: [
    // stdio 传输
    {
      name: 'filesystem',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
    // SSE 传输
    {
      name: 'remote-tools',
      type: 'sse',
      url: 'https://mcp.example.com/sse',
    },
    // HTTP 传输
    {
      name: 'api-tools',
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    },
    // WebSocket 传输
    {
      name: 'ws-tools',
      type: 'ws',
      url: 'ws://localhost:3001',
    },
    // In-process 传输（直接注入工具）
    {
      name: 'local-tools',
      type: 'in-process',
      tools: [myTool1, myTool2],
    },
  ],
});
```

## 权限控制

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  tools: builtinTools(),

  // 预设模式
  permissionMode: 'default',  // 'allowAll' | 'denyAll' | 'default'

  // 或自定义处理器
  permissionHandler: {
    async checkPermission(tool, input, context) {
      if (tool === 'bash') {
        return { behavior: 'ask', message: '是否允许执行 shell 命令？' };
      }
      return { behavior: 'allow' };
    },
  },
});
```

### 规则引擎

```typescript
import { evaluateRules } from 'zero-agent-sdk';

const rules = [
  { tool: 'file-write', path: '/tmp/**', decision: 'allow' },
  { tool: 'file-write', path: '**', decision: 'deny' },
  { tool: 'bash', decision: 'ask' },
];
```

## 生命周期钩子

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  hooks: {
    preToolUse: async (event) => {
      console.log(`即将调用: ${event.toolName}`, event.input);
      // 返回 { abort: true, message: '...' } 可中止工具调用
    },
    postToolUse: async (event) => {
      console.log(`工具完成: ${event.toolName}`, event.result);
    },
    preQuery: async (event) => {
      // 在发送给模型前拦截/修改消息
    },
    postQuery: async (event) => {
      // 模型返回后处理
    },
    onTurnStart: async (event) => {
      console.log(`第 ${event.turn} 轮开始`);
    },
    onTurnEnd: async (event) => {
      console.log(`第 ${event.turn} 轮结束`);
    },
    onError: async (event) => {
      console.error('Agent 错误:', event.error);
    },
    onCompact: async (event) => {
      console.log('上下文已压缩');
    },
    timeout: { default: 30_000 },
  },
});
```

## 上下文压缩

当对话过长时自动压缩上下文，防止超出模型窗口：

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  contextWindow: 128_000,       // 模型上下文窗口大小
  compactThreshold: 0.8,        // 使用率达到 80% 时触发压缩
});
```

压缩策略按优先级执行：
1. **Micro-compact** — 移除旧消息中的媒体内容（图片、文档等）
2. **Full compact** — 使用 LLM 摘要历史对话
3. **Truncation** — 删除最旧的消息
4. **断路器** — 连续 3 次 LLM 压缩失败后自动降级

## 预算控制

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  maxTurns: 20,          // 最大轮次
  maxTokens: 100_000,    // 最大 Token 数
  maxBudgetUsd: 5.0,     // 最大费用（美元）
});

// 实时跟踪用量
const agent = await createAgentAsync({
  // ...
  onUsage: (event) => {
    console.log(`已用 ${event.usage.totalTokens} tokens`);
  },
});
```

## 模型降级

当主模型持续返回 529 (过载) 错误时，自动切换到备用模型：

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  fallbackModel: 'gpt-4o-mini',       // 备用模型
  maxConsecutive529s: 3,               // 连续 3 次 529 后切换（默认值）
});
```

## 结构化日志

通过 Logger 接口获取 SDK 内部关键决策的结构化日志：

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  logger: {
    debug: (msg, meta) => console.debug(msg, meta),
    info: (msg, meta) => console.info(msg, meta),
    warn: (msg, meta) => console.warn(msg, meta),
    error: (msg, meta) => console.error(msg, meta),
  },
});
```

日志覆盖：重试策略、压缩触发、权限检查、MCP 连接状态等。

## 指令文件加载

CLI 风格的 Agent 可开启兼容指令文件加载。默认优先扫描 `AGENTS.md`，同时兼容 `CLAUDE.md` 等文件：

```typescript
const agent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  loadInstructionFiles: true,  // 默认 false，防止服务端意外加载宿主文件
});
```

## Agent 委托

创建子 Agent 工具，实现多 Agent 编排：

```typescript
import { delegateTool } from 'zero-agent-sdk';

const researchAgent = delegateTool({
  name: 'researcher',
  description: '负责信息检索和分析的子 Agent',
  agentConfig: {
    provider: openai(),
    model: 'gpt-4o',
    tools: [webSearchTool, webFetchTool],
  },
});

const mainAgent = await createAgentAsync({
  provider: openai(),
  model: 'gpt-4o',
  tools: [...builtinTools(), researchAgent],
});
```

## 多模态生成

直接调用多模态能力（不通过 Agent 循环）：

```typescript
import { generateImage, generateSpeech, transcribe, embed } from 'zero-agent-sdk';

// 图像生成
const image = await generateImage({
  model: myImageModel,
  prompt: 'a sunset over mountains',
  size: '1024x1024',
});

// 语音合成
const speech = await generateSpeech({
  model: mySpeechModel,
  text: 'Hello, world!',
  voice: 'alloy',
});

// 音频转录
const transcript = await transcribe({
  model: myTranscriptionModel,
  audio: audioBuffer,
});

// 向量嵌入
const embedding = await embed({
  model: myEmbeddingModel,
  value: 'some text to embed',
});
```

## 检索工具

将任意检索器包装为 Agent 可用的工具：

```typescript
import { retrieverTool } from 'zero-agent-sdk';

const searchTool = retrieverTool({
  name: 'knowledge-search',
  description: '搜索知识库',
  retriever: myRetriever, // 实现 Retriever 接口
});
```

## 追踪

```typescript
import { createTracer } from 'zero-agent-sdk';

const tracer = createTracer({ outputPath: './trace.json' });

const agent = await createAgentAsync({
  // ...
  hooks: {
    onTurnStart: (e) => tracer.beginSpan('turn', { turn: e.turn }),
    onTurnEnd: (e) => tracer.endSpan('turn'),
  },
});
```

## 事件类型

| 事件 | 说明 |
|------|------|
| `text` | 模型生成的文本片段 |
| `thinking` | 模型的思考过程（需模型支持） |
| `tool_use_start` | 工具调用开始 |
| `tool_use_delta` | 工具参数的流式 JSON 片段（可选，视 provider 支持） |
| `tool_use_end` | 工具调用结束（含结果） |
| `turn_start` | 新一轮开始 |
| `turn_end` | 一轮结束 |
| `usage` | Token 用量更新 |
| `error` | 错误事件 |
| `permission_request` | 权限请求（需用户确认） |
| `compact` | 上下文压缩事件 |

### 流式工具参数 (`tool_use_delta`)

当模型生成较长的工具输入时（例如复杂 JSON、代码生成、结构化内容），SDK 会在 `tool_use_start` 与 `tool_use_end` 之间发出若干 `tool_use_delta` 事件，承载 provider 实际推送的 JSON 片段：

```typescript
interface ToolUseDeltaEvent {
  type: 'tool_use_delta';
  toolUseId: string;
  toolName: string;
  partialJson: string;      // 本次 chunk
  accumulatedJson: string;  // 迄今累计字符串（中途不保证是合法 JSON）
}
```

事件顺序保证：

```text
tool_use_start → tool_use_delta* → tool_use_end
```

`accumulatedJson` 在流完成前可能是不完整的 JSON 前缀；若需在完成前提取字段，请使用增量 JSON 解析器（如 `partial-json`、`jsonparse`）。

Provider 兼容性：

| Provider 系列 | 是否流式发送工具参数 | 说明 |
|---|---|---|
| Anthropic (Claude 原生) | ✅ | 原生 `input_json_delta`，逐 token 推送 |
| OpenAI / Azure / 兼容家族（DeepSeek, Moonshot, Qwen, Groq, xAI, TogetherAI 等） | ✅ | `tool_calls[].function.arguments` 逐 chunk 合流到同一路径 |
| Google Gemini / Vertex / Bedrock | ✅ | 内部规范化为 `input_json_delta` |
| 非合规 OpenAI 兼容端点 | ⚠️ | 可能一次性返回完整参数，退化为单个 delta 事件 |

## AgentResult

`agent.run()` 返回的结果结构：

```typescript
interface AgentResult {
  text: string;              // 最终文本输出
  content: ContentBlock[];   // 最终消息的内容块
  finalAssistantMessage: ProviderMessage;
  usage: Usage;              // 累计用量
  turns: number;             // 总轮次
  stopReason: string;        // 停止原因
  messages: ProviderMessage[]; // 完整消息历史
}
```

## 错误处理

SDK 提供结构化的错误类族：

| 错误类 | 场景 |
|--------|------|
| `AgentError` | 基类 |
| `ProviderError` | 模型服务错误 |
| `ToolExecutionError` | 工具执行失败 |
| `PermissionDeniedError` | 权限被拒绝 |
| `BudgetExceededError` | 超出预算限制 |
| `AbortError` | 操作被中止 |

```typescript
import { AgentError, BudgetExceededError } from 'zero-agent-sdk';

try {
  await agent.run('...');
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log('预算超限');
  } else if (err instanceof AgentError) {
    console.log('Agent 错误:', err.message);
  }
}
```

## 扩展思考

对于支持扩展思考的模型：

```typescript
const agent = await createAgentAsync({
  provider: anthropic(),
  model: 'claude-sonnet-4-20250514',
  thinkingConfig: {
    type: 'enabled',
    budgetTokens: 10_000,
  },
});
```

## 技术栈

- **运行时**: TypeScript 5.7+ / Node.js >= 18
- **构建**: tsup（ESM + CJS 双格式输出）
- **验证**: Zod（运行时 schema 校验）
- **测试**: Vitest
- **代码质量**: Biome (lint + format)
- **包管理**: pnpm

## 开发

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发模式（watch）
pnpm build          # 构建
pnpm lint           # Lint + 自动修复
pnpm format         # 格式化
pnpm typecheck      # 类型检查
pnpm test           # 运行测试
```

## License

MIT
