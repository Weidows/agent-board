# agent-board — 面向 agent 的 miro

多 agent 并行做项目时，项目 / 临时文件 / 链接 / 临时记录散落一地。
agent-board 是一个本地零依赖白板：**项目=画布，万物=卡片**，人可拖拽，agent 可调 API。

- 后端：Python 标准库 only（`http.server`），数据落盘 `data.json`
- 前端：单文件 `index.html`，无限画布（平移/缩放/拖卡片/双击新建）
- agent 优先：REST API 全量 CRUD，卡片带 `x,y` 坐标、类型、标签、状态

## 启动（uv）

```bash
cd agent-board
uv sync          # 首次：建 .venv（零依赖，秒级）
uv run server.py # → http://127.0.0.1:8787
PORT=9000 uv run server.py
```

## agent API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全量（boards + cards） |
| POST | `/api/boards` | `{title, desc?}` 新建项目画布 |
| PATCH | `/api/boards/:id` | 改标题/描述 |
| DELETE | `/api/boards/:id` | 删除画布（含卡片） |
| POST | `/api/cards` | 新建卡片（见下） |
| PATCH | `/api/cards/:id` | 改卡片任意字段（含 x,y） |
| DELETE | `/api/cards/:id` | 删卡片 |

新建卡片：

```bash
curl -s localhost:8787/api/cards -H 'Content-Type: application/json' -d '{
  "board_id": "<board id>",
  "type": "note",
  "title": "临时记录",
  "body": "agent 写点什么…",
  "url": "", "path": "",
  "x": 100, "y": 200,
  "color": "yellow", "tags": ["todo"], "status": "open"
}'
```

卡片 `type`: `note` 笔记 / `link` 链接 / `file` 本地文件路径 / `task` 任务。
`status`: `open` / `done`（task 打勾用）。

## agent 使用约定（建议写进 agent prompt）

- 开工先 `GET /api/state` 看有哪些 board，没有就 `POST /api/boards` 建一个
- 临时文件/链接/结论随手 `POST /api/cards` 扔到对应 board（`path` 填绝对路径，`url` 填链接）
- 做完把 task 卡片 `PATCH status=done`
- 坐标随手给（防重叠：x += 260 依次排），人不讲究位置，agent 只管记下来

## 文件

- `server.py` — 后端 + 静态服务 + 原子写盘
- `index.html` — 前端画布
- `data.json` — 真实数据（已 gitignore，首次从 seed 起）
- `seed.json` — 示例画布
- `frontend/` — React + Tailwind v4 + React Flow 前端（`frontend/dist/` 构建产物已提交，后端直接serve，无需 node 即可运行）
- `index.html` — 旧版单文件前端（备用，后端在无 dist 时回退到它）

## 开发

```bash
cd frontend
pnpm install
pnpm dev      # 开发模式，/api 代理到 :8787（后端需先起）
pnpm build    # 构建到 frontend/dist，后端直接serve
```
