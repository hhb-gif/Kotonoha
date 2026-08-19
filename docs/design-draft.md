# Kotonoha 设计草案

> 本文件记录项目构思阶段的完整决策过程，作为后续开发的依据。

## 一、用户需求

1. 用 Galgame/视觉小说风格界面使用 AI Coding Agent
2. 内核使用 DeepSeek Harness（dsh）
3. 选定了「路径 D」：自写前端壳 + dsh 内核（绕开 dsh 自带 Web UI）

## 二、方案对比（已调研）

### 路径 A：CSS 皮肤注入（最轻）
- 不改组件，只注入 CSS 覆盖外观
- 只能「化妆」，改不动布局骨架
- 局限：顶部栏/侧栏布局无法重构成 Galgame 演出

### 路径 B：dsh 前端插件（官方路径）
- 注册 `ConversationNodeDefinition` + keyed renderer
- 把对话流渲染成自定义组件
- 需要写 React 代码 + 打包成插件
- 局限：受限于现有页面结构

### 路径 C：改前端源码重建（最彻底）
- clone deepseek-harness，改 `packages/web-frontend`，自行 build
- 完全自定义，但需维护 fork，升级需合并
- 代价高

### 路径 D：外包壳（已选 ✅）
- 不用 dsh 自带 UI，自己写独立 Galgame 前端
- 通过 dsh 的 **ACP / JSON-RPC / WebSocket** 驱动内核
- 自由度 100%，是 dsh「换 UI 不动内核」设计理念的正统用法
- 代价：前端从零搭，但聊天协议对接不算复杂

## 三、dsh 内核关键信息

### 架构：一切皆插件（Cordis 框架）
- 插件（Plugin）= 函数/对象，带 `apply(ctx)`
- 上下文（Context）= 服务容器，按 key 注册（ctx.tools / ctx.llm / ctx.sessions...）
- 事件（Event）= 插件间通信，四种模式：emit / waterfall / parallel / serial
- 副作用可逆：插件卸载时注册项自动撤销

### seam（接缝）= 可替换能力
- Service Definition（接口）→ Service Provider（实现）→ Consumer（模型可调工具）
- 换一个 provider 能改整个产品（文件系统+子进程共享执行世界）

### 插件树 / Profile / Bundle
- `cordis.yml` 是配置主文件，插件按层级叠加
- profile = 具名组装（web / headless 是官方模板）
- bundle = 配置行+挂载代码的分发格式
- 修改优先级：profile 列表 → cordis.patch.yml → home 级 → --patch overlay
- 配置热更新（HMR）：改 cordis.yml 自动卸载重装插件

### 核心包（ctx 键）
| 包 | 职责 | ctx 键 |
|---|---|---|
| core/session | SessionEvent 日志 | ctx.sessions |
| core/system-prompt | 提示词组装 | ctx.systemPrompt |
| core/tools | 工具注册表+执行流水线 | ctx.tools |
| core/agent | Agent 接口+注册表 | ctx.agents |
| core/agent-loop | 默认 agent 循环驱动器 | ctx.agentLoop |
| core/scope | 按 agent 作用域注册 | 库 |
| llm/llm | 消息词汇+适配器 seam | ctx.llm |

### 添加能力速查表
| 目标 | 机制 |
|---|---|
| 加模型提供方 | ctx.llm 注册适配器 |
| 加模型可调能力 | ctx.tools 注册 |
| 加 shell 执行 | ctx.shell 后端 |
| 加后台任务 | ctx.jobs |
| 加文件系统策略 | ctx.fs provider / fs/* 事件 |
| 拦截 agent 请求 | agent/*、tools/* 事件 |
| 换 agent 循环 | 实现 ctx.agentLoop 接口 |
| 加 UI 集成 | 驱动 ctx.agents + session/event 渲染 |

## 四、Galgame 风格要点（参考 LingChat）

- 底部对话框 + 角色立绘（LingChat 有立绘/表情/动作/服装切换）
- 打字机效果、逐字/渐入
- 选项分支 = 选择肢控制剧情
- 背景/场景切换、BGM（VITS 语音可后期加）
- 情绪识别（LingChat 自研 18 种短句情绪模型）
- 剧本/羁绊系统（可选，增强叙事感）

## 五、待确认事项

- [ ] 「纯演出」还是「真交互」：galgame 选择肢是只做展示，还是真的映射为 agent 指令
- [ ] 前端技术栈定稿：React / Vue / 原生 + PixiJS
- [ ] 需要哪些 agent 能力在演出层展示（工具调用→演出动作？文件修改→场景变化？）
- [ ] 是否接语音（VITS）
- [ ] 单 agent 还是多 agent（多角色对话？）

## 六、已调研的相似项目

| 项目 | 方向 | 与本项目关系 |
|---|---|---|
| LingChat (1.6k) | 纯聊天 galgame 壳 | UI 设计参考，但非 agent |
| ZcChat/ZcChat2 | AI 桌宠 | 灵感来源 |
| ST-CinemaMode | SillyTavern→galgame 影院播放器 | 前端解析思路参考 |
| AI4VisualNovel (47) | 多 agent 自动生成 VN 游戏 | 方向相反（生成游戏而非 agent 界面） |
| kourai-khryseai | Ren'Py 界面 + A2A agent | 最接近但只是 demo |
| renforge-mcp | MCP 驱动 Ren'Py 游戏 | 方向相反 |

**结论：GitHub 上无现成「agent 内核 + galgame 前端壳」项目，本项目是空白领域，有差异化价值。**