# integration 体检报告（2026-11-18）

> 对象：`origin/integration` @ `1d3c21e`，本地检出 `D:\Travel-Planning-Assistant-integration`
> 方式：真实数据库 + 真实 HTTP 全链路冒烟 + 静态对账。未改任何业务代码。

## 0. 结论摘要

主干链路能端到端跑通：登录 → 建行程 → 规划 → 选景点 → 生成方案 → 应用方案 → 记录足迹（带图）→ 地图聚合 → 上传媒体 → 写手账 → 改名 → 删除，21 步里 19 步通过；另外 2 步是故意探测"前端声明但后端不存在"的接口，返回 404 属预期，是本报告的证据之一。

真正的风险不在"能不能跑起来"，而在四处：**降级态（没有地图 Key 时数据是残的）、错误文案（关键原因被吞掉）、数据规模（只有 2 座城市）、以及从未在浏览器里验证过的交互**。

## 1. 环境与实跑记录

| 项             | 结果                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| Docker Desktop | 启动后 6 秒 engine 就绪                                                              |
| PostgreSQL     | `travel-planner-v2-framework-postgres-1`，postgres:17-alpine，healthy                |
| 迁移           | 14 个文件全部 applied，最新 `202611180001_footprint_multi_media`                     |
| 种子           | `db:seed:b`（浙江/杭州 + 3 景点）、`db:seed:beijing`（北京 18 景点）                 |
| 数据           | destinations 4 条（浙江/杭州/北京，2 省 2 市）、places 21 条                         |
| API            | `http://127.0.0.1:3000/api`，`/health` 200、`/ready` 200（database ok）              |
| Web            | `http://127.0.0.1:5173`，HTTP 200                                                    |
| 收尾           | 冒烟产生的 7 个临时账号已删除，数据回到 users 18 / trips 2 / footprints 13 / media 1 |

## 2. 全链路冒烟（HTTP）

| #   | 步骤                                | 结果   | 关键观察                                               |
| --- | ----------------------------------- | ------ | ------------------------------------------------------ |
| 1   | 注册                                | ✅ 201 | 只返回 `{user}`，**不含 token**                        |
| 2   | 登录                                | ✅ 200 | 返回 `accessToken`、`expiresAt`                        |
| 3   | 读资料 `GET /users/me`              | ✅ 200 |                                                        |
| 4   | 改名 `PATCH /users/me`              | ✅ 200 |                                                        |
| 5   | 城市目录                            | ✅ 200 | 北京市、杭州市                                         |
| 6   | 景点目录（杭州）                    | ✅ 200 | 3 个                                                   |
| 7   | 建行程                              | ✅ 201 | revision=1                                             |
| 8   | 填规划                              | ✅ 200 | revision=2                                             |
| 9   | 选景点                              | ✅ 200 | 3 个，revision=3                                       |
| 10  | 生成方案                            | ✅ 200 | 2 天、3 条 warning、`source=rule`（无 LLM）            |
| 11  | 应用方案                            | ✅ 200 | status=planned，revision=4                             |
| 12  | 记录足迹（1 张图）                  | ✅ 201 | `media=1`，但 **`provinceName=null`、`cityName=null`** |
| 13  | 足迹地图聚合                        | ✅ 200 | 点位=1，**省=0、市=0**                                 |
| 14  | 上传媒体                            | ✅ 201 |                                                        |
| 15  | 鉴权读回媒体                        | ✅ 200 | `image/png`，70 字节                                   |
| 16  | 写手账                              | ✅ 201 |                                                        |
| 17  | 手账列表                            | ✅ 200 | 1 条                                                   |
| 18  | 探测 `GET /recommendations/:id`     | ❌ 404 | 前端 `getProposal()` 声明过，后端没注册                |
| 19  | 探测 `POST /recommendations/places` | ❌ 404 | 前端 `recommendPlaces()` 声明过，后端没注册            |
| 20  | 删足迹                              | ✅ 204 |                                                        |
| 21  | 删行程                              | ✅ 204 | 需带 `expectedRevision`                                |

## 3. 四个对账

### 3.1 接口对账（前端 24 条路径 vs 后端 36 条路由）

前端声明、后端不存在（实测 404）：

- `GET /recommendations/:id` ← `trip-draft-client.ts:168 getProposal()`
- `POST /recommendations/places` ← `trip-draft-client.ts:166 recommendPlaces()`

这两条前端**从未真正调用**（只有 `generateProposal`/`applyProposal` 在用），属于死代码，但会误导下一个改这里的人。

后端暴露、前端不调用（合理或待清理）：

- `GET /places/:id`、`DELETE /media/:id`：无人调用
- `GET /health`、`GET /ready`：运维接口，本来就不该被页面调用

### 3.2 数据对账

- 城市 2 座、景点 21 个（北京 18 / 杭州 3）。首页的"城市目录""景点"就这么多，演示时看起来会"很空"。
- 12 条到访记录、2 个行程来自早期演示数据，与本次冒烟无关。

### 3.3 页面巡检（静态：空态 / 错态 / loading）

| 组件                                    | 空态 | 错态 | loading |
| --------------------------------------- | ---- | ---- | ------- |
| FootprintList                           | 有   | 有   | 有      |
| FootprintMapView                        | 有   | 有   | 有      |
| JournalPage                             | 有   | 有   | 有      |
| HomePage                                | 有   | 有   | 有      |
| TripDetail                              | 有   | 有   | —       |
| ProfilePage                             | —    | 有   | 有      |
| NewTripPage                             | —    | 有   | —       |
| FootprintEntryForm                      | —    | —    | 有      |
| FootprintPage / AppShell / CityPostcard | —    | —    | —       |

`FootprintEntryForm` 既没有空态也没有 `role="alert"` 错误位；表单提交失败时用户看到的是页面级提示还是静默，需要人工确认。

### 3.4 状态对账（用户数据存在哪）

| 数据                         | 存储位置                                | 后果                                   |
| ---------------------------- | --------------------------------------- | -------------------------------------- |
| 行程、到访、手账、媒体元数据 | PostgreSQL                              | 换设备可见                             |
| 登录 token                   | `sessionStorage`                        | 关标签页即失效（设计如此）             |
| 行程草稿                     | `localStorage`（planner-storage）       | 换设备丢                               |
| 预约状态                     | `localStorage`（trip-booking）          | 换设备丢                               |
| 行程内"去过"勾选             | `localStorage`（trip-day / TripDetail） | 与"足迹打卡"是**两套互不相通的"去过"** |
| 行李勾选、提醒完成           | `localStorage`（trip-reminders）        | 换设备丢                               |
| 图片/视频文件                | 服务器磁盘 `MEDIA_STORAGE_DIR`          | 正常                                   |

## 4. 运行时发现的问题（按严重度）

### P0-1 关键错误原因被全局过滤器吞掉

- `POST /footprints` 传了未来日期 → `400 {"code":"VALIDATION_ERROR","message":"请求未能处理"}`，看不出是日期越界。
- `GET /footprints/places/search`（无地图 Key）→ `503 {"code":"HTTP_ERROR","message":"服务器暂时无法处理请求"}`，而同一时刻 `POST /locations/reverse` 返回的是 `503 "地图服务尚未配置"`。

同一个系统里两套错误契约：B 模块走 `BExceptionFilter` 保留原文，其余走 `ApiExceptionFilter` 压成通用文案。这就是之前记的"C1 错误契约统一"，现在有了运行证据。

### P0-2 没有高德 Key 时，足迹数据是"残"的

- 新建足迹：`provinceName`、`cityName`、`cityAdcode` 全是 `null`（服务端逆地理 503）。
- `/footprints/map` 返回 `provinces: []`、`cities: []`，于是"已点亮省份/城市"两个清单永远为空。
- 但**地图本身仍能点亮**：`AtlasMap` 在前端用点做点在多边形判定（`featureAt`），不依赖服务端省市字段。所以"足迹地图"这个旗舰功能在无 Key 时仍可演示，只有统计清单是空的——这点值得在演示话术里说清楚。

### P0-3 校验失败没有可行动的信息

未来日期、超长文本等都会落到同一句"请求未能处理"。用户不知道改哪里。

### P1-1 注册与登录的返回体不对称

`POST /auth/register` 返回 `{user}`，`POST /auth/login` 返回 `{accessToken, expiresAt, user}`。前端 `App.tsx:69-70` 是"先注册、再登录"，所以能跑；但任何别的客户端按直觉取 `accessToken` 都会拿到 `undefined`。

### P1-2 足迹表单缺 9 个上限（静态）

`FootprintEntryForm.tsx:336` 直接把 `files` 全收，界面却写着"最多 9 个"；服务端 `FilesInterceptor('files', 9)` 会拒绝，用户只看到一句笼统错误。

### P1-3 文档与实现不一致

`docs/接口与数据约定.md:205/210/219` 仍写单文件 `file`、`removeMedia=true`，实际是 `files`（≤9）与 `removeMediaIds`。照着文档调必然 400。

### P1-4 死代码

- `features/footprints/FootprintMap.tsx`：无人引用（`map-adapter.ts` 仍被 `TripMap` 使用，不能一起删）。
- `recommendPlaces()` / `getProposal()`：指向不存在的路由。

### P1-5 首页「旅行灵感对话」是本地正则

`HomePage.generateReply` 用关键词匹配拼字符串，不是模型调用。演示时若说成"已接入 AI"会被追问。

### P1-6 `APP_Test` 是"死"的

222 条用例、Playwright 依赖，但没装依赖、没跑过、不在 CI（CI 只监听 `travel-planner-v2-framework/**`，它位于仓库根目录）。

## 5. 测试策略建议

| 层             | 现在                                                  | 建议补                                                            | 优先级 |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| 单元（前后端） | API 93 / Web 63，全绿                                 | 维持；新增功能同步补                                              | 持续   |
| 契约（错误码） | 各模块分散                                            | 断言每个 4xx 的 `code` 与 `message`，把"请求未能处理"这类吞错挡住 | 高     |
| 集成（真库）   | `verify-trip-persistence`、`verify-catalog-migration` | 增加"足迹多附件/按 id 删除"脚本                                   | 中     |
| 冒烟（HTTP）   | 本次临时脚本                                          | 固化到 `apps/api/scripts/smoke.cjs`，CI 里跑                      | 高     |
| E2E（浏览器）  | 0                                                     | 5 条主干：登录→建行程→记足迹→写手账→看地图                        | 中     |
| 全软件用例     | `APP_Test` 222 条未跑                                 | 先跑 T0（环境）→ T1（核心），再接 CI                              | 中     |

## 6. 建议的下一步顺序

1. **错误契约统一**：让 `ApiExceptionFilter` 保留 `HttpException` 的 message（或让 footprints 也用 `BExceptionFilter` 那套）。改动小、收益最大。
2. **表单 9 个上限 + 文档字段修正**：半小时量级。
3. **接一个高德 Key 再跑一遍本报告第 2 节**：验证省市归属、点亮清单、行程地图。
4. **数据扩充**：至少再加 2–3 座城市，否则首页与"猜你喜欢"类展示撑不起来。
5. **把本脚本固化成 `scripts/smoke.cjs` 并进 CI**，再谈 `APP_Test` 的接入。

## 7. 复现方式

```powershell
cd D:\Travel-Planning-Assistant-integration\travel-planner-v2-framework
docker compose up -d postgres
npm run db:migrate
npm run db:seed:b
npm run db:seed:beijing
npm run dev            # API 3000 + Web 5173
```

冒烟脚本（临时，未入库）：`%TEMP%\dsh-integration-smoke.mjs`，`node` 直接运行即可。
