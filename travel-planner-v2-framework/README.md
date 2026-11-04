# 旅行规划助手 v2（重写项目）

这是四人旅行项目共用的工程，沿用 React、NestJS 和 PostgreSQL。基础工程与 B 的地点目录、规则推荐、方案持久化和地图/可选模型适配已实现；前端业务页面、C 的登录/行程与 D 的地图手账仍待开发。

## 先看现有问题与重构方案

主文档：[现有代码问题分析与重构架构](docs/现有代码问题分析与重构架构.md)。文档从原代码已复现的开发注入失败、无效迁移状态命令等问题出发，说明保留的设计、已经调整的代码和目标业务架构。

基础重构的历史结果见 [架构验证记录](docs/架构验证记录.md)，B 的当前结果见 [B 验证记录](docs/验证记录-B.md)。全员维护同一份 [接口与数据约定](docs/接口与数据约定.md)，避免接口名称和字段分叉。

## 项目架构与四人分工

四个人开始独立开发时，先看 [四人并行开发总览](docs/总体架构.md)。其中提供统一接口契约、A/B/C/D 四份个人开发说明、共同示例数据和联调验收清单；业务接口仍需按说明实现。

产品分为“旅行前的智能行程规划”和“旅行后的地图足迹与图文手账”两条主流程。详细设计见 [项目架构与四人分工](docs/项目架构与四人分工.md)，包含目录规划、数据库、接口边界和开发顺序。

| 成员 | 负责方向                                         |
| ---- | ------------------------------------------------ |
| A    | 统一前端、创建行程表单、行程编辑页与接口联调     |
| B    | 景点数据、外部 API、路线查询与智能推荐方案       |
| C    | 登录鉴权、日期与偏好保存、景点选择和行程业务后端 |
| D    | 到访记录、地图点亮、图片随笔、媒体存储与地图组件 |

推荐方案经用户确认后由 C 保存为行程，地图点亮依据真实到访记录计算。B 已提供推荐能力；登录、正式行程和手账尚待接入。B 默认拒绝未认证业务请求，C 需要按接口文档注册真实令牌校验器。

## B 的开发与联调

完整的执行顺序、输入与预期结果见 [B 完整测试流程与用例](docs/B-完整测试流程与用例.md)，另提供 [Postman 请求集](docs/examples/B-接口测试.postman_collection.json)。

应用迁移后运行 `npm run db:seed:b`，显式导入统一的杭州演示目录；此命令不创建用户。`npm test` 包含 B 的快速测试；真实 PostgreSQL 测试单独运行：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://你的用户:你的密码@localhost:5432/travel_planner_b_test'
npm run test:integration:b
```

先自行创建专用测试库。脚本要求库名以 `_test` 结尾，每次在独立 schema 内测试并清理，不清空其他 schema。测试身份仅由测试装配注入。

地图配置使用服务端 `AMAP_WEB_SERVICE_KEY`。未配置时仅短距离步行可明确估算；推荐会尝试将缺少路线的景点分到其他日期，必要路线仍不可得时返回 503。模型默认关闭，启用需 `B_LLM_ENABLED=true` 和完整的 `LLM_API_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；使用兼容 Chat Completions 且支持严格 JSON Schema 的服务，失败保留规则结果。真实 Key 调用与联合业务流程是否通过，以验证记录为准。

服务器现有的免费开源模型部署、数据库/模型双隧道、完整验收命令与功能证据矩阵见 [B 全面验收与开源模型](docs/B-全面验收与开源模型.md)。模型可独立设置 `B_LLM_TIMEOUT_MS`；真实 CPU 推理验收会保存 prompt 和原始回复。

## 技术栈

- Web：React、TypeScript、Vite
- API：NestJS、TypeScript、REST；健康检查已提供
- 数据库：PostgreSQL；迁移工具：node-pg-migrate
- 开发环境：Docker Compose + PostgreSQL
- 代码规范：ESLint、Prettier、TypeScript strict
- CI：迁移、lint、类型检查、构建和基础运行测试

## 当前 B 环境：服务器数据库

数据库运行在 120.53.94.209 的 Docker 中，本地运行 Node.js，通过 SSH 隧道连接。服务器开发库、独立测试库与本地 .env 已配置，使用方式见 [服务器开发与测试](docs/服务器开发与测试.md)。

第一个终端运行 `npm run db:tunnel:b` 并按提示输入 SSH 密码，保持连接；第二个终端运行 `npm run test:integration:b` 或 `npm run dev:api`。本地无需启动 Docker。数据库密码不写入仓库。

## 其他环境的启动方式

需要 Node.js 22.12+、npm 和已运行的 PostgreSQL。也可以通过 Docker Desktop 启动下面的数据库服务。

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci
docker compose up -d postgres
```

确认数据库已就绪后执行；使用自己安装的 PostgreSQL 时，修改 `.env` 中的 `DATABASE_URL`，并跳过上面的 Docker 数据库启动命令。

```powershell
npm run db:migrate
npm run dev
```

前端地址：<http://localhost:5173>；API 健康检查：<http://localhost:3000/api/health>；数据库就绪检查：<http://localhost:3000/api/ready>。

开发模式先用 tsc 编译，再监视并运行编译产物，确保 NestJS 构造器注入元数据与构建模式一致。修改后端 `PORT` 时，Vite 开发代理自动跟随；需要其他代理目标时配置 `API_PROXY_TARGET`。

`/api/health` 只检查 API 存活；`/api/ready` 进行数据库连接检查，失败返回 503，不代表所有业务表或外部服务都已可用。

## 基础检查

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

`npm test` 先构建后端，再运行 Node 内置测试。基础测试使用测试替身和本地 HTTP 服务，不需要已经启动 PostgreSQL；真实迁移和整套 Docker 环境需要另行验证。

构建后，可使用 `npm run start --workspace=@travel/api` 运行 API。

## Docker 开发环境

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build
```

Compose 启动 PostgreSQL 和开发容器，容器会先按锁文件同步依赖，再应用迁移并运行 API 与 Vite。开发期间源码从宿主机挂载，数据库数据保存在 Docker named volume `postgres_data` 中。该配置用于开发，正式部署方案待后续迭代。

## 环境变量

复制 `.env.example` 为 `.env`。`VITE_AMAP_WEB_KEY` 会进入浏览器，必须在高德控制台限制允许的域名；服务端地图 Key、LLM Key 仅放在服务端环境变量中。不要提交 `.env` 或真实密钥。

## 迁移

新增迁移：

```powershell
npm run db:migration:new --workspace=@travel/api -- add-something
```

应用迁移：`npm run db:migrate`；查看状态：`npm run db:migrate:status`。状态脚本只读默认 `public.pgmigrations` 表，显示 applied、pending 或 missing-file，不会执行迁移。已提交的迁移文件不要直接改写，应新增前向迁移。
