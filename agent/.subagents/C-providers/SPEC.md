# C-providers SPEC: 多供应商路由 + OpenAI 兼容适配器

## 目标
统一模型 Provider 接口，实现 OpenAI 兼容适配器 (用户仅填 baseURL + apiKey)，支持 DeepSeek/Agnes/Ollama/任意 OpenAI 兼容端点，含降级链、成本统计。

## 接口契约 (扩展 types.ts)
```ts
interface ModelProvider {
  id: string
  name: string
  listModels(): Promise<{id:string,name?:string}[]>
  streamChat(p: StreamParams): AsyncGenerator<ProviderChunk>
  // 新增
  estimateCost(promptTokens: number, completionTokens: number): number
  healthCheck(): Promise<boolean>
}
interface ProviderRegistry {
  get(id: string): ModelProvider | undefined
  list(): ModelProvider[]
  defaultId(): string
  register(provider: ModelProvider): void
  unregister(id: string): void
  // 新增
  setFallbackChain(chain: string[]): void
  getFallbackChain(): string[]
}
```

## 交付文件
```
agent/src/providers/
├── registry.ts              # ProviderRegistry (含 fallback 链)
├── openai-compat.ts         # OpenAICompatProvider (统一适配器)
├── deepseek.ts              # DeepSeekProvider (继承 OpenAICompat)
├── agnes.ts                 # AgnesProvider (继承 OpenAICompat)
├── ollama.ts                # OllamaProvider (本地 /api/chat + /api/tags)
├── cost.ts                  # 成本估算表 (USD/1k tokens)
├── fallback.ts              # 降级链执行器 (超时/错误自动切换)
└── index.ts                 # buildDefaultRegistry() 预置 3 供应商
```

## 预置配置 (用户可在设置面板增删)
```ts
// 默认注册 (需用户填 apiKey)
DeepSeekProvider   { baseURL: 'https://api.deepseek.com',   models: ['deepseek-chat','deepseek-reasoner'] }
AgnesProvider      { baseURL: 'https://apihub.agnes-ai.com', models: ['agnes-image-2.1-flash','agnes-video-v2.0'] }
OllamaProvider     { baseURL: 'http://127.0.0.1:11434',    models: [] } // 动态拉取 /api/tags
// 用户自定义 OpenAI 兼容
CustomProvider     { baseURL: '<user-input>', apiKey: '<user-input>', models: ['<user-input>'] }
```

## 验收标准
| 场景 | 预期 |
|------|------|
| DeepSeek 官方 | 流式对话正常，tool_calls 解析正确，reasoning_content 支持 |
| Agnes 图像/视频 | 非聊天模型，registry 标记 `capabilities: ['image','video']`，chat 报错友好 |
| Ollama 本地 | 自动发现 `/api/tags` 模型列表，流式正常，GPU 分层 (num_gpu) 可配 |
| 用户自定义 OpenAI 兼容 | 仅填 baseURL + apiKey + model 即可用，无需代码修改 |
| 降级链 | primary 超时/5xx/限流 -> 自动切 fallback，日志记录切换原因 |
| 成本统计 | 每次调用累计 prompt/completion tokens，按模型价格表估算 USD，导出 CSV |
| 模型切换 UI | EscapePanel "模型" 页：供应商下拉 + 模型下拉 + 参数 (温度/上下文) |

- `npx tsc --noEmit` 零错误
- 单测：mock fetch 验证请求体/响应解析/降级逻辑
- 集成测：真实调用 DeepSeek + Ollama (如本地有) 跑通

## 依赖
- 依赖 `agent/src/types.ts` (StreamParams, ProviderChunk)
- 无新增 npm 依赖 (原生 fetch)

## 非目标
- 不实现 Anthropic/Claude 原生适配 (可通过 OpenAI 兼容层转发)
- 不做模型微调/部署管理

## 交付时间
M1 第 2 周末前 (与 B-mcp 并行)