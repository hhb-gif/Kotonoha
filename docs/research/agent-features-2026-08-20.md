# 主流 AI Coding Agent 功能与 UI 组织调研报告

> 用途：为 Kotonoha（React + Electron 视觉小说风格桌面 Agent，后端 dsh）完善 ESC 角色面板（分类工具栏）与侧边栏设计提供依据。
> 调研日期：2026-08-20　|　性质：纯调研，不涉及代码改动
> 说明：带「未确认」标记的条目为本次未能从一手资料逐条核实的信息，引用时请自行复核。

---

## 1. 调研来源清单

| # | 产品 | 来源类型 | URL | 获取内容 |
|---|------|---------|-----|---------|
| 1 | Cline | 官方 README（raw） | https://github.com/cline/cline | 产品矩阵（VS Code/JetBrains/CLI/Kanban/SDK）、Plan/Act、.clinerules、MCP、多 agent、定时任务、连接器 |
| 2 | Cline | 官方文档索引 | https://docs.cline.bot/llms.txt | 完整文档目录：Checkpoints、Subagents、Memory Bank、Auto Approve & YOLO、Using Commands、MCP、Skills、Hooks 等 |
| 3 | OpenCode | 官方文档 Intro | https://opencode.ai/docs | 安装、/init 初始化 AGENTS.md、Plan/Build 模式（Tab 切换）、@ 引用、图片拖入、/undo /redo |
| 4 | OpenCode | 官方文档 TUI | https://opencode.ai/docs/tui | 17 个内置斜杠命令全表、ctrl+x leader 键、ctrl+p 命令面板、@ 模糊搜索、! bash 注入、attention 通知 |
| 5 | OpenCode | 官方文档 Commands | https://opencode.ai/docs/commands | 自定义命令（markdown 文件/JSON）、frontmatter（agent/model）、$ARGUMENTS/$1..$n、!`cmd` shell 注入、@file |
| 6 | OpenCode | 官方文档 Agents | https://opencode.ai/docs/agents | build/plan 主 agent、general/explore/scout 子代理、@ 提及、per-agent 权限、steps/temperature/color |
| 7 | OpenCode | 官方文档 Permissions | https://opencode.ai/docs/permissions | allow/ask/deny、bash 命令级粒度（"git *": ask）、external_directory、doom_loop、审批 once/always/reject、--auto |
| 8 | Cursor | 官方文档 Agent | https://cursor.com/docs/agent/overview | Agent 工具集（搜索/网页/读/编辑/终端/浏览器/生图/提问）、Checkpoints、消息队列（Enter 排队 / Cmd+Enter 插队）、/goal |
| 9 | Cursor | 官方文档 Plan Mode | https://cursor.com/docs/agent/plan-mode | Shift+Tab 切换 Plan Mode、计划可存 markdown、模式选择器 |
| 10 | Windsurf | 官方文档 Cascade（docs.devin.ai 镜像） | https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview | Write/Chat 双模式、模型选择器位置、消息队列、voice、按步骤 revert、自动执行 Off/Auto/Turbo |
| 11 | Windsurf | 社区/第三方指南 | https://en.paradigmadigital.com/dev/windsurf-cascade-guide-best-practices 等 | 规则系统（.windsurf/rules/、12k 字符预算、触发模式）、Memories、plans/ 目录工作流、hooks |
| 12 | Kilo Code | Marketplace + 官方文档 + 迁移计划文档 | https://kilo.ai/docs、https://github.com/Kilo-Org/kilocode | 重建版（Kilo CLI 后端 + SolidJS webview）、Modes（Architect/Coder/Debugger）、MCP Marketplace、自定义命令、/init、会话/云端同步、子代理 |
| 13 | Aider | 官方 README + 命令文档 | https://aider.chat/docs/usage/commands.html | 全部约 40 个斜杠命令、repo map、git 自动 commit、lint/test、voice、/web |
| 14 | Cherry Studio | 官方 README | https://github.com/CherryHQ/cherry-studio | 桌面聊天应用：助手列表+话题（会话）系统、300+ 预设助手、多模型同聊、MCP、WebDAV、全局搜索 |
| 15 | Roo Code | 官方文档 + 第三方指南 | https://roocodeinc.github.io/Roo-Code/ | 5 种内置模式、Custom Modes、工具组（read/edit/command/mcp）、斜杠切模式、Todo 列表、Checkpoints、Boomerang |
| 16 | Continue.dev | 官方 README | https://github.com/continuedev/continue | 已停更（2.0.0 终版，只读），CLI/VS Code/JetBrains |
| 17 | VS Code | 官方 MCP 开发指南 | https://code.visualstudio.com/api/extension-guides/ai/mcp | MCP 服务器管理 UI（扩展视图）、MCP: Add Server 命令、--add-mcp、自动发现 |

注：Cline / Kilo Code / Aider 的 GitHub 主页直连抓取失败，已改用 raw README 与官方文档站点获取；内容以 2026-08-20 抓取到的版本为准，后续版本可能有变化。

---

## 2. 功能对照表

图例：● 完整/原生支持　◐ 部分支持或有变体　○ 无或未确认

| 功能类别 | Cline | OpenCode | Cursor | Windsurf (Cascade) | Kilo Code | Aider | Roo Code | Cherry Studio |
|---|---|---|---|---|---|---|---|---|
| **会话管理**（新建/历史/切换/导出） | ◐ 历史在侧边栏；checkpoints 保存文件快照 | ● /new /sessions(/resume) /export；子代理产生 child session 树；自动生成标题 | ◐ 聊天历史列表；checkpoint 时间线；Agent Window | ◐ 侧边栏 Chat/History/Tasks 三页签（界面常识，文档未逐条列） | ● 会话列表+标题生成；Session Preview（首条消息摘要）；云端任务同步 | ◐ 单会话为主；/reset /clear；/save 存档文件列表 | ◐ 会话历史；checkpoints 恢复对话状态 | ● 话题（Topic）系统：重命名/归档/分组/拖拽排序；WebDAV 备份 |
| **模型切换与管理** | ● 底部模型下拉；30+ 提供商/OpenRouter/本地 Ollama | ● /models 列出；ctrl+t 循环模型变体；Zen 精选模型；per-command/per-agent model | ● Agent Window 模型选择器；各模型默认/最大上下文展示（200k~1M） | ● 输入框下方模型选择菜单；不同任务换模型 | ● 500+ 模型（Kilo Gateway）；记住上次模型并预选 | ● /model /models /weak-model /editor-model（架构师/编辑器双模型） | ● 模式级粘性模型（每个 mode 记住上次模型）；API 配置 Profiles | ● 多提供商（云+本地）；同会话多模型同时对话对比 |
| **文件系统操作**（打开/编辑/差异） | ● diff 视图可审阅/修改/回退；checkpoints；Jupyter 编辑 | ● read/write/edit/apply_patch；TUI 内 diff 渲染（diff_style） | ● 文件编辑工具+diff 审阅；Agent Review；checkpoint 预览文件状态 | ● 多文件编辑；按步骤 revert（悬停消息即可回滚） | ● 文件编辑；Fast Edits（CLI 侧） | ● /add /drop /read-only /ls 控制会话内文件；diff 视图 | ● read/edit 工具组；文件权限正则限制（如仅 .md） | ◐ 文档上传（文本/Office/PDF）；无代码库语义 |
| **终端/命令执行** | ● 直接执行+实时输出；后台长任务持续响应 | ● ! 前缀 bash 注入；bash 权限命令级控制 | ● 终端工具；可指定默认终端 profile | ● 终端工具+自动装依赖；自动执行等级 Off/Auto/Turbo | ● 终端（可选手动执行/复用 IDE 终端） | ● /run !、/test（失败才注入输出） | ● command 工具组 | ○ 无 |
| **Git 操作** | ● checkpoints 回滚；Kanban 每卡独立 worktree+auto-commit | ● /undo /redo 基于 Git 实现（需 git 仓库）；git 命令权限可细化 | ● checkpoint 与 Git 分离（本地快照）；GitHub/GitLab 集成、PR 审批 agent | ◐ 步骤级 revert（非 Git 语义） | ◐ 代码评审（未提交/分支 diff）；/init 前秘密扫描建议 | ● 自动 commit（智能提交信息）；/commit /undo /diff /git | ◐ checkpoints；Git 操作经 command 工具 | ○ 无 |
| **MCP 服务器管理** | ● 图形化添加/启停；cli 侧 `cline mcp`；企业 allowlist | ● opencode.json 配置；mymcp_* 通配权限 | ● MCP 配置面板；@ 选择 MCP 工具 | ● MCP 接入；hooks 可拦截 pre_mcp_tool_use | ● MCP Marketplace（发现/安装）；配置 UI（增删改+工具 allowlist） | ○ 无（未确认） | ● MCP 工具组；可按模式限制 | ● MCP 服务器配置（桌面客户端） |
| **任务/待办管理** | ● 任务型交互；Kanban 看板（卡片=任务，依赖链）；计划模式 | ● todowrite/todoread 工具；plan agent 输出计划 | ● 计划存 markdown 文件；队列消息（Enter 排队/Cmd+Enter 插队） | ● 计划与 TODO 列表；queued messages 队列 | ● 任务自动化；Cloud Task | ◐ 计划/执行分离（architect 模式） | ● Task Todo List（多步任务进度）；Boomerang 任务模板 | ○ 无 |
| **上下文管理（@mention 等）** | ● @ 提及+拖放文件/图片进上下文 | ● @ 模糊搜索文件、@agent 调子代理、@ 引用目录；references 配置；/compact 压缩上下文 | ● @ 文件/规则/技能；上下文显式管理（模型上下文指示） | ● 记忆系统（Memories）+规则自动注入；实时感知编辑/终端/剪贴板 | ● @ 文件/上下文提及（未逐条确认） | ● /add /drop /read-only /context /tokens；repo map | ● 上下文提及（Context Mentions 文档）；每条消息 token 统计 | ● 话题内上下文；文档知识库（企业版） |
| **命令面板与斜杠命令** | ◐ 内置命令 + 自定义命令（清单未逐条确认） | ● 17 内置命令+自定义命令（markdown/JSON）；/ 触发带描述；ctrl+p 命令面板 | ● ⌘K 命令面板/内联；Agent 内 /goal /loop；Custom Modes | ◐ 无公开斜杠命令体系（未确认） | ● 自定义命令（YAML frontmatter）+ 内置 /init 等 | ● 约 40 个斜杠命令（见第 4 节全表） | ● /code /architect /ask /debug /orchestrator 切模式；/new /clear /help | ○ 无斜杠命令（纯聊天） |
| **审批/权限管理** | ● 每步人工审批；auto-approve 白名单；YOLO 模式；企业级 RBAC | ● allow/ask/deny 三级；bash 命令级 glob 规则；approval once/always/reject；external_directory/doom_loop；--auto | ◐ 默认自动执行；手动审查（Agent Review）；安全设置面板 | ● 自动执行等级 Off/Auto/Turbo（可企业封顶）；allow/deny 列表 | ● 权限运行时（CLI 侧）；工具 allowlisting | ◐ 无审批流；靠 Git 回滚兜底 | ● 模式级工具权限（read/edit/command/mcp 按需开放） | ○ 无（仅 API key 管理） |
| **记忆/技能/自定义指令** | ● .clinerules + Skills（按需加载指令）；Memory Bank 最佳实践；AGENTS.md | ● AGENTS.md（/init 引导生成）；agent skills（SKILL.md）；rules；自定义命令模板 | ● Rules（可被 agent 按类型抓取）；Skills（含 /loop）；Subagents；Hooks | ● .windsurf/rules/（trigger: always_on/glob/model_decision，12k 字符预算）；Memories（自动沉淀）；Hooks | ● 规则与工作流管理 UI（rules/workflows 子页签） | ● conventions 文件（--conventions）；/read-only 引用 | ● .roo/rules-{mode}/ 模式级规则目录；Custom Instructions；Skills；Custom Modes 共享市场 | ◐ 预设助手=人设模板（300+）；无 agent 记忆 |
| **其他亮点** | Kanban 多 agent 看板、定时任务（cron）、Telegram/Slack 连接器、SDK、headless CI | /share 分享会话链接、/themes 主题、attention 声音通知、web/IDE 多端 | 浏览器工具、图像生成、Checkpoint 时间线、消息队列插队、/goal 长期目标 | 实时协作感知（continue my work）、语音输入、按步骤回滚 | 并行子代理、Orchestrator、代码索引+语义搜索、内联自动补全 | repo map、自动 lint/test、voice、/web 抓网页、/copy-context 迁到 web 聊天 | Boomerang 编排（跨模式子任务委派）、模式切换 Ctrl+.、sticky models | 全局搜索、AI 翻译、小程序、Mermaid 渲染、主题系统 |

---

## 3. 侧边栏 / 面板设计建议（针对 Kotonoha）

### 3.1 成熟 agent 侧边栏的通用分区模型

把 Cline（VS Code 侧栏）、OpenCode（TUI 布局）、Cursor（Agent Window）、Windsurf（Cascade）、Kilo（webview 侧栏）、Cherry Studio（桌面侧栏）放在一起看，侧边栏都收敛为**三个区**：

**① 顶部 Header 区**——身份与全局操作
- 应用/产品名 + 新建会话按钮（OpenCode `/new`、Cursor 新聊天、Cherry 新建话题）
- 设置/凭据入口（Cline 面板头部设置按钮；OpenCode `/connect`）
- 状态指示：当前 agent/模式、审批模式（OpenCode 自动审批时在界面右下角显示 muted 的 `auto` 指示器）、MCP 在线状态（Cline 有 MCP 服务器指示）

**② 主内容区**——会话层
- 上层：会话/话题列表（Cherry Studio 的 Topic 系统最完整：重命名、归档、分组、拖拽排序；OpenCode `/sessions` 可切换并自动生成标题；Kilo 有 Session Preview 首条消息摘要）
- 下层：当前会话消息流，工具调用可折叠/展开（Kilo「Expandable MCP Tools」、OpenCode `/details` 切换工具执行细节）

**③ 底部控制区**——输入与执行参数（这是 agent 类产品区别于普通聊天软件的核心区）
- 输入框：支持前缀语法 `@`（引用文件/agent）、`!`（shell）、`/`（命令）——OpenCode 三前缀是行业事实标准
- 输入框旁/上方：**模式切换**（Cline Plan/Act 单选、Roo 模式下拉、OpenCode Tab 循环、Cursor Shift+Tab 旋转 Plan Mode）
- 模型选择器：**紧贴输入框**（Windsurf 官方文档明确「模型选择菜单位于对话输入框下方」；Cline 在底部；Roo 每个模式粘住上次模型）
- token/上下文占用计数（Cline tokens 显示、Aider `/tokens`）

> Kotonoha 现状：ESC 面板 4 页签（存档/模型/技能/统计）+ 顶栏 + 底部工具栏。对照上面的模型：**缺会话层（无会话列表/切换）、缺输入框前缀语法、缺模式切换、缺审批状态区、缺 MCP/凭据管理入口**。建议底部工具栏承担「输入框+模式+模型+审批」这一组，ESC 面板承担 Header 区 + 会话层 + 后台管理页签。

### 3.2 建议新增的工具栏 / 页签（按价值排序）

| 建议 | 放哪 | 借鉴来源 | 理由 |
|---|---|---|---|
| **会话页签**（新建/重命名/归档/导出/搜索） | ESC 面板第 1 页签（现有「存档」扩展为会话管理） | Cherry Studio Topic 系统；OpenCode `/sessions` `/export`；Kilo Session Preview | 会话管理是所有 agent 产品的标配；视觉小说风格下「存档」天然对应会话快照，把「存档=会话」概念打通是最贴合 Kotonoha 语义的做法 |
| **模式切换控件**（Plan/Build，或自定义「攻略/行动」模式） | 底部工具栏，输入框旁 | Cline Plan/Act；OpenCode Tab 切换 build/plan；Roo 模式下拉；Cursor Plan Mode | 四个产品不约而同放在输入框同一位置，说明这是肌肉记忆位；对 Kotonoha 可映射为「商量计划 vs 直接行动」两种角色姿态 |
| **命令面板（Command Palette）** | 全局快捷键（Ctrl+K/Ctrl+P）+ 输入框 `/` 菜单 | OpenCode ctrl+p 命令面板 + `/` 命令带描述；Cursor ⌘K；Kilo YAML 自定义命令 | 是「功能发现」的最低成本方案：记不住的功能都能在面板里搜到；斜杠命令带描述展示是 OpenCode TUI 的细节（description 字段） |
| **Git 页签**（status/diff/commit/checkpoint 回滚） | ESC 面板页签（可选） | OpenCode `/undo` `/redo` 基于 Git；Cline Checkpoints；Aider 自动 commit；Cursor checkpoint 时间线 | 回滚能力是 agent 信任感的基石；若 Kotonoha 暂不面向代码编辑，可降级为「步骤回滚」按钮（Windsurf 按消息 hover 回滚） |
| **任务/待办页签**（当前任务、步骤清单、审批队列） | ESC 面板页签（可选） | Roo Task Todo List；OpenCode todowrite；Windsurf 计划+Todo；Cursor 消息队列 | 多步任务进度可视化是 Roo 用户粘性最高的功能之一；审批队列与 Kotonoha 的审批机制是天然结合点 |
| **MCP 页签**（服务器列表/启停/配置/工具 allowlist） | ESC 面板页签（可选） | VS Code 扩展视图管理 MCP；Kilo MCP 配置 UI+Marketplace；Cline MCP 指示器；OpenCode mymcp_* 权限 | 后端 dsh 本身是插件生态（Cordis），MCP 页签与 dsh 的插件管理理念同构；至少需要一个状态指示器（哪些 MCP 在线） |
| **凭据/设置页签**（模型提供商、API key、本地模型） | ESC 面板页签（可选） | OpenCode `/connect`；Roo API Configuration Profiles；Cline 30+ provider | 模型页签已有雏形，补「提供商/凭据管理」即可闭环；注意密钥不落盘明文（OpenCode 默认 deny 读 .env） |
| **记忆/技能页签**（已有「技能」，补记忆管理） | 扩展现有「技能」页签 | Cline Memory Bank + Skills；Windsurf Memories；OpenCode agent skills（SKILL.md） | Kotonoha 视觉小说场景下记忆=羁绊/好感度，是产品差异化的核心卖点，值得单独深化 |

### 3.3 命令面板与斜杠命令设计建议

1. **三层入口统一**：全局快捷键打开命令面板（搜功能）＋ 输入框内 `/` 弹出命令菜单（带描述、可传参）＋ 常用命令给 leader 键组合（OpenCode 的 ctrl+x 体系，如 ctrl+x n = 新会话）。
2. **命令即模板**：自定义命令用 markdown/YAML 文件定义（frontmatter 里写 description/agent/model），文件名即命令名——照抄 OpenCode/Kilo 的做法，成本极低、可 git 管理。
3. **命令参数**：支持 `$ARGUMENTS`、`$1..$n` 位置参数、`!`\`shell\`` 注入输出、`@file` 注入文件内容（全部是 OpenCode 已验证的语法，直接采纳）。
4. **命令可覆盖**：允许用户自定义命令覆盖内置命令（OpenCode 明确支持），避免命令名冲突。
5. **Kotonoha 特色命令示例**：`/save`（存档=导出会话）、`/load`（读档=恢复会话）、`/emote`（切换立绘情绪）、`/bgm`、`/mode`（切 Plan/Build）、`/approve`（批量审批队列）、`/skill`（加载技能）。

---

## 4. 常用 / 命令参考表

> 来源：OpenCode 官方 TUI 文档（全量）、Aider 官方命令文档（全量）、Roo Code 官方文档（模式命令）、Cursor 官方文档（/goal /loop）、Kilo/Cline 以文档提及为准（部分未逐条确认）。

### 4.1 OpenCode 内置命令（官方全量，2026-08-20）

| 命令 | 别名 / 快捷键 | 用途 |
|---|---|---|
| `/connect` | - | 添加模型提供商并录入 API key |
| `/compact` | `/summarize`、ctrl+x c | 压缩当前会话上下文 |
| `/details` | - | 切换工具执行细节显示 |
| `/editor` | ctrl+x e | 用外部编辑器（$EDITOR）撰写消息 |
| `/exit` | `/quit` `/q`、ctrl+x q | 退出 |
| `/export` | ctrl+x x | 导出会话为 Markdown |
| `/help` | - | 显示帮助对话框 |
| `/init` | - | 引导生成/更新 AGENTS.md |
| `/models` | ctrl+x m | 列出可用模型 |
| `/new` | `/clear`、ctrl+x n | 新建会话 |
| `/redo` | ctrl+x r | 重做（基于 Git 还原文件） |
| `/sessions` | `/resume` `/continue`、ctrl+x l | 列出/切换会话 |
| `/share` | - | 生成会话分享链接 |
| `/themes` | ctrl+x t | 切换主题 |
| `/thinking` | - | 切换思考块显隐 |
| `/undo` | ctrl+x u | 撤销上一条消息及其文件改动（基于 Git） |
| `/unshare` | - | 取消分享 |

### 4.2 Aider 内置命令（官方全量）

| 命令 | 用途 |
|---|---|
| `/add` | 添加文件到会话（可编辑） |
| `/architect` | 进入双模型 architect/editor 模式 |
| `/ask` | 只问不改 |
| `/chat-mode` | 切换聊天模式 |
| `/clear` | 清空聊天历史 |
| `/code` | 请求改代码 |
| `/commit` | 提交聊天外的改动（可带提交信息） |
| `/context` | 查看/进入上下文模式 |
| `/copy` | 复制最后一条助手消息 |
| `/copy-context` | 把上下文复制为 markdown（粘贴到 web 聊天） |
| `/diff` | 显示上次消息以来的 diff |
| `/drop` | 从会话移除文件 |
| `/edit`（=`/editor`） | 打开编辑器写 prompt |
| `/editor-model` | 切换编辑器模型 |
| `/exit` `/quit` | 退出 |
| `/git` | 执行 git 命令（输出不进聊天） |
| `/help` | 问 aider 问题 |
| `/lint` | 对会话内文件跑 lint 并修复 |
| `/load` | 从文件加载并执行命令 |
| `/ls` | 列出已知文件并标记会话内文件 |
| `/map` | 打印仓库地图（repo map） |
| `/map-refresh` | 强制刷新 repo map |
| `/model` | 切换主模型 |
| `/models` | 搜索可用模型 |
| `/multiline-mode` | 切换多行模式 |
| `/ok` | 快捷「好的，请执行」 |
| `/paste` | 从剪贴板粘贴文本/图片 |
| `/read-only` | 添加只读引用文件 |
| `/reasoning-effort` | 设置推理强度 |
| `/report` | 开 GitHub Issue 报告问题 |
| `/reset` | 丢弃所有文件并清空历史 |
| `/run`（别名 `!`） | 运行 shell 命令并可注入输出 |
| `/save` | 保存会话文件列表到文件 |
| `/settings` | 打印当前设置 |
| `/test` | 运行命令，非零退出码时把输出注入聊天 |
| `/think-tokens` | 设置思考 token 预算 |
| `/tokens` | 报告上下文 token 用量 |
| `/undo` | 撤销 aider 做的最后一次 commit |
| `/voice` | 语音输入 |
| `/weak-model` | 切换弱模型 |
| `/web` | 抓网页转 markdown 发入聊天 |

### 4.3 其他产品命令（部分确认）

| 命令 | 产品 | 用途 |
|---|---|---|
| `/code` `/architect` `/ask` `/debug` `/orchestrator` | Roo Code | 切换内置模式（另可 Ctrl+. 循环） |
| `/new` `/clear` `/help` | Roo Code | 新会话/清空/帮助 |
| `/init` | Kilo Code / Cline（Cline 未逐条确认） | 初始化项目规则（/init 前会建议加秘密扫描 hook） |
| `/review` | Kilo Code / Cline（未逐条确认） | AI 代码评审 |
| `/goal` | Cursor | 设定长期目标持续执行直到完成 |
| `/loop` | Cursor（内置 skill） | 周期性汇报进度的循环执行 |
| 自定义命令（YAML frontmatter：description/model/agent） | Kilo Code / OpenCode | 团队共享的可复用命令 |
| 自定义命令（markdown 文件，支持 $ARGUMENTS、@file、!`cmd`） | OpenCode | 同上，模板即命令 |
| 切模式斜杠（/architect /coder /debugger，未逐条确认） | Kilo Code（旧版） | 模式切换 |

### 4.4 值得抄进 Kotonoha 的最小命令集（推荐首版实现）

`/new`（新会话）、`/sessions`（读档）、`/save`（存档）、`/export`（导出为 md）、`/mode`（切 Plan/Build）、`/model`（切模型）、`/skill`（加载技能）、`/help`、`/compact`（压缩上下文）、`/approve`（批量审批）、`/undo`（回滚上一步）。

---

## 5. 对 Kotonoha 的落地建议（按优先级）

### 核心必须有（第 1 期）

| # | 建议 | 依据 |
|---|---|---|
| 1 | **会话层**：ESC「存档」页签升级为会话管理（列表/新建/切换/重命名/归档/导出 md）。会话即存档，打通 galgame 语义 | Cherry Studio Topic 系统、OpenCode `/sessions` `/export`、Kilo Session Preview（全部产品标配） |
| 2 | **输入框三前缀**：`@` 引用（文件/角色/技能）、`!` shell、`/` 命令菜单（带描述+参数提示） | OpenCode TUI 事实标准；Aider `!`/`/run` |
| 3 | **Plan/Build 模式切换**：底部工具栏输入框旁的切换控件 + 审批队列（once/always/reject 三档） | Cline Plan/Act、OpenCode Tab、Cursor Plan Mode、OpenCode 审批 once/always/reject |
| 4 | **模型选择器移到输入框附近** + 当前模型/上下文占用指示 | Windsurf（输入框下方）、Cline（底部）、Roo sticky models |
| 5 | **命令面板**：全局快捷键（Ctrl+K 或 Ctrl+P）+ 自定义命令模板文件（首版先做内置 10 个命令） | OpenCode ctrl+p + markdown 命令；Cursor ⌘K |
| 6 | **审批状态区**：待审批队列入口常驻（角标/红点），dsh 审批事件 → 演出层提示 | Cline 每步审批、OpenCode approval 队列、Windsurf 自动执行等级 |
| 7 | **会话/操作回滚**：至少「上一步回滚」按钮（首版可只做会话级快照，不做文件级） | OpenCode `/undo`、Windsurf 按步骤 revert、Cline Checkpoints |

### 可选（第 2 期，按性价比排序）

| # | 建议 | 依据 |
|---|---|---|
| 8 | Git 页签（status/diff/commit/checkpoint 时间线）——若目标用户是开发者 | OpenCode `/undo` 基于 Git；Cline Checkpoints；Aider 自动 commit |
| 9 | MCP 页签（服务器列表/启停/工具 allowlist）+ 在线状态指示器 | VS Code 扩展视图、Kilo MCP 配置 UI、Cline MCP 指示器 |
| 10 | 任务/待办页签（多步任务进度 + 审批队列合并展示） | Roo Task Todo List、OpenCode todowrite |
| 11 | 会话分享/导出链接 | OpenCode `/share`（分享链接） |
| 12 | 记忆系统（角色羁绊/好感度 = 长期记忆，自动沉淀+可编辑）——Kotonoha 差异化核心 | Windsurf Memories、Cline Memory Bank |
| 13 | 消息队列：执行中可排队下一条消息（Enter 排队 / Ctrl+Enter 插队） | Cursor queued messages、Windsurf queued messages |
| 14 | 桌面通知+声音（agent 等待审批/完成时） | OpenCode attention（通知+音效包） |
| 15 | 语音输入 | Aider `/voice`、Windsurf voice |
| 16 | 多 agent/子代理：主角色 + 子代理（探查/文档等），`@` 提及调用 | OpenCode subagents（explore/scout）、Roo Orchestrator、Cline agent teams |
| 17 | 技能页签深化：技能=SKILL.md 模板化，可与自定义命令打通 | Cline Skills、OpenCode agent skills |

### 不建议照搬（与产品定位冲突或成本高）

- Cline 的 Kanban 看板 / 定时任务 / Telegram 连接器：面向 CI 与团队，桌面单机 galgame 场景无需求。
- Cursor 的浏览器工具 / 图像生成：kotonoha 定位是个人桌面助手，后期若需要可走 MCP 扩展而非内建。
- Aider 的 repo map / 自动 commit：需要 git 仓库 + 代码库语义，与视觉小说叙事定位不符，除非未来接「工作目录」场景。
- Continue.dev 已停更（2.0.0 终版只读），参考其交互即可，不要作为架构参考。

---

## 6. 关键「未确认」清单（后续若采用需复核）

1. Cline 内置斜杠命令完整清单（官方「Using Commands」页本次未逐条抓取；/init /review /clear /new /help 为常见公开信息）。
2. Kilo Code 重建版侧边栏的页签细节（迁移计划文档确认了 rules/workflows 子页签、MCP 配置 UI，其余界面细节未截图确认）。
3. Windsurf 侧边栏 Chat/History/Tasks 页签（官方文档未逐条列出，来自产品界面常识）。
4. Cursor 的 Cmd+K 内联编辑、Chat/Composer 面板细分（本次抓取的 Agent/Plan 文档未展开，属产品常识）。
5. Cherry Studio 的侧边栏结构细节（仅 README 功能列表，界面布局未逐一确认）。
6. Aider 是否有 MCP 支持（官方文档未见，标记为「未确认」）。

---

*报告完。调研日期 2026-08-20，抓取内容以当日为准。*