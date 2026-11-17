const assert = require("node:assert/strict");
const { world, error, sameSet } = require("./support/world.cjs");
module.exports = {
  D01: [
    "目录景点到访由服务端确认城市与GCJ02坐标",
    async (t) => {
      const w = await world(t),
        visit = await w.visit();
      assert.equal(visit.placeId, w.fixtures.places[0].id);
      assert.equal(visit.cityId, w.fixtures.input.cityId);
      assert.equal(visit.cityAdcode, "330100");
      assert.equal(visit.coordinates.coordinateSystem, "GCJ-02");
      assert.equal(visit.visitedOn, "2025-11-01");
    },
  ],
  D02: [
    "自定义地点无法确认城市时保留标记不伪造城市",
    async (t) => {
      const w = await world(t),
        point = { longitude: 0, latitude: 0, coordinateSystem: "GCJ-02" };
      const visit = await w.call(
        "POST",
        "/visited-places",
        {
          placeName: "未确认地点",
          coordinates: point,
          visitedOn: "2025-10-01",
        },
        201,
      );
      assert.equal(visit.placeId, null);
      assert.equal(visit.cityId, null);
      assert.equal(visit.cityAdcode, null);
      assert.deepEqual(visit.coordinates, point);
      assert.ok((await w.footprints()).markers.some((m) => m.id === visit.id));
    },
  ],
  D03: [
    "拒绝未来到访日期及不存在日期且没有新增标记",
    async (t) => {
      const w = await world(t);
      for (const visitedOn of ["2100-12-31", "2025-02-30", "2025/11/01"])
        assert.equal(
          (
            await w.request(
              "POST",
              "/visited-places",
              { placeId: w.fixtures.places[0].id, visitedOn },
              w.a.token,
            )
          ).status,
          400,
        );
      assert.deepEqual((await w.footprints()).markers, []);
    },
  ],
  D04: [
    "同一地点不同日期支持多次到访而不自动去重",
    async (t) => {
      const w = await world(t),
        first = await w.visit(),
        second = await w.visit({ visitedOn: "2025-11-02" });
      assert.notEqual(first.id, second.id);
      sameSet(
        (await w.footprints()).markers.map((m) => m.id),
        [first.id, second.id],
      );
    },
  ],
  D05: [
    "修改到访日期和名称后重新聚合得到新值",
    async (t) => {
      const w = await world(t),
        visit = await w.visit();
      const updated = await w.call("PATCH", "/visited-places/" + visit.id, {
        placeName: "重命名地点",
        visitedOn: "2024-10-01",
      });
      assert.equal(updated.placeName, "重命名地点");
      assert.equal(updated.visitedOn, "2024-10-01");
      assert.equal((await w.footprints("?year=2024")).markers[0].id, visit.id);
      assert.deepEqual((await w.footprints("?year=2025")).markers, []);
    },
  ],
  D06: [
    "到访更新拒绝更换地点城市坐标及自报身份",
    async (t) => {
      const w = await world(t),
        visit = await w.visit();
      for (const body of [
        { placeId: w.fixtures.places[1].id },
        { cityId: w.fixtures.input.cityId },
        { coordinates: visit.coordinates },
        { ownerId: w.b.user.id },
      ])
        error(
          await w.request(
            "PATCH",
            `/visited-places/${visit.id}`,
            body,
            w.a.token,
          ),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
  D07: [
    "删除到访同时删除相关随笔并移除标记",
    async (t) => {
      const w = await world(t),
        visit = await w.visit(),
        journal = await w.journal(visit);
      await w.call("DELETE", `/visited-places/${visit.id}`, undefined, 204);
      error(
        await w.request("GET", `/journals/${journal.id}`, undefined, w.a.token),
        404,
        "NOT_FOUND",
      );
      assert.deepEqual((await w.footprints()).markers, []);
      assert.deepEqual((await w.footprints()).litCities, []);
    },
  ],
  D08: [
    "他人到访不能更新删除或关联随笔",
    async (t) => {
      const w = await world(t),
        visit = await w.visit();
      for (const [method, route, body] of [
        ["PATCH", `/visited-places/${visit.id}`, { placeName: "越权" }],
        ["DELETE", `/visited-places/${visit.id}`, undefined],
        [
          "POST",
          "/journals",
          {
            visitedPlaceId: visit.id,
            title: "越权",
            body: "text",
            mediaIds: [],
          },
        ],
      ])
        error(
          await w.request(method, route, body, w.b.token),
          404,
          "NOT_FOUND",
        );
      assert.equal((await w.footprints()).markers.length, 1);
    },
  ],
  D09: [
    "手动地点拒绝非法坐标及未转换WGS84",
    async (t) => {
      const w = await world(t);
      for (const coordinates of [
        { longitude: 181, latitude: 30, coordinateSystem: "GCJ-02" },
        { longitude: 120, latitude: 91, coordinateSystem: "GCJ-02" },
        { longitude: 120, latitude: 30, coordinateSystem: "WGS84" },
      ])
        error(
          await w.request(
            "POST",
            "/visited-places",
            { placeName: "地点", coordinates, visitedOn: "2025-11-01" },
            w.a.token,
          ),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
  D10: [
    "客户端不能指定城市adcode或其他用户所有者",
    async (t) => {
      const w = await world(t);
      for (const extra of [
        { cityAdcode: "330100" },
        { ownerId: w.b.user.id },
        { userId: w.b.user.id },
      ])
        error(
          await w.request(
            "POST",
            "/visited-places",
            {
              placeId: w.fixtures.places[0].id,
              visitedOn: "2025-11-01",
              ...extra,
            },
            w.a.token,
          ),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
};
