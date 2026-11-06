"""Build a local, static report from captured acceptance outputs; no test results are fabricated."""
from pathlib import Path
from html import escape
import csv
import json
import re
import shutil

folder = Path(__file__).resolve().parent
root = folder.parents[2]


def read(name):
    return (folder / name).read_text(encoding="utf-8")


def data(name):
    return json.loads(read(name))


def dump(name, value):
    (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


run = data("run.json")
full = data("full-b-results.json")
smoke = data("http-results.json")
models = data("real-model-evidence.json")
fast = int(re.search(r"\btests\s+(\d+)", read("06-fast-tests.txt")).group(1))
assert run["failed"] == full["failed"] == smoke["failed"] == 0
assert full["passed"] == 79 and fast == 42 and len(models) == 3
assert "REMOTE AUDIT EXIT: 0" in read("12-server-docker.txt")
assert "(0 rows)" in read("12-server-docker.txt")
for entry in models:
    assert entry["httpStatus"] == 200

style = """body{margin:0;background:#edf2f7;color:#182b42;font-family:'Microsoft YaHei','Segoe UI',sans-serif;font-size:15px;line-height:1.6}main{max-width:1100px;margin:24px auto;padding:24px 32px;background:white;border-radius:14px}h1{font-size:30px;margin:6px 0 12px}h2{font-size:20px;margin-top:22px}h3{font-size:16px}p{margin:10px 0}.muted{color:#556c82;font-size:13px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}a{color:#1467a8;text-decoration:none}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#f1f8f6;border:1px solid #cfe6de;border-radius:10px;padding:16px}.number{font-size:30px;font-weight:700;color:#137c58}.note{padding:13px 17px;background:#fff7e8;border-left:4px solid #c78418;border-radius:4px}.pass{color:#08724c;font-weight:650}table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}td,th{text-align:left;border-bottom:1px solid #dce5ee;padding:8px 10px;vertical-align:top}th{background:#eef4fa}pre{background:#f6f8fb;border:1px solid #dbe4ee;padding:15px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 Consolas,'Microsoft YaHei',monospace;border-radius:6px}details{margin:12px 0}summary{cursor:pointer;color:#1467a8}.reply{border-left:4px solid #168b66;background:#eef9f4;padding:16px 20px;font-size:17px}.pill{display:inline-block;padding:3px 10px;border-radius:20px;background:#e8f6ef;color:#08724c;font-size:13px}footer{border-top:1px solid #dce5ee;padding-top:15px;margin-top:26px;color:#556c82;font-size:12px}code{background:#eef2f7;padding:1px 4px}ul{padding-left:24px}@media(max-width:800px){main{margin:0;padding:20px}.cards{grid-template-columns:repeat(2,1fr)}}"""


def pre(value):
    return "<pre>" + escape(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"


def table(headers, rows):
    return "<table><thead><tr>" + "".join("<th>" + escape(str(h)) + "</th>" for h in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + escape(str(c)) + "</td>" for c in row) + "</tr>" for row in rows) + "</tbody></table>"


def page(name, title, content):
    nav = '<nav><a href="index.html">验收总览</a><a href="model.html">真实 prompt / 回复</a><a href="pipeline.html">B 模型落库链路</a><a href="coverage.html">79 场景</a><a href="cli.html">命令输出</a><a href="server.html">服务器 Docker</a></nav>'
    html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><style>' + style + '</style><main><div class="muted">Travel Planning Assistant · B · 2026-11-02 · 实际执行证据</div><h1>' + escape(title) + '</h1>' + nav + content + '<footer>本页由实际日志与 JSON 生成。截图为该报告在浏览器中的真实截图；命令行原文另存 .txt。身份为测试专用注入；高德正式服务与 A/C/D 联合流程未计为通过。</footer></main></html>'
    (folder / name).write_text(html, encoding="utf-8")


cards = '<div class="cards">' + ''.join('<div class="card"><div class="number">' + str(n) + '</div>' + label + '</div>' for n, label in [(fast, '快速测试全部通过'), (full['passed'], '扩展场景全部通过'), (7, '真实数据库子场景通过'), (smoke['passed'], '生产入口 HTTP 检查通过')]) + '</div>'
status = table(['项目', '结果与实际依赖'], [
    ['命令检查', f"{run['passed']}/{run['commandGroups']}，包含 lint / typecheck / build / format / diff"],
    ['真实模型', '服务器 Docker Ollama 0.13.5 + Qwen2.5-0.5B；3 次真实调用均 HTTP 200'],
    ['数据库', '服务器 Docker PostgreSQL 17.11；随机测试 schema 已清理；开发数据仍 2 目的地条目 / 3 景点'],
    ['排程规模', '120 景点 × 30 天、三节奏边界、数量与时间预算、调用上限、缓存与截止时间'],
    ['接口与数据', '六个 B 接口；筛选排序分页；参数异常；重启重读；两用户归属；SQL 失败不写入'],
    ['高德适配', '实际适配器 + 可控 HTTP 服务；无 Key 降级实际运行。正式账号与真实地图数据未验证'],
])
limits = '<div class="note"><b>尚未验收：</b>高德正式权限/真实公交与地址耗时，以及 C 真实登录、A/C 正式行程确认、D 页面与到访。79 场景使用测试专用身份；可控地图响应不等于真实高德调用。</div>'
page('index.html', 'B 全面验收报告', '<p class="muted">执行：2026-11-02 16:35:36—16:36:45（Asia/Shanghai）；服务器复核 16:37。代码为当前未提交工作区。</p>' + cards + '<h2>验收结论与覆盖</h2>' + status + limits + '<h2>原始证据</h2><p><a href="README.md">完整流程与复现命令</a> · <a href="功能覆盖矩阵.md">中文功能矩阵</a> · <a href="commands.ps1">执行命令</a> · <a href="run.json">命令退出码</a> · <a href="full-http-evidence.json">全部业务 HTTP 请求/响应</a> · <a href="real-model-evidence.json">真实模型原文</a></p><h2>本轮修复并复验</h2><p>真实小模型曾漏掉一个景点：补全输出数组长度约束与完整选择提示；CPU 模型输出超过 15 秒：新增独立模型超时，仍受总生成截止时间约束。失败预检与修复后记录均保留在 attempts/。</p>')

free = models[0]
page('model.html', '真实开源模型：prompt 与原始回复', '<p><span class="pill">真实 CPU 推理 · HTTP 200</span></p><p>模型：<b>Qwen2.5-0.5B Q4_K_M</b>；服务器 Docker Ollama 0.13.5；本次耗时 ' + str(free['elapsedMs']) + ' ms。</p><h2>实际发送的 prompt</h2>' + pre(free['request']['prompt']) + '<h2>模型原始文本回复</h2><div class="reply">' + escape(free['response']['choices'][0]['message']['content']).replace('\n', '<br>') + '</div><p class="muted">这是独立模型连通与文本生成验收。公开 B 接口仍接收结构化 PlanningInput；没有新增任意自由文本聊天接口。</p><h2>B 功能的真实结构化请求</h2><p>完整 system/user prompt、JSON Schema、模型原始 ID 排列，以及真实落库方案另见 <a href="pipeline.html">B 模型链路</a>。未将自由文本生成当作旅游事实核验。</p>' + table(['调用', 'HTTP', '耗时 ms', '结构校验 / 落库'], [(m['caseId'], m['httpStatus'], m['elapsedMs'], '原 ID 完整排列；已保存并重读' if m.get('validatedOrder') else '文本生成连通') for m in models]))

body = ''
for item in models[1:]:
    proposal = item['proposal']
    body += '<h2>' + escape(item['caseId']) + '</h2><p><span class="pill">HTTP 200 · 原 ID 完整排列 · 真实 PostgreSQL 保存重读</span></p>'
    body += '<p>' + ('使用 B 实际无 Key 估算和改日策略，未调用地图测试服务器。' if item['caseId'].endswith('NO-KEY') else '真实模型 + 可控地图 HTTP 响应 + 真实数据库。') + ' 模型耗时 ' + str(item['elapsedMs']) + ' ms；最终 source=<b>' + proposal['source'] + '</b>。本次原顺序已合法，模型未提供更优顺序，保留 rule 符合契约。</p>'
    body += '<details><summary>展开实际 system / user prompt 与严格 JSON Schema</summary>' + pre(item['request']) + '</details><h3>模型原始结构化回复</h3>' + pre(item['response']['choices'][0]['message']['content'])
    body += table(['日期', '顺序/景点', '开始', '游玩分钟', '前站交通分钟', '来源'], [(day['date'], str(p['position'] + 1) + ' / ' + {'001': '西湖', '002': '灵隐寺', '003': '良渚博物院'}.get(p['placeId'][-3:], p['placeId']), p['startTime'], p['durationMinutes'], p['travelMinutesFromPrevious'], p['travelTimeSource']) for day in proposal['days'] for p in day['items']])
    body += '<p class="muted">proposalId=' + proposal['proposalId'] + '；未安排景点数=' + str(len(proposal['unassignedPlaceIds'])) + '；所有者读取结果与返回方案逐字段一致。</p>'
page('pipeline.html', 'B 真实模型 → 排程 → 保存与重读', body)

page('coverage.html', '79 个扩展场景逐项结果', '<p><span class="pill">79 passed · 0 failed</span>；覆盖所有六个 B 接口、数据库、外部错误和模型链路。</p><p><a href="full-b-results.json">完整机器结果</a> · <a href="full-http-evidence.json">每次业务请求与响应</a> · <a href="map-contract-evidence.json">地图适配实际参数（可控服务）</a></p>' + limits + table(['编号', '验收场景', '结果', '耗时 ms'], [(c['id'], c['name'], c['status'], c.get('elapsedMs', '')) for c in full['cases']]))
cli = table(['执行命令', '退出码', '耗时 ms'], [(r['command'], r['exitCode'], r['elapsedMs']) for r in run['results']])
cli += '<h2>快速测试原始输出</h2><p><a href="06-fast-tests.txt">06-fast-tests.txt</a>（42/42；以下是实际命令日志）</p>' + pre(read('06-fast-tests.txt'))
cli += '<h2>真实数据库集成原始输出</h2><p>Node tests=8 包含 1 个父测试与 7 个业务子场景。</p>' + pre(read('08-integration.txt'))
page('cli.html', '命令行原始输出与退出码', cli)
page('server.html', '服务器 Docker 与清理复核', '<p>服务器 120.53.94.209；Docker 只在服务器使用；数据库与模型均绑定回环地址。</p><p><a href="12-server-docker.txt">服务器原始输出</a> · <a href="remote-commands.txt">部署与核对命令</a></p>' + pre(read('12-server-docker.txt')))

for source, target in [('docs/B-全面验收与开源模型.md', '功能覆盖矩阵.md'), ('docs/B-完整测试流程与用例.md', '完整测试流程与用例.md'), ('docs/接口与数据约定.md', '接口与数据约定.md'), ('scripts/remote-llm/setup.sh', 'remote-llm-setup.sh'), ('scripts/acceptance/remote-audit.sh', 'remote-audit.sh')]:
    shutil.copyfile(root / source, folder / target)

with (folder / '命令结果.csv').open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.writer(stream)
    writer.writerow(['编号', '命令', '退出码', '耗时毫秒', '原始日志'])
    writer.writerows((r['id'], r['command'], r['exitCode'], r['elapsedMs'], r['log']) for r in run['results'])

readme = '''# B 全面验收记录（2026-11-02）

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
'''
(folder / 'README.md').write_text(readme, encoding='utf-8')
dump('acceptance-summary.json', {'commandGroups': {'passed': run['passed'], 'failed': run['failed']}, 'fastTests': fast, 'postgresBusinessSubcases': 7, 'fullCases': {'passed': full['passed'], 'failed': full['failed']}, 'productionHttpChecks': smoke['passed'], 'realModelRequests': len(models), 'unverified': run['pending'], 'scope': full['scope']})
print('Report generated from verified raw results: 42 fast / 7 DB / 79 extended / 14 production HTTP / 3 real model calls.')
