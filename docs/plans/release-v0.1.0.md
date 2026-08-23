# Release v0.1.0 打包完善规划

> 目标：产出可发布的第一个完整 release（portable + setup 双格式），SQLite 全功能可用。

## 核心问题与方案

| 问题 | 现状 | 方案 |
|------|------|------|
| **better-sqlite3 ABI 不匹配** | Electron 31 = ABI 125，agent 用 Node 22 = ABI 127，无 MSVC 无法重编 → 打包后 SQLite 不可用（骨架模式） | **内置 node.exe（Node 22，ABI 127）打进 resources/node**，打包后 agent 用它运行，与系统编译的 better-sqlite3 ABI 完全一致，零编译。**注：Electron 36.9.5 内嵌 Node 22.19 但 ABI 是 135（Electron 独立编号，非 127），无法直接复用系统 ABI 的 better-sqlite3** |
| 无应用图标 | 默认 Electron 图标 | 生成 icon.ico（256px，深紫/星空主题） |
| 无单实例锁 | 可重复启动 | app.requestSingleInstanceLock() |
| 版本/元数据 | 0.1.0 | 完善 productName/version/作者/描述 |
| 数据目录 | 打包后 KOTONOHA_DATA_DIR 在 userData | 已在 main.cjs 处理 ✓ |

## 任务分解

### G2-electron 升级+打包完善
- `app/package.json`: electron ^31 → ^36.9.5，重新 npm install（二进制下载走 ELECTRON_MIRROR 镜像）
- 生成 `app/build/icon.ico`（256px 深紫星空 + 言叶文字，scripts/gen-icon.py + PIL）
- electron-builder 配置完善：icon、win 目标（portable + nsis）、artifactName、nsis 向导式安装
- main.cjs 增加：requestSingleInstanceLock、窗口图标、默认菜单、will-quit/uncaughtException 兜底回收
- 打包模式 agent 改由内置 node.exe（extraResources → resources/node/node.exe）运行
- 验证：`npm run pack:dir` 产物里内置 node.exe 加载 better-sqlite3 实测通过，e2e 启动 health ok

### V2-release 验证
- 打包后 exe 完整验证：SQLite 会话落盘、真实对话、工具审批
- 用户区数据目录确认（userData/agent-data）
- 打包体积、冷启动时间记录

## 验收标准
1. `npm run build:app` 产出 portable + setup 两个 exe
2. 打包 exe 内 agent 的 `session.create` 真实写入 SQLite（非骨架）
3. 打包 exe 内真实 DeepSeek 对话可用（key 注入 secrets）
4. 单实例锁生效、退出回收 agent 子进程
5. 图标正确显示

## 风险
- Electron 36 下载需网络（已走 npmmirror 镜像）
- **Electron ABI 独立编号（36=135），与系统 Node 22（127）不同**，已用内置 node.exe 方案绕过（无需重编）
- 内置 node.exe 增加约 40MB 体积（portable 102MB / setup 102MB）
- better-sqlite3 运行时依赖 bindings + file-uri-to-path 需一并打进 resources/agent/node_modules（已处理）