# B 完整测试流程与用例

适用日期：2026-11-02。工程目录为 `F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework`。本地运行 Node.js，PostgreSQL 运行在 120.53.94.209 的 Docker 中。

本手册只描述怎么测试；接口定义以 [接口与数据约定](接口与数据约定.md) 为准，环境维护见 [服务器开发与测试](服务器开发与测试.md)，历史实际结果见 [验证记录](验证记录-B.md)。

## 1. 先明确现在可以测什么

| 测试方式                                | 当前是否可执行                               | 验证范围                                                                      |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| 快速自动化 `npm test`                   | 可以，无需服务器、地图 Key 或真实登录        | 规则、输入、目录、HTTP 请求响应、外部失败和模型回退；使用测试身份与可控替身   |
| 真实数据库 `npm run test:integration:b` | 可以，需要 SSH 隧道                          | 真实 SQL、迁移、种子、HTTP 生成与持久化、重启读取、用户隔离；身份仍为测试装配 |
| 手动健康检查和未认证请求                | 可以，需要启动本地 API；ready 需要数据库连接 | API 存活、数据库连接、401 拒绝                                                |
| 手动请求 B 业务接口成功/参数失败        | 等 C 注册真实认证后执行                      | 使用真实 accessToken，按本手册和 Postman 请求集操作                           |
| 真实地图和模型                          | 认证接通并配置对应 Key 后执行                | 第三方账号权限、配额、网络、实际输出；不由替身测试代替                        |
| 确认推荐为正式行程                      | 等 C 的行程接口完成                          | B 方案与 C 行程的联合验收，当前不能记录为已完成                               |

当前默认 BModule 会拒绝全部业务请求。直接用 Postman 得到 401 是预期行为；`Bearer test-only` 和 `Bearer integration-only` 只在各自自动化测试装配中生效，不是开发 API 的登录凭据。

## 2. 第一轮：运行现有完整自动化

### 2.1 准备依赖

PowerShell：

```powershell
cd F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework
node --version
npm ci
Test-Path .env
```

Node 要求至少 22.12，已验证环境为 24.x。本工作目录的 .env 已配置数据库连接，最后一条应为 True。新工作目录需要先取得自己的数据库配置；不要直接复制 .env.example 覆盖现有连接。

### 2.2 检查代码和快速测试

```powershell
npm run lint
npm run typecheck
npm run build
npm test
npm run format:check
```

每条命令完成后再执行下一条；出现错误先记录并处理。当前版本预期快速测试 tests 38、pass 38、fail 0，其余命令无错误退出。38 包含原有基础测试，不是 38 个独立业务接口。

### 2.3 终端 A：连接远程数据库

```powershell
cd F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework
npm run db:tunnel:b
```

按提示输入 SSH 密码，保持终端运行。成功后通常没有持续输出。这个终端只负责转发，后面的命令放到另一个终端。

### 2.4 终端 B：检查迁移并运行数据库集成测试

```powershell
cd F:\TPA\Travel-Planning-Assistant\travel-planner-v2-framework
npm run db:migrate:status
npm run test:integration:b
```

当前开发库应显示三份迁移 applied。数据库测试应报告 tests 8、pass 8、fail 0，其中为 1 个测试组与 7 个实际子场景。脚本自动读取 .env 中的 TEST_DATABASE_URL，在远程 travel_planner_b_test 库的新 schema 中迁移、造数、测试并清理。

新代码确有待应用迁移时才运行 `npm run db:migrate`。开发演示数据缺失时可运行 `npm run db:seed:b`；当前服务器已完成这些步骤。集成测试会自行准备其数据，不依赖手动修改开发库。

### 2.5 按模块定位问题

先构建，再选需要的测试文件：

```powershell
npm run build --workspace=@travel/api
node --test apps/api/tests/places.test.cjs
node --test apps/api/tests/recommendations.test.cjs
node --test apps/api/tests/integrations.test.cjs
node --test apps/api/tests/llm.test.cjs
node --test apps/api/tests/b-http.test.cjs
```

只测试某个场景，例如无 Key 演示：

```powershell
node --test --test-name-pattern="no-key demo" apps/api/tests/recommendations.test.cjs
```

日期、模型、路线异常以固定时钟和替身测试为主，不需要等待真实方案过期，也不需要通过断开整个服务器来模拟地图失败。

## 3. 第二轮：启动 API，做现在可执行的手动检查

保持终端 A 的隧道打开。在终端 B 启动：

```powershell
npm run dev:api
```

默认 API 地址为 `http://localhost:3000/api`，这是本地 Node.js 的地址，不是服务器公网 IP 的 3000 端口。若修改了 .env 的 PORT，请同步改下面和 Postman 的 baseUrl。

终端 C 执行：

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:3000/api/ready
```

预期：

```json
{ "status": "ok", "service": "travel-planner-api" }
```

```json
{ "status": "ready", "database": "ok" }
```

未登录请求：

```powershell
try {
    Invoke-RestMethod http://localhost:3000/api/destinations
} catch {
    [int]$_.Exception.Response.StatusCode
    $_.ErrorDetails.Message
}
```

预期为 401 / UNAUTHENTICATED。

可选的连接恢复检查：在无人依赖本条隧道时，关闭自己的终端 A 隧道，保持本地 API 运行，再请求 health 和 ready。health 应仍为 200；ready 应在连接/查询超时后返回 503。重新运行隧道命令，再请求 ready，应恢复 200。整个过程只断开自己的隧道，不停止服务器容器。

## 4. 统一测试数据

先使用现有固定演示数据：

| 简称 | 内容                                       | ID                                   |
| ---- | ------------------------------------------ | ------------------------------------ |
| city | 杭州市                                     | 20000000-0000-4000-8000-000000000002 |
| A    | 西湖（演示），90 分钟，nature/landmark     | 30000000-0000-4000-8000-000000000001 |
| B    | 灵隐景区（演示），120 分钟，history/nature | 30000000-0000-4000-8000-000000000002 |
| C    | 良渚博物院（演示），120 分钟，history/art  | 30000000-0000-4000-8000-000000000003 |

完整数据来自 [共用样例](examples/demo-scenario.json)。样例不是登录账号；实际手工测试使用 C 创建的真实测试用户。用户 ID、业务 accessToken、服务器 SSH 密码、数据库密码是不同的概念。

## 5. 第三轮：C 接通认证后的手动业务用例

这一节和 Postman 请求集后续分组均依赖 C 的真实认证。C 实现注册/登录并完成 B_AUTHENTICATOR 接线后，创建真实测试用户，登录取得 accessToken。当前仅启动原始 BModule 时仍会是 401。

### 5.1 导入 Postman 请求集

导入 [B 测试请求集](examples/B-接口测试.postman_collection.json)，在该 Collection 的变量中设置：

| 变量                           | 值                                               |
| ------------------------------ | ------------------------------------------------ |
| baseUrl                        | http://localhost:3000/api                        |
| accessToken                    | C 登录返回的真实 token；现在先留空               |
| cityId、placeA、placeB、placeC | 已填统一演示 ID                                  |
| startDate / endDate            | 默认 2026-11-10 / 2026-11-11，可换成有效日历日期 |

先运行“01 当前即可执行”分组。等认证接通后，再运行“02 目录”“03 推荐与输入校验”。“04 地图未配置 Key”要求服务端 AMAP_WEB_SERVICE_KEY 为空；“05 地图正常或估算”接受有效 provider 或 estimate 结果，逆地理编码成功需要真实 Key。

每个请求自带 Tests 断言。正常请求会校验结构、景点完整性或来源；异常请求会校验 HTTP 状态和 code。不要直接运行全部分组：不同分组的服务端配置前提不同。

请求集不会自动调用尚未实现的登录或行程接口，也不会向正式应用注入测试身份。生成方案后会在 Postman Collection 变量 proposalId 中记录结果，供之后与 C 的确认接口对接；B 当前没有公开的 GET proposal 接口。

请求集已通过 Postman 官方 v2.1 JSON Schema 校验、32 段断言脚本的 JavaScript 语法检查，以及演示 ID/变量检查；这不等于 32 个请求已在真实认证后的 API 上执行通过。导入时的 accessToken 为空，执行者需按分组前提补充真实结果。

### 5.2 一组完整推荐请求

POST `{{baseUrl}}/recommendations/itinerary`，Authorization 为 Bearer Token，Body 为 raw JSON：

```json
{
  "cityId": "20000000-0000-4000-8000-000000000002",
  "startDate": "2026-11-10",
  "endDate": "2026-11-11",
  "themes": ["history", "nature"],
  "pace": "standard",
  "transportMode": "walking",
  "selectedPlaceIds": [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003"
  ]
}
```

预期为 200，检查：

- proposalId 为新 UUID，generatedAt / expiresAt 为实际生成时间，默认相差 30 分钟。
- days 含两个日期，即使某一天为空也保留；三个景点在所有安排及 unassignedPlaceIds 中各出现一次。
- 每日 position 从 0 连续递增；第一站交通为 0 / none；后续交通、休息和游玩时间都计入预算。
- source 为 rule 或实际采用模型建议后的 llm-assisted；warnings 会说明开放时间尚未核实等限制。
- 无地图 Key、模型关闭、原演示数据未改动时，当前规则应产生第一天两个、第二天一个景点，并标记估算和改日警告。

有真实地图 Key 或演示数据被调整时，不应把“始终必须是 2+1”作为通用正确性标准，应检查日期、唯一性、预算和来源。

## 6. 可直接采用的测试用例

下表给出输入、预期和当前执行方式。手工用例的状态码前提是已通过认证；否则鉴权先返回 401，不会执行参数校验。未标记为已有自动化覆盖的手工用例，应填写实际结果后再计入通过数量。

### 6.1 环境、认证与目录

| 编号 | 操作 / 输入                          | 预期                                                               | 如何执行                            |
| ---- | ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| E01  | 启动 API，请求 health                | 200，status=ok                                                     | 当前手工；已有 health 自动化        |
| E02  | 隧道正常，请求 ready                 | 200，database=ok                                                   | 当前手工                            |
| E03  | 关闭自己的隧道后请求 ready，再恢复   | 503，恢复后 200；health 仍为 200                                   | 可选手工；不停止服务器容器          |
| A01  | 不带 token 请求 B 业务接口           | 401 / UNAUTHENTICATED                                              | 当前手工；b-http 自动化覆盖六个入口 |
| A02  | 提交伪造 Bearer token 或 x-user-id   | 仍为 401                                                           | 当前手工；b-http 自动化             |
| P01  | GET /destinations?level=city         | 包含杭州，返回分页结构                                             | 认证后手工；HTTP/真库自动化         |
| P02  | GET /places?cityId=city&keyword=灵隐 | 结果包含 B；只保留名称匹配项                                       | 认证后手工                          |
| P03  | category=history                     | 每项包含 history；纯演示种子为 B、C                                | 认证后手工；目录/真库自动化         |
| P04  | themes=art&pageSize=1                | 排序后第一页为 C，total 是筛选后、分页前的总数；纯演示种子 total=3 | 认证后手工；目录/真库自动化         |
| P05  | pageSize=101 或 page=0               | 400 / VALIDATION_ERROR                                             | 认证后手工；目录自动化              |
| P06  | GET /places/合法但不存在的 UUID      | 404 / NOT_FOUND；格式错误 UUID 为 400                              | 认证后手工；目录自动化              |
| P07  | 请求远超总页数的 page                | items=[]，total 仍为符合过滤条件的总数                             | 认证后手工；真库自动化              |

### 6.2 推荐与日期边界

| 编号 | 在基础推荐请求上修改                            | 预期                                                     | 如何执行                                           |
| ---- | ----------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| R01  | 两天、A/B/C、standard、walking                  | 200，日期完整，已安排与未安排合计恰好三项且不重复        | 认证后手工；规则/HTTP/真库自动化                   |
| R02  | startDate=endDate，只选择 A                     | 200，恰好一个 day                                        | 认证后手工；同日日期自动化                         |
| R03  | 2026-11-10 至 2026-12-09，只选择 A              | 200，30 个 day，空日期也保留                             | 认证后手工；30 天日期计算自动化                    |
| R04  | 2026-11-10 至 2026-12-10                        | 400 / INVALID_DATE_RANGE（31 天）                        | 认证后手工；日期自动化                             |
| R05  | 结束日期早于开始日期                            | 400 / INVALID_DATE_RANGE                                 | 认证后手工；日期自动化                             |
| R06  | 2027-02-29 或 2026-02-30                        | 400 / INVALID_DATE_RANGE                                 | 认证后手工；日期自动化                             |
| R07  | 2028-02-28 至 2028-03-01，只选择 A              | 200，包含合法闰日的 3 个 day                             | 认证后手工；闰日日期自动化                         |
| R08  | selectedPlaceIds=[A,A] 或 []                    | 400 / VALIDATION_ERROR                                   | 认证后手工；推荐自动化                             |
| R09  | 任意不存在或不属于该城市的景点                  | 400 / VALIDATION_ERROR，不保存方案                       | 未知 ID 可手工；跨城用推荐自动化替身或额外城市夹具 |
| R10  | pace=fast、themes=[unknown] 或额外 ownerId 字段 | 400 / VALIDATION_ERROR                                   | 认证后手工；推荐/HTTP 自动化                       |
| R11  | 一天、relaxed、A/B/C，地图无 Key、模型关闭      | 200，最多两站，至少一个未安排项及 UNASSIGNED_PLACES 警告 | 认证后手工；数量/预算规则自动化                    |
| R12  | 单景点时长刚好用完预算 / 多一分钟               | 刚好可安排；多一分钟进入未安排列表                       | 推荐自动化夹具，不修改共享开发库时长               |
| R13  | 固定路线、时钟、ID，重复执行相同输入            | days 和理由稳定；不要求真实请求的随机 UUID/时间相同      | 推荐自动化                                         |
| R14  | 路线不足，无法判定能否安排且没有其他可行日期    | 503 / DEPENDENCY_UNAVAILABLE，不伪称已知“排不下”         | 路线预算自动化；无 Key 单日远距离手工              |

### 6.3 地图和模型

| 编号 | 输入 / 前提                                   | 预期                                                                           | 如何执行                                     |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| G01  | 西湖坐标到灵隐坐标，walking，无 Key           | 200，estimate，正整数分钟，含 ROUTE_ESTIMATED；当前数据为 83 分钟              | 认证后手工；地图自动化                       |
| G02  | 相同两点，driving，无 Key                     | 503 / DEPENDENCY_UNAVAILABLE                                                   | 认证后手工；地图自动化                       |
| G03  | 西湖到良渚，walking，无 Key，直接调用路线预览 | 超出 5 km 估算范围，503                                                        | 认证后手工；地图自动化                       |
| G04  | 坐标标签改为 WGS84，或经度=181                | 400 / VALIDATION_ERROR                                                         | 认证后手工；坐标自动化                       |
| G05  | 高德成功返回耗时 61 秒                        | 向上取整为 2 分钟，source=provider                                             | 地图适配器替身测试；真实调用不要求固定 61 秒 |
| G06  | 逆地理编码成功但城市无法对应目录              | cityId/cityAdcode 均为 null，含 CITY_UNCONFIRMED；若连地点名称也无法取得则 503 | 地图自动化；真实 Key 专项                    |
| M01  | B_LLM_ENABLED=false                           | 不请求模型，source=rule，基础方案仍可用                                        | 模型自动化；当前默认配置                     |
| M02  | 模型非法 JSON、重复/编造景点、超时或拒绝      | 使用合法规则结果，含 MODEL_FALLBACK，不泄漏原文或 Key                          | 模型自动化及本地 HTTP 模型替身               |
| M03  | 模型给出合法顺序                              | 重新排程；仅完整程度改善或同等完整程度下交通减少时采用                         | 模型自动化                                   |

### 6.4 数据持久化与多人协作

| 编号 | 操作                                       | 预期                                                 | 如何执行                            |
| ---- | ------------------------------------------ | ---------------------------------------------------- | ----------------------------------- |
| D01  | 从原基础库升级两份 B 迁移，再重复检查      | 升级成功，已应用迁移不重复执行                       | 真库自动化                          |
| D02  | 在测试 schema 中连续执行两次种子           | 两个目的地、三个景点、不创建用户                     | 真库自动化                          |
| D03  | HTTP 生成方案，关闭并重建应用后读取        | ProposalReader 仍返回同一内容，非进程内 Map 假持久化 | 真库自动化；当前无公开 GET proposal |
| D04  | 用户 B 通过 ProposalReader 读取用户 A 方案 | 404，不返回方案内容                                  | 推荐/真库自动化                     |
| D05  | 输入非法景点后比较方案记录数               | 记录数不增加；已有数据不受影响                       | 真库自动化                          |
| D06  | 生成推荐后检查正式 trips                   | B 不创建或覆盖正式行程                               | 真库自动化                          |
| C01  | C 确认方案时已经过期或草稿条件变更         | 归属校验后分别 410 或 409，不写正式日程              | 待 C 联合验收                       |
| C02  | A 展示存在未安排项的方案                   | 展示具体地点/原因，禁止作为完整方案确认              | 待 A/C 联合验收                     |

## 7. 真实 Key 的最后一轮专项测试

前提为 C 的真实认证已接通。配置 .env 后重启 API，以确保配置重新加载。

地图专项：给 AMAP_WEB_SERVICE_KEY 配置服务端 Key，分别调用 walking、driving、transit，记录 source=provider、耗时正整数和响应时间；逆地理编码检查杭州地点匹配平台城市，城市级 cityAdcode 为 330100。实际耗时和地址以供应商响应为准，不与演示分钟数硬比较。供应商失败时按警告或 503 判断，不能当成已验证成功。

模型专项：配置 B_LLM_ENABLED=true 及完整 LLM_API_BASE_URL、LLM_API_KEY、LLM_MODEL。先记录关闭模型的基线，再比较开启后的景点完整性、日期、预算和来源。模型未被采用时 source=rule 也可能是正确结果；不以“每次必须 llm-assisted”作为通过标准。故障回退优先由自动化替身验证，避免靠反复调用收费服务构造错误。

这一轮的真实账号、权限、网络和费用结果单独记录，不能沿用自动化替身的通过数量。

## 8. 常见失败如何处理

| 表现                              | 优先检查                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 隧道提示 Address already in use   | 是否已有本项目隧道或其他服务占用本机 55432；只保留需要的一条连接             |
| ECONNREFUSED 127.0.0.1:55432      | 隧道是否开启；服务器容器是否 healthy                                         |
| TEST_DATABASE_URL is required     | 在工程根目录运行；.env 是否存在并配置了测试库连接                            |
| 拒绝非测试库名                    | 测试连接应指向 travel_planner_b_test，不改名绕过目标检查                     |
| password authentication failed    | 核对数据库连接凭据；SSH 密码不是 PostgreSQL 密码；不在日志里打印完整连接串   |
| 手动业务请求总是 401              | 当前 B 默认拒绝；确认 C 已接入认证且使用真实 token，不使用测试脚本中的 token |
| 无 Key 时部分路线为 503           | 对驾车/公交或超出短距离步行范围属于预期；推荐会在有其他可行日期时尝试改日    |
| Cannot find module @travel/shared | 先在工程根目录执行 npm ci，恢复 workspace 链接                               |

## 9. 测试记录和结束操作

每次记录：代码版本、日期、执行人、用例编号、前提（真实/替身、Key 是否启用）、步骤、期望、实际、通过/失败/阻塞，以及日志或截图。当前不能执行的用例填“阻塞：等待 C 认证”，不计为通过。

建议完成标准：代码检查均通过，快速测试 38/38，真实数据库子场景 7/7，健康检查和 401 手动检查正确；认证接通后再补业务手工与 A/C 联调结果。

测试结束后，在本地 API 与隧道终端分别按 Ctrl+C。服务器数据库保持运行供后续开发。不要通过清空共享开发库或删除数据卷来“恢复测试环境”；自动化集成测试已经为自身使用隔离 schema。
