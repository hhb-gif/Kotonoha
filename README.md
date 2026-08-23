# Kotonoha（言葉）

> 视觉小说风格的 AI Agent 工作台——自研 Harness 引擎，模型无关，可扩展可外接。
> Kotonoha（言葉）在日语中意为「话语」——言语与声音，正是人与 AI 对话的本质。

## 什么是 Kotonoha

Kotonoha 是一款**桌面级 AI Agent**，把 agent 干活的过程包装成**视觉小说演出**——像玩 Galgame 一样与 AI 对话、使用工具、管理记忆。

- **自研 Harness**（TypeScript，零外部依赖）：会话引擎、工具系统、提供商路由、权限审批、三层记忆、降级容错
- **视觉小说 UI**（React）：打字机回复、立绘、场景切换、存档体系、ESC 9 页签
- **可拓展可外接**：插件系统 + Shell/HTTP 工具 + MCP 协议 + 用户配置化，不写核心代码即可扩展

## 快速开始

### 下载安装
1. 从 [Releases](https://github.com/hhb-gif/Kotonoha/releases/latest) 下载 **Setup**（推荐）或 **Portable**
2. 安装/运行后，打开**设置**面板，填入你的 API 密钥（DeepSeek / Agnes / 任意 OpenAI 兼容端点）
3. 回到主菜单，点「新游戏」开始对话

### 从源码运行
```bash
# 安装依赖
cd app && npm install
cd ../agent && npm install

# 启动 Agent（3080 端口）
cd agent && npx tsx src/index.ts

# 启动前端（5173 端口）
cd app && npm run dev
```
访问 http://127.0.0.1:5173

## 核心功能

### Agent Harness（自研，TypeScript）
| 能力 | 说明 |
|------|------|
| 会话管理 | 创建/重命名/Fork/删除，SQLite 持久化 |
| 流式对话 | 打字机效果，支持 reasoning（思考过程） |
| 工具系统 | 20+ 内置工具，可并行只读，可 checkpoint/undo |
| 插件系统 | `tools/plugins/` 放 plugin.yaml 即加载，不改核心代码 |
| 配置工具 | Shell/HTTP 工具通过 tool.yaml 声明式定义 |
| MCP 协议 | 既是客户端（连接外部 MCP），也可作为 MCP Server |
| 权限审批 | 三档（允许/询问/拒绝）+ always 规则 + 5 分钟超时 |
| 降级容错 | 主模型失败自动切换备用 provider，健康监控 |
| 三层记忆 | episodic（会话）+ semantic（自动提取「言叶记得的事」）+ procedural（自学习技能） |
| 会话搜索 | SQLite FTS5 全文检索 |
| 成本统计 | 每次调用 token/费用落库，可导出 CSV |
| 中断恢复 | 随时停止生成，状态可恢复 |

### 前端 UI（React 视觉小说风格）
- **对话页**：打字机回复、思考中「停止」按钮
- **ESC 面板 9 页签**：存档 / 模型 / 技能（工具集切换+技能批准+记忆） / 会话（搜索+导出/归档） / Git / MCP / 命令 / 凭据（规则） / 统计（成本+降级记录+轨迹）
- **设置面板**：文本速度 / 背景 / 立绘 / 模型与密钥管理
- **首次引导**：4 步新手流程

### 模型支持
| 供应商 | 模型 |
|--------|------|
| DeepSeek（官方） | deepseek-v4-flash（推荐）、deepseek-v4-pro、deepseek-v4-flash-vision-exp |
| Agnes AI | 图像/视频生成 |
| Ollama（本地） | 自动发现本地模型 |
| 任意 OpenAI 兼容 | 自定义 baseURL + API Key |

## 目录结构

```
Kotonoha/
├── agent/                     # Harness 核心（TypeScript）
│   ├── src/
│   │   ├── core/             #   引擎（session + turn runner）
│   │   ├── providers/        #   模型路由（DeepSeek/Agnes/Ollama + fallback）
│   │   ├── tools/            #   工具注册表 + 20+ 内置工具
│   │   │   ├── builtin/      #     内置工具
│   │   │   ├── plugins/      #     插件系统 + 示例
│   │   │   └── external/     #     Shell/HTTP 配置工具
│   │   ├── mcp/              #   MCP 客户端 + Server 模式
│   │   ├── auth/             #   权限审批 + 三档权限
│   │   ├── memory/           #   三层记忆（semantic/procedural）
│   │   ├── store/            #   SQLite 持久化 + FTS5 搜索
│   │   └── api/              #   RPC + WS 事件流
│   ├── scripts/              #   测试脚本
│   └── dist/                 #   编译产物
├── app/                       # Electron 桌面壳 + React UI
│   ├── electron/             #   Electron 主进程 + preload
│   ├── src/
│   │   ├── components/       #   视觉小说 UI 组件
│   │   ├── bridge/           #   前端协议桥接
│   │   └── ...
│   └── vite.config.js        #   Vite 构建配置
├── docs/                      #   规划文档 + 工作记录
│   └── plans/               #   harness-v2-v3-optimization / master-plan 等
└── temp/                      #   临时文件
```

## 技术栈

| 层 | 技术 |
|----|------|
| Harness 引擎 | TypeScript + better-sqlite3（ABI 127）+ Node 22 |
| 前端 | React 18 + Vite + 打字机/场景切换 |
| 桌面壳 | Electron 36 + electron-builder（内置 Node 运行时） |
| 协议 | HTTP POST RPC + WebSocket 事件流（兼容 dsh 格式） |
| 模型 | OpenAI 兼容 API（DeepSeek/Agnes/Ollama/自定义） |

## 相关文档

| 文档 | 说明 |
|------|------|
| [M0 规划](docs/plans/agent-harness-m0.md) | 初始架构 |
| [M1 规划](docs/plans/agent-harness-m1.md) | 工具+审批 |
| [Harness v2](docs/plans/harness-v2-optimization.md) | 工具协议+记忆+并行+中断 |
| [Harness v3](docs/plans/harness-v3-tools.md) | 工具门类+插件+配置工具 |
| [M4](docs/plans/m4-reliability.md) | 降级+健康监控 |
| [全局规划](docs/plans/master-plan-2026-08-21.md) | M0-M6 完整路线 |

## 许可证

MIT