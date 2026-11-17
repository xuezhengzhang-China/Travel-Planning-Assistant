const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const {
  fixtures,
  policies,
  userA,
  userB,
  fixedNow,
} = require("./fixtures.cjs");

function environmentError(message) {
  const error = new Error(message);
  error.code = "TDD_ENVIRONMENT";
  return error;
}
let binding;
function target() {
  if (binding) return binding;
  const configured = process.env.TPA_TDD_SUBJECT_ROOT;
  if (!configured || !path.isAbsolute(configured))
    throw environmentError(
      "必须显式设置绝对路径 TPA_TDD_SUBJECT_ROOT；不默认回退到已有实现。",
    );
  const root = path.resolve(configured);
  if (!fs.existsSync(path.join(root, "package.json")))
    throw environmentError("被测工程不存在 package.json。");
  const dependency = createRequire(path.join(root, "package.json"));
  function sut(relative) {
    const file = path.join(root, "apps/api/dist", relative);
    if (!fs.existsSync(file))
      throw environmentError(
        `缺少构建产物 ${relative}；环境错误不能作为初始业务失败。`,
      );
    return dependency(file);
  }
  binding = { root, dependency, sut };
  return binding;
}
function sut(relative) {
  return target().sut(relative);
}
function config(overrides = {}) {
  // Fixed test configuration avoids reading developer .env or a reference implementation.
  return {
    values: {
      amapKey: "tdd-fixture-only",
      externalTimeoutMs: 500,
      maxRouteCalls: 40,
      proposalTtlMinutes: 30,
      generationTimeoutMs: 20000,
      llmEnabled: false,
      llmBaseUrl: "http://127.0.0.1:1/v1",
      llmKey: "tdd-fixture-only",
      llmModel: "contract-model",
      llmTimeoutMs: 500,
      ...overrides,
    },
  };
}
function memoryProposals() {
  const rows = new Map();
  return {
    rows,
    async save(owner, proposal) {
      rows.set(proposal.proposalId, {
        owner,
        proposal: structuredClone(proposal),
      });
    },
    async getOwned(id, owner) {
      const row = rows.get(id);
      return row?.owner === owner ? structuredClone(row.proposal) : null;
    },
  };
}
function memoryCatalog(data = fixtures()) {
  return {
    data,
    async getCity(id) {
      return (
        data.destinations.find((d) => d.id === id && d.level === "city") || null
      );
    },
    async getPlaces(ids) {
      return data.places.filter((p) => ids.includes(p.id));
    },
    async getRouteCityCode() {
      return "0571";
    },
    async cityForAdminCode(code) {
      return ["330100", "330106", "330110"].includes(code)
        ? data.destinations[1]
        : null;
    },
  };
}
function recommendation() {
  const data = fixtures(),
    repository = memoryCatalog(data),
    proposals = memoryProposals(),
    settings = config();
  const places = new (sut("places/places.service.js").PlacesService)(
    repository,
  );
  const geo = {
    route: async () => ({
      durationMinutes: 30,
      source: "provider",
      warnings: [],
    }),
  };
  const advisor = { suggest: async () => ({ order: null }) };
  const service = new (sut(
    "recommendations/recommendations.service.js",
  ).RecommendationsService)(
    places,
    geo,
    proposals,
    settings,
    () => new Date(fixedNow),
    randomUUID,
    advisor,
  );
  return {
    data,
    repository,
    proposals,
    settings,
    places,
    geo,
    advisor,
    service,
  };
}
function expectHttp(status, code) {
  return (error) => {
    assert.equal(error.getStatus(), status);
    if (code) assert.equal(error.getResponse().code, code);
    return true;
  };
}
function plan(
  input = fixtures().input,
  places = fixtures().places,
  route = () => ({ durationMinutes: 30, source: "provider", warnings: [] }),
) {
  const { planRule, RouteNeeded, routeKey } = sut(
    "recommendations/rule-planner.js",
  );
  const routes = new Map();
  // A finite guard makes an implementation that repeatedly asks for the same edge fail.
  for (
    let attempts = 0;
    attempts <= input.selectedPlaceIds.length ** 2 + 1;
    attempts++
  ) {
    try {
      return planRule(input, places, routes);
    } catch (error) {
      if (!(error instanceof RouteNeeded)) throw error;
      const key = routeKey(error.from.id, error.to.id);
      assert.ok(!routes.has(key), "同一已缓存路线不能被重复请求");
      routes.set(key, route(error.from, error.to));
    }
  }
  assert.fail("排程没有在有限路线集合内结束");
}
function assertSchedule(input, places, result) {
  const expected = policies[input.pace],
    byId = new Map(places.map((p) => [p.id, p]));
  const count =
    Math.round(
      (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000,
    ) + 1;
  assert.equal(result.days.length, count);
  const seen = [];
  for (const [dayIndex, day] of result.days.entries()) {
    assert.equal(
      day.date,
      new Date(Date.parse(input.startDate) + dayIndex * 86400000)
        .toISOString()
        .slice(0, 10),
    );
    assert.ok(day.items.length <= expected.count);
    let end = expected.start;
    for (const [index, item] of day.items.entries()) {
      assert.equal(item.position, index);
      assert.match(item.startTime, /^\d{2}:\d{2}$/);
      const [hour, minute] = item.startTime.split(":").map(Number);
      assert.ok(hour <= 23 && minute <= 59);
      assert.ok(byId.has(item.placeId));
      assert.equal(
        item.durationMinutes,
        byId.get(item.placeId).suggestedDurationMinutes,
      );
      assert.ok(Number.isSafeInteger(item.travelMinutesFromPrevious));
      if (!index) {
        assert.equal(item.travelMinutesFromPrevious, 0);
        assert.equal(item.travelTimeSource, "none");
      } else {
        assert.ok(item.travelMinutesFromPrevious > 0);
        assert.ok(["provider", "estimate"].includes(item.travelTimeSource));
      }
      const start = hour * 60 + minute;
      assert.ok(
        start >=
          end + (index ? expected.rest + item.travelMinutesFromPrevious : 0),
      );
      assert.ok(start + item.durationMinutes <= expected.end);
      end = start + item.durationMinutes;
      seen.push(item.placeId);
    }
  }
  seen.push(...result.unassignedPlaceIds);
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual([...seen].sort(), [...input.selectedPlaceIds].sort());
}
async function localHttp(t, handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      let text = "";
      for await (const chunk of request) text += chunk;
      const record = {
        url: new URL(request.url, "http://fixture.invalid"),
        body: text ? JSON.parse(text) : null,
      };
      requests.push(record);
      await handler(record, response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, requests };
}
function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
async function database(t, options = {}) {
  const { root, dependency } = target();
  if (!process.env.TEST_DATABASE_URL)
    throw environmentError(
      "真库用例需要服务器专用 TEST_DATABASE_URL；缺配置应记为阻塞。",
    );
  let url;
  try {
    url = new URL(process.env.TEST_DATABASE_URL);
  } catch {
    throw environmentError("TEST_DATABASE_URL 格式错误。");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !/^[a-z0-9_]+_test$/.test(decodeURIComponent(url.pathname.slice(1)))
  )
    throw environmentError("仅允许 PostgreSQL 专用 _test 数据库。");
  const { Client } = dependency("pg"),
    schema = "tdd_" + randomUUID().replaceAll("-", "");
  const admin = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
  } catch {
    await admin.end().catch(() => {});
    throw environmentError("无法连接服务器专用测试库，连接信息不输出。");
  }
  let created = false;
  t.after(async () => {
    try {
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await admin.query(`SET search_path TO "${schema}",public`);
  const migrationOptions = {
    dbClient: admin,
    dir: path.join(root, "apps/api/migrations"),
    direction: "up",
    schema,
    migrationsSchema: schema,
    migrationsTable: "pgmigrations",
    log: () => {},
  };
  const migrate = (extra) =>
    dependency("node-pg-migrate").runner({ ...migrationOptions, ...extra });
  const seed = () =>
    dependency(path.join(root, "apps/api/scripts/seed-b.cjs")).seedB(admin);
  if (options.migrate !== false) await migrate();
  if (options.seed !== false) await seed();
  if (options.users !== false && options.migrate !== false) {
    // Planning-only integration uses synthetic actors, never login accounts.
    // Permit the later auth migration to require credential columns without weakening its constraints.
    const columns = await admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='users'",
      [schema],
    );
    const credentials = ["password_hash", "password_salt"].filter((name) =>
      columns.rows.some((row) => row.column_name === name),
    );
    for (const [index, owner] of [userA, userB].entries()) {
      const values = [
        owner,
        `tdd-${index}@fixture.invalid`,
        "隔离测试身份",
        ...credentials.map(() => "not-a-login-credential"),
      ];
      const names = ["id", "email", "display_name", ...credentials];
      await admin.query(
        `INSERT INTO users(${names.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")})`,
        values,
      );
    }
  }
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return { admin, schema, url: url.toString(), migrate, seed, Client };
}
async function application(t, options = {}) {
  const { dependency } = target();
  dependency("reflect-metadata");
  const { Module } = dependency("@nestjs/common"),
    { NestFactory } = dependency("@nestjs/core");
  const { BModule } = sut("b/b.module.js"),
    { BConfig } = sut("b/config.js"),
    { B_AUTHENTICATOR } = sut("b/identity.js");
  const data = fixtures(),
    proposals = memoryProposals(),
    settings = config({ amapKey: "" });
  const providers = [{ provide: BConfig, useValue: settings }];
  if (!options.productionIdentity)
    providers.push({
      provide: B_AUTHENTICATOR,
      useValue: {
        authenticate: async (header) =>
          header === "Bearer tdd-a"
            ? { userId: userA }
            : header === "Bearer tdd-b"
              ? { userId: userB }
              : null,
      },
    });
  if (!options.database) {
    const directory = memoryCatalog(data);
    // SQL directory behavior is tested using the real repository in C01-C12.
    directory.destinations = async () => ({
      items: data.destinations,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    directory.places = async () => ({
      items: data.places,
      page: 1,
      pageSize: 20,
      total: 3,
    });
    providers.push(
      {
        provide: sut("places/places.repository.js").PlacesRepository,
        useValue: directory,
      },
      {
        provide: sut("recommendations/proposals.repository.js")
          .ProposalsRepository,
        useValue: proposals,
      },
    );
  }
  providers.push(...(options.providers || []));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    options.database?.url || "postgresql://tdd:tdd@127.0.0.1:1/tdd_test";
  let app;
  try {
    class Root {}
    Module({ imports: [BModule.register({ providers })] })(Root);
    app = await NestFactory.create(Root, { logger: false });
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
  } catch (error) {
    if (app) await app.close();
    throw error;
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await app.close();
    }
  };
  t.after(close);
  const base = (await app.getUrl()) + "/api";
  const request = async (
    method,
    endpoint,
    body,
    status = 200,
    token = "tdd-a",
    headers = {},
  ) => {
    const response = await fetch(base + endpoint, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  return { app, data, settings, proposals, request, close };
}
module.exports = {
  target,
  sut,
  config,
  fixtures,
  policies,
  memoryCatalog,
  memoryProposals,
  recommendation,
  plan,
  assertSchedule,
  expectHttp,
  localHttp,
  json,
  database,
  application,
  environmentError,
};
