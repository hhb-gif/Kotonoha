# Kotonoha Master Plan — 完整 Agent 产品规划

> **核心定位**：Kotonoha = Harness (核心引擎) + Visual Novel UI (前端交互)
> **对标**：opencode / Claude Code —— 可分发、可扩展、模型无关的桌面级 Agent
> **差异化卖点**：视觉小说式交互（存档/羁绊/场景/立绘）+ 硬核 Agent 能力（工具/审批/记忆/MCP）

---

## 1. 架构总览

```
Kotonoha/
├── agent/                    # Harness 核心 (Node/TS, 单进程)
│   ├── api/                  # RPC + EventStream (协议兼容 dsh)
│   ├── core/                 # TurnRunner, Engine, ContextBuilder
│   ├── providers/            # 模型路由 (DeepSeek/Agnes/Ollama/OpenAI-compat)
│   ├── tools/                # 工具注册表 + 执行器 (fs/term/git/search/skill/MCP)
│   ├── mcp/                  # MCP 客户端 (stdio/SSE)
│   ├── auth/                 # 权限三档 + 规则引擎 + 审批队列
│   ├── memory/               # 规则/记忆注入、@mention、上下文压缩
│   ├── store/                # SQLite 持久化 + 加密凭据 + 导出/归档
│   └── cli/                  # CLI 入口 (复用 harness)
├── electron/                 # 桌面壳 (内嵌 agent, 单 exe 分发)
│   ├── main.cjs              # 启动 agent, BrowserWindow, IPC
│   └── preload.cjs           # 安全桥接
└── src/                      # React UI (视觉小说交互)
    ├── components/           # DialogBox, CharacterSprite, EscapePanel...
    ├── bridge/               # 协议桥接 (零改动复用 dsh 协议)
    └── hooks/                # 状态/快捷键/流式渲染
```

**关键设计原则**：
- **协议层照抄 dsh** → 前端现有交互（存档/技能/审批/打字机）零改动生效
- **Harness 单进程** → Electron 内嵌 `require('./agent/dist')`，无 IPC 开销
- **模型无关** → ProviderRegistry 统一接口，动态注册/降级
- **可扩展优先** → ToolRegistry/MCPClient/RuleEngine 采用插件化设计
- **零外部依赖** → **完全自建 harness，不再依赖 dsh**；模型提供商全走 OpenAI 兼容适配器，用户仅需填 baseURL + apiKey

---

## 2. 里程碑与交付物

### M0 ✅ 协议兼容引擎 (已完成)
- [x] 会话 CRUD + fork/rename
- [x] 流式对话 (text-delta → finish{stop})
- [x] SQLite 持久化 + WAL + 加密凭据
- [x] Provider: DeepSeek + Agnes (OpenAI-compat)
- [x] 9 工具 + 三档权限 + 审批队列
- [x] 协议兼容 dsh → 前端零改动回归通过

### M1 🎯 工具生态 + 审批前端联动 (当前主线)
| 任务 | 产出 | 验收 |
|------|------|------|
| 1.1 ToolRegistry 插件化 + schema 校验 | `agent/src/tools/registry.ts` 重构 | 任意工具热插拔 |
| 1.2 7 核心工具实现 | read/edit/write/glob/grep/task/bash/patch | 单测 + 集成测全过 |
| 1.3 Git 工具增强 | checkout/branch/diff/log/status/commit/push | 真实仓库操作可用 |
| 1.4 Search/Web 工具 | ripgrep + DDG/Google/SerpAPI 可选 | 并发搜索 < 2s |
| 1.5 MCP 客户端 v1 | stdio transport + tool 映射 | 能连接 filesystem/github mcp |
| 1.6 前端技能页签联动 | EscapePanel "技能" 页读取 tools.list | 勾选即生效 |
| 1.7 审批 Toast 完善 | approval/requested → allow-once/deny/always | 无阻塞、可撤销 |

### M2 🎯 多供应商路由 + 成本控制
| 任务 | 产出 |
|------|------|
| 2.1 ProviderRegistry 统一接口 | `get/chat/stream/listModels/costEstimate` |
| 2.2 **OpenAI 兼容统一适配器** | 任意 OpenAI 兼容端点 (baseURL + apiKey)，用户自填 |
| 2.3 Ollama 本地模型支持 | 自动发现 /api/tags、GPU 分层 |
| 2.4 降级链配置 | primary → fallback → local，含超时/重试 |
| 2.5 成本/Token 统计 | 每会话/每模型/每日汇总，导出 CSV |
| 2.6 模型切换 UI | EscapePanel "模型" 页：供应商/模型/参数 |

### M3 🎯 会话管理 + Git + MCP 深度
| 任务 | 产出 |
|------|------|
| 3.1 会话导出/归档/压缩 | export JSON/Markdown、上下文压缩 (summarize) |
| 3.2 Git checkpoint/undo | 自动提交 + `git undo` 恢复工具调用前状态 |
| 3.3 MCP 客户端 v2 | SSE transport、动态工具发现、资源/提示词支持 |
| 3.4 会话侧边栏 UI | 左侧栏：搜索/筛选/拖拽排序/批量操作 |

### M4 🎯 记忆系统 + 规则引擎 + CLI
| 任务 | 产出 |
|------|------|
| 4.1 规则文件 (KOTONOHA.md) | 项目级/用户级/会话级，自动注入上下文 |
| 4.2 @mention 文件注入 | `@file.ts` → 读取内容注入 messages |
| 4.3 羁绊记忆自动沉淀 | 关键决策/偏好 → 规则文件自动追加 |
| 4.4 CLI 形态 | `kotonoha` 命令行：chat/repl/pipe/daemon |
| 4.5 / 命令体系 | harness 层实现，前端/CLI 共用 |

### M5 🎯 Electron 分发 + 生产就绪
| 任务 | 产出 |
|------|------|
| 5.1 Electron 内嵌 agent | main.cjs 启动 harness、随机端口、优雅关闭 |
| 5.2 单 exe 打包 | electron-builder + NSIS/NSIS-Web、自动更新 |
| 5.3 原生菜单/托盘/快捷键 | 全局唤醒、截图上下文、拖拽文件 |
| 5.4 安全加固 | contextIsolation、CSP、预加载脚本最小权限 |

### M6 🎯 视觉小说体验深化
| 任务 | 产出 |
|------|------|
| 6.1 场景/立绘/演出系统 | 背景切换、表情差分、Live2D/Spine 支持 |
| 6.2 存档可视化 | 时间线视图、分支对比、关键节点标记 |
| 6.3 羁绊面板 | 角色好感度、专属剧情、语音/TTS |
| 6.4 多语言/i18n | 中/英/日，运行时切换 |

---

## 3. 子 Agent 分派策略

> **原则**：每个子 agent 单一职责、独立验收、产出可复用模块

| 子 Agent | 职责域 | 入口文件 | 验收方式 |
|----------|--------|----------|----------|
| **A-tools** | 工具注册表 + 7 核心工具 | `agent/src/tools/` | 单测 100% + 集成测 |
| **B-mcp** | MCP 客户端 (stdio/SSE) | `agent/src/mcp/` | 能连 3 个标准 MCP server |
| **C-providers** | 多供应商路由 + 成本 | `agent/src/providers/` | 4 供应商无缝切换 |
| **D-auth** | 权限引擎 + 审批队列 | `agent/src/auth/` | 18/18 冒烟 + 压测 |
| **E-memory** | 规则/记忆/上下文构建 | `agent/src/memory/` | 规则注入/羁绊生成 |
| **F-session** | 会话持久化/导出/压缩 | `agent/src/store/` | 导出/导入往返无损 |
| **G-electron** | 桌面壳 + 打包 | `electron/` | 单 exe < 100MB、冷启动 < 3s |
| **H-ui** | 前端联动 (技能/审批/侧边栏) | `src/` | 视觉回归 + 交互测试 |
| **I-cli** | CLI 入口 + /命令 | `agent/src/cli/` | `kotonoha --help` 可用 |

**派发顺序**：
1. **并行启动**：A-tools, B-mcp, C-providers, D-auth, E-memory, F-session (M1-M4 基础设施)
2. **串行依赖**：G-electron 依赖 A-F 稳定；H-ui 依赖 A,B,D 接口定稿；I-cli 依赖 A-F
3. **每周同步**：周一规划、周三中检、周五验收合并

---

## 4. 验收标准与回归机制

### 自动化回归 (CI)
```yaml
# .github/workflows/ci.yml
- lint: eslint + tsc --noEmit
- unit: vitest (agent/* 覆盖率 ≥ 80%)
- integration: 
    - session CRUD + 流式对话
    - 工具调用 + 审批流
    - 多供应商切换
- e2e: playwright (主流程 5 分钟)
```

### 手动验收清单 (每里程碑)
| 维度 | M1 | M2 | M3 | M4 | M5 |
|------|----|----|----|----|----|
| 对话流式 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 工具调用 | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 |
| 审批流 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 模型切换 | - | ✅ | ✅ | ✅ | ✅ |
| 会话管理 | 基础 | 基础 | 完整 | 完整 | 完整 |
| MCP | v1 | v1 | v2 | v2 | v2 |
| 记忆/规则 | - | - | - | ✅ | ✅ |
| CLI | - | - | - | ✅ | ✅ |
| 桌面分发 | - | - | - | - | ✅ |

---

## 5. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| MCP 协议变更 | 中 | 高 | 版本锁定 + 适配器模式 |
| 模型 API 限流/变价 | 高 | 中 | 降级链 + 本地模型兜底 |
| Electron 打包体积 | 中 | 低 | 动态导入、移除无用模块 |
| 前端状态同步复杂 | 高 | 高 | 单向数据流 + 事件溯源 |
| 视觉小说资源体积 | 低 | 中 | CDN 按需加载、压缩 |

---

## 6. 资源估算

| 角色 | 人周 (M1-M4) | 备注 |
|------|--------------|------|
| 核心开发 (Harness) | 8 | 可并行 3-4 子 agent |
| 前端联动 | 4 | 依赖后端接口稳定 |
| Electron/打包 | 2 | 独立可并行 |
| 测试/文档 | 3 | 持续贯穿 |
| **总计** | **~17 人周** | 约 1.5-2 月 |

---

## 6. 下一步行动 (本周)

1. **创建子 agent 工作目录** `agent/.subagents/{A,B,C,D,E,F}/`
2. **写入各子 agent SPEC** (接口定义、验收用例、依赖声明)
3. **启动并行开发** A-tools + B-mcp + C-providers + D-auth + E-memory + F-session
4. **建立周会节奏** + 共享看板 (GitHub Projects)

---

> **决策点**：是否先推 **Electron 集成 (G-electron)** 并行？  
> 建议：M1 后端接口稳定后再接入 (约 1 周后)，避免频繁重打包干扰核心开发。