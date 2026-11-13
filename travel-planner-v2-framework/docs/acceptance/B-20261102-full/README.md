# B 全面验收记录（2026-11-02）

实际执行时间：16:35:36—16:36:45，Asia/Shanghai；服务器复核 16:37。基于当前未提交工作区，基准 Git revision 见 run.json，逐文件 SHA-256 见 source-manifest.json。

## 实际结果

| 项目 | 结果 |
| --- | --- |
| 顺序执行的命令组 | 12/12 退出码 0 |
| 快速测试 | 42/42 |
| 真实 PostgreSQL 集成 | 7/7 子场景（Node 另计父测试，显示 8/8） |
| 扩展 HTTP/数据库/模型场景 | 79/79 |
| 生产入口 HTTP smoke | 14/14 |
| 真实模型调用 | 3 次 HTTP 200：中文回复、B 结构化模型+落库、B 无地图 Key 模型+落库 |
| 服务器复核 | PostgreSQL healthy；Ollama running；临时测试 schema 0 个；开发目录仍 2 目的地/3 景点 |

以上集合有交叉，不加总为独立业务数量。当前未验证高德正式账号/真实地图数据，以及 C 真登录、A/C 正式行程确认与 D 页面。地图三模式经过真实适配器+可控 HTTP 服务；身份只在测试装配中注入，没有绕过生产认证。

## 测试流程与命令

1. 检查 B 开发计划、唯一接口契约与配置，只读取配置是否存在，不导出凭据。
2. SSH 连接用户服务器，开启 55432 数据库、11434 模型双隧道；服务器部署限额的 Ollama+Qwen2.5-0.5B。完整部署命令见 remote-commands.txt。
3. 新增边界和扩展场景，预检真实模型发现漏景点、CPU 超时；修复后复验，原始失败记录留在 attempts/。
4. 从工程根目录执行 `npm run acceptance:b -- --real-model --output docs/acceptance/B-20261102-full`；具体子命令、时间和退出码保存在 commands.ps1、run.json、命令结果.csv 与逐命令 .txt。
5. 执行远程 Docker/版本/限制/数据量/临时 schema 复核，保存 12-server-docker.txt。
6. 从原始 JSON 和日志生成此报告，浏览器真实打开报告并截图；校对证据后生成 SHA-256 清单和 zip。
7. 结束临时 API、报告服务器和本次 SSH 隧道；服务器数据库和模型留给后续开发。重新使用请先运行 `npm run services:tunnel:b`。

复现请选择新的输出目录，避免覆盖证据。详细功能对照与配置见 功能覆盖矩阵.md。B 的公开请求仍为结构化 PlanningInput；独立中文 prompt 测试验证真实模型连通，没有新增公开聊天入口。

## 如何查看

- index.html：总览；model.html：实际 prompt 与中文回复；pipeline.html：真实结构化回复和保存方案。
- full-b-results.json：79 场景结果；full-http-evidence.json：每次请求和响应；map-contract-evidence.json：真实适配器发出的测试参数。
- real-model-evidence.json：3 次真实请求/回复、耗时、校验后的排序与对应方案，未记录 Authorization Key。
- 01—11 与 08b .txt：命令原始输出；12-server-docker.txt：服务器原始输出。
- screenshots/：浏览器真实报告截图。它们是验收报告页面，非原生终端或业务前端界面；所有原始 CLI 日志均单独保留。
- attempts/01：真实模型漏一个景点，被校验正确回退；attempts/02：原 15 秒上限下回退；attempts/03：修复后预检通过。最终结果以本目录根层文件为准。
- integrity-check.json / artifact-manifest.json：源文件/证据完整性与敏感信息检查；压缩包 SHA-256 另存同级 .zip.sha256。

模型本次结构化返回的顺序与原选择相同，最终 source=rule 正确。真实模型被调用、校验通过和数据库保存不以必须出现 llm-assisted 为验收标准；候选有实际改进才采用的分支另有自动化测试。
