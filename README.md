# Kotonoha（言葉）

> 把 AI Agent 工作台做成视觉小说（Galgame）风格的界面。
> Kotonoha 在日语中意为「话语」——言语与声音，正是人与 AI 对话的本质。

## 项目定位

DeepSeek Harness（dsh）内核 + 自建 Galgame 前端壳。

- **内核**：DeepSeek Harness（dsh）—— 开源 agent harness，「一切皆插件」
- **前端**：自写视觉小说风格 UI（路径 D 方案）
- **目标**：agent 干活的过程被包装成「剧情演出」，像玩 Galgame 一样使用 AI 编码助手

## 设计理念

DeepSeek Harness 的定位是「组装 Agent 的运行时」——换 UI 不动内核是它的核心卖点。
本项目利用这一特性，用 Galgame 前端壳替代 dsh 自带 Web UI：

- 底部对话框 + 角色立绘
- 剧情文本打字机/渐入效果
- 选项分支 = 给 agent 发不同指令
- 背景图/场景切换、BGM
- 日系字体、复古光效

## 技术选型（草案）

- 前端：React / Vue + PixiJS（演出层）
- 通信：dsh 的 ACP / JSON-RPC / WebSocket
- 后端：dsh 内核（node_modules 全局安装的 @deepseek-ai/dsh）

## 参考项目

| 项目 | 用途 |
|------|------|
| [LingChat](https://github.com/SlimeBoyOwO/LingChat) | Galgame UI 设计参考（立绘/情绪/语音/剧本） |
| [ST-CinemaMode](https://github.com/Tech-Explorer-AI/ST-CinemaMode) | 把任意聊天流解析成 Galgame 演出的前端思路 |
| [dsh](https://github.com/deepseek-ai/deepseek-harness) | 内核，通过 ACP/JSON-RPC/WebSocket 驱动 |

## 相关环境

- dsh 全局安装于 `C:\Users\10660\.nvm\...\node_modules\@deepseek-ai\dsh`（v0.1.0-rc.7）
- dsh 配置家目录：`~/.dsh`（profiles/web、settings.yaml、credentials.yaml）
- dsh 启动：`dsh web` → `http://127.0.0.1:3080`
- 模型：opencode provider / deepseek-v4-flash-free

## 目录结构

```
docs/
├── memory/      # 对话记忆迁移
└── records/     # 故障记录/工作记录
```