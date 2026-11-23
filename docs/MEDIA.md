# 媒体控制：一条主链路与两种「特殊播放器」

媒体面板是 wl-Island 的重点，也是 Windows 上唯一需要跨进程才能拿到数据的一部分。这里写清楚
每一层在做什么，出问题该查哪里。

## 1. SMTC + 常驻 PowerShell 桥

Windows 的「系统媒体传输控件」（`GlobalSystemMediaTransportControlsSessionManager`）是唯一能同时
拿到**元数据 + 封面 + 播放进度 + 可控性**的公开接口。

难点在调用方式：它是 WinRT 异步 API，PowerShell 5.1 没有 `await`。wl-Island 用一个**常驻**的
`powershell.exe` 进程，通过 stdin/stdout 交换 JSON 行：

```
in : {"id":7,"cmd":"media.status","target":"cloudmusic.exe"}
out: {"id":7,"ok":true,"data":{"title":"成都","artist":"赵雷",...}}
```

为什么常驻而不是每次 `spawn`：新建一个 PowerShell 进程约 250–400 ms，1.6 秒轮询一次等于持续
烧 CPU；常驻进程空闲时几乎零开销。

桥内实现了：

| 命令 | 作用 |
| --- | --- |
| `media.status` | 当前 / 指定会话的元数据、播放态、进度、是否可 seek |
| `media.art` | 封面（`IRandomAccessStreamReference` → `DataReader` → base64），只在换歌时调一次 |
| `media.sessions` | **所有**可见会话（多播放器播放的关键，见第 3 节） |
| `media.control` | SMTC 优先，失败回落全局媒体键 |
| `media.fallback` | 不注册 SMTC 的播放器：窗口标题 + 扬声器峰值电平 |
| `bt.list` | `Get-PnpDevice -Class Bluetooth` |
| `proc.top` | 按工作集排前 5 的进程（状态面板用，4 s 缓存） |
| `act.mute` | 系统静音（发 `VK_VOLUME_MUTE`） |
| `mouse.left` | `GetAsyncKeyState(0x01)`，拖动时判断左键是否还按着 |

WinRT 类型加载被包在 `try/catch` 里：Windows 10 N 版 / LTSC 精简镜像可能缺少媒体组件，此时桥
不会崩，只是 `active:false`，媒体键兜底仍然有效。

### 媒体键兜底

某些播放器（尤其是基于 CEF 的桌面客户端、网页播放器）根本不注册 SMTC。这时
`keybd_event(VK_MEDIA_PLAY_PAUSE / NEXT / PREV)` 仍然有效，因为 Windows 会把媒体键路由给
「最近活跃的媒体应用」。

代价：媒体键是**盲发**，拿不到反馈，也无法 seek。所以策略是「能 SMTC 就 SMTC」，UI 上不区分
——`canSeek` 会告诉面板是否显示可拖动的进度条。

### 网易云 3.x：连会话都没有

网易云音乐 3.x 主进程的启动参数里带着

```
--disable-features=...,MediaSessionService,SameSiteByDefaultCookies,...
```

也就是**主动关掉了 Chromium 的媒体会话**，同时自己也不调用
`SystemMediaTransportControls`。结果：`GetSessions()` 返回 0 个会话，
`GetCurrentSession()` 为 `$null` —— 只靠 SMTC 的版本在这台机器上永远是「未在播放」，
哪怕歌正在放。

`media.fallback` 用两条还在的信号把它拼回来：

| 信号 | 来源 | 用途 |
| --- | --- | --- |
| 窗口标题 `歌曲 - 歌手` | `EnumWindows` + `GetWindowText`，按进程名白名单（cloudmusic / QQMusic / KuGou / KwMusic / Spotify…） | 曲目 |
| 扬声器峰值电平 | Core Audio `IAudioMeterInformation.GetPeakValue()`，8 次采样取最大 | 是否在播 |

峰值电平而不是会话状态：Chromium 暂停后音频流会**继续保持 Active 好几分钟**（实测 6 s 仍是
`Active`），只有峰值在 0.5 s 内归零。所以播放态判定是「最近 2 s 内见过峰值」，暂停超过 1.4 s
后以用户最后一次点击为准（避免淡出尾巴把图标弹回「播放中」）。

窗口评分规则：同一进程可能有多个窗口（网易云的「桌面歌词」也带标题），带 `歌曲 - 歌手` 结构的
加分，标题里出现 `歌词 / Lyric / 迷你` 的减分，`桌面歌词`、`网易云音乐` 这类纯应用名直接丢弃。

这类播放器自己没有时间轴。`media.fallback` 额外返回 `meter` 标志：某些虚拟/远程声卡没有端点
峰值表，这时不能把「读不到」当成「静音」，改为默认播放中并跟随用户的播放/暂停操作。

### 封面、歌词与本地时钟

窗口标题只有曲名，SMTC 封面和本地歌词服务都拿不到数据。`MediaService._resolveSong()` 用
「曲名 + 歌手」查网易云公开接口，一次搜索同时服务封面与歌词：

```
/api/search/get?type=1&s=<曲名 歌手>&limit=5   → 歌曲 id / 时长(ms)
/api/song/detail?ids=[id]                      → album.picUrl（搜索结果里没有封面直链）
p2.music.126.net/<picId>.jpg?param=300y300     → 封面字节 → data: URL
/api/song/lyric?id=<id>&lv=1&kv=1&tv=-1        → LRC 文本
```

- 曲名做归一化比对（去空格、括号、标点），匹配不上就不取，避免给错封面。
- 真实时长让 `0:00 / 0:00` 的死进度条变成 `0:00 / 2:41`；`canSeek` 仍是 `false`，因为媒体键
  无法 seek。
- 服务维护一个本地时钟（切歌归零、暂停停走），驱动 LRC 逐行滚动；换歌时封面与歌词一起清空，
  不会把上一首的歌词带过来。
- LRC 开头的「作词 / 作曲 / 编曲」署名行会被过滤；歌曲开场空档胶囊直接显示第一句歌词。
- 所有请求 6–7 s 超时、失败静默降级、按 `曲名|歌手` 缓存；断网只影响封面和歌词。
- 设置里填了本地 `media.neteaseApi`（NetEaseCloudMusicApi）时优先走本地，未填才用公开接口；
  关掉「显示封面」或「歌词」即可完全禁用联网查询。

## 2. 为什么桥脚本必须是解包状态

`spawn` 是内核调用，Electron 的 asar 兼容层无法把它重定向进归档。所以：

```yaml
asarUnpack:
  - desktop/main/platform/*.ps1
```

`win32.js` 的 `resolveScript()` 在运行时把 `app.asar/...` 换成 `app.asar.unpacked/...`。
症状很典型：**开发模式一切正常，安装版媒体控制静默失效**。

另外 `.ps1` 必须保留 UTF-8 BOM——PowerShell 5.1 会按系统 ANSI 码页（中文机器上是 GBK）读
无 BOM 的脚本，中文注释直接变成语法错误，进程秒退，上层只看到「媒体读不到」。

## 3. 网易云 / 波点：多会话问题

这是「支持所有音乐平台」里最容易被忽略的坑。

**问题**：网易云、QQ 音乐、波点、甚至浏览器标签页，都会各自向系统注册一个媒体会话。而
`GetCurrentSession()` 只返回系统认为「当前」的那一个——它可能是你刚在后台暂停的那个，而不是你
眼前正在播的那个。

**解法**：wl-Island 不用 `GetCurrentSession`，而是列出全部会话，并允许**固定**：

```js
media:sessions  → [{ id: "cloudmusic.exe", app: "网易云音乐", playing: true }, ...]
media:target    → 写入 config.media.preferApp
```

之后所有 `media.status` / `media.art` / `media.control` 都带上 `target`，桥在 `GetSessions()` 里
按 `SourceAppUserModelId` 精确匹配。

媒体面板底部的播放器 chips 就是这个开关；设置 → 媒体 里也能设。**当控制按钮没反应时，先看这个
chip 选中的是不是你在看的那个播放器。**

## 4. 封面取色做玻璃

封面不只是一张图片：主进程把封面缩小后交给渲染层，渲染层用 `background-image` +
`filter: blur(34px) saturate(190%)` + `transform: scale(1.45)` 铺成 `.tint` 层，再叠
`linear-gradient` 玻璃、`sheen` 高光、`grain` 噪点。

模糊半径由 设置 → 外观 → 背景模糊 控制（`appearance.blur`），取色透明度由
`appearance.tintOpacity` 控制。**注意**：Windows 上不用 `backdrop-filter`，它会让 DWM 丢弃整层，
岛直接不可见。

## 5. 歌词（可选）

没有任何系统媒体接口提供歌词，所以这是唯一需要外部服务的能力：

```bash
git clone https://github.com/Binaryify/NeteaseCloudMusicApi
cd NeteaseCloudMusicApi && npm install && node app.js   # 默认 http://127.0.0.1:3000
```

然后在 设置 → 媒体 → 歌词 填入地址并打开开关。流程：

1. `GET /search?keywords=<标题 歌手>&limit=1` 取第一首的 id
2. `GET /lyric?id=<id>` 取 LRC
3. 解析 `[mm:ss.xx]` 时间轴，按当前进度滚动单行

只对网易云曲库有效；其它平台的歌大概率搜不到或对不上。搜索 / 歌词结果按「标题|歌手」缓存 10 条。

打开「收缩态显示歌词」后，胶囊会从 148 px 拉宽到 340 px 跟着唱；换行是两条绝对定位的行交替
（向上滚动 + 交叉淡入），超长句缓慢横移。间奏保留上一句，避免宽度抖动。

## 6. 故障排查

| 现象 | 先查什么 |
| --- | --- |
| 面板一直「未在播放」 | 设置 → 关于 → 运行诊断；看「SMTC 媒体桥」是否 ok |
| 有歌名但没有封面 | 播放器没在 SMTC 里给 `Thumbnail`；网页播放器常见 |
| 进度条不可拖 | `canSeek == false`，该播放器不支持 seek（或用媒体键兜底） |
| 按钮点了没反应 | 是否固定到了错误的播放器（第 3 节） |
| 换歌后封面慢一拍 | 正常：封面是换歌后才异步拉取的（避免每次轮询搬几十 KB base64） |
| 安装版才算读不到 | 桥脚本没解包，或 `.ps1` 丢了 BOM（第 2 节） |

## 7. 给面板作者的约定

`media` 事件里给的 `position` 是**上次采样时的位置**，配套 `stamp`（时间戳）和 `playing`。
要做平滑进度，请自己外推：

```js
const elapsed = playing ? (Date.now() - stamp) / 1000 : 0;
const pos = Math.min(duration, position + elapsed);
```

不要为了平滑去提高轮询频率——那会持续拉高系统调用开销，收益远不如本地插值。
