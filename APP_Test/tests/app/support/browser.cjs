const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const { target, environmentError } = require("../../tdd/support/context.cjs");
const { fixtures, evidence } = require("./world.cjs");
const TRIP_ID = "40000000-0000-4000-8000-000000000001";
const VISIT_ID = "50000000-0000-4000-8000-000000000001";
const JOURNAL_ID = "60000000-0000-4000-8000-000000000001";
function uiFixture() {
  const f = fixtures(),
    now = new Date().toISOString();
  const input = {
    ...f.input,
    selectedPlaceIds: f.input.selectedPlaceIds.slice(0, 2),
  };
  const days = [
    {
      date: input.startDate,
      items: [
        {
          placeId: input.selectedPlaceIds[0],
          position: 0,
          startTime: "09:00",
          durationMinutes: 90,
          travelMinutesFromPrevious: 0,
          travelTimeSource: "none",
          reason: "测试契约",
        },
      ],
    },
    {
      date: input.endDate,
      items: [
        {
          placeId: input.selectedPlaceIds[1],
          position: 0,
          startTime: "09:00",
          durationMinutes: 120,
          travelMinutesFromPrevious: 0,
          travelTimeSource: "none",
          reason: "测试契约",
        },
      ],
    },
  ];
  const user = {
    id: "10000000-0000-4000-8000-000000000011",
    email: "ui@tdd.invalid",
    displayName: "UI测试用户",
  };
  const trip = {
    id: TRIP_ID,
    ownerId: user.id,
    title: "杭州两日游",
    revision: 3,
    status: "draft",
    planningInput: input,
    days: [],
    createdAt: now,
    updatedAt: now,
  };
  const proposal = {
    proposalId: "70000000-0000-4000-8000-000000000001",
    inputSnapshot: input,
    generatedAt: now,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    days,
    unassignedPlaceIds: [],
    warnings: [
      { code: "ROUTE_ESTIMATED", message: "测试步行估算，需核实路线" },
      { code: "OPENING_HOURS_UNVERIFIED", message: "开放时间未核实" },
    ],
    source: "rule",
  };
  const visit = {
    id: VISIT_ID,
    placeId: f.places[0].id,
    placeName: "西湖",
    coordinates: f.places[0].coordinates,
    cityId: input.cityId,
    cityAdcode: "330100",
    visitedOn: "2025-11-01",
    createdAt: now,
    updatedAt: now,
  };
  const journal = {
    id: JOURNAL_ID,
    visitedPlaceId: visit.id,
    title: "西湖随笔",
    body: "纯文本测试正文",
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ...f, user, trip, proposal, visit, journal };
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function browser(t, options = {}) {
  const cleanup = [];
  t.after(async () => {
    const failures = [];
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (e) {
        failures.push(e);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Browser cleanup failed");
  });
  const after = (fn) => cleanup.push(fn);
  let playwright;
  try {
    playwright = require("@playwright/test");
  } catch {
    throw environmentError("请在 App_Test 执行 npm ci 安装浏览器测试依赖");
  }
  const root = target().root,
    vite = path.join(root, "node_modules/vite/bin/vite.js");
  if (!fs.existsSync(vite))
    throw environmentError("目标工程缺少 Vite，先安装工程依赖");
  const port = await freePort(),
    url = `http://127.0.0.1:${port}`;
  const process_ = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: path.join(root, "apps/web"),
      windowsHide: true,
      env: {
        ...process.env,
        VITE_AMAP_JS_KEY: "",
        VITE_AMAP_SECURITY_JS_CODE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "",
    exited = false;
  process_.stdout.on("data", (b) => {
    log += b.toString();
  });
  process_.stderr.on("data", (b) => {
    log += b.toString();
  });
  process_.on("error", () => {
    exited = true;
  });
  process_.on("exit", () => {
    exited = true;
  });
  after(async () => {
    if (!exited) {
      const closed = new Promise((resolve) => process_.once("exit", resolve));
      process_.kill();
      await Promise.race([closed, delay(3000)]);
    }
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (exited) throw environmentError("Vite 启动失败；请单独修复前端运行环境");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  if (!ready) throw environmentError("Vite 启动超时");
  let engine;
  const channel =
    process.env.TPA_BROWSER_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "");
  try {
    engine = await playwright.chromium.launch({
      headless: true,
      ...(channel ? { channel } : {}),
    });
  } catch {
    throw environmentError(
      "浏览器不可用：配置 TPA_BROWSER_CHANNEL 或安装 Playwright Chromium",
    );
  }
  after(() => engine.close());
  const context = await engine.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
  });
  const page = await context.newPage(),
    errors = [],
    requests = [],
    f = uiFixture();
  if (options.fixture) options.fixture(f);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      endpoint = u.pathname.replace(/^\/api/, ""),
      method = req.method();
    let body;
    try {
      body = req.postDataJSON();
    } catch {}
    // Never retain auth headers, credentials or tokens in request evidence.
    requests.push({
      method,
      endpoint,
      body: endpoint.startsWith("/auth/") ? undefined : body,
      query: u.search,
    });
    if (options.real) {
      const response = await route.fetch({
        url: options.real.url + u.pathname + u.search,
      });
      await route.fulfill({ response });
      return;
    }
    if (
      options.handle &&
      (await options.handle({ route, req, endpoint, method, body, fixture: f }))
    )
      return;
    const paged = (items) => ({
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
    });
    let status = 200,
      result;
    if (endpoint === "/health")
      result = { status: "ok", service: "travel-planner-api" };
    else if (endpoint === "/auth/login")
      result = {
        user: f.user,
        accessToken: "ui-fixture-only",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    else if (endpoint === "/auth/register") {
      status = 201;
      result = { user: f.user };
    } else if (endpoint === "/users/me") result = f.user;
    else if (endpoint === "/destinations") result = paged(f.destinations);
    else if (endpoint === "/places") result = paged(f.places);
    else if (endpoint.startsWith("/places/"))
      result = f.places.find((p) => p.id === endpoint.split("/").pop());
    else if (endpoint === "/trips" && method === "GET")
      result = paged([f.trip]);
    else if (endpoint === "/trips" && method === "POST") {
      status = 201;
      result = {
        ...f.trip,
        revision: 1,
        planningInput: {
          ...f.trip.planningInput,
          startDate: null,
          endDate: null,
          themes: [],
          selectedPlaceIds: [],
        },
      };
    } else if (endpoint.endsWith("/apply-proposal"))
      result = {
        ...f.trip,
        status: "planned",
        revision: f.trip.revision + 1,
        days: f.proposal.days,
      };
    else if (endpoint.startsWith("/trips/"))
      result =
        method === "GET"
          ? f.trip
          : { ...f.trip, revision: f.trip.revision + 1 };
    else if (endpoint === "/recommendations/itinerary") result = f.proposal;
    else if (endpoint === "/footprints")
      result = {
        markers: [f.visit],
        litCities: [
          {
            cityId: f.visit.cityId,
            cityAdcode: f.visit.cityAdcode,
            cityName: "杭州市",
            visitCount: 1,
          },
        ],
      };
    else if (endpoint === "/journals" && method === "GET")
      result = paged([f.journal]);
    else if (endpoint === "/journals" && method === "POST") {
      status = 201;
      result = { ...f.journal, ...body };
    } else if (endpoint.startsWith("/journals/")) result = f.journal;
    else if (endpoint === "/visited-places") {
      status = 201;
      result = f.visit;
    } else {
      status = 404;
      result = { code: "NOT_FOUND", message: "测试场景未定义该请求" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  const report = process.env.TPA_TDD_REPORT_DIR,
    id = t.name?.split(" ")[0] || "UI";
  after(async () => {
    evidence("browser-requests", {
      caseId: id,
      requests: requests.map(({ method, endpoint }) => ({ method, endpoint })),
      pageErrors: errors,
    });
    if (report && !page.isClosed()) {
      const dir = path.join(report, "screenshots");
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, id + ".png"),
        fullPage: true,
      });
    }
  });
  async function login(identity = options.real?.a) {
    await page.goto(url + "/login");
    await page.getByTestId("auth-email").fill(identity?.email || f.user.email);
    await page
      .getByTestId("auth-password")
      .fill(identity?.password || "UI-fixture-password");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/auth/login" && r.status() === 200,
      ),
      page.getByTestId("auth-login-submit").click(),
    ]);
    await playwright.expect(page.getByTestId("trip-list")).toBeVisible();
  }
  async function open(route) {
    await login();
    // Navigate through browser history without a full reload, preserving the specified in-memory login.
    await page.evaluate((next) => {
      history.pushState({}, "", next);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
  }
  async function noOverflow() {
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Unexpected horizontal overflow",
    );
    assert.deepEqual(errors, []);
  }
  return {
    page,
    url,
    fixture: f,
    requests,
    errors,
    expect: playwright.expect,
    login,
    open,
    noOverflow,
    context,
  };
}
module.exports = { browser, uiFixture, TRIP_ID, VISIT_ID, JOURNAL_ID };
