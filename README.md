# Kotonoha（言葉）

> 一款视觉小说风格的 **AI 桌面应用**——自研 Agent 引擎，模型无关，可扩展可外接。
> Kotonoha（言葉）在日语中意为「话语」——言语与声音，正是人与 AI 对话的本质。

<p align="center">
  <a href="https://github.com/hhb-gif/Kotonoha/releases/latest"><img src="https://img.shields.io/github/v/release/hhb-gif/Kotonoha?label=version" alt="version"/></a>
  <a href="https://github.com/hhb-gif/Kotonoha/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform"/>
</p>

## 什么是 Kotonoha

Kotonoha 是一款**本地运行的 AI 桌面应用**（Windows），把 Agent 干活的过程包装成**视觉小说演出**——像玩 Galgame 一样与 AI 对话、使用工具、管理记忆。

- **自研 Harness 引擎**（TypeScript）：会话引擎、20+ 工具、插件系统、MCP 双向、三层记忆、降级容错
- **视觉小说交互**：打字机回复、立绘表情随情绪变化、语音朗读、羁绊成长
- **数据全部本地**：SQLite 存储，仅监听 127.0.0.1，无遥测无上传

## 快速开始

1. 从 [Releases](https://github.com/hhb-gif/Kotonoha/releases/latest) 下载 **Setup**（推荐，支持自动更新）或 **Portable**（免安装）
2. 首次启动跟随新手引导，进入**设置**填入 API 密钥（DeepSeek / Agnes / 任意 OpenAI 兼容端点）
3. 主菜单点「新游戏」开始对话

> 也提供 **CLI 终端形态**：`agent/dist/cli.js chat "消息"` 单条对话、`repl` 交互模式（与桌面版会话互通）。

## 核心功能

### Agent 引擎（自研 Harness）
| 能力 | 说明 |
|------|------|
| 流式对话 | 打字机演出，支持思考过程（reasoning），随时停止生成 |
| 工具系统 | 20+ 内置工具，只读并行执行，Git checkpoint/undo |
| 可扩展 | 插件（`~/.kotonoha/plugins/`）、Shell/HTTP 配置工具、MCP 服务器管理界面 |
| MCP 双向 | 连接外部 MCP server；Kotonoha 自身也可作为 MCP server 被其它 agent 连接 |
| 权限审批 | 三档（允许/询问/拒绝）+ 「始终允许」规则 + 弹窗裁决 |
| 降级容错 | 主模型失败自动切换备用 provider，健康监控探活 |
| 三层记忆 | 会话（episodic）+ 知识偏好（semantic，自动提取）+ 自学习技能（procedural） |
| 会话管理 | Fork/重命名/导出（JSON/Markdown）/归档/压缩/全文搜索/时间线回放 |
| 成本统计 | 每次调用 token/费用落库，统计页汇总 |
| 中断恢复 | 随时停止生成，状态不残留 |

### 视觉小说体验
- **情绪演出**：模型回复自带情绪标签，立绘 7 种表情切换（思考/开心/道歉…）
- **语音朗读**：言叶开口说话（系统 TTS，情绪影响语调，可关闭）
- **羁绊系统**：好感度四档成长（陌生→熟悉→信赖→羁绊），言叶的语气随之进化
- **ESC 面板 10+1 页签**：存档 / 模型 / 技能（工具集+技能批准+记忆） / 会话（搜索+时间线+导出） / 羁绊 / Git / MCP / 命令 / 凭据 / 统计（成本+降级+轨迹）
- **桌面集成**：系统托盘常驻、全局快捷键（Ctrl+Shift+K）、应用内自动更新、中/英/日三语界面

### 模型支持
| 供应商 | 模型 |
|--------|------|
| DeepSeek（官方） | deepseek-v4-flash（默认）、deepseek-v4-pro、deepseek-v4-flash-vision-exp |
| Agnes AI | 图像/视频生成 |
| Ollama（本地） | 自动发现本地模型，离线可用 |
| 任意 OpenAI 兼容 | 自定义 baseURL + API Key |

## 目录结构

```
Kotonoha/
├── agent/                     # Harness 引擎（TypeScript，独立进程）
│   ├── src/
│   │   ├── core/             #   会话引擎 + agent loop + 情绪解析
│   │   ├── providers/        #   模型路由（DeepSeek/Agnes/Ollama + 降级链）
│   │   ├── tools/            #   工具注册表 + 内置工具 + 插件 + 外接配置
│   │   ├── mcp/              #   MCP 客户端 + Server 模式
│   │   ├── auth/             #   权限审批 + 规则引擎
│   │   ├── memory/           #   三层记忆（semantic/procedural）
│   │   ├── store/            #   SQLite 持久化 + 成本/搜索/羁绊
│   │   └── cli.ts            #   CLI 终端形态
│   └── scripts/              #   验收/回归测试脚本
├── app/                       # 桌面应用（Electron + React）
│   ├── electron/             #   主进程（agent 生命周期/托盘/更新）
│   ├── src/
│   │   ├── components/       #   视觉小说 UI（面板/对话框/立绘）
│   │   ├── bridge/           #   前端协议桥接
│   │   ├── hooks/            #   TTS/BGM/事件 hooks
│   │   └── i18n/             #   中/英/日语言包
│   └── scripts/              #   打包辅助
└── docs/plans/                #   架构规划文档
```

## 技术栈

| 层 | 技术 |
|----|------|
| Harness 引擎 | TypeScript + better-sqlite3 + Node 22（打包内置） |
| 桌面应用 | Electron 36（sandbox + contextIsolation） |
| 前端 | React 18 + Vite |
| 模型协议 | OpenAI 兼容 API |

## 开发者指南

```bash
# 引擎（3080 端口）
cd agent && npm install && npm run build && npm start

# 桌面应用开发模式（5173 端口热更新）
cd app && npm install && npm run dev
cd app && npm run dev:electron   # Electron 壳（另开终端）

# 打包
cd app && npm run build:app      # dist-release/ 下产出 portable + setup
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [全局规划](docs/plans/master-plan-2026-08-21.md) | M0-M6 完整路线 |
| [Harness v2](docs/plans/harness-v2-optimization.md) / [v3](docs/plans/harness-v3-tools.md) | 引擎架构演进 |
| [v0.2.x 路线](docs/plans/roadmap-v0.2.x.md) | 演出/语音/羁绊/桌面 |

## 许可证

MIT