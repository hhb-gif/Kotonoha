# Update Feature: 应用内自动更新 (v0.1.1)

> 目标：用户已安装 v0.1.0，新版本发布后应用内自动检查并更新，无需重新下载。

## 方案

| 分发形态 | 更新方式 |
|----------|----------|
| **Setup (NSIS 安装版)** | electron-updater 自动下载 + 静默安装 + 重启 |
| **Portable (免安装版)** | 检测到新版本 → 提示打开 GitHub Release 页手动下载（electron-updater 对 portable 无自动安装支持） |

## electron-builder 集成要点
- package.json `build.publish` 配 `provider: github, owner: hhb-gif, repo: Kotonoha`
- electron-builder 打包时自动生成 `latest.yml`（nsis 更新元数据）+ `latest-mac.yml`（忽略）
- **发布时用 `gh release upload` 上传 exe + latest.yml**（更新通道）

## 实现任务

### U1-main: main.cjs 集成 electron-updater
- 安装 `electron-updater`
- 启动后（延迟 3s，避免阻塞首屏）检查更新：
  - `autoUpdater.checkForUpdatesAndNotify()` 有可用更新自动下载（nsis）
  - 事件：`update-available` → 前端通知；`download-progress` → 进度；`update-downloaded` → 提示重启安装
- `app.isPackaged` 时才启用（dev 不检查）
- portable 检测：`process.env.PORTABLE_EXECUTABLE_FILE` 存在 → 走「打开 GitHub Release」逻辑（不自动更新）
- IPC 暴露：`app:checkUpdate`（前端触发）、事件推送 `update:status`

### U2-ui: 设置面板「检查更新」
- 设置面板加「检查更新」按钮
- 状态显示：检查中 / 已是最新 / 发现新版本(版本号+更新按钮) / 下载进度
- 下载完成 → 「重启并安装」按钮
- 更新相关样式加入 styles.css

### U3-config: package.json + 打包
- 加 electron-updater 依赖
- `build.publish` 配置 github provider
- 确认打包产物含 latest.yml

## 验收
1. `npm run build:app` 产出含 latest.yml 的 exe
2. nsis 安装版运行 → 启动后检查更新逻辑执行（无网络/无新版本时静默，不崩）
3. 前端「检查更新」按钮触发 IPC → 返回版本状态
4. portable 模式检测到新版本 → 提示打开 Release 页

## 发布流程（每次发版）
1. 改 package.json version
2. `npm run build:app`
3. `gh release create vX.Y.Z dist-release/*.exe dist-release/latest.yml`
4. 用户应用内自动更新（nsis）或提示下载（portable）

## 风险
- GitHub API 访问慢/被墙 → 更新检查超时（5s）静默失败，不打扰用户
- electron-updater 与 electron-builder 版本兼容 → 用 6.x + 24.x 已验证生态