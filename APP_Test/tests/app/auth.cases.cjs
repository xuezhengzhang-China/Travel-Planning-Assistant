const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { world, actor, error, uuid } = require("./support/world.cjs");
module.exports = {
  A13: [
    "真实签发令牌到期后必须重新登录",
    async (t) => {
      const w = await world(t, { users: false, tokenTtlSeconds: 1 });
      const start = Date.now(),
        a = await w.newUser("expiry");
      await w.request("GET", "/users/me", undefined, a.token, 200);
      await delay(Math.max(0, start + 2100 - Date.now()));
      error(
        await w.request("GET", "/users/me", undefined, a.token),
        401,
        "UNAUTHENTICATED",
      );
      assert.ok((await w.login(a)).token);
    },
  ],
  A01: [
    "注册返回用户且不泄露密码或哈希",
    async (t) => {
      const w = await world(t, { users: false }),
        a = actor();
      const registered = await w.register(a);
      assert.equal(registered.user.email, a.email);
      assert.equal(registered.user.displayName, a.displayName);
      assert.equal(registered.user.password, undefined);
      assert.equal(registered.user.passwordHash, undefined);
      assert.ok(!JSON.stringify(registered.user).includes(a.password));
    },
  ],
  A02: [
    "同邮箱重复注册拒绝且不创建第二个用户",
    async (t) => {
      const w = await world(t, { users: false }),
        a = actor();
      await w.register(a);
      error(await w.request("POST", "/auth/register", a), 409, "EMAIL_IN_USE");
      const rows = await w.db.admin.query(
        "SELECT count(*)::int AS n FROM users WHERE email=$1",
        [a.email],
      );
      assert.equal(rows.rows[0].n, 1);
    },
  ],
  A03: [
    "注册拒绝无效邮箱缺字段和未知所有者字段",
    async (t) => {
      const w = await world(t, { users: false });
      for (const body of [
        { ...actor(), email: "not-an-email" },
        { email: actor().email },
        { ...actor(), ownerId: "injected" },
      ])
        error(
          await w.request("POST", "/auth/register", body),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
  A04: [
    "真实注册后登录获得令牌并读取本人资料",
    async (t) => {
      const w = await world(t, { users: false }),
        a = await w.newUser("login");
      const me = await w.call("GET", "/users/me", undefined, 200, a);
      uuid(me.id);
      assert.equal(me.id, a.user.id);
      assert.equal(me.email, a.email);
    },
  ],
  A05: [
    "错误密码与不存在账号均不签发令牌",
    async (t) => {
      const w = await world(t, { users: false }),
        a = await w.register();
      for (const body of [
        { email: a.email, password: a.password + "wrong" },
        { email: actor().email, password: a.password },
      ]) {
        const r = await w.request("POST", "/auth/login", body);
        error(r, 401, "UNAUTHENTICATED");
        assert.equal(r.body.accessToken, undefined);
      }
    },
  ],
  A06: [
    "当前用户接口拒绝匿名随机及篡改令牌",
    async (t) => {
      const w = await world(t),
        altered = w.a.token.slice(0, -8) + "tampered";
      for (const token of [undefined, "fake-token", altered])
        error(
          await w.request("GET", "/users/me", undefined, token),
          401,
          "UNAUTHENTICATED",
        );
    },
  ],
  A07: [
    "两用户令牌和私人行程互相隔离",
    async (t) => {
      const w = await world(t);
      assert.notEqual(w.a.token, w.b.token);
      assert.notEqual(w.a.user.id, w.b.user.id);
      const trip = await w.createTrip();
      error(
        await w.request("GET", "/trips/" + trip.id, undefined, w.b.token),
        404,
        "NOT_FOUND",
      );
    },
  ],
  A08: [
    "修改本人昵称持久化且不影响另一用户",
    async (t) => {
      const w = await world(t),
        changed = await w.call("PATCH", "/users/me", {
          displayName: "新的昵称",
        });
      assert.equal(changed.displayName, "新的昵称");
      assert.equal((await w.call("GET", "/users/me")).displayName, "新的昵称");
      assert.equal(
        (await w.call("GET", "/users/me", undefined, 200, w.b)).displayName,
        w.b.displayName,
      );
    },
  ],
  A09: [
    "资料更新拒绝自报ID邮箱及未知字段",
    async (t) => {
      const w = await world(t);
      for (const patch of [
        { id: w.b.user.id },
        { ownerId: w.b.user.id },
        { email: w.b.email },
      ])
        error(
          await w.request("PATCH", "/users/me", patch, w.a.token),
          400,
          "VALIDATION_ERROR",
        );
      assert.equal((await w.call("GET", "/users/me")).id, w.a.user.id);
    },
  ],
  A10: [
    "数据库用户记录不包含明文注册密码",
    async (t) => {
      const w = await world(t, { users: false }),
        a = await w.register();
      const rows = await w.db.admin.query(
        "SELECT to_jsonb(u) AS user_record FROM users u WHERE id=$1",
        [a.user.id],
      );
      assert.equal(rows.rowCount, 1);
      assert.ok(
        !JSON.stringify(rows.rows[0]).includes(a.password),
        "Password must be hashed before persistence",
      );
      await w.login(a); // The hash must also support a real successful login.
    },
  ],
  A11: [
    "并发同邮箱注册恰好一次成功另一次冲突",
    async (t) => {
      const w = await world(t, { users: false }),
        a = actor();
      const results = await Promise.all([
        w.request("POST", "/auth/register", a),
        w.request("POST", "/auth/register", a),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const counts = await w.db.admin.query(
        "SELECT count(*)::int AS n FROM users WHERE email=$1",
        [a.email],
      );
      assert.equal(counts.rows[0].n, 1);
    },
  ],
  A12: [
    "登录请求拒绝缺字段及未知身份字段",
    async (t) => {
      const w = await world(t, { users: false });
      for (const body of [
        { email: actor().email },
        { password: "example" },
        { ...actor(), userId: "injected" },
      ])
        error(
          await w.request("POST", "/auth/login", body),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
};
