# Zero Agent SDK — Agents 协作指南

本文件为仓库内协作的 AI coding agents 提供统一参考。

## 项目定位

Zero Agent SDK 是一个 Provider 无关的 AI Agent 框架，核心是统一 Agent 抽象、工具调用、MCP 集成、权限控制和上下文管理。支持 39+ LLM Provider 和多模态（图像/视频/音频/嵌入）。

## 架构总览

```text
createAgent(config) → AgentImpl
  ├── agent.run(prompt)     → Promise<AgentResult>
  ├── agent.stream(prompt)  → AsyncGenerator<AgentEvent>
  └── agent.createSession() → AgentSession (多轮)

agentLoop() 核心循环:
  turnStartHook → buildSystemPrompt → provider.streamMessage()
  → 提取 tool_use → preToolUseHook → checkPermission → runTools()
  → postToolUseHook → usageEvent → budgetCheck → autoCompact → turnEndHook
  → 循环直到 end_turn / maxTurns
```

## 代码结构

```text
src/
├── core/           # Agent 工厂、会话、事件、错误、会话存储
│   ├── agent.ts    # createAgent(), Agent, AgentConfig
│   ├── session.ts  # AgentSession
│   ├── types.ts    # Usage, ContentBlock, ThinkingConfig, Logger
│   ├── events.ts   # AgentEvent (text/thinking/tool_use_*/turn_*/usage/error/...)
│   ├── errors.ts   # AgentError, ProviderError, ToolExecutionError, PermissionDeniedError, BudgetExceededError, AbortError
│   └── store.ts    # SessionStore, InMemorySessionStore, FileSessionStore
│
├── loop/           # 执行循环
│   ├── agent-impl.ts  # AgentImpl (run/stream/createSession 实现)
│   └── query.ts       # agentLoop() — 核心循环，处理工具/权限/钩子/压缩/重试
│
├── providers/      # 39 个 Provider (文本 + 多模态)
│   ├── types.ts           # ModelProvider, ProviderMessage, ProviderStreamEvent, ProviderContentBlock
│   ├── registry.ts        # ProviderRegistry
│   ├── multimodal.ts      # EmbeddingModel, ImageModel, SpeechModel, VideoModel, TranscriptionModel
│   ├── openai-compatible/ # 通用 OpenAI 兼容基类 (大多数 Provider 继承)
│   ├── anthropic/ openai/ deepseek/ google/ azure/ mistral/ alibaba/ xai/ groq/ ...
│   └── [多模态] black-forest-labs/ replicate/ elevenlabs/ deepgram/ bytedance/ ...
│
├── tools/          # 工具系统
│   ├── types.ts         # SDKTool 接口 (call/description/checkPermissions/isConcurrencySafe/isReadOnly)
│   ├── registry.ts      # ToolRegistry
│   ├── orchestration.ts # runTools(), partitionToolCalls() — 并发/串行分区执行
│   ├── multimodal.ts    # imageGenerationTool, speechGenerationTool, transcriptionTool
│   └── builtin/         # 21 个内置工具
│       ├── index.ts     # builtinTools(options) 工厂
│       ├── bash.ts file-read.ts file-write.ts file-edit.ts
│       ├── glob.ts grep.ts notebook-edit.ts
│       ├── web-search.ts web-fetch.ts ask-user.ts agent.ts
│       └── task-*.ts task-store.ts background-task.ts
│
├── mcp/            # MCP 集成 (stdio/sse/http/ws/in-process)
│   ├── types.ts         # MCPServerConfig, MCPConnection, MCPToolDefinition
│   ├── client.ts        # MCPClient
│   ├── tool-bridge.ts   # mcpToolsToSDKTools()
│   ├── normalization.ts # encodeMCPToolName/decodeMCPToolName (server__tool 格式)
│   ├── transports.ts    # @modelcontextprotocol/sdk 适配
│   └── native-transports.ts # SSE/WebSocket 原生传输
│
├── permissions/    # 权限系统
│   ├── types.ts           # PermissionMode (allowAll/denyAll/default/custom), PermissionHandler, PermissionDecision
│   ├── checker.ts         # checkToolPermission(), 内置处理器 (allowAllHandler/readOnlyHandler/defaultHandler)
│   ├── rules.ts           # 规则引擎 (evaluateRules/matchRule/parseRulePattern)
│   ├── path-validation.ts # validateFilePath/validateFilePathAsync
│   └── ssrf-guard.ts      # validateUrl() SSRF 防护
│
├── hooks/          # 生命周期钩子 (8 种)
│   ├── types.ts    # HookConfig, HookFn, PreToolUseEvent, PostToolUseEvent, ...
│   └── runner.ts   # runHookChain(), runPreToolUseHook(), runPostToolUseHook(), ...
│
├── context/        # 上下文管理
│   ├── compact.ts       # compactMessages(), autoCompactIfNeeded(), microCompact(), CompactCircuitState
│   ├── memory.ts        # loadMemoryFiles(), loadInstructionFiles()
│   ├── message-groups.ts # groupMessagesByApiRound()
│   └── system-prompt.ts # buildSystemPrompt()
│
├── agent-tool/delegate.ts  # delegateTool() — 子 Agent 编排
├── retrieval/types.ts      # Retriever 接口, retrieverTool()
├── tracing/tracer.ts       # Tracer (Chrome Trace Event)
├── generate.ts             # generateImage/Speech/Video, transcribe, embed/embedMany
├── utils/                  # abort, async-queue, messages, streaming, tokens
├── index.ts                # 主入口 (所有导出)
└── __tests__/              # 24+ 测试文件
```

## 开发重点

- **Provider 无关**: 核心层 (`core/`, `loop/`, `tools/`, `permissions/`, `hooks/`, `context/`) 不引入任何 Provider 专属逻辑
- **工具输入**: 必须用 Zod schema 校验
- **错误处理**: 使用 `AgentError` 及子类，不抛裸 `Error`
- **并发安全**: 工具通过 `isConcurrencySafe()` / `isReadOnly()` 标注，`partitionToolCalls()` 自动分区
- **测试**: 新增核心能力时补齐测试
- **导出**: 公开 API 变更后同步检查 `src/index.ts` 导出
- **构建**: ESM + CJS 双输出，Provider SDK 作为可选 peerDependencies
- **按需加载**: 每个 Provider 是独立入口，通过 `zero-agent-sdk/providers/*` 导入
- **ESM 加载**: Provider `getClient()` 使用 `await import()` 而非 `require()`，兼容纯 ESM 环境

## 常用命令

```bash
pnpm install          # 安装
pnpm dev              # 开发 (watch)
pnpm build            # 构建
pnpm lint             # biome check --write
pnpm format           # biome format --write
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:watch       # vitest
```

提交前：`pnpm lint && pnpm typecheck && pnpm test`

## 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 模块文件 | kebab-case | `agent-impl.ts` |
| 测试文件 | `[name].test.ts` | `permissions.test.ts` |
| 类名 / 接口 / 类型 | PascalCase | `MCPClient`, `AgentConfig` |
| 函数 / 变量 | camelCase | `createAgent`, `runTools` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| 错误类 | `*Error` 后缀 | `ProviderError` |
| Provider 工厂 | `create*Provider()` 或便捷函数 | `openai()` |

## 术语

| 术语 | 说明 |
|------|------|
| Agent | 自主执行任务的 AI 实体 (`createAgent()`) |
| AgentSession | 多轮会话状态 |
| AgentImpl | Agent 内部实现 (`loop/agent-impl.ts`) |
| agentLoop | 核心执行循环 (`loop/query.ts`) |
| ModelProvider | 模型服务抽象接口 |
| SDKTool | 统一工具接口 |
| ToolRegistry | 工具查找注册表 |
| MCPClient / MCPConnection | MCP 客户端和连接 |
| PermissionMode / PermissionHandler | 权限模式和处理器 |
| HookConfig / HookFn | 生命周期钩子 |
| ProviderMessage / ProviderContentBlock | Provider 无关的消息格式 |
| CompactCircuitState | 压缩断路器 (3 次失败后降级) |
| delegateTool | 子 Agent 委托 |
| retrieverTool | 检索器工具包装 |
| Logger | 结构化日志接口，通过 `AgentConfig.logger` 注入 |

## 重要设计约定

- **ESM 优先**: 所有 Provider 使用 `await import()` 动态加载 SDK，推荐使用 `createAgentAsync()` 工厂
- **安全默认值**: `loadInstructionFiles` 默认 `false`，防止服务端意外加载宿主文件内容
- **Span 生命周期**: Tracer span 必须在 try/finally 中配对 `beginSpan`/`endSpan`
- **模型降级**: 连续 529 过载后自动切换 `fallbackModel`（配置 `maxConsecutive529s`，默认 3）
- **SSRF 防护**: `validateUrl()` 覆盖 IPv4-mapped IPv6 地址绕过
- **工具结果不可变**: 工具结果截断使用 immutable spread 而非直接修改 block
