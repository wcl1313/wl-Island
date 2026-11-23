# 外部接口

wl-Island 目前对外只开放一个 HTTP 入口（其余能力都在进程内）。这是刻意保守的：一个常驻桌面的浮层不应该默认监听一堆端口。

## POST /notify

任何脚本、构建工具、CI、浏览器用户脚本都可以往灵动岛推一条消息。

```
POST http://127.0.0.1:7788/notify
Content-Type: application/json
```

```json
{
  "title": "构建完成",
  "body": "3 分 12 秒 · 0 错误",
  "level": "success",
  "actions": [
    { "id": "open", "label": "查看日志" }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 必填，截断到 80 字符 |
| `body` | string | 截断到 400 字符 |
| `level` | `info` \| `success` \| `warn` \| `alarm` | 决定图标与配色，默认 `info` |
| `actions` | array | 最多 3 个按钮；`id` 会原样回传给内部动作处理器 |

响应：

```json
{ "ok": true, "id": "8f3a1c2d" }
```

### 示例

```bash
# 构建完成
curl -X POST http://127.0.0.1:7788/notify \
  -H "content-type: application/json" \
  -d '{"title":"构建完成","body":"3 分 12 秒","level":"success"}'

# 长任务失败
curl -X POST http://127.0.0.1:7788/notify \
  -H "content-type: application/json" \
  -d '{"title":"部署失败","body":"staging 环境健康检查超时","level":"alarm"}'
```

```js
// Node 里
await fetch('http://127.0.0.1:7788/notify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: '单元测试', body: '248 passed', level: 'success' })
});
```

```python
# Python 里
import requests
requests.post('http://127.0.0.1:7788/notify',
              json={'title': '训练完成', 'body': 'epoch 40 · loss 0.021', 'level': 'success'})
```

### 行为细节

- 4 秒内完全相同的 `title + body` 会被去重（避免「闹钟 + HTTP + 系统通知」三重触发）
- 最多同时显示 3 条 banner，自动 6.2 秒消失；鼠标悬停暂停计时
- 面板收起时 banner 会把岛撑开；面板展开时 banner 出现在岛下方，不打断当前面板
- 端口在 设置 → 更多 里可改；关掉「通知」服务会同时关掉这个 HTTP 入口

## GET /health

```
GET http://127.0.0.1:7788/health  →  { "ok": true, "app": "wl-island" }
```

用来在脚本里判断 wl-Island 是否在跑。

## 安全说明

- 只绑定 `127.0.0.1`，不接受外部连接
- 没有鉴权：能跑在本机的进程本来就能读你的播放状态、你的中转站目录——再加一层 token 只是心理安慰。如果你在多用户机器上跑，请改端口或关掉这个服务
- 请求体上限 64KB，超出直接断连

## 计划中

- [ ] `GET /media` 只读当前播放状态（给 stream deck / 状态栏类工具用）
- [ ] `POST /media/control`
- [ ] `GET /events`（SSE）订阅状态变化
- [ ] 自定义动作注册（`actions[].id` 回调到外部 URL）

这些故意没有先做：接口一旦发布就要维护兼容性，先让内部结构稳定。
