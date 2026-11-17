const assert = require("node:assert/strict");
const { world, cleanTrip } = require("./support/world.cjs");
const { database } = require("../tdd/support/context.cjs");
const required = [
  "users",
  "destinations",
  "places",
  "recommendation_proposals",
  "trips",
  "trip_selections",
  "trip_days",
  "trip_items",
  "visited_places",
  "journals",
  "media_assets",
];
module.exports = {
  DB01: [
    "空测试schema可完整迁移出所有软件业务表",
    async (t) => {
      const db = await database(t, { users: false });
      const result = await db.admin.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1",
        [db.schema],
      );
      const tables = new Set(result.rows.map((r) => r.table_name));
      for (const table of required)
        assert.ok(
          tables.has(table),
          "Missing full-application migration: " + table,
        );
    },
  ],
  DB02: [
    "旧基础schema向前升级且重复迁移种子幂等",
    async (t) => {
      const db = await database(t, {
        migrate: false,
        seed: false,
        users: false,
      });
      await db.migrate({ count: 1 });
      const id = "10000000-0000-4000-8000-000000000099";
      await db.admin.query(
        "INSERT INTO users(id,email,display_name) VALUES($1,'upgrade@tdd.invalid','旧资料')",
        [id],
      );
      await db.migrate();
      await db.seed();
      await db.migrate();
      await db.seed();
      const user = await db.admin.query(
        "SELECT display_name FROM users WHERE id=$1",
        [id],
      );
      assert.equal(user.rows[0].display_name, "旧资料");
      const result = await db.admin.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1",
        [db.schema],
      );
      for (const table of required)
        assert.ok(
          result.rows.some((r) => r.table_name === table),
          "Missing upgraded table: " + table,
        );
    },
  ],
  DB03: [
    "重启真实应用后行程到访随笔和图片仍然可读",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip(),
        v = await w.visit(),
        media = await w.upload(),
        j = await w.journal(v, { mediaIds: [media.id] });
      const before = await w.request(
        "GET",
        "/media/" + media.id,
        undefined,
        w.a.token,
        200,
      );
      await w.restart();
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
      assert.equal((await w.footprints()).markers[0].id, v.id);
      assert.deepEqual((await w.call("GET", "/journals/" + j.id)).mediaIds, [
        media.id,
      ]);
      assert.deepEqual(
        (
          await w.request(
            "GET",
            "/media/" + media.id,
            undefined,
            w.a.token,
            200,
          )
        ).bytes,
        before.bytes,
      );
    },
  ],
  DB04: [
    "同时确认同一草稿只提交一次且日程无重复",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        p = await w.propose(trip);
      const results = await Promise.all(
        [1, 2].map(() =>
          w.request(
            "POST",
            `/trips/${trip.id}/apply-proposal`,
            { expectedRevision: trip.revision, proposalId: p.proposalId },
            w.a.token,
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const current = await w.getTrip(trip);
      assert.equal(current.revision, trip.revision + 1);
      assert.deepEqual(current.days, p.days);
      const count = await w.db.admin.query(
        "SELECT count(*)::int AS n FROM trip_items",
      );
      assert.equal(count.rows[0].n, trip.planningInput.selectedPlaceIds.length);
    },
  ],
  DB05: [
    "重启后真实账号可重新登录且健康就绪接口可用",
    async (t) => {
      const w = await world(t, { users: false });
      const identity = await w.register();
      await w.restart();
      const a = await w.login(identity);
      assert.equal(
        (await w.call("GET", "/users/me", undefined, 200, a)).id,
        identity.user.id,
      );
      assert.deepEqual(
        (await w.request("GET", "/health", undefined, undefined, 200)).body,
        { status: "ok", service: "travel-planner-api" },
      );
      assert.deepEqual(
        (await w.request("GET", "/ready", undefined, undefined, 200)).body,
        { status: "ready", database: "ok" },
      );
    },
  ],
};
