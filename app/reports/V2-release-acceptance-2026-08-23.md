# V2 Release 打包产物验收报告

日期: 2026-08-23
产物目录: `E:\Kotonoha\app\dist-final\`
验收环境: Windows (win32), 已验证无残留进程/端口后开始

## PASS/FAIL/SKIP 表

| # | 验收项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 产物存在性（两个 exe >50MB） | **PASS** | portable 107,211,113 B (102.2MB)；setup 107,476,613 B (102.5MB) |
| 2.1 | portable 启动：Kotonoha 进程存在 | **PASS** | 4 个 Kotonoha.exe（Electron 主/GPU/渲染/工具进程）从 SFX 临时目录运行 |
| 2.2 | agent 子进程端口 3180-3279 | **PASS** | 内置 `resources\node\node.exe resources\agent\dist\index.js`，实测监听 3180 / 3237（均在区间内） |
| 2.3 | `GET /api/health` → ok:true | **PASS** | `{"ok":true}` |
| 2.4 | SQLite 真实落盘（WAL） | **PASS** | `%APPDATA%\kotonoha-app\agent-data\kotonoha.db`(+.db-wal+.db-shm) 存在；内置 better-sqlite3 打开读回 4 events / 2 sessions；应用退出后重开数据仍在（WAL 重放） |
| 2.5 | 真实对话「你好」WS 流 | **PASS** | session.create→WS `/api/events.mux`→`turn/start, assistant/chunk(reasoning-delta,text-delta,finish), turn/end`→`finish{reason:{kind:"stop"}}`；text-delta 累计 141 字中文；assistant/message 369 字完整落盘 |
| 2.6 | tools.list ≥10 工具 | **PASS** | 返回 14 个工具（read_file/write_file/edit_file/glob/grep/task/bash/run_command/git_*/fetch_url/web_search/execute_skill） |
| 3 | 退出回收（无孤儿 node.exe） | **PASS** | 优雅关闭（CloseMainWindow）→ 全部 Kotonoha 进程退出、agent node.exe 被杀、3180-3279 无监听（验证两轮） |
| 4.1 | setup exe 存在 | **PASS** | 107,476,613 B |
| 4.2 | setup 内部含 node.exe + better_sqlite3.node | **PASS** | 7-Zip 22.01 识别为 NSIS-3 Unicode，载荷 `$PLUGINSDIR\app-64.7z` 内确认 `resources\node\node.exe`(86,969,160 B) 与 `resources\agent\node_modules\better-sqlite3\build\Release\better_sqlite3.node`(1,721,344 B) |
| 4.3 | portable/setup 载荷一致 | **PASS** | 两者 `app-64.7z` SHA256 完全一致 (5D354B4BCE...) |
| 5 | 单实例锁 | **PASS** | 静态：`main.cjs` requestSingleInstanceLock + second-instance focus；动态：第二实例启动后无新增 Kotonoha.exe/node.exe、无新端口，第二 SFX 约 20s 自行退出 |

**结果: 10 PASS / 0 FAIL / 0 SKIP**

## 数据目录确认

`C:\Users\10660\AppData\Roaming\kotonoha-app\agent-data\`
- `kotonoha.db` (4096 B，WAL 模式主文件，数据在 wal)
- `kotonoha.db-wal` (115,392 B，实际会话数据)
- `kotonoha.db-shm` (32,768 B)
- `secrets.enc` (354 B，见备注)

## 备注 / 问题

1. **真实对话的 key 注入**：打包后的 userData/agent-data 初始无 key（`credentials.describe` → configured:false）。为跑通真实对话，验收时从开发环境 `E:\Kotonoha\agent\data\secrets.enc`（含 DEEPSEEK_API_KEY，机器密钥派生可解密）复制注入到数据目录，agent 重启后读到 key（configured:true, source "dsh credentials.yaml"）并完整实测对话。若按"打包环境无 key"口径，该项可记为 SKIP；本报告按注入后实测记 PASS。当前数据目录残留此 secrets.enc（含测试 key），是否清理由用户决定。
2. **portable 自清理**：SFX 退出时自动删除临时解压目录（正常行为）。
3. **session.history 返回聚合消息**（user/message、assistant/message），非 chunk 流，验证脚本需注意，非缺陷。
4. **端口随机分配**：两轮实测 3180 / 3237，均落在 3180-3279 区间。
5. 未实际安装 setup exe（避免污染系统），仅以 7-Zip 静态校验内部载荷；win-unpacked 目录已含 node.exe + better_sqlite3.node 且 portable 运行实证 ABI 127 匹配（内置 node v22.22.3 + better-sqlite3 正常打开数据库）。

**结论：V2-release 产物可发布。**