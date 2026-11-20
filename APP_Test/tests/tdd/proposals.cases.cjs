const assert = require("node:assert/strict");
const {
  sut,
  database,
  application,
  recommendation,
  expectHttp,
} = require("./support/context.cjs");
const {
  userA,
  userB,
  fixedNow,
  provinceId,
  id,
} = require("./support/fixtures.cjs");
const { randomUUID } = require("node:crypto");
module.exports = {
  S01: [
    "初始库向前升级且已应用迁移不重复执行",
    async (t) => {
      const db = await database(t, {
        migrate: false,
        seed: false,
        users: false,
      });
      await db.migrate({ count: 1 });
      assert.equal(
        (await db.admin.query("SELECT to_regclass('places') AS name")).rows[0]
          .name,
        null,
      );
      await db.migrate();
      const before = (
        await db.admin.query("SELECT name FROM pgmigrations ORDER BY id")
      ).rows;
      assert.equal(before.length, 3);
      await db.migrate();
      assert.deepEqual(
        (await db.admin.query("SELECT name FROM pgmigrations ORDER BY id"))
          .rows,
        before,
      );
    },
  ],
  S02: [
    "种子幂等不创建用户且保留人工景点",
    async (t) => {
      const db = await database(t, { users: false });
      await db.seed();
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM places")).rows[0].count,
        "3",
      );
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM destinations")).rows[0]
          .count,
        "2",
      );
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM users")).rows[0].count,
        "0",
      );
      await db.admin.query(
        "UPDATE places SET source='curated',name='人工维护名称' WHERE id=$1",
        [id(1)],
      );
      await db.seed();
      assert.equal(
        (await db.admin.query("SELECT name FROM places WHERE id=$1", [id(1)]))
          .rows[0].name,
        "人工维护名称",
      );
    },
  ],
  S03: [
    "重新生成独立方案ID且保存规范化输入快照",
    async () => {
      const f = recommendation(),
        input = { ...f.data.input, themes: ["nature", "history", "nature"] },
        before = structuredClone(input);
      const a = await f.service.generate(input, userA),
        b = await f.service.generate(input, userA);
      assert.notEqual(a.proposalId, b.proposalId);
      assert.deepEqual(a.inputSnapshot.themes, ["history", "nature"]);
      assert.deepEqual(
        a.inputSnapshot.selectedPlaceIds,
        input.selectedPlaceIds,
      );
      assert.deepEqual(input, before);
      assert.equal(f.proposals.rows.size, 2);
    },
  ],
  S04: [
    "固定生成时间30分钟有效期和毫秒到期边界",
    async () => {
      const f = recommendation(),
        result = await f.service.generate(f.data.input, userA);
      assert.equal(result.generatedAt, fixedNow);
      assert.equal(
        Date.parse(result.expiresAt) - Date.parse(result.generatedAt),
        1800000,
      );
      const expired = sut(
        "recommendations/recommendations.service.js",
      ).isProposalExpired;
      assert.equal(
        expired(result, new Date(Date.parse(result.expiresAt) - 1)),
        false,
      );
      assert.equal(expired(result, new Date(result.expiresAt)), true);
    },
  ],
  S05: [
    "所有者读取到完整原方案",
    async () => {
      const f = recommendation(),
        p = await f.service.generate(f.data.input, userA);
      assert.deepEqual(
        await f.service.getOwnedProposal(p.proposalId, userA),
        p,
      );
    },
  ],
  S06: [
    "未知与他人方案均404且不暴露内容",
    async () => {
      const f = recommendation(),
        p = await f.service.generate(f.data.input, userA);
      for (const [proposalId, owner] of [
        [p.proposalId, userB],
        [randomUUID(), userA],
      ])
        await assert.rejects(
          f.service.getOwnedProposal(proposalId, owner),
          expectHttp(404, "NOT_FOUND"),
        );
    },
  ],
  S07: [
    "修改生成响应或读取副本不影响保存方案",
    async () => {
      const f = recommendation(),
        p = await f.service.generate(f.data.input, userA),
        before = structuredClone(p);
      p.days.length = 0;
      p.inputSnapshot.themes.push("art");
      const copy = await f.service.getOwnedProposal(before.proposalId, userA);
      assert.deepEqual(copy, before);
      copy.days.length = 0;
      assert.deepEqual(
        await f.service.getOwnedProposal(before.proposalId, userA),
        before,
      );
    },
  ],
  S08: [
    "真实应用连接池重启后仍读同一保存方案",
    async (t) => {
      const db = await database(t),
        first = await application(t, { database: db });
      const saved = await first.request(
        "POST",
        "/recommendations/itinerary",
        first.data.input,
      );
      await first.close();
      const second = await application(t, { database: db });
      const reader = second.app.get(
        sut("recommendations/recommendations.service.js").PROPOSAL_READER,
      );
      assert.deepEqual(
        await reader.getOwnedProposal(saved.proposalId, userA),
        saved,
      );
      await assert.rejects(
        reader.getOwnedProposal(saved.proposalId, userB),
        expectHttp(404),
      );
    },
  ],
  S09: [
    "无效输入和缺失必要路线均不向真实库写方案",
    async (t) => {
      const db = await database(t),
        app = await application(t, { database: db });
      const before = (
        await db.admin.query("SELECT count(*) FROM recommendation_proposals")
      ).rows[0].count;
      await app.request(
        "POST",
        "/recommendations/itinerary",
        { ...app.data.input, selectedPlaceIds: [randomUUID()] },
        400,
      );
      await app.request(
        "POST",
        "/recommendations/itinerary",
        {
          ...app.data.input,
          endDate: app.data.input.startDate,
          transportMode: "driving",
        },
        503,
      );
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM recommendation_proposals"))
          .rows[0].count,
        before,
      );
    },
  ],
  S10: [
    "真实插入异常通用500且没有部分方案",
    async (t) => {
      const db = await database(t),
        app = await application(t, { database: db });
      await db.admin.query(
        "CREATE FUNCTION reject_proposal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private sql credential'; END $$",
      );
      await db.admin.query(
        "CREATE TRIGGER fail_save BEFORE INSERT ON recommendation_proposals FOR EACH ROW EXECUTE FUNCTION reject_proposal()",
      );
      const response = await app.request(
        "POST",
        "/recommendations/itinerary",
        app.data.input,
        500,
      );
      assert.equal(response.code, "INTERNAL_ERROR");
      assert.ok(!JSON.stringify(response).includes("private sql"));
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM recommendation_proposals"))
          .rows[0].count,
        "0",
      );
    },
  ],
  S11: [
    "种子失败整体回滚且外键和所有者级联生效",
    async (t) => {
      const db = await database(t);
      await db.admin.query(
        "UPDATE destinations SET name='事务前名称' WHERE id=$1",
        [provinceId],
      );
      await db.admin.query(
        "CREATE FUNCTION reject_place() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled seed failure'; END $$",
      );
      await db.admin.query(
        "CREATE TRIGGER fail_seed BEFORE INSERT OR UPDATE ON places FOR EACH ROW EXECUTE FUNCTION reject_place()",
      );
      await assert.rejects(db.seed());
      assert.equal(
        (
          await db.admin.query("SELECT name FROM destinations WHERE id=$1", [
            provinceId,
          ])
        ).rows[0].name,
        "事务前名称",
      );
      await db.admin.query("DROP TRIGGER fail_seed ON places");
      await assert.rejects(
        db.admin.query("UPDATE places SET city_id=$1 WHERE id=$2", [
          randomUUID(),
          id(1),
        ]),
      );
      const app = await application(t, { database: db });
      await app.request("POST", "/recommendations/itinerary", app.data.input);
      await db.admin.query("DELETE FROM users WHERE id=$1", [userA]);
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM recommendation_proposals"))
          .rows[0].count,
        "0",
      );
    },
  ],
  S12: [
    "生成推荐只保存Proposal不写正式Trip",
    async (t) => {
      const db = await database(t),
        app = await application(t, { database: db });
      const before = (await db.admin.query("SELECT * FROM trips ORDER BY id"))
        .rows;
      await app.request("POST", "/recommendations/itinerary", app.data.input);
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM recommendation_proposals"))
          .rows[0].count,
        "1",
      );
      assert.deepEqual(
        (await db.admin.query("SELECT * FROM trips ORDER BY id")).rows,
        before,
      );
    },
  ],
};
