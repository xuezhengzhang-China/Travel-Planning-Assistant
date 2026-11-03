# 随心行（travel-planner-v2-framework）

当前已完成北京创建行程、规则推荐、编辑及数据库保存读取删除，支持React主界面嵌入。前端接入先看 [随心行接入说明](docs/随心行-前端接入说明.md)，完整状态与当前分工见 [联调交付](docs/当前分工与联调交付.md)。后文原始架构说明保留作历史背景。

- C负责创建行程前端、规则推荐与行程业务；A负责正式外层页面；B协作核实景点及地图；D负责真实足迹和手账。
- 真实地图查询需配置服务端Key及核实坐标，自动行程当前仍为标明来源的交通估算；尚未集成对方实际前端源码。
- 上传时保留全部增量迁移、迁移data快照、共享目录和推荐引擎；不要上传.env、node_modules、数据库文件或本地视频。
- 所有命令在此子目录执行。根目录.github/workflows/travel-planner-v2.yml为GitHub自动检查入口。
- Windows检出保留现有换行风格，Prettier使用endOfLine:auto，避免仅因CRLF误报。

这是四人旅行项目共用的基础工程，沿用 React、NestJS 和 PostgreSQL。当前已完成配置、数据库公共能力和健康检查等基础重构，后续围绕“旅行前规划”和“旅行后地图手账”逐步开发业务。

## 先看现有问题与重构方案

主文档：[现有代码问题分析与重构架构](docs/现有代码问题分析与重构架构.md)。文档从原代码已复现的开发注入失败、无效迁移状态命令等问题出发，说明保留的设计、已经调整的代码和目标业务架构。

验证范围与结果见 [架构验证记录](docs/架构验证记录.md)。当前提供两个检查接口、公共配置和数据库模块，业务接口按文档分阶段实现。

## 项目架构与四人分工

四个人开始独立开发时，先看 [四人并行开发总览](docs/总体架构.md)。其中提供统一接口契约、A/B/C/D 四份个人开发说明、共同示例数据和联调验收清单；业务接口仍需按说明实现。

产品分为“旅行前的智能行程规划”和“旅行后的地图足迹与图文手账”两条主流程。详细设计见 [项目架构与四人分工](docs/项目架构与四人分工.md)，包含目录规划、数据库、接口边界和开发顺序。

| 成员 | 负责方向                                         |
| ---- | ------------------------------------------------ |
| A    | 统一前端、创建行程表单、行程编辑页与接口联调     |
| B    | 景点数据、外部 API、路线查询与智能推荐方案       |
| C    | 登录鉴权、日期与偏好保存、景点选择和行程业务后端 |
| D    | 到访记录、地图点亮、图片随笔、媒体存储与地图组件 |

推荐方案经用户确认后保存为行程，地图点亮依据真实到访记录计算。分工文档中的登录、推荐、行程和手账接口属于后续开发规划。

## 技术栈

- Web：React、TypeScript、Vite
- API：NestJS、TypeScript、REST；健康检查已提供
- 数据库：PostgreSQL；迁移工具：node-pg-migrate
- 开发环境：Docker Compose + PostgreSQL
- 代码规范：ESLint、Prettier、TypeScript strict
- CI：迁移、lint、类型检查、构建和基础运行测试

## 本地启动

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
