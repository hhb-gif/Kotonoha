# 对话记忆迁移

> 本文件把 Kotonoha 项目启动前的完整对话上下文迁移到项目内，供后续会话恢复使用。
> 记录时间：2026-08-19

## 一、对话背景

用户从「寻找安卓端统一连接多个 AI agent 的成熟项目」开始，最终选定 **Orca** 作为多 agent 工作台，随后了解 **DeepSeek Harness（dsh）**，最后萌生「用 Galgame 风格界面使用 dsh」的想法，创立本项目。

## 二、用户环境（重要）

- **OS**: Windows（PowerShell 5.1）
- **Git**: 2.55.0.windows.2
- **gh**: 2.92.0，已登录 GitHub 账号 **hhb-gif**（token scopes: gist, read:org, repo）
- **Node**: v22.22.3（通过 nvm，bin 目录 `C:\Users\10660\.nvm\versions\node\v22.22.3\bin`）
- **npm 全局包**: claude-code@2.1.232, opencode-ai@1.18.18, codex-cli@0.147.0, hermes-web-ui@0.4.0, @deepseek-ai/dsh@0.1.0-rc.7
- **代理**: 系统代理 `127.0.0.1:7890`（时通时不通，npm registry 常直连）
- **产出原则**: 所有输出放 E 盘项目目录，禁止放桌面/C 盘/下载夹
- **git 身份**: hhb-gif / 15293421255@163.com

### 已安装的 Agent
| Agent | 命令 | 位置 |
|---|---|---|
| Claude Code | claude | npm 全局 |
| OpenCode | opencode | npm 全局 |
| Codex CLI | codex | npm 全局（桌面版 GUI 另有，注意其配置污染） |
| Hermes | hermes | D:\Miniconda3\Scripts\hermes.exe |
| dsh | dsh | npm 全局 |

### 关键环境变量
- `HERMES_HOME=E:\HermesAgent`（Hermes 配置家目录）
- Codex CLI 配置在 `~/.codex/config.toml`（**混有桌面版配置**，启动报 `codex_apps` MCP 超时，属无害噪音）

## 三、Orca 使用情况（顺带记录）

- **安装**: `E:\HermesAgent\temp\orca-windows-setup.exe`（178.8 MB）→ 安装到 `C:\Users\10660\AppData\Local\Programs\Orca`
- **版本**: 1.4.182（Electron 应用）
- **账号**: yji004966@gmail.com（Personal profile）
- **工作区根目录**: `E:\ocra`（注意拼写 o-c-r-a，不是 orca）
- **LFP 项目**: `E:\LFP`（git 仓库，kind=git）
- **桌面版**: uiLanguage 已设为 zh（中文界面）
- **入口**: 45.1k stars，YC 支持，MIT 开源，支持 Claude/Codex/OpenCode/Hermes 等 20+ agent
- **手机端**: iOS/Android companion App（beta），无语言切换，界面英文固定
- **启动**: `C:\Users\10660\AppData\Local\Programs\Orca\Orca.exe`

### Orca 核心概念
- Project（项目）= git 仓库；Worktree（工作树）= 任务副本；Workspace（工作区）= worktree 存放根目录
- 点「+」时：git 项目显示「新建工作树」，普通文件夹显示「新建工作区」（取决于有无 git 分支可复制）
- 首次启动会引导授权 home 目录访问、可选导入 ~/.claude、~/.codex

## 四、dsh 安装与使用

- **全局安装**: `npm install -g @deepseek-ai/dsh`（装 530 包，成功）
- **启动**: `dsh web` → `http://127.0.0.1:3080`（或 `npx @deepseek-ai/dsh web`）
- **注意**: npx 方式是临时缓存，不占全局；全局装好后直接 `dsh web`
- **配置家目录**: `~/.dsh`
  - `settings.yaml`: 已配置 provider=opencode, model=deepseek-v4-flash-free
  - `.credentials.yaml`: 凭据
  - `profiles/web/cordis.yml` + `cordis.patch.yml`: 插件树主配置 + 用户补丁层
  - `sessions/`, `storages/`: 会话与存储
- **前端技术栈**: React + Vite（`@deepseek-ai/dsh-web-frontend`，编译产物，无源码）
- **自定义入口**: `cordis.patch.yml`（配置层，不碰源码）；写插件；或改源码（升级会被覆盖）

## 五、技术调研结论

1. **dsh 是组装 Agent 的运行时**（区别于 Codex/Claude Code 的固化产品），「一切皆插件」，连 agent loop 都是插件
2. **Model + Harness = Agent** 是 DeepSeek 内部公式
3. dsh 前端是 React+Vite，编译产物，改造 UI 需走前端插件或外包壳
4. **GitHub 无现成「agent 内核 + galgame 前端壳」项目**，Kotonoha 是空白领域
5. LingChat（1.6k star, Rust, AGPL-3.0）是最完整的 galgame 聊天壳参考，但它不接 agent 能力

## 六、Kotonoha 项目决策

- **名字**: Kotonoha（言葉），日语「话语」
- **路径**: D（自写前端 + dsh 内核，经 ACP/JSON-RPC/WebSocket）
- **技术栈（草案）**: React/Vue + PixiJS
- **待定**: 纯演出 vs 真交互、是否接语音、单/多 agent

## 七、网络问题经验

- GitHub / npm 直连可能超时，走代理 `http://127.0.0.1:7890` 可解决（设置环境变量 https_proxy/http_proxy）
- 代理端口时通时不通，`Test-NetConnection 127.0.0.1 -Port 7890` 先探测
- npm registry 常可直连（无需代理）
- 系统代理开着但 curl 不走代理 → 需手动设 `https_proxy`