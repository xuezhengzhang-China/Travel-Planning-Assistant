const assert = require("node:assert/strict");
const { world, sameSet } = require("./support/world.cjs");
module.exports = {
  F01: [
    "有正式计划但没有真实到访时地图不点亮",
    async (t) => {
      const w = await world(t);
      await w.plannedTrip();
      assert.deepEqual(await w.footprints(), { markers: [], litCities: [] });
    },
  ],
  F02: [
    "同城两次到访逐条删除使计数2到1到0",
    async (t) => {
      const w = await world(t),
        a = await w.visit(),
        b = await w.visit({ visitedOn: "2025-11-02" });
      let fp = await w.footprints();
      assert.equal(fp.litCities[0].visitCount, 2);
      await w.call("DELETE", "/visited-places/" + a.id, undefined, 204);
      fp = await w.footprints();
      assert.equal(fp.litCities[0].visitCount, 1);
      assert.equal(fp.markers[0].id, b.id);
      await w.call("DELETE", "/visited-places/" + b.id, undefined, 204);
      fp = await w.footprints();
      assert.deepEqual(fp.markers, []);
      assert.deepEqual(fp.litCities, []);
    },
  ],
  F03: [
    "年份过滤的标记与城市计数使用同一集合",
    async (t) => {
      const w = await world(t),
        old = await w.visit({ visitedOn: "2024-01-01" }),
        recent = await w.visit();
      for (const [year, id] of [
        [2024, old.id],
        [2025, recent.id],
      ]) {
        const fp = await w.footprints("?year=" + year);
        assert.deepEqual(
          fp.markers.map((m) => m.id),
          [id],
        );
        assert.equal(fp.litCities[0].visitCount, 1);
      }
    },
  ],
  F04: [
    "城市与年份组合筛选及空结果结构正确",
    async (t) => {
      const w = await world(t);
      await w.visit();
      assert.equal(
        (await w.footprints(`?cityId=${w.fixtures.input.cityId}&year=2025`))
          .markers.length,
        1,
      );
      assert.deepEqual(
        await w.footprints(`?cityId=${w.fixtures.input.cityId}&year=2024`),
        { markers: [], litCities: [] },
      );
    },
  ],
  F05: [
    "未知城市只形成地点标记而不形成点亮城市",
    async (t) => {
      const w = await world(t);
      await w.call(
        "POST",
        "/visited-places",
        {
          placeName: "未知城市",
          coordinates: {
            longitude: 0,
            latitude: 0,
            coordinateSystem: "GCJ-02",
          },
          visitedOn: "2025-11-01",
        },
        201,
      );
      const fp = await w.footprints();
      assert.equal(fp.markers.length, 1);
      assert.deepEqual(fp.litCities, []);
    },
  ],
  F06: [
    "地图聚合返回全部标记而非默认20条分页",
    async (t) => {
      const w = await world(t),
        ids = [];
      for (let i = 0; i < 21; i++) ids.push((await w.visit()).id);
      const fp = await w.footprints();
      sameSet(
        fp.markers.map((m) => m.id),
        ids,
      );
      assert.equal(fp.litCities[0].visitCount, 21);
    },
  ],
  F07: [
    "非法年份城市UUID与未知参数被拒绝",
    async (t) => {
      const w = await world(t);
      for (const query of [
        "?year=not-a-year",
        "?year=2025.5",
        "?cityId=bad-id",
        "?ownerId=other",
      ])
        assert.equal(
          (await w.request("GET", "/footprints" + query, undefined, w.a.token))
            .status,
          400,
        );
    },
  ],
  F08: [
    "足迹聚合始终只包含当前用户到访",
    async (t) => {
      const w = await world(t),
        a = await w.visit(),
        b = await w.visit({}, w.b);
      assert.deepEqual(
        (await w.footprints()).markers.map((m) => m.id),
        [a.id],
      );
      assert.deepEqual(
        (await w.footprints("", w.b)).markers.map((m) => m.id),
        [b.id],
      );
    },
  ],
};
