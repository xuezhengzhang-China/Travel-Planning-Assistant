const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { sut, database, expectHttp } = require("./support/context.cjs");
const { cityId, provinceId, id } = require("./support/fixtures.cjs");
async function directory(t) {
  const db = await database(t);
  const repository = new (sut("places/places.repository.js").PlacesRepository)(
    db.admin,
  );
  return {
    ...db,
    service: new (sut("places/places.service.js").PlacesService)(repository),
  };
}
module.exports = {
  C01: [
    "真实目录按省市层级筛选",
    async (t) => {
      const f = await directory(t);
      const provinces = await f.service.destinations({ level: "province" }),
        cities = await f.service.destinations({ level: "city" });
      assert.deepEqual(
        provinces.items.map((d) => d.id),
        [provinceId],
      );
      assert.deepEqual(
        cities.items.map((d) => d.id),
        [cityId],
      );
    },
  ],
  C02: [
    "城市按父省筛选且不匹配父级返回空",
    async (t) => {
      const f = await directory(t);
      assert.equal(
        (await f.service.destinations({ level: "city", parentId: provinceId }))
          .total,
        1,
      );
      assert.equal(
        (
          await f.service.destinations({
            level: "city",
            parentId: randomUUID(),
          })
        ).total,
        0,
      );
    },
  ],
  C03: [
    "目的地关键词和空结果分页结构",
    async (t) => {
      const f = await directory(t);
      const city = await f.service.destinations({ keyword: "杭州" });
      assert.equal(city.total, 1);
      assert.equal(city.items[0].id, cityId);
      assert.deepEqual(
        await f.service.destinations({ keyword: "不存在的测试地" }),
        { items: [], total: 0, page: 1, pageSize: 20 },
      );
    },
  ],
  C04: [
    "未知城市和省份不能用作景点查询城市",
    async (t) => {
      const f = await directory(t);
      for (const value of [randomUUID(), provinceId])
        await assert.rejects(
          f.service.places({ cityId: value }),
          expectHttp(400),
        );
    },
  ],
  C05: [
    "景点查询只返回选定城市",
    async (t) => {
      const f = await directory(t),
        other = randomUUID();
      await f.admin.query(
        "INSERT INTO destinations(id,name,level,parent_id,adcode) VALUES($1,'另一测试城市','city',$2,'999900')",
        [other, provinceId],
      );
      await f.admin.query("UPDATE places SET city_id=$1 WHERE id=$2", [
        other,
        id(3),
      ]);
      const page = await f.service.places({ cityId });
      assert.equal(page.total, 2);
      assert.ok(page.items.every((p) => p.cityId === cityId));
      assert.ok(!page.items.some((p) => p.id === id(3)));
    },
  ],
  C06: [
    "景点中文关键词与类别组合过滤",
    async (t) => {
      const f = await directory(t);
      const page = await f.service.places({
        cityId,
        keyword: "良渚",
        category: "history",
      });
      assert.equal(page.total, 1);
      assert.equal(page.items[0].id, id(3));
      assert.equal(
        (await f.service.places({ cityId, keyword: "西湖", category: "art" }))
          .total,
        0,
      );
    },
  ],
  C07: [
    "主题匹配排序同分ID稳定且不排除未命中景点",
    async (t) => {
      const f = await directory(t);
      assert.deepEqual(
        (await f.service.places({ cityId, themes: "nature" })).items.map(
          (p) => p.id,
        ),
        [id(1), id(2), id(3)],
      );
      const art = await f.service.places({ cityId, themes: "art" });
      assert.equal(art.total, 3);
      assert.deepEqual(
        art.items.map((p) => p.id),
        [id(3), id(1), id(2)],
      );
    },
  ],
  C08: [
    "类别过滤与主题排序先于分页",
    async (t) => {
      const f = await directory(t);
      const first = await f.service.places({
          cityId,
          category: "history",
          themes: "art",
          pageSize: "1",
        }),
        second = await f.service.places({
          cityId,
          category: "history",
          themes: "art",
          pageSize: "1",
          page: "2",
        });
      assert.equal(first.total, 2);
      assert.deepEqual(
        first.items.map((p) => p.id),
        [id(3)],
      );
      assert.deepEqual(
        second.items.map((p) => p.id),
        [id(2)],
      );
    },
  ],
  C09: [
    "空页仍保留筛选后的真实总数",
    async (t) => {
      const f = await directory(t);
      const page = await f.service.places({
        cityId,
        category: "history",
        page: "999",
      });
      assert.deepEqual(page.items, []);
      assert.equal(page.total, 2);
      assert.equal(page.page, 999);
    },
  ],
  C10: [
    "详情字段完整有效未知UUID返回404",
    async (t) => {
      const f = await directory(t);
      const place = await f.service.getPlace(id(1));
      for (const key of [
        "id",
        "cityId",
        "name",
        "categories",
        "address",
        "coordinates",
        "suggestedDurationMinutes",
        "description",
        "openingHoursText",
        "source",
        "updatedAt",
      ])
        assert.ok(Object.hasOwn(place, key), key);
      assert.equal(place.cityId, cityId);
      assert.equal(place.coordinates.coordinateSystem, "GCJ-02");
      await assert.rejects(
        f.service.getPlace(randomUUID()),
        expectHttp(404, "NOT_FOUND"),
      );
    },
  ],
  C11: [
    "SQL注入字符串按字面量处理且目录未变",
    async (t) => {
      const f = await directory(t);
      const result = await f.service.places({
        cityId,
        keyword: "%' OR 1=1; DROP TABLE places; --",
      });
      assert.equal(result.total, 0);
      assert.deepEqual(result.items, []);
      assert.equal(
        (await f.admin.query("SELECT count(*) FROM places")).rows[0].count,
        "3",
      );
    },
  ],
  C12: [
    "批量查询保留选择顺序并拒绝未知跨城景点",
    async (t) => {
      const f = await directory(t);
      assert.deepEqual(
        (await f.service.getSelectedPlaces(cityId, [id(3), id(1)])).map(
          (p) => p.id,
        ),
        [id(3), id(1)],
      );
      await assert.rejects(
        f.service.getSelectedPlaces(cityId, [randomUUID()]),
        expectHttp(400),
      );
      await f.admin.query("UPDATE places SET city_id=$1 WHERE id=$2", [
        provinceId,
        id(3),
      ]);
      await assert.rejects(
        f.service.getSelectedPlaces(cityId, [id(1), id(3)]),
        expectHttp(400),
      );
    },
  ],
};
