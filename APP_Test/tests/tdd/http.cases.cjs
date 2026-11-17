const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  database,
  application,
  sut,
  localHttp,
  json,
} = require("./support/context.cjs");
const { cityId, provinceId, id } = require("./support/fixtures.cjs");
module.exports = {
  H01: [
    "目的地HTTP筛选分页和校验错误符合契约",
    async (t) => {
      const db = await database(t),
        app = await application(t, { database: db });
      const page = await app.request(
        "GET",
        `/destinations?level=city&parentId=${provinceId}&pageSize=1`,
      );
      assert.equal(page.page, 1);
      assert.equal(page.pageSize, 1);
      assert.equal(page.total, 1);
      assert.deepEqual(
        page.items.map((d) => d.id),
        [cityId],
      );
      const error = await app.request(
        "GET",
        "/destinations?page=0",
        undefined,
        400,
      );
      assert.equal(error.code, "VALIDATION_ERROR");
    },
  ],
  H02: [
    "景点HTTP组合筛选主题排序和空页总数",
    async (t) => {
      const db = await database(t),
        app = await application(t, { database: db });
      const first = await app.request(
        "GET",
        `/places?cityId=${cityId}&category=history&themes=art&pageSize=1`,
      );
      assert.equal(first.total, 2);
      assert.deepEqual(
        first.items.map((p) => p.id),
        [id(3)],
      );
      const empty = await app.request(
        "GET",
        `/places?cityId=${cityId}&category=history&page=999`,
      );
      assert.deepEqual(empty.items, []);
      assert.equal(empty.total, 2);
      await app.request("GET", "/places", undefined, 400);
    },
  ],
  H03: [
    "景点详情HTTP完整资源与400和404",
    async (t) => {
      const app = await application(t);
      const detail = await app.request("GET", `/places/${id(1)}`);
      assert.equal(detail.id, id(1));
      assert.equal(detail.cityId, cityId);
      assert.equal(detail.coordinates.coordinateSystem, "GCJ-02");
      assert.equal(detail.suggestedDurationMinutes, 90);
      assert.equal(
        (await app.request("GET", "/places/not-a-uuid", undefined, 400)).code,
        "VALIDATION_ERROR",
      );
      assert.equal(
        (await app.request("GET", "/places/" + randomUUID(), undefined, 404))
          .code,
        "NOT_FOUND",
      );
    },
  ],
  H04: [
    "路线HTTP来源警告和200及400及503正确",
    async (t) => {
      const app = await application(t),
        p = app.data.places;
      const body = {
        from: p[0].coordinates,
        to: p[1].coordinates,
        transportMode: "walking",
      };
      const result = await app.request("POST", "/routes/preview", body);
      assert.equal(result.source, "estimate");
      assert.equal(result.durationMinutes, 83);
      assert.ok(result.warnings.some((w) => w.code === "ROUTE_ESTIMATED"));
      await app.request(
        "POST",
        "/routes/preview",
        { ...body, transportMode: "flying" },
        400,
      );
      await app.request(
        "POST",
        "/routes/preview",
        { ...body, transportMode: "driving" },
        503,
      );
      await app.request(
        "POST",
        "/routes/preview",
        { ...body, to: p[2].coordinates },
        503,
      );
    },
  ],
  H05: [
    "逆地理HTTP明确城市空值和异常契约",
    async (t) => {
      let code = "330106";
      const server = await localHttp(t, (_request, response) =>
        json(response, {
          status: "1",
          regeocode: {
            formatted_address: "HTTP测试地点",
            addressComponent: { adcode: code, citycode: "0571" },
          },
        }),
      );
      const app = await application(t, {
        providers: [
          {
            provide: sut("integrations/amap/amap.client.js").B_FETCH,
            useValue: (address, options) =>
              fetch(new URL(new URL(address).pathname, server.base), options),
          },
        ],
      });
      app.settings.values.amapKey = "tdd-fixture-only";
      const request = { coordinates: app.data.places[0].coordinates };
      const located = await app.request("POST", "/locations/reverse", request);
      assert.equal(located.cityId, cityId);
      assert.equal(located.cityAdcode, "330100");
      code = "330199";
      const unknown = await app.request("POST", "/locations/reverse", request);
      assert.equal(unknown.cityId, null);
      assert.equal(unknown.cityAdcode, null);
      assert.ok(unknown.warnings.some((w) => w.code === "CITY_UNCONFIRMED"));
      await app.request(
        "POST",
        "/locations/reverse",
        { coordinates: { ...request.coordinates, coordinateSystem: "WGS-84" } },
        400,
      );
      app.settings.values.amapKey = "";
      await app.request("POST", "/locations/reverse", request, 503);
    },
  ],
  H06: [
    "推荐HTTP生成完整方案且拒绝伪造所有者",
    async (t) => {
      const app = await application(t);
      const result = await app.request(
        "POST",
        "/recommendations/itinerary",
        app.data.input,
      );
      assert.equal(result.source, "rule");
      assert.deepEqual(
        result.days.map((d) => d.items.length),
        [2, 1],
      );
      assert.deepEqual(result.unassignedPlaceIds, []);
      assert.deepEqual(result.inputSnapshot, app.data.input);
      assert.ok(app.proposals.rows.has(result.proposalId));
      const before = app.proposals.rows.size;
      await app.request(
        "POST",
        "/recommendations/itinerary",
        { ...app.data.input, ownerId: "10000000-0000-4000-8000-000000000002" },
        400,
      );
      assert.equal(app.proposals.rows.size, before);
    },
  ],
  H07: [
    "生产B身份默认拒绝匿名伪造和自报身份",
    async (t) => {
      const app = await application(t, { productionIdentity: true });
      for (const [method, endpoint] of [
        ["GET", "/destinations"],
        ["GET", "/places"],
        ["GET", "/places/x"],
        ["POST", "/routes/preview"],
        ["POST", "/locations/reverse"],
        ["POST", "/recommendations/itinerary"],
      ])
        for (const token of ["", "forged", "tdd-a"]) {
          const result = await app.request(
            method,
            endpoint,
            method === "POST" ? {} : undefined,
            401,
            token,
            { "x-user-id": "10000000-0000-4000-8000-000000000001" },
          );
          assert.equal(result.code, "UNAUTHENTICATED");
        }
    },
  ],
  H08: [
    "HTTP错误有code和message且未知SQL异常不泄漏",
    async (t) => {
      const app = await application(t, {
        providers: [
          {
            provide: sut("recommendations/proposals.repository.js")
              .ProposalsRepository,
            useValue: {
              save: async () => {
                throw new Error(
                  "SELECT private_key, password FROM secret_table",
                );
              },
              getOwned: async () => null,
            },
          },
        ],
      });
      const validation = await app.request(
        "POST",
        "/recommendations/itinerary",
        { ...app.data.input, startDate: "2026-02-30" },
        400,
      );
      assert.equal(validation.code, "INVALID_DATE_RANGE");
      assert.equal(typeof validation.message, "string");
      const failed = await app.request(
        "POST",
        "/recommendations/itinerary",
        app.data.input,
        500,
      );
      assert.equal(failed.code, "INTERNAL_ERROR");
      assert.equal(typeof failed.message, "string");
      for (const secret of [
        "SELECT",
        "private_key",
        "password",
        "secret_table",
        "stack",
      ])
        assert.ok(!JSON.stringify(failed).includes(secret));
    },
  ],
};
