const assert = require("node:assert/strict");
const { world, error, page } = require("./support/world.cjs");
module.exports = {
  SEC01: [
    "所有业务领域匿名与伪造令牌都返回401",
    async (t) => {
      const w = await world(t, { users: false });
      for (const route of [
        "/users/me",
        "/destinations",
        "/places?cityId=" + w.fixtures.input.cityId,
        "/trips",
        "/footprints",
        "/journals",
      ])
        for (const token of [undefined, "fake-token"])
          error(
            await w.request("GET", route, undefined, token),
            401,
            "UNAUTHENTICATED",
          );
    },
  ],
  SEC02: [
    "客户端自报身份请求头不能充当登录",
    async (t) => {
      const w = await world(t);
      const response = await fetch(w.url + "/api/trips", {
        headers: { "x-user-id": w.a.user.id, "x-owner-id": w.a.user.id },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 401);
    },
  ],
  SEC03: [
    "行程搜索和标题中的SQL语句只作为数据保存",
    async (t) => {
      const w = await world(t),
        title = "测试'); DROP TABLE users; --";
      const trip = await w.call(
        "POST",
        "/trips",
        { title, cityId: w.fixtures.input.cityId },
        201,
      );
      assert.equal((await w.getTrip(trip)).title, title);
      assert.equal((await w.call("GET", "/users/me")).id, w.a.user.id);
      const list = await w.call(
        "GET",
        "/places?cityId=" +
          w.fixtures.input.cityId +
          "&keyword=" +
          encodeURIComponent("' OR 1=1 --"),
      );
      assert.deepEqual(page(list), []);
      assert.equal(list.total, 0);
    },
  ],
  SEC04: [
    "未知私人UUID与他人资源返回同样404错误类别",
    async (t) => {
      const w = await world(t),
        trip = await w.createTrip(w.b);
      const responses = await Promise.all(
        [trip.id, "40000000-0000-4000-8000-999999999999"].map((id) =>
          w.request("GET", "/trips/" + id, undefined, w.a.token),
        ),
      );
      for (const r of responses) error(r, 404, "NOT_FOUND");
      assert.equal(responses[0].body.message, responses[1].body.message);
    },
  ],
  SEC05: [
    "数据库异常对外只返回通用错误而不泄露SQL堆栈",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        p = await w.propose(trip);
      await w.failInsert("trip_items");
      const r = await w.request(
        "POST",
        `/trips/${trip.id}/apply-proposal`,
        { expectedRevision: trip.revision, proposalId: p.proposalId },
        w.a.token,
      );
      error(r, 500, "INTERNAL_ERROR");
      assert.ok(
        !/injected-app-test-failure|CREATE TRIGGER|SELECT |INSERT INTO|postgres(?:ql)?:\/\/|at \w+.*\(/i.test(
          JSON.stringify(r.body),
        ),
      );
      assert.equal(r.body.stack, undefined);
    },
  ],
  SEC06: [
    "图片私有读取接口拒绝URL查询令牌认证",
    async (t) => {
      const w = await world(t),
        media = await w.upload();
      error(
        await w.request(
          "GET",
          "/media/" +
            media.id +
            "?access_token=" +
            encodeURIComponent(w.a.token),
        ),
        401,
        "UNAUTHENTICATED",
      );
    },
  ],
  SEC07: [
    "畸形UUID与分页非法类型返回400且不改变私人数据",
    async (t) => {
      const w = await world(t);
      for (const route of [
        "/trips/not-uuid",
        "/journals/not-uuid",
        "/trips?page=0",
        "/journals?pageSize=101",
        "/trips?page=1&page=2",
      ])
        assert.equal(
          (await w.request("GET", route, undefined, w.a.token)).status,
          400,
        );
      assert.equal((await w.call("GET", "/trips")).total, 0);
    },
  ],
  SEC08: [
    "来源不在白名单时不返回允许跨域来源",
    async (t) => {
      const w = await world(t, { users: false });
      for (const origin of [
        "http://127.0.0.1:4179",
        "https://untrusted.invalid",
      ]) {
        const r = await fetch(w.url + "/api/health", {
          headers: { Origin: origin },
          signal: AbortSignal.timeout(5000),
        });
        const allowed = r.headers.get("access-control-allow-origin");
        if (origin === "http://127.0.0.1:4179") assert.equal(allowed, origin);
        else assert.notEqual(allowed, origin);
      }
    },
  ],
};
