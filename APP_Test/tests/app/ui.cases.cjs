const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { browser, TRIP_ID, JOURNAL_ID } = require("./support/browser.cjs");
const { image } = require("./support/world.cjs");
const fail = async (route, status, code) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ code, message: "测试错误：" + code }),
  });
async function preview(t, options = {}) {
  const u = await browser(t, options);
  await u.open(`/trips/${TRIP_ID}/edit`);
  await u.page.getByTestId("generate-itinerary").click();
  await u.expect(u.page.getByTestId("proposal-preview")).toBeVisible();
  return u;
}
module.exports = {
  UI01: [
    "注册页面提交约定字段并引导真实登录入口",
    async (t) => {
      const u = await browser(t);
      await u.page.goto(u.url + "/register");
      await u.page.getByTestId("auth-email").fill("ui@tdd.invalid");
      await u.page.getByTestId("auth-password").fill("UI-fixture-password");
      await u.page.getByTestId("auth-display-name").fill("UI测试用户");
      await u.page.getByTestId("auth-register-submit").click();
      await u.expect(u.page.getByTestId("auth-login-submit")).toBeVisible();
      assert.equal(
        u.requests.filter(
          (r) => r.endpoint === "/auth/register" && r.method === "POST",
        ).length,
        1,
      );
    },
  ],
  UI02: [
    "空行程显示空状态而不是网络错误",
    async (t) => {
      const u = await browser(t, {
        handle: async ({ route, endpoint, method }) => {
          if (endpoint === "/trips" && method === "GET") {
            await route.fulfill({
              json: { items: [], page: 1, pageSize: 20, total: 0 },
            });
            return true;
          }
        },
      });
      await u.login();
      await u.expect(u.page.getByTestId("trips-empty")).toBeVisible();
      await u.expect(u.page.getByTestId("error-banner")).toHaveCount(0);
    },
  ],
  UI03: [
    "非法日期在前端阻止生成并保留用户输入",
    async (t) => {
      const u = await browser(t);
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.page.getByTestId("trip-start-date").fill("2026-11-03");
      await u.page.getByTestId("trip-end-date").fill("2026-11-01");
      await u.expect(u.page.getByTestId("date-error")).toBeVisible();
      await u.expect(u.page.getByTestId("generate-itinerary")).toBeDisabled();
      assert.equal(
        u.requests.filter((r) => r.endpoint === "/recommendations/itinerary")
          .length,
        0,
      );
      await u
        .expect(u.page.getByTestId("trip-start-date"))
        .toHaveValue("2026-11-03");
    },
  ],
  UI04: [
    "保存失败保留表单并停留当前步骤允许重试",
    async (t) => {
      const u = await browser(t, {
        handle: async ({ route, endpoint, method }) => {
          if (endpoint.startsWith("/trips/") && method === "PATCH") {
            await fail(route, 500, "INTERNAL_ERROR");
            return true;
          }
        },
      });
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.page.getByTestId("trip-start-date").fill("2026-11-02");
      await u.page.getByTestId("save-dates").click();
      await u.expect(u.page.getByTestId("error-banner")).toBeVisible();
      await u
        .expect(u.page.getByTestId("trip-start-date"))
        .toHaveValue("2026-11-02");
      await u.expect(u.page.getByTestId("save-dates")).toBeEnabled();
    },
  ],
  UI05: [
    "推荐预览展示估算与开放时间未核实警告",
    async (t) => {
      const u = await preview(t);
      await u
        .expect(u.page.getByTestId("warning-ROUTE_ESTIMATED"))
        .toBeVisible();
      await u
        .expect(u.page.getByTestId("warning-OPENING_HOURS_UNVERIFIED"))
        .toBeVisible();
      await u
        .expect(u.page.getByTestId("proposal-source"))
        .toHaveText(/rule|规则/);
    },
  ],
  UI06: [
    "存在未安排景点时展示名单并禁用完整确认",
    async (t) => {
      const u = await preview(t, {
        fixture: (f) => {
          f.proposal.unassignedPlaceIds = [f.places[1].id];
          f.proposal.days[1].items = [];
        },
      });
      await u
        .expect(u.page.getByTestId("unassigned-places"))
        .toContainText(/灵隐/);
      await u.expect(u.page.getByTestId("confirm-proposal")).toBeDisabled();
    },
  ],
  UI07: [
    "409冲突提示重新载入且不自动覆盖服务器版本",
    async (t) => {
      const u = await preview(t, {
        handle: async ({ route, endpoint }) => {
          if (endpoint.endsWith("/apply-proposal")) {
            await fail(route, 409, "REVISION_CONFLICT");
            return true;
          }
        },
      });
      await u.page.getByTestId("confirm-proposal").click();
      await u.expect(u.page.getByTestId("revision-conflict")).toBeVisible();
      assert.equal(
        u.requests.filter((r) => r.endpoint.endsWith("/apply-proposal")).length,
        1,
      );
    },
  ],
  UI08: [
    "方案过期保留条件并提供重新生成入口",
    async (t) => {
      const u = await preview(t, {
        handle: async ({ route, endpoint }) => {
          if (endpoint.endsWith("/apply-proposal")) {
            await fail(route, 410, "PROPOSAL_EXPIRED");
            return true;
          }
        },
      });
      await u.page.getByTestId("confirm-proposal").click();
      await u.expect(u.page.getByTestId("proposal-expired")).toBeVisible();
      await u.expect(u.page.getByTestId("regenerate-itinerary")).toBeEnabled();
      await u.expect(u.page.getByTestId("proposal-preview")).toBeVisible();
    },
  ],
  UI09: [
    "401保存失败引导登录而不是展示空行程",
    async (t) => {
      const u = await browser(t, {
        handle: async ({ route, endpoint, method }) => {
          if (endpoint.startsWith("/trips/") && method === "PATCH") {
            await fail(route, 401, "UNAUTHENTICATED");
            return true;
          }
        },
      });
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.page.getByTestId("save-dates").click();
      await u.expect(u.page.getByTestId("auth-login-submit")).toBeVisible();
      await u.expect(u.page.getByTestId("trips-empty")).toHaveCount(0);
    },
  ],
  UI10: [
    "确认请求进行中禁用按钮并抑制重复点击",
    async (t) => {
      const u = await preview(t, {
        handle: async ({ route, endpoint, fixture: f }) => {
          if (endpoint.endsWith("/apply-proposal")) {
            await delay(300);
            await route.fulfill({
              json: {
                ...f.trip,
                status: "planned",
                revision: 4,
                days: f.proposal.days,
              },
            });
            return true;
          }
        },
      });
      await u.page.getByTestId("confirm-proposal").evaluate((button) => {
        button.click();
        button.click();
      });
      await u.expect(u.page.getByTestId("confirm-proposal")).toBeDisabled();
      await u.expect(u.page.getByTestId("daily-schedule")).toBeVisible();
      assert.equal(
        u.requests.filter((r) => r.endpoint.endsWith("/apply-proposal")).length,
        1,
      );
    },
  ],
  UI11: [
    "景点搜索后返回的旧请求不能覆盖新关键词结果",
    async (t) => {
      const u = await browser(t, {
        handle: async ({ route, req, endpoint, fixture: f }) => {
          const keyword = new URL(req.url()).searchParams.get("keyword");
          if (endpoint === "/places" && keyword) {
            await delay(keyword === "旧查询" ? 350 : 10);
            await route.fulfill({
              json: {
                items: [{ ...f.places[0], name: keyword + "结果" }],
                page: 1,
                pageSize: 20,
                total: 1,
              },
            });
            return true;
          }
        },
      });
      await u.open(`/trips/${TRIP_ID}/edit`);
      const oldRequest = u.page.waitForRequest(
        (r) => new URL(r.url()).searchParams.get("keyword") === "旧查询",
      );
      const oldResponse = u.page.waitForResponse(
        (r) => new URL(r.url()).searchParams.get("keyword") === "旧查询",
      );
      const search = u.page.getByTestId("place-search");
      await search.fill("旧查询");
      await oldRequest;
      await search.fill("新查询");
      await oldResponse;
      await u
        .expect(u.page.getByTestId("place-results"))
        .toContainText("新查询结果");
      await u
        .expect(u.page.getByTestId("place-results"))
        .not.toContainText("旧查询结果");
    },
  ],
  UI12: [
    "图片上传失败保留正文与其余编辑内容",
    async (t) => {
      const u = await browser(t, {
        handle: async ({ route, endpoint, method }) => {
          if (endpoint === "/media" && method === "POST") {
            await fail(route, 503, "DEPENDENCY_UNAVAILABLE");
            return true;
          }
        },
      });
      await u.open(`/journals/${JOURNAL_ID}`);
      await u.page.getByTestId("edit-journal").click();
      await u.page.getByTestId("journal-body").fill("上传失败也要保留的正文");
      await u.page
        .getByTestId("journal-media-input")
        .setInputFiles({
          name: "fixture.png",
          mimeType: "image/png",
          buffer: image(),
        });
      await u.expect(u.page.getByTestId("media-upload-error")).toBeVisible();
      await u
        .expect(u.page.getByTestId("journal-body"))
        .toHaveValue("上传失败也要保留的正文");
    },
  ],
  UI13: [
    "手账纯文本展示不执行正文中的HTML脚本",
    async (t) => {
      const text =
        '<img src=x onerror="window.__tpaXss=1"><script>window.__tpaXss=1</script>';
      const u = await browser(t, {
        fixture: (f) => {
          f.journal.body = text;
        },
      });
      await u.open(`/journals/${JOURNAL_ID}`);
      await u.expect(u.page.getByTestId("journal-body-text")).toHaveText(text);
      assert.equal(await u.page.evaluate(() => window.__tpaXss), undefined);
      await u
        .expect(u.page.getByTestId("journal-body-text").locator("script,img"))
        .toHaveCount(0);
    },
  ],
  UI14: [
    "私人图片使用Bearer请求和Blob展示且URL不含token",
    async (t) => {
      let fetched = false;
      const id = "80000000-0000-4000-8000-000000000001";
      const u = await browser(t, {
        fixture: (f) => {
          f.journal.mediaIds = [id];
        },
        handle: async ({ route, req, endpoint }) => {
          if (endpoint === "/media/" + id) {
            assert.match(req.headers().authorization || "", /^Bearer /);
            assert.ok(!/token=/i.test(req.url()));
            fetched = true;
            await route.fulfill({ contentType: "image/png", body: image() });
            return true;
          }
        },
      });
      await u.open(`/journals/${JOURNAL_ID}`);
      const img = u.page.getByTestId("journal-media-" + id);
      await u.expect(img).toBeVisible();
      assert.ok(fetched);
      assert.match(await img.getAttribute("src"), /^blob:/);
    },
  ],
  UI15: [
    "390像素手机规划编辑页无横向溢出与运行错误",
    async (t) => {
      const u = await browser(t, { viewport: { width: 390, height: 844 } });
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.expect(u.page.getByTestId("trip-start-date")).toBeVisible();
      await u.expect(u.page.getByTestId("generate-itinerary")).toBeVisible();
      await u.noOverflow();
    },
  ],
  UI16: [
    "1280像素足迹页面展示标记点亮与随笔入口",
    async (t) => {
      const u = await browser(t);
      await u.open("/footprints");
      await u
        .expect(u.page.getByTestId("visit-marker-" + u.fixture.visit.id))
        .toBeVisible();
      await u
        .expect(u.page.getByTestId("city-lit-" + u.fixture.visit.cityId))
        .toBeVisible();
      await u.noOverflow();
    },
  ],
  UI17: [
    "地图SDK加载失败仍可读取手账文字列表",
    async (t) => {
      const u = await browser(t);
      await u.page.route("**://webapi.amap.com/**", (route) => route.abort());
      await u.open("/footprints");
      await u.expect(u.page.getByTestId("map-unavailable")).toBeVisible();
      await u
        .expect(u.page.getByTestId("journal-list"))
        .toContainText("西湖随笔");
      assert.deepEqual(u.errors, []);
    },
  ],
  UI18: [
    "更换城市前确认清空旧景点且采用服务器新状态",
    async (t) => {
      const city = "20000000-0000-4000-8000-000000000099";
      const u = await browser(t, {
        fixture: (f) => {
          f.destinations.push({
            ...f.destinations[1],
            id: city,
            name: "另一城市",
            adcode: "999999",
          });
        },
        handle: async ({ route, endpoint, method, fixture: f }) => {
          if (endpoint.startsWith("/trips/") && method === "PATCH") {
            await route.fulfill({
              json: {
                ...f.trip,
                revision: 4,
                planningInput: {
                  ...f.trip.planningInput,
                  cityId: city,
                  selectedPlaceIds: [],
                },
                days: [],
              },
            });
            return true;
          }
        },
      });
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.page.getByTestId("trip-city").selectOption(city);
      await u.expect(u.page.getByTestId("city-change-confirm")).toBeVisible();
      await u.page.getByTestId("confirm-city-change").click();
      await u.expect(u.page.getByTestId("selected-places")).toBeEmpty();
    },
  ],
  UI19: [
    "刷新重新登录后从服务器恢复草稿日期与选择",
    async (t) => {
      const u = await browser(t);
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u.page.reload();
      await u.open(`/trips/${TRIP_ID}/edit`);
      await u
        .expect(u.page.getByTestId("trip-start-date"))
        .toHaveValue(u.fixture.input.startDate);
      for (const id of u.fixture.trip.planningInput.selectedPlaceIds)
        await u
          .expect(u.page.getByTestId("selected-place-" + id))
          .toBeVisible();
    },
  ],
  UI20: [
    "确认仅提交proposalId和expectedRevision不提交可信日程JSON",
    async (t) => {
      const u = await preview(t);
      await u.page.getByTestId("confirm-proposal").click();
      await u.expect(u.page.getByTestId("daily-schedule")).toBeVisible();
      const req = u.requests.find((r) =>
        r.endpoint.endsWith("/apply-proposal"),
      );
      assert.deepEqual(req.body, {
        proposalId: u.fixture.proposal.proposalId,
        expectedRevision: u.fixture.trip.revision,
      });
    },
  ],
};
