# 构建与发布

## 环境

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | ≥ 18（推荐 20 LTS） | 全部 |
| npm | ≥ 9 | 依赖 |

没有任何 Python / 原生模块依赖，`npm install` 之后即可运行与打包。

```bash
npm install          # 会下载 Windows 版 Electron 二进制
npm start            # 直接跑
```

国内网络下载 Electron 失败时：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
# 或
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node node_modules/electron/install.js
```

## 打包

```bash
npm run icon          # 生成 build/icon.png（那双眼睛，1024²）
npm run dist:x64      # Windows x64 安装包
npm run dist:arm64    # Windows arm64 安装包
npm run dist:offline  # 同上 x64，但复用本地 electron 二进制
```

产物在 `release/`，配置见 `electron-builder.yml`。只出 NSIS 安装包，**不做 portable**。

### 打包时的四个坑（踩过了，写在这）

**1. 架构别写两遍。** `win.target` 里不要再写 `arch: [x64, arm64]`。配置与命令行同时声明架构时，
electron-builder 会额外生成一个「双架构合一」的 nsis，然后把自己撞死：

```
⨯ Generated installer (121437761 bytes) is smaller than the embedded archive(s) (241700506 bytes)
```

架构只从命令行给（`--x64` / `--arm64`），配置里只写 target 类型。

**2. Windows 桥脚本必须解包。** `spawn` 是内核调用，Electron 的 asar 兼容层无法把它重定向进
归档，所以配置里写了：

```yaml
asarUnpack:
  - desktop/main/platform/*.ps1
```

`win32.js` 的 `resolveScript()` 会在运行时把 `app.asar/...` 换成 `app.asar.unpacked/...`。这条
路径一旦改错，症状是「安装版里媒体控制静默失效，开发模式却正常」。`.ps1` 必须带 UTF-8 BOM，
否则 PowerShell 5.1 会按 GBK 读中文注释，直接语法错误。

**3. 离线打包。** 若 electron-builder 卡在 `unpacking default Electron distribution`（拉不动 zip
或解压卡住），直接复用已经装好的 Electron：

```bash
npm run dist:offline    # 等价于 --config.electronDist=node_modules/electron/dist
```

**4. 不要在便携目录里跑。** 安装包会装到 `%LOCALAPPDATA%\Programs\wl-Island`，`asarUnpack` 出来
的桥脚本路径稳定。如果硬把 `win-unpacked` 拷到带空格或中文的目录，`spawn` 的引号处理偶发失效，
表现为「岛能起来，媒体读不到」。

### Windows

- 目标：只有 `nsis`（安装版），`oneClick: false`，可选安装目录，装桌面与开始菜单快捷方式
- 产物：`wl-Island-<版本>-win-x64.exe`、`wl-Island-<版本>-win-arm64.exe`
- 两个架构分两次跑，别指望一条命令出全（见第一条坑）
- 未签名安装包会被 SmartScreen 拦一次，点「更多信息 → 仍要运行」
- 想签名就设 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量
- 卸载默认保留 `%APPDATA%\wl-Island`（配置、待办、中转站），由 `deleteAppDataOnUninstall: false` 决定

## CI

[`.github/workflows/build.yml`](../.github/workflows/build.yml) 只有两个 job：

| Job | 触发 | 产物 |
| --- | --- | --- |
| `syntax gate` | push / PR | 无（37 个 JS 文件的语法门禁） |
| `windows (x64 / arm64)` | push / tag | `*.exe` |

想做正式 Release，把 `release/*` 换成 `electron-builder --publish always` 并配 `GH_TOKEN` 即可
（打 `v*` tag 时自动发布）。`npm ci` 需要 `package-lock.json`，本仓库已提交。

## 发布清单

- [ ] `node scripts/check-syntax.js` 通过（应输出 `✓ 37 JS files parsed`）
- [ ] `npm run dev` 跑一遍截图回归，`.tmp/` 里没有 `CLIPPED`
- [ ] 手动过一遍：拖动跟手、眼睛跟随、十四套主题、拖文件进岛、待办勾选、状态刷新、设备页与优化页
- [ ] `npm run icon` 重新生成图标
- [ ] 设置 → 关于 → 运行诊断 全绿或明确标黄
- [ ] 版本号同步：`package.json` 与 `electron-builder.yml`（后者用 `${version}`，无需改）
- [ ] CHANGELOG 补一条
- [ ] 打 tag：`git tag v0.3.0 && git push --tags`

## 产物体积参考

| 产物 | 大小（实测） |
| --- | --- |
| wl-Island-0.3.0-win-x64.exe (NSIS) | 116 MB |
| wl-Island-0.3.0-win-arm64.exe (NSIS) | 111 MB |

国内网络下 arm64 的 Electron 二进制容易 `socket hang up`，加镜像重试即可：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:arm64
```

Electron 的固有体积。如果在意，可以考虑 Tauri 重写，但媒体/蓝牙的系统集成工作量会翻几倍——
这也是当初选 Electron 的原因。
