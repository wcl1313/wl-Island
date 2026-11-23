# 在真机上验证

只做 Windows。这份文档写的是**怎么在不盯着屏幕的情况下判断改坏了没有**，以及几个只有在真机上
才会撞到的点（SMTC 读不到、桥脚本失效、拖放丢了 `pointerup`）。

先记住一条：`npm start` 跑的是源码，`npm run dist:x64` 跑的是打包产物。两者行为必须一致；
不一致多半是 asar 相关（桥脚本没解包），见 `BUILD.md` 第二条坑。

---

## 1. 截图回归（首选）

```bash
npm run dev
```

`--dev` 会挂上 `desktop/main/dev-harness.js`：它自己点开十个面板、切七套主题、模拟拖放与
打字，把每一屏 `capturePage()` 到 `.tmp/`，并在控制台打印几何数据。

```
[harness] dom {"stage":204,"island":"collapsed","theme":"midnight"}
[harness] pill-idle {"box":"148x36","eyes":"30x15"} 306x138
[harness] panel todo {"h":308,"view":218,"content":218} 768x546 
[harness] typing-keeps-open -> expanded
[harness] leave-collapse -> collapsed
[harness] done
```

读法：

| 字段 | 含义 | 期望 |
| --- | --- | --- |
| `box` | 胶囊的 CSS 尺寸 | idle 148×36 / media 248×36 / lyric 340×36 |
| `h` / `view` / `content` | 岛高 / 可视区高 / 内容高 | `content <= view`，否则行尾会打 `CLIPPED` |
| `typing-keeps-open` | 输入框有焦点时鼠标移开 | 必须是 `expanded` |
| `leave-collapse` | 光标移开后 | 必须是 `collapsed` |

截图清单：`pill-idle`、`pill-lyric`、`drop-veil`、`drop-veil-expanded`、`panel-*`（11 张）、
`theme-*`（6 张）、`banner`、`desktop-*`。改了 CSS 之后先看这 25 张图，比肉眼点一遍快得多。

> `capturePage()` 返回的是物理像素，`getContentSize()` 是 DIP；在 150% 缩放的屏幕上两者差 1.5 倍，
> 夹具里已经按 `scaleFactor` 换算过。

---

## 2. 手动清单（发布前必过）

| # | 动作 | 期望 |
| --- | --- | --- |
| 1 | 点胶囊 | 展开到 456 宽，高度按面板内容自适应，无裁切 |
| 2 | 按住胶囊拖到屏幕四角 | 1:1 跟手，**不闪、不抖、不粘鼠标**；松手后重启仍在原处 |
| 3 | 快速甩动后立刻松开 | 岛停下，不会跟着鼠标跑（`GetAsyncKeyState` 兜底） |
| 4 | 移动鼠标绕岛一圈 | 瞳孔跟着转，偶尔眨眼 |
| 5 | 鼠标移开 | 0.4 s 内收起；在 AI 输入框里打字时**不**收起 |
| 6 | 拖 3 个文件到收缩态胶囊 | 自动展开到中转站，虚线环 + 卡片，松手后计数 +3 |
| 7 | 拖文件到展开态面板任意位置 | 同上；面板内容整体淡出，不跟卡片打架 |
| 8 | 设置里连点十四套主题 | 整岛换色，雪原 / 象牙下所有面板真的反色（白底白字即失败） |
| 9 | 状态 → 设备 | USB 与 COM 端口有名称与类别，插拔后刷新能变 |
| 10 | 状态 → 优化 | 显示 C: 剩余、%TEMP% 大小、休眠状态；清理与休眠均弹系统确认框 |
| 11 | 打开一个全屏视频 | 岛自动隐藏，退出全屏后回来（设置里可关） |
| 9 | 拖「不透明度」滑块 | 只变透明度；媒体进度**不能**跳、蓝牙**不能**闪 |
| 10 | 待办：加一条 / 勾一条 / 星标 / 双击编辑 | 排序稳定，重启后还在 |
| 11 | 状态面板停 10 秒 | CPU/内存数值在动，进程列表不闪 |
| 12 | 托盘 → 重置位置 | 回到顶部居中 |
| 13 | `Ctrl+Shift+I` | 显示 / 隐藏 |

---

## 3. 只在真机上会撞到的点

### 3.1 SMTC 读不到（媒体面板空）

排查顺序：

```powershell
# 1. 系统层面有没有会话
Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 5

# 2. 桥脚本单独跑（最有效）
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\main\platform\win32-bridge.ps1
# 交互输入：media.state
```

`media.state` 返回 `{"active":false}` 只有三种可能：

1. 播放器没发布 SMTC 会话（部分国产播放器关掉「系统媒体控制」后就不发）；
2. PowerShell 桥起不来（`.ps1` 丢了 UTF-8 BOM → 中文注释按 GBK 解码 → 语法错误）；
3. 打包版里 `resolveScript()` 没把 `app.asar/` 换成 `app.asar.unpacked/`。

第 3 种的判定方法很干脆：**开发模式正常、安装版失效**，就一定是它。

### 3.2 蓝牙「已连接」不准

Windows 没有公开稳定的连接状态接口，这里用 PnP 设备状态近似。不同驱动（尤其是 Intel 与
Realtek 的蓝牙栈）表现不同。图标显示「已配对」但耳机没连上，属于已知边界，不是 bug。

### 3.3 拖放：`pointerup` 丢在窗口外

快速甩动时，鼠标可能在松开前已经离开 204×92 的窗口，渲染层收不到 `pointerup`。所以拖动必须
由主进程 16 ms 轮询 + `GetAsyncKeyState(0x01)` 判定，测试时专门甩一次：如果岛粘在鼠标上，
就是这条链路坏了。

### 3.4 屏幕缩放 125% / 150% / 200%

- 窗口尺寸全部按 DIP 计算，缩放后岛的大小应当不变（视觉上变大的是像素密度）；
- 如果拖到副屏（不同缩放）后位置偏移，检查 `general.anchor` 是全局 DIP 坐标，副屏的 origin
  可能为负值——这是预期行为。

### 3.5 多显示器

可以拖到任意显示器；锚点记的是全局坐标，重启后回到同一物理位置。拔掉那块显示器后岛会跑到
主屏可见区域外，此时用托盘「重置位置」救回来。

### 3.6 高对比度 / 减少动效

设置 → 外观 → 减少动效 会把所有 `transition/animation` 压到 0.001 ms（`prefers-reduced-motion`
同样生效）。系统开了「高对比度」时，浅色主题的文字对比度可能不足，建议切回「极夜」。

---

## 4. 打包产物验证

```bash
npm run dist:x64
# 装完从开始菜单启动，然后：
curl -X POST http://127.0.0.1:7788/notify -H "Content-Type: application/json" ^
  -d "{\"title\":\"构建完成\",\"body\":\"3 分 12 秒\",\"level\":\"success\"}"
```

岛上应当弹出一条横幅，眼睛「惊」一下。能弹出说明 HTTP 服务、IPC、渲染层都在；再点开媒体面板，
能读到当前播放就说明 PowerShell 桥在 asar 解包目录里也活着。

---

## 5. 一张自检表

| 检查项 | 通道 | 期望 |
| --- | --- | --- |
| 胶囊可见、四周无框 | 透明窗口 + 内容尺寸 | ✅ |
| 拖动跟手不闪 | 主进程光标轮询 | ✅ |
| 眼睛跟随 | 主进程 80 ms 光标推送 | ✅ |
| 鼠标移开自动收起 | 引用计数 + 0.4 s 宽限 | ✅ |
| 收缩态歌词 | SMTC + 本地歌词 API | 需 NetEaseCloudMusicApi |
| 媒体控制 | SMTC → 媒体键兜底 | 见 3.1 |
| 蓝牙设备图标 | PnP 枚举 | 见 3.2 |
| 通知 HTTP 接口 | `127.0.0.1:7788` | ✅ |
| 久坐检测 | `powerMonitor.getSystemIdleTime()` | ✅ |
| 状态面板 | `os.cpus()` + `fs.statfsSync` + 桥 | ✅ |
