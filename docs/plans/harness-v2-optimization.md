# Kotonoha Harness 系统优化规划（v2，2026-08-23）

> 目标：把 harness 从「能用的 M1」升级到「对标 2026 主流开源 agent（Hermes/Goose/Aider/Claude Code）的生产级工具系统」。
> 视觉小说 UI 保持现有交互不变，harness 是引擎升级。

## 一、参考系调研摘要（2026-08）

| 项目 | 亮点 | Kotonoha 借鉴点 |
|------|------|----------------|
| **Hermes Agent**（NousResearch，106K stars） | 三层记忆（episodic/semantic/procedural）、自学习 Skill（完成任务→自动生成 SKILL.md→复用进化）、40+ 工具、provider fallback 链、SQLite 会话搜索 | 三层记忆与自学习 skill 正是「羁绊」卖点的工程化形态 |
| **Goose**（Block → Linux Foundation） | **MCP-native**：一切能力都是 MCP server，工具集成是唯一扩展机制 | 工具层统一走 MCP 协议，内置工具也做成 MCP server → 一套接口管全部 |
| **Aider** | **git 即 undo**（不用自定义状态回滚）、Architect/Editor 规划与执行分离、repo map | 工具执行前 git checkpoint、失败自动回滚 |
| **Claude Code** | Hooks 系统（pre/post-tool 强制门禁）、并行工具调用、worktrees | 工具前后钩子、只读类工具并行 |
| **OpenCode** | provider 无关（75+ 供应商）、build/plan 双 agent（plan 只读） | 只读探查 agent 模式、opencode.md 项目上下文 |

**2026 harness 共识四要素**：agent loop + tool interface + context management + control mechanisms。

## 二、Kotonoha Harness 现状盘点

| 子系统 | 现状 | 差距 |
|--------|------|------|
| agent loop | TurnRunner 多轮工具循环 + thinking 支持 ✓ | 无并行工具调用；无中断/恢复 |
| tools | 14 个内置工具（fs/term/git/web/skill）+ ToolRegistry | **无 MCP-native 统一**；无 checkpoint/undo；无 hooks；无子 agent 编排 |
| mcp | stdio+SSE 客户端 v1 | 无资源/提示词；无 MCP server 模式（不能暴露自己） |
| providers | DeepSeek/Ollama/Agnes + fallback 链（配置了未全接线） | 无成本统计落库；无健康切换 |
| auth | 三档权限 + 审批 + rules | 无 hooks 门禁；无会话级记忆规则 |
| memory | KOTONOHA.md 规则 + 羁绊雏形 + 上下文构建 | **缺 semantic 层**（知识图谱/偏好库）；无自学习 skill 沉淀 |
| store | SQLite 会话 + 导出/压缩/归档 | 无全文搜索；无轨迹（trajectory）审计 |
| api | RPC + WS（dsh 兼容）✓ | 稳定，保持不动 |

## 三、优化后的 Harness 架构

```
agent/
├── core/            # 引擎
│   ├── engine.ts        # 会话引擎（现有，加中断/恢复、并行工具调度）
│   ├── agent.ts         # TurnRunner → AgentLoop（支持 abort、并行读工具）
│   └── context.ts       # 上下文构建（接入三层记忆）
├── tools/           # ★ 工具层重构（本轮重点）
│   ├── protocol.ts      # 统一工具协议：所有工具（内置/MCP/子agent）同一接口
│   ├── registry.ts      # ToolRegistry：register/list/get + 分组 + 依赖注入
│   ├── checkpoint.ts    # Git checkpoint：工具执行前自动 commit（git 即 undo）
│   ├── hooks.ts         # 工具钩子：before/after（审计、门禁、副作用清理）
│   ├── builtin/         # 内置工具（fs/grep/glob/bash/git/web/skill）
│   └── mcp-bridge.ts    # MCP 工具适配进统一协议（Goose 模式）
├── mcp/
│   ├── client.ts        # 现有 stdio+SSE 客户端（增强 resources/prompts）
│   └── server.ts        # ★ 新增：Kotonoha 自身作为 MCP server 暴露（hermes mcp serve 模式）
├── memory/          # ★ 三层记忆（Hermes 模式）
│   ├── episodic.ts      # 会话事件流（现有 SQLite events）
│   ├── semantic.ts      # ★ 新增：知识/偏好库（实体-关系，SQLite 表 + 检索注入）
│   └── procedural.ts    # ★ 技能沉淀：完成任务→自动生成 SKILL.md→execute_skill 复用
├── skills/          # 自学习技能（procedural 的载体）
│   ├── store.ts         # SKILL.md 存储/版本/进化
│   └── autoskill.ts     # 任务完成后自动提炼技能（触发词/步骤/验收）
├── auth/
│   ├── permission.ts    # 三档权限（现有）
│   └── hooks-gate.ts    # hooks 与权限联动（before-hook 可拦截）
├── providers/
│   ├── registry.ts      # 现有 + 健康检查调度
│   └── cost.ts          # ★ 成本统计落库（settings 表 + 会话级汇总）
└── store/
    ├── db.ts            # 现有（加 semantic 表、cost 表、trajectory 表）
    └── search.ts        # ★ 会话全文搜索（FTS5）
```

## 四、里程碑更新

### M2 🎯 工具层重构（本轮，对标 Goose/Hermes/Aider）
| 任务 | 产出 | 验收 |
|------|------|------|
| 2.1 统一工具协议 + 注册表重构 | protocol.ts/registry.ts | 内置/MCP/子agent 三类工具同一接口注册 |
| 2.2 Git checkpoint + undo | checkpoint.ts | 工具执行前自动 commit；undo 恢复工作区 |
| 2.3 工具 hooks | hooks.ts | before/after 钩子可审计+拦截 |
| 2.4 并行只读工具 | agent loop 调度 | 同轮多个 read/grep 并行执行 |
| 2.5 MCP server 模式 | mcp/server.ts | `agent mcp serve` 暴露 Kotonoha 工具给其它 agent |
| 2.6 子 agent 编排工具 | tools/task 增强 | task 工具真实派发子 agent 并回收结果 |

### M3 🎯 三层记忆 + 自学习技能（对标 Hermes）
| 任务 | 产出 |
|------|------|
| 3.1 semantic 记忆库 | 实体-关系表 + 对话自动提取 + 检索注入 |
| 3.2 自学习技能沉淀 | 完成任务 → 自动生成 SKILL.md → execute_skill 复用 |
| 3.3 会话全文搜索 | SQLite FTS5 + session.search RPC |
| 3.4 轨迹审计 | trajectory 表记录每次工具调用（审计/回放） |

### M4 🎯 成本与可靠性
| 任务 | 产出 |
|------|------|
| 4.1 成本统计落库 | 每会话/每模型 token+费用，导出 CSV |
| 4.2 provider 健康切换 | 失败自动降级（fallback 链真正接线） |
| 4.3 中断/恢复 | turn 可 abort（前端「停止」按钮），状态可恢复 |

### M5 保持原规划：Electron 增强 + CLI + 视觉小说深化

## 五、执行顺序（子 agent 分派）

| 批次 | 子 agent | 任务 | 依赖 |
|------|----------|------|------|
| ① 并行 | A-tools2（协议+注册表重构） | 2.1+2.2+2.3 | 无 |
| ① 并行 | B-mcp2（server 模式+资源支持） | 2.5 | 无 |
| ① 并行 | C-memory2（三层记忆） | 3.1+3.2 | 无 |
| ② 串行 | D-loop（并行工具+中断） | 2.4+4.3 | A-tools2 |
| ② 串行 | E-ops（成本+hooks门禁+搜索+审计） | 2.3联动/4.1/3.3/3.4 | A-tools2+C-memory2 |
| ③ 集成 | 主 agent | 全链路验收 + 前端 ESC 面板联动 | 全部 |

## 六、验收标准

1. `npx tsc --noEmit` 零错误 + verify-all 全 PASS
2. 三类工具（内置/MCP/子agent）可在同一 registry 注册并在真实对话中调用
3. 工具执行前自动 git checkpoint，undo 后工作区恢复
4. 完成任务后 skill 自动沉淀，下次同任务命中复用（可演示）
5. semantic 记忆跨会话可检索（问「我之前说过什么偏好」能答上）
6. Kotonoha 可作为 MCP server 被其它 agent 连接（hermes/opencode 测试连接成功）

## 七、风险

| 风险 | 对策 |
|------|------|
| MCP server 模式协议细节多 | 用官方 @modelcontextprotocol/sdk 的 server 模块 |
| 自学习 skill 质量差（垃圾技能污染） | 阈值门控：任务复杂度+用户确认才沉淀 |
| git checkpoint 在无 git 目录失效 | 检测非 git 目录降级为快照模式 |
| 并行工具与审批流冲突 | 只读工具才并行；写工具保持串行+审批 |
