# Zero Agent SDK

本文件为通用 coding agents 提供项目开发参考。

## 项目概述

**Zero Agent SDK** 是一个 Provider 无关的 AI Agent 框架，提供统一的 Agent 抽象层，让应用可以组合模型、工具、MCP 服务和权限控制来完成自主任务。

## 技术栈

- **运行时**: TypeScript 5.7+ / Node.js >= 18
- **构建**: tsup（ESM + CJS 双格式输出）
- **验证**: Zod ^4.0
- **测试**: Vitest ^2.1
- **代码质量**: Biome
- **包管理**: pnpm

## 源码结构

```text
src/
├── core/                # Agent 工厂、会话、事件、错误
│   ├── agent.ts         # createAgent() 工厂 + Agent/AgentConfig 类型
│   ├── session.ts       # AgentSession 接口
│   ├── types.ts         # Usage, ContentBlock, ThinkingConfig, Logger
│   ├── events.ts        # AgentEvent 类型体系
│   ├── errors.ts        # AgentError 及子类
│   └── store.ts         # SessionStore, InMemorySessionStore, FileSessionStore
│
├── loop/                # Agent 执行循环
│   ├── agent-impl.ts    # AgentImpl 实现类 (run/stream/createSession)
│   └── query.ts         # agentLoop() 核心循环
│
├── providers/           # Provider 适配层 (39 个)
│   ├── types.ts         # ModelProvider, ProviderMessage, ProviderStreamEvent
│   ├── registry.ts      # ProviderRegistry (provider:model 解析)
│   ├── multimodal.ts    # EmbeddingModel, ImageModel, SpeechModel 等
│   ├── anthropic/       # Claude
│   ├── openai/          # OpenAI (含 embedding)
│   ├── openai-compatible/ # 通用 OpenAI 兼容基类
│   ├── deepseek/        # DeepSeek
│   ├── google/          # Gemini
│   ├── google-vertex/   # Vertex AI
│   ├── azure/           # Azure OpenAI
│   ├── mistral/ alibaba/ xai/ groq/ togetherai/ ...
│   ├── black-forest-labs/ replicate/ luma/ fal/ prodia/  # 图像
│   ├── bytedance/ klingai/                                # 视频
│   └── elevenlabs/ deepgram/ assemblyai/ revai/ ...       # 音频
│
├── tools/               # 工具系统
│   ├── types.ts         # SDKTool, ToolExecutionContext, PermissionCheckResult
│   ├── registry.ts      # ToolRegistry
│   ├── orchestration.ts # runTools(), partitionToolCalls()
│   ├── multimodal.ts    # imageGenerationTool, speechGenerationTool 等
│   └── builtin/         # 21 个内置工具
│       ├── index.ts     # builtinTools() 工厂
│       ├── bash.ts      # Shell 执行
│       ├── file-read/write/edit.ts
│       ├── glob.ts grep.ts notebook-edit.ts
│       ├── web-search.ts web-fetch.ts
│       ├── ask-user.ts agent.ts
│       ├── task-create/get/list/update/stop/output.ts
│       └── task-store.ts background-task.ts
│
├── mcp/                 # MCP 集成
│   ├── types.ts         # MCPServerConfig, MCPConnection, MCPToolDefinition
│   ├── client.ts        # MCPClient (connect/getTools/callTool/close)
│   ├── tool-bridge.ts   # mcpToolsToSDKTools()
│   ├── normalization.ts # encodeMCPToolName/decodeMCPToolName
│   ├── transports.ts    # @modelcontextprotocol/sdk 适配
│   ├── native-transports.ts # SSE/WebSocket 传输
│   └── schema-utils.ts  # Zod schema 工具
│
├── permissions/         # 权限系统
│   ├── types.ts         # PermissionMode, PermissionHandler, PermissionDecision
│   ├── checker.ts       # checkToolPermission(), getHandlerForMode()
│   ├── rules.ts         # evaluateRules(), matchRule(), parseRulePattern()
│   ├── path-validation.ts # validateFilePath()
│   └── ssrf-guard.ts    # validateUrl() SSRF 防护
│
├── hooks/               # 生命周期钩子
│   ├── types.ts         # HookConfig, HookFn, 各 HookEvent
│   └── runner.ts        # runHookChain(), runPreToolUseHook() 等
│
├── context/             # 上下文管理
│   ├── compact.ts       # compactMessages(), autoCompactIfNeeded(), microCompact()
│   ├── memory.ts        # loadMemoryFiles(), loadInstructionFiles()
│   ├── message-groups.ts # groupMessagesByApiRound()
│   └── system-prompt.ts # buildSystemPrompt()
│
├── agent-tool/          # Agent 委托
│   └── delegate.ts      # delegateTool()
│
├── retrieval/           # 检索抽象
│   └── types.ts         # Retriever 接口, retrieverTool()
│
├── tracing/             # 追踪
│   └── tracer.ts        # Tracer (Chrome Trace Event 格式)
│
├── utils/               # 通用工具
│   ├── abort.ts         # createLinkedAbortController(), throwIfAborted()
│   ├── async-queue.ts   # AsyncQueue
│   ├── messages.ts      # createUserMessage(), extractText(), normalizeMessageOrder()
│   ├── streaming.ts     # merge() 流合并
│   └── tokens.ts        # estimateTokenCount(), addUsage()
│
├── generate.ts          # 多模态直调 (generateImage, generateSpeech, transcribe, embed)
├── index.ts             # 主入口 (所有导出)
└── __tests__/           # 24+ 测试文件
```

## 执行模型

```text
createAgent(config)
  → AgentImpl
    → agent.run(prompt) / agent.stream(prompt)
      → agentLoop(loopConfig)
        1. runTurnStartHook()
        2. buildSystemPrompt() (base + tools + appendSystemPrompt)
        3. provider.streamMessage() → 流式 TextEvent / ThinkingEvent
        4. 提取 tool_use 块
        5. runPreToolUseHook() → checkToolPermission() → runTools()
           └─ partitionToolCalls(): 并发安全工具并行，其余串行
        6. runPostToolUseHook()
        7. emit UsageEvent
        8. 检查预算 (token / cost / turns)
        9. autoCompactIfNeeded()
           └─ microCompact → fullCompact → truncation (断路器保护)
       10. runTurnEndHook()
       11. 循环直到 end_turn 或 maxTurns
```

自动重试: 429/5xx/overloaded 最多重试 3 次 (指数退避)。连续 529 错误达到 `maxConsecutive529s` (默认 3) 后自动切换 `fallbackModel`。

## 核心接口速查

### Agent

```typescript
interface Agent {
  run(prompt: string, options?: RunOptions): Promise<AgentResult>
  stream(prompt: string, options?: RunOptions): AsyncGenerator<AgentEvent>
  createSession(options?): AgentSession | Promise<AgentSession>
  abort(): void
  close(): Promise<void>
}
```

### AgentConfig 关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | `ModelProvider` | 必选，模型服务 |
| `model` | `string` | 必选，模型 ID |
| `tools` | `SDKTool[]` | 可选，工具列表 |
| `mcpServers` | `MCPServerConfig[]` | 可选，MCP 服务 |
| `systemPrompt` | `string` | 可选，系统提示 |
| `appendSystemPrompt` | `string` | 可选，追加系统提示 |
| `maxTurns` | `number` | 可选，最大轮次 |
| `maxBudgetUsd` | `number` | 可选，费用上限 |
| `maxTokens` | `number` | 可选，Token 上限 |
| `permissionMode` | `PermissionMode` | 可选，权限模式 |
| `permissionHandler` | `PermissionHandler` | 可选，自定义权限 |
| `hooks` | `HookConfig` | 可选，生命周期钩子 |
| `contextWindow` | `number` | 可选，启用自动压缩 |
| `compactThreshold` | `number` | 可选，压缩阈值 (默认 0.8) |
| `thinkingConfig` | `ThinkingConfig` | 可选，扩展思考 |
| `temperature` | `number` | 可选 |
| `sessionStore` | `SessionStore` | 可选，会话存储 |
| `memoryDir` | `string` | 可选，内存文件目录 |
| `cwd` | `string` | 可选，工作目录 |
| `onEvent` | `(event: AgentEvent) => void` | 可选，事件回调 |
| `onUsage` | `(event: UsageCallbackEvent) => void` | 可选，用量回调 |
| `loadInstructionFiles` | `boolean` | 可选，加载指令文件（默认 false） |
| `fallbackModel` | `string` | 可选，529 过载时备用模型 |
| `maxConsecutive529s` | `number` | 可选，切换备用模型前的连续 529 次数（默认 3） |
| `logger` | `Logger` | 可选，结构化日志接口 |

### SDKTool 接口核心方法

| 方法 | 说明 |
|------|------|
| `call(args, context, onProgress?)` | 执行工具 |
| `description()` | 返回工具描述 |
| `prompt()` | 返回工具提示词 |
| `checkPermissions(input, context)` | 权限检查 |
| `isConcurrencySafe(input)` | 是否可并发 |
| `isReadOnly(input)` | 是否只读 |

### ModelProvider 接口

```typescript
interface ModelProvider {
  readonly providerId: string
  streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent>
  generateMessage(params: GenerateMessageParams): Promise<ProviderResponse>
  getModelInfo(modelId: string): ModelInfo
}
```

### AgentEvent 类型

`text` | `thinking` | `tool_use_start` | `tool_use_end` | `turn_start` | `turn_end` | `usage` | `error` | `permission_request` | `compact`

### 错误类族

`AgentError` → `ProviderError` | `ToolExecutionError` | `PermissionDeniedError` | `BudgetExceededError` | `AbortError`

### 权限模式

`'allowAll'` | `'denyAll'` | `'default'` (只读允许，破坏性拒绝，其余询问) | `'custom'`

### 钩子事件

`preToolUse` | `postToolUse` | `preQuery` | `postQuery` | `onError` | `onTurnStart` | `onTurnEnd` | `onCompact`

## 包导出结构

```text
zero-agent-sdk              # 主入口 (createAgent, 类型, 错误, 事件, 会话, 压缩, 权限, 钩子, 追踪, 多模态生成)
zero-agent-sdk/providers/*  # 各 Provider 单独入口 (按需加载)
zero-agent-sdk/tools        # builtinTools() + 工具工厂
zero-agent-sdk/mcp          # MCPClient + 工具桥接
```

## 开发命令

```bash
pnpm install          # 安装依赖
pnpm dev              # tsup --watch
pnpm build            # 构建
pnpm lint             # biome check --write
pnpm format           # biome format --write
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:watch       # vitest
```

提交前：

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## 开发规范

1. 代码、注释、变量名使用英文；文档使用中文。
2. 工具输入通过 Zod schema 校验。
3. 使用 `AgentError` 及其子类表达已知错误场景，不抛裸 `Error`。
4. 保持核心循环与 Provider 解耦，不在通用层引入 Provider 专属逻辑。
5. 新增核心功能时补充测试。
6. 并发安全工具通过 `isConcurrencySafe()` 标注。
7. 公开 API 变更后同步检查 `src/index.ts` 导出和类型声明。
8. 运行时依赖尽量精简；Provider SDK 作为 peerDependencies。
9. 构建结果必须同时覆盖 ESM 和 CJS。

## 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 模块文件 | kebab-case | `agent-impl.ts` |
| 测试文件 | `[name].test.ts` | `permissions.test.ts` |
| 类名 | PascalCase | `MCPClient` |
| 接口/类型 | PascalCase | `AgentConfig` |
| 函数/变量 | camelCase | `createAgent` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| 错误类 | `*Error` 后缀 | `ProviderError` |
| Provider 工厂 | `create*Provider()` 或便捷函数 | `createOpenAIProvider()` / `openai()` |
| 内置工具 | kebab-case name | `file-read` |

## 领域术语

| 术语 | 说明 |
|------|------|
| Agent | 自主执行任务的 AI 实体，通过 `createAgent()` 创建 |
| AgentSession | 多轮会话状态，保持消息历史和用量 |
| AgentImpl | Agent 的内部实现类 (`src/loop/agent-impl.ts`) |
| agentLoop | 核心执行循环 (`src/loop/query.ts`) |
| Provider / ModelProvider | 模型服务抽象，统一流式/非流式接口 |
| SDKTool | 统一工具接口，包含权限检查和并发标记 |
| ToolRegistry | 工具查找注册表 |
| MCPClient | MCP 协议客户端 |
| MCPConnection | 单个 MCP 服务器连接 |
| Hook / HookConfig | 生命周期钩子配置 |
| PermissionMode | 权限模式 (allowAll/denyAll/default/custom) |
| PermissionHandler | 自定义权限处理器 |
| ContentBlock / ProviderContentBlock | 消息内容块 (文本/工具调用/工具结果/思考/图片/文档) |
| CompactCircuitState | 压缩断路器状态 |
| delegateTool | 子 Agent 委托工具 |
| retrieverTool | 检索器包装工具 |
| Logger | 结构化日志接口 (`debug`/`info`/`warn`/`error`)，通过 `AgentConfig.logger` 注入 |

## 关键设计决策

1. **Provider 无关**: 核心循环 (`agentLoop`) 只依赖 `ModelProvider` 接口，不引入任何 Provider 专属逻辑。
2. **按需加载**: 每个 Provider 是独立入口点，通过子路径导入 (`zero-agent-sdk/providers/openai`)，避免加载不需要的 SDK。
3. **工具分区执行**: `partitionToolCalls()` 将工具调用分为并发安全组和串行组，最大化执行效率。
4. **三级压缩**: micro-compact (移除媒体) → full compact (LLM 摘要) → truncation (删除旧消息)，配合断路器防止连续失败。
5. **统一消息格式**: `ProviderMessage` / `ProviderContentBlock` 是 Provider 无关的内部消息表示，各 Provider 负责转换。
6. **ESM 优先**: 所有 Provider 使用 `await import()` 动态加载 SDK，同时兼容 CJS。推荐使用 `createAgentAsync()` 工厂函数。
7. **安全默认值**: `loadInstructionFiles` 默认 `false`，防止服务端/多租户场景意外加载宿主文件系统内容。
8. **Span 生命周期**: Tracer span 必须在 try/finally 中配对 `beginSpan`/`endSpan`，防止异常路径泄漏。
9. **SSRF 防护**: `validateUrl()` 覆盖 IPv4-mapped IPv6 地址（`::ffff:127.0.0.1`）绕过检测。
