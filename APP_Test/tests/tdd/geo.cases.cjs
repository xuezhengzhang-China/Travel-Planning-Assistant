const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const {
  sut,
  fixtures,
  config,
  memoryCatalog,
  recommendation,
  expectHttp,
  localHttp,
  json,
} = require("./support/context.cjs");
const { cityId } = require("./support/fixtures.cjs");
function client(settings, transport) {
  return new (sut("integrations/amap/amap.client.js").AmapClient)(
    settings,
    transport,
  );
}
function geo(amap) {
  return new (sut("integrations/amap/geo.service.js").GeoService)(
    amap,
    new (sut("places/places.service.js").PlacesService)(memoryCatalog()),
  );
}
function redirect(base) {
  return (address, options) => {
    const url = new URL(address);
    assert.equal(url.hostname, "restapi.amap.com");
    return fetch(new URL(url.pathname + url.search, base), options);
  };
}
function routeData(seconds = "61") {
  return {
    status: "1",
    infocode: "10000",
    route: {
      paths: [{ cost: { duration: seconds } }],
      transits: [{ cost: { duration: seconds } }],
    },
  };
}
function reverseData(adcode = "330106", citycode = "0571") {
  return {
    status: "1",
    regeocode: {
      formatted_address: "合同测试地址",
      addressComponent: { adcode, citycode, city: [] },
    },
  };
}
async function routeContract(t, mode, expectedPath) {
  const server = await localHttp(t, (_request, response) =>
    json(response, routeData()),
  );
  const api = client(config(), redirect(server.base)),
    [from, to] = fixtures().places.map((p) => p.coordinates);
  assert.equal(
    await api.route(from, to, mode, mode === "transit" ? "0571" : undefined),
    2,
  );
  const request = server.requests[0].url;
  assert.equal(request.pathname, expectedPath);
  assert.equal(request.searchParams.get("show_fields"), "cost");
  assert.equal(request.searchParams.get("origin"), "120.148000,30.245000");
  assert.equal(request.searchParams.get("destination"), "120.102000,30.242000");
  return server;
}
module.exports = {
  R01: [
    "步行请求路径坐标和cost参数正确",
    (t) => routeContract(t, "walking", "/v5/direction/walking"),
  ],
  R02: [
    "驾车请求路径和耗时解析正确",
    (t) => routeContract(t, "driving", "/v5/direction/driving"),
  ],
  R03: [
    "公交使用citycode并可从两点逆地理分别取得",
    async (t) => {
      const server = await routeContract(
        t,
        "transit",
        "/v5/direction/transit/integrated",
      );
      assert.equal(server.requests[0].url.searchParams.get("city1"), "0571");
      assert.equal(server.requests[0].url.searchParams.get("city2"), "0571");
      const deriving = await localHttp(t, (request, response) =>
        json(
          response,
          request.url.pathname.includes("regeo") ? reverseData() : routeData(),
        ),
      );
      const points = fixtures().places.map((p) => p.coordinates);
      assert.equal(
        await client(config(), redirect(deriving.base)).route(
          points[0],
          points[1],
          "transit",
        ),
        2,
      );
      assert.equal(
        deriving.requests.filter((r) => r.url.pathname.includes("regeo"))
          .length,
        2,
      );
      assert.equal(
        deriving.requests.at(-1).url.searchParams.get("city1"),
        "0571",
      );
    },
  ],
  R04: [
    "路线秒数向上取整为正整数分钟",
    async (t) => {
      let seconds = "1";
      const server = await localHttp(t, (_request, response) =>
          json(response, routeData(seconds)),
        ),
        api = client(config(), redirect(server.base)),
        p = fixtures().places;
      for (const [raw, expected] of [
        ["1", 1],
        ["60", 1],
        ["61", 2],
        [2701, 46],
      ]) {
        seconds = raw;
        assert.equal(
          await api.route(p[0].coordinates, p[1].coordinates, "walking"),
          expected,
        );
      }
    },
  ],
  R05: [
    "空路径和无效耗时永不转换成成功路线",
    async (t) => {
      let payload;
      const server = await localHttp(t, (_request, response) =>
          json(response, payload),
        ),
        api = client(config(), redirect(server.base)),
        p = fixtures().places;
      for (const raw of [0, -1, "", "NaN", null, {}, 604801]) {
        payload = routeData(raw);
        await assert.rejects(
          api.route(p[0].coordinates, p[1].coordinates, "walking"),
          expectHttp(503),
        );
      }
      payload = { status: "1", route: { paths: [] } };
      await assert.rejects(
        api.route(p[0].coordinates, p[1].coordinates, "walking"),
        expectHttp(503),
      );
    },
  ],
  R06: [
    "HTTP业务状态和损坏JSON均导致受控失败",
    async (t) => {
      let mode;
      const server = await localHttp(t, (_request, response) => {
          if (mode === "http") return json(response, {}, 502);
          if (mode === "business")
            return json(response, {
              status: "0",
              infocode: "10001",
              info: "tdd-fixture-only",
            });
          response.end("not json");
        }),
        api = client(config(), redirect(server.base)),
        p = fixtures().places;
      for (mode of ["http", "business", "json"]) {
        await assert.rejects(
          api.route(p[0].coordinates, p[1].coordinates, "driving"),
          (error) => {
            expectHttp(503)(error);
            assert.ok(
              !JSON.stringify(error.getResponse()).includes("tdd-fixture-only"),
            );
            return true;
          },
        );
      }
    },
  ],
  R07: [
    "地图超时取消及总生成截止有效且不保存",
    async (t) => {
      const server = await localHttp(t, async (_request, response) => {
          await delay(120);
          json(response, routeData());
        }),
        api = client(config({ externalTimeoutMs: 20 }), redirect(server.base)),
        p = fixtures().places;
      await assert.rejects(
        api.route(p[0].coordinates, p[1].coordinates, "driving"),
        expectHttp(503),
      );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        api.route(
          p[0].coordinates,
          p[1].coordinates,
          "driving",
          undefined,
          controller.signal,
        ),
        expectHttp(503),
      );
      const f = recommendation();
      f.settings.values.generationTimeoutMs = 10;
      f.geo.route = async () => {
        await delay(50);
        return { durationMinutes: 1, source: "provider", warnings: [] };
      };
      await assert.rejects(
        f.service.generate(
          f.data.input,
          "10000000-0000-4000-8000-000000000001",
        ),
        expectHttp(503),
      );
      assert.equal(f.proposals.rows.size, 0);
    },
  ],
  R08: [
    "无Key近距离步行采用明确警告的合理估算",
    async () => {
      const points = fixtures().places.map((p) => p.coordinates);
      let calls = 0;
      const actual = geo(
        client(config({ amapKey: "" }), async () => {
          calls++;
          throw new Error("unexpected network");
        }),
      );
      const result = await actual.route(points[0], points[1], "walking");
      assert.equal(result.source, "estimate");
      assert.equal(result.durationMinutes, 83);
      assert.ok(result.warnings.some((w) => w.code === "ROUTE_ESTIMATED"));
      assert.equal(calls, 0);
    },
  ],
  R09: [
    "无Key驾车公交和远距离步行均不伪造路线",
    async () => {
      const points = fixtures().places.map((p) => p.coordinates),
        actual = geo(
          client(config({ amapKey: "" }), async () => {
            throw new Error("unexpected network");
          }),
        );
      for (const [mode, to] of [
        ["walking", points[2]],
        ["driving", points[1]],
        ["transit", points[1]],
      ])
        await assert.rejects(
          actual.route(points[0], to, mode),
          expectHttp(503, "DEPENDENCY_UNAVAILABLE"),
        );
    },
  ],
  R10: [
    "有向路线复用且调用预算耗尽不保存不可靠方案",
    async () => {
      const f = recommendation(),
        calls = [],
        input = f.data.input;
      f.advisor.suggest = async () => ({
        order: [...input.selectedPlaceIds].reverse(),
      });
      f.geo.route = async (from, to) => {
        calls.push(from.longitude + ">" + to.longitude);
        return { durationMinutes: 30, source: "provider", warnings: [] };
      };
      await f.service.generate(input, "10000000-0000-4000-8000-000000000001");
      assert.equal(new Set(calls).size, calls.length);
      assert.ok(calls.includes("120.148>120.102"));
      assert.ok(calls.includes("120.102>120.148"));
      const capped = recommendation();
      capped.settings.values.maxRouteCalls = 1;
      let count = 0;
      capped.geo.route = async () => {
        count++;
        return { durationMinutes: 1, source: "provider", warnings: [] };
      };
      await assert.rejects(
        capped.service.generate(
          {
            ...capped.data.input,
            transportMode: "driving",
            endDate: "2026-11-01",
          },
          "10000000-0000-4000-8000-000000000001",
        ),
        expectHttp(503),
      );
      assert.equal(count, 1);
      assert.equal(capped.proposals.rows.size, 0);
    },
  ],
  G01: [
    "逆地理采用供应商返回的有效地点描述",
    async (t) => {
      const server = await localHttp(t, (_request, response) =>
        json(response, reverseData()),
      );
      const result = await client(config(), redirect(server.base)).reverse(
        fixtures().places[0].coordinates,
      );
      assert.equal(result.placeName, "合同测试地址");
      assert.equal(server.requests[0].url.pathname, "/v3/geocode/regeo");
    },
  ],
  G02: [
    "登记区县映射平台城市及城市级adcode",
    async (t) => {
      const server = await localHttp(t, (_request, response) =>
        json(response, reverseData()),
      );
      const result = await geo(client(config(), redirect(server.base))).reverse(
        fixtures().places[0].coordinates,
      );
      assert.equal(result.cityId, cityId);
      assert.equal(result.cityAdcode, "330100");
      assert.deepEqual(result.warnings, []);
    },
  ],
  G03: [
    "未登记区县不按前缀猜城市",
    async (t) => {
      const server = await localHttp(t, (_request, response) =>
        json(response, reverseData("330199")),
      );
      const result = await geo(client(config(), redirect(server.base))).reverse(
        fixtures().places[0].coordinates,
      );
      assert.equal(result.cityId, null);
      assert.equal(result.cityAdcode, null);
      assert.ok(result.warnings.some((w) => w.code === "CITY_UNCONFIRMED"));
    },
  ],
  G04: [
    "city为空数组但地址有效仍可完成解析",
    async (t) => {
      const server = await localHttp(t, (_request, response) =>
        json(response, reverseData()),
      );
      const result = await client(config(), redirect(server.base)).reverse(
        fixtures().places[0].coordinates,
      );
      assert.equal(result.placeName, "合同测试地址");
      assert.equal(result.adcode, "330106");
      assert.equal(result.cityCode, "0571");
    },
  ],
  G05: [
    "缺Key无名称及业务错误不能伪造地点",
    async (t) => {
      let payload = {
        status: "1",
        regeocode: { formatted_address: "", addressComponent: {} },
      };
      const server = await localHttp(t, (_request, response) =>
          json(response, payload),
        ),
        p = fixtures().places[0].coordinates;
      await assert.rejects(
        client(config({ amapKey: "" }), redirect(server.base)).reverse(p),
        expectHttp(503),
      );
      await assert.rejects(
        client(config(), redirect(server.base)).reverse(p),
        expectHttp(503),
      );
      payload = { status: "0", infocode: "10001" };
      await assert.rejects(
        client(config(), redirect(server.base)).reverse(p),
        expectHttp(503),
      );
    },
  ],
  G06: [
    "GPS转换发送源坐标并校验实际返回坐标",
    async (t) => {
      let locations = "120.148,30.245";
      const server = await localHttp(t, (_request, response) =>
          json(response, { status: "1", locations }),
        ),
        api = client(config(), redirect(server.base));
      assert.deepEqual(await api.convertGps(120.14, 30.24), {
        longitude: 120.148,
        latitude: 30.245,
        coordinateSystem: "GCJ-02",
      });
      assert.equal(server.requests[0].url.searchParams.get("coordsys"), "gps");
      assert.equal(
        server.requests[0].url.searchParams.get("locations"),
        "120.140000,30.240000",
      );
      for (locations of ["", "181,30", "bad,30", "120,30;121,31"])
        await assert.rejects(api.convertGps(120.14, 30.24), expectHttp(503));
    },
  ],
};
