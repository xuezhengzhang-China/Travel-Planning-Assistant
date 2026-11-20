const assert = require("node:assert/strict");
const { world, page, error, sameSet } = require("./support/world.cjs");
module.exports = {
  J01: [
    "创建随笔后详情与列表可以完整读回",
    async (t) => {
      const w = await world(t),
        visit = await w.visit(),
        j = await w.journal(visit);
      assert.equal(j.visitedPlaceId, visit.id);
      assert.equal((await w.call("GET", "/journals/" + j.id)).body, j.body);
      assert.deepEqual(
        page(await w.call("GET", "/journals")).map((x) => x.id),
        [j.id],
      );
    },
  ],
  J02: [
    "同一次到访支持多篇独立随笔",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        a = await w.journal(v),
        b = await w.journal(v, { title: "第二篇" });
      assert.notEqual(a.id, b.id);
      sameSet(
        page(await w.call("GET", "/journals?visitedPlaceId=" + v.id)).map(
          (j) => j.id,
        ),
        [a.id, b.id],
      );
    },
  ],
  J03: [
    "修改标题正文后重新读取一致",
    async (t) => {
      const w = await world(t),
        j = await w.journal(await w.visit());
      const changed = await w.call("PATCH", "/journals/" + j.id, {
        title: "修改标题",
        body: "修改正文",
      });
      assert.equal(changed.title, "修改标题");
      assert.equal((await w.call("GET", "/journals/" + j.id)).body, "修改正文");
    },
  ],
  J04: [
    "删除随笔保留到访与点亮且其他随笔仍存在",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        a = await w.journal(v),
        b = await w.journal(v);
      await w.call("DELETE", "/journals/" + a.id, undefined, 204);
      error(
        await w.request("GET", "/journals/" + a.id, undefined, w.a.token),
        404,
        "NOT_FOUND",
      );
      assert.equal((await w.call("GET", "/journals/" + b.id)).id, b.id);
      const fp = await w.footprints();
      assert.equal(fp.markers[0].id, v.id);
      assert.equal(fp.litCities[0].visitCount, 1);
    },
  ],
  J05: [
    "随笔按到访城市年份及分页正确过滤",
    async (t) => {
      const w = await world(t),
        old = await w.journal(await w.visit({ visitedOn: "2024-01-01" }));
      await w.journal(await w.visit());
      const list = await w.call(
        "GET",
        `/journals?cityId=${w.fixtures.input.cityId}&year=2024&page=1&pageSize=1`,
      );
      assert.equal(list.total, 1);
      assert.equal(page(list)[0].id, old.id);
      const empty = await w.call(
        "GET",
        "/journals?year=2024&page=2&pageSize=1",
      );
      assert.deepEqual(page(empty), []);
      assert.equal(empty.total, 1);
    },
  ],
  J06: [
    "纯文本正文中的HTML和脚本原样保存",
    async (t) => {
      const w = await world(t),
        body = "<script>window.__tpaXss=1</script><img src=x onerror=alert(1)>";
      const j = await w.journal(await w.visit(), { body });
      assert.equal((await w.call("GET", "/journals/" + j.id)).body, body);
      // Rendering safety is verified separately in the browser suite.
    },
  ],
  J07: [
    "他人随笔的读取更新和删除均返回404",
    async (t) => {
      const w = await world(t),
        j = await w.journal(await w.visit());
      for (const [method, body] of [
        ["GET", undefined],
        ["PATCH", { body: "越权" }],
        ["DELETE", undefined],
      ])
        error(
          await w.request(method, "/journals/" + j.id, body, w.b.token),
          404,
          "NOT_FOUND",
        );
      assert.deepEqual(
        page(await w.call("GET", "/journals", undefined, 200, w.b)),
        [],
      );
    },
  ],
  J08: [
    "不存在或他人的到访不能用来创建随笔",
    async (t) => {
      const w = await world(t),
        v = await w.visit({}, w.b);
      for (const id of [v.id, "40000000-0000-4000-8000-999999999999"])
        error(
          await w.request(
            "POST",
            "/journals",
            { visitedPlaceId: id, title: "测试", body: "正文", mediaIds: [] },
            w.a.token,
          ),
          404,
          "NOT_FOUND",
        );
      assert.deepEqual(page(await w.call("GET", "/journals")), []);
    },
  ],
  J09: [
    "随笔不能更换到访所有者或写入未知字段",
    async (t) => {
      const w = await world(t),
        j = await w.journal(await w.visit());
      for (const body of [
        { visitedPlaceId: (await w.visit()).id },
        { ownerId: w.b.user.id },
        { unknown: "field" },
      ])
        error(
          await w.request("PATCH", "/journals/" + j.id, body, w.a.token),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
  J10: [
    "随笔创建数据库故障不留下部分记录或图片关联",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        media = await w.upload();
      await w.failInsert("journals");
      error(
        await w.request(
          "POST",
          "/journals",
          {
            visitedPlaceId: v.id,
            title: "失败",
            body: "正文",
            mediaIds: [media.id],
          },
          w.a.token,
        ),
        500,
        "INTERNAL_ERROR",
      );
      assert.deepEqual(page(await w.call("GET", "/journals")), []);
      // A failed association must leave this media deletable.
      await w.call("DELETE", "/media/" + media.id, undefined, 204);
    },
  ],
};
