const assert = require("node:assert/strict");
const {
  world,
  page,
  uuid,
  error,
  cleanTrip,
  sameSet,
} = require("./support/world.cjs");
module.exports = {
  T01: [
    "新建草稿默认字段完整且revision为1",
    async (t) => {
      const w = await world(t),
        trip = await w.createTrip();
      uuid(trip.id);
      assert.equal(trip.ownerId, w.a.user.id);
      assert.equal(trip.revision, 1);
      assert.equal(trip.status, "draft");
      assert.deepEqual(trip.days, []);
      assert.deepEqual(trip.planningInput, {
        cityId: w.fixtures.input.cityId,
        startDate: null,
        endDate: null,
        themes: [],
        pace: "standard",
        transportMode: "walking",
        selectedPlaceIds: [],
      });
    },
  ],
  T02: [
    "本人行程列表分页不包含另一用户行程",
    async (t) => {
      const w = await world(t),
        first = await w.createTrip();
      await w.createTrip(w.b);
      const list = await w.call("GET", "/trips?page=1&pageSize=1");
      assert.equal(list.total, 1);
      assert.equal(page(list)[0].id, first.id);
      assert.equal(
        page(await w.call("GET", "/trips", undefined, 200, w.b)).length,
        1,
      );
    },
  ],
  T03: [
    "草稿条件选择与顺序保存后重新读取一致",
    async (t) => {
      const w = await world(t);
      let trip = await w.preparedTrip();
      trip = await w.call("PUT", `/trips/${trip.id}/selections`, {
        expectedRevision: trip.revision,
        placeIds: w.fixtures.input.selectedPlaceIds,
      });
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
      assert.deepEqual(
        trip.planningInput.selectedPlaceIds,
        w.fixtures.input.selectedPlaceIds,
      );
      assert.equal(trip.revision, 4);
    },
  ],
  T04: [
    "日期必须成对提交且拒绝倒置不存在及超30天",
    async (t) => {
      const w = await world(t),
        trip = await w.createTrip();
      for (const dates of [
        { startDate: "2026-11-01" },
        { startDate: "2026-11-02", endDate: "2026-11-01" },
        { startDate: "2026-02-30", endDate: "2026-03-01" },
        { startDate: "2026-01-01", endDate: "2026-01-31" },
      ]) {
        const r = await w.request(
          "PATCH",
          `/trips/${trip.id}`,
          { expectedRevision: trip.revision, planningInput: dates },
          w.a.token,
        );
        assert.equal(r.status, 400);
      }
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T05: [
    "草稿允许同日及成对空日期并规范化主题",
    async (t) => {
      const w = await world(t);
      let trip = await w.createTrip();
      trip = await w.patchTrip(trip, {
        planningInput: {
          startDate: "2026-11-01",
          endDate: "2026-11-01",
          themes: ["nature", "history", "nature"],
        },
      });
      assert.deepEqual(trip.planningInput.themes, ["history", "nature"]);
      trip = await w.patchTrip(trip, {
        planningInput: { startDate: null, endDate: null },
      });
      assert.equal(trip.planningInput.startDate, null);
      assert.equal(trip.planningInput.endDate, null);
    },
  ],
  T06: [
    "选择拒绝重复未知及跨城景点且保持草稿",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip();
      const foreign = "30000000-0000-4000-8000-000000009999";
      const otherCity = "20000000-0000-4000-8000-000000009999";
      await w.db.admin.query(
        "INSERT INTO destinations(id,name,level,parent_id,adcode,time_zone) VALUES($1,'异地测试','city',$2,'999999','Asia/Shanghai')",
        [otherCity, w.fixtures.destinations[0].id],
      );
      await w.db.admin.query(
        "INSERT INTO places(id,city_id,name,categories,address,longitude,latitude,suggested_duration_minutes,description,source) SELECT $1::uuid,$2::uuid,name,categories,address,longitude,latitude,suggested_duration_minutes,description,source FROM places LIMIT 1",
        [foreign, otherCity],
      );
      for (const placeIds of [
        [
          trip.planningInput.selectedPlaceIds[0],
          trip.planningInput.selectedPlaceIds[0],
        ],
        ["30000000-0000-4000-8000-999999999998"],
        [foreign],
      ]) {
        error(
          await w.request(
            "PUT",
            `/trips/${trip.id}/selections`,
            { expectedRevision: trip.revision, placeIds },
            w.a.token,
          ),
          400,
          "VALIDATION_ERROR",
        );
      }
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T07: [
    "PATCH不能绕过选择接口修改selectedPlaceIds或所有者",
    async (t) => {
      const w = await world(t),
        trip = await w.createTrip();
      for (const patch of [
        { planningInput: { selectedPlaceIds: [] } },
        { ownerId: w.b.user.id },
        { status: "planned" },
        { days: [] },
      ])
        error(
          await w.request(
            "PATCH",
            `/trips/${trip.id}`,
            { expectedRevision: 1, ...patch },
            w.a.token,
          ),
          400,
          "VALIDATION_ERROR",
        );
    },
  ],
  T08: [
    "版本冲突不覆盖最新行程",
    async (t) => {
      const w = await world(t),
        original = await w.createTrip(),
        changed = await w.patchTrip(original, { title: "新版本" });
      error(
        await w.request(
          "PATCH",
          `/trips/${original.id}`,
          { expectedRevision: original.revision, title: "过期覆盖" },
          w.a.token,
        ),
        409,
        "REVISION_CONFLICT",
      );
      assert.deepEqual(
        cleanTrip(await w.getTrip(original)),
        cleanTrip(changed),
      );
    },
  ],
  T09: [
    "相同revision并发修改只有一个提交成功",
    async (t) => {
      const w = await world(t),
        trip = await w.createTrip();
      const results = await Promise.all(
        ["版本甲", "版本乙"].map((title) =>
          w.request(
            "PATCH",
            `/trips/${trip.id}`,
            { expectedRevision: trip.revision, title },
            w.a.token,
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const current = await w.getTrip(trip);
      assert.equal(current.revision, trip.revision + 1);
      assert.equal(
        current.title,
        results.find((r) => r.status === 200).body.title,
      );
    },
  ],
  T10: [
    "生成推荐不会提前修改正式行程",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      uuid(proposal.proposalId);
      assert.ok(proposal.days.length > 0);
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T11: [
    "确认本人有效方案一次性保存planned日程",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      assert.deepEqual(proposal.unassignedPlaceIds, []);
      const planned = await w.apply(trip, proposal);
      assert.equal(planned.status, "planned");
      assert.equal(planned.revision, trip.revision + 1);
      assert.deepEqual(planned.days, proposal.days);
      assert.deepEqual(cleanTrip(await w.getTrip(planned)), cleanTrip(planned));
    },
  ],
  T12: [
    "修改草稿后拒绝确认旧输入快照且不写日程",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      const changed = await w.patchTrip(trip, {
        planningInput: { pace: "relaxed" },
      });
      error(
        await w.request(
          "POST",
          `/trips/${trip.id}/apply-proposal`,
          {
            expectedRevision: changed.revision,
            proposalId: proposal.proposalId,
          },
          w.a.token,
        ),
        409,
        "PROPOSAL_INPUT_MISMATCH",
      );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(changed));
    },
  ],
  T13: [
    "本人过期方案返回410且草稿不变",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      await w.expireProposal(proposal);
      error(
        await w.request(
          "POST",
          `/trips/${trip.id}/apply-proposal`,
          { expectedRevision: trip.revision, proposalId: proposal.proposalId },
          w.a.token,
        ),
        410,
        "PROPOSAL_EXPIRED",
      );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T14: [
    "他人方案即使过期也只返回404",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip();
      const foreign = await w.call(
        "POST",
        "/recommendations/itinerary",
        trip.planningInput,
        200,
        w.b,
      );
      await w.expireProposal(foreign);
      error(
        await w.request(
          "POST",
          `/trips/${trip.id}/apply-proposal`,
          { expectedRevision: trip.revision, proposalId: foreign.proposalId },
          w.a.token,
        ),
        404,
        "NOT_FOUND",
      );
    },
  ],
  T15: [
    "未安排项非空的方案拒绝确认且无部分写入",
    async (t) => {
      const w = await world(t);
      let trip = await w.preparedTrip();
      trip = await w.patchTrip(trip, {
        planningInput: {
          endDate: trip.planningInput.startDate,
          pace: "relaxed",
        },
      });
      await w.db.admin.query(
        "UPDATE places SET suggested_duration_minutes=600 WHERE id=$1",
        [trip.planningInput.selectedPlaceIds[0]],
      );
      const proposal = await w.propose(trip);
      assert.ok(proposal.unassignedPlaceIds.length > 0);
      error(
        await w.request(
          "POST",
          `/trips/${trip.id}/apply-proposal`,
          { expectedRevision: trip.revision, proposalId: proposal.proposalId },
          w.a.token,
        ),
        422,
        "UNASSIGNED_PLACES",
      );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T16: [
    "planned修改规划条件须确认重置且只增加一次版本",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip(),
        patch = { planningInput: { pace: "relaxed" } };
      error(
        await w.request(
          "PATCH",
          `/trips/${trip.id}`,
          { expectedRevision: trip.revision, ...patch },
          w.a.token,
        ),
        409,
        "SCHEDULE_RESET_REQUIRED",
      );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
      const reset = await w.patchTrip(trip, {
        ...patch,
        acknowledgeScheduleReset: true,
      });
      assert.equal(reset.status, "draft");
      assert.deepEqual(reset.days, []);
      assert.equal(reset.revision, trip.revision + 1);
    },
  ],
  T17: [
    "planned仅改标题保留既有安排",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip(),
        changed = await w.patchTrip(trip, { title: "只改标题" });
      assert.equal(changed.status, "planned");
      assert.deepEqual(changed.days, trip.days);
      assert.equal(changed.revision, trip.revision + 1);
    },
  ],
  T18: [
    "planned选择变化须显式重置并清空日程",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip(),
        body = { expectedRevision: trip.revision, placeIds: [] };
      error(
        await w.request("PUT", `/trips/${trip.id}/selections`, body, w.a.token),
        409,
        "SCHEDULE_RESET_REQUIRED",
      );
      const reset = await w.call("PUT", `/trips/${trip.id}/selections`, {
        ...body,
        acknowledgeScheduleReset: true,
      });
      assert.equal(reset.status, "draft");
      assert.deepEqual(reset.days, []);
      assert.deepEqual(reset.planningInput.selectedPlaceIds, []);
    },
  ],
  T19: [
    "手动换日保持景点集合和position并持久化",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip();
      const ids = trip.planningInput.selectedPlaceIds;
      const days = trip.days.map((d, index) => ({
        date: d.date,
        items: [
          {
            ...trip.days
              .flatMap((x) => x.items)
              .find((x) => x.placeId === ids[1 - index]),
            position: 0,
            startTime: "09:00",
            travelMinutesFromPrevious: 0,
            travelTimeSource: "none",
          },
        ],
      }));
      const changed = await w.call("PUT", `/trips/${trip.id}/schedule`, {
        expectedRevision: trip.revision,
        days,
      });
      assert.deepEqual(changed.days, days);
      sameSet(
        changed.days.flatMap((d) => d.items.map((i) => i.placeId)),
        ids,
      );
      assert.deepEqual((await w.getTrip(trip)).days, days);
    },
  ],
  T20: [
    "手动日程拒绝漏项重复重叠和范围外日期",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip();
      const variants = [
        [],
        trip.days.map((d) => ({ ...d, items: [] })),
        [{ date: "2020-01-01", items: trip.days.flatMap((d) => d.items) }],
      ];
      const duplicated = structuredClone(trip.days);
      duplicated[0].items.push({
        ...trip.days.flatMap((d) => d.items)[0],
        position: duplicated[0].items.length,
      });
      variants.push(duplicated);
      const overlap = structuredClone(trip.days);
      const items = overlap.flatMap((d) => d.items);
      overlap[0].items = items.map((i, position) => ({
        ...i,
        position,
        startTime: "09:00",
      }));
      overlap[1].items = [];
      variants.push(overlap);
      for (const days of variants)
        error(
          await w.request(
            "PUT",
            `/trips/${trip.id}/schedule`,
            { expectedRevision: trip.revision, days },
            w.a.token,
          ),
          422,
          "INVALID_SCHEDULE",
        );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T21: [
    "草稿不能直接写日程且planned不能再次确认覆盖",
    async (t) => {
      const w = await world(t),
        draft = await w.preparedTrip(),
        proposal = await w.propose(draft);
      assert.equal(
        (
          await w.request(
            "PUT",
            `/trips/${draft.id}/schedule`,
            { expectedRevision: draft.revision, days: proposal.days },
            w.a.token,
          )
        ).status,
        409,
      );
      const planned = await w.apply(draft, proposal);
      assert.equal(
        (
          await w.request(
            "POST",
            `/trips/${planned.id}/apply-proposal`,
            {
              expectedRevision: planned.revision,
              proposalId: proposal.proposalId,
            },
            w.a.token,
          )
        ).status,
        409,
      );
      assert.deepEqual(cleanTrip(await w.getTrip(planned)), cleanTrip(planned));
    },
  ],
  T22: [
    "他人行程的读改选择确认和删除均返回404",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      for (const [method, suffix, body] of [
        ["GET", "", undefined],
        ["PATCH", "", { expectedRevision: trip.revision, title: "越权" }],
        [
          "PUT",
          "/selections",
          { expectedRevision: trip.revision, placeIds: [] },
        ],
        [
          "POST",
          "/apply-proposal",
          { expectedRevision: trip.revision, proposalId: proposal.proposalId },
        ],
        ["DELETE", `?expectedRevision=${trip.revision}`, undefined],
      ])
        error(
          await w.request(
            method,
            `/trips/${trip.id}${suffix}`,
            body,
            w.b.token,
          ),
          404,
          "NOT_FOUND",
        );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
    },
  ],
  T23: [
    "确认第二条日程写入失败时整个事务回滚",
    async (t) => {
      const w = await world(t),
        trip = await w.preparedTrip(),
        proposal = await w.propose(trip);
      await w.failInsert("trip_items", 2);
      error(
        await w.request(
          "POST",
          `/trips/${trip.id}/apply-proposal`,
          { expectedRevision: trip.revision, proposalId: proposal.proposalId },
          w.a.token,
        ),
        500,
        "INTERNAL_ERROR",
      );
      assert.deepEqual(cleanTrip(await w.getTrip(trip)), cleanTrip(trip));
      const rows = await w.db.admin.query(
        "SELECT count(*)::int AS n FROM trip_items",
      );
      assert.equal(rows.rows[0].n, 0);
    },
  ],
  T24: [
    "删除行程保护revision且不删除独立到访手账",
    async (t) => {
      const w = await world(t),
        trip = await w.plannedTrip(),
        visit = await w.visit(),
        journal = await w.journal(visit);
      error(
        await w.request(
          "DELETE",
          `/trips/${trip.id}?expectedRevision=${trip.revision - 1}`,
          undefined,
          w.a.token,
        ),
        409,
        "REVISION_CONFLICT",
      );
      await w.call(
        "DELETE",
        `/trips/${trip.id}?expectedRevision=${trip.revision}`,
        undefined,
        204,
      );
      error(
        await w.request("GET", `/trips/${trip.id}`, undefined, w.a.token),
        404,
        "NOT_FOUND",
      );
      assert.equal(
        (await w.call("GET", `/journals/${journal.id}`)).id,
        journal.id,
      );
      assert.ok((await w.footprints()).markers.some((m) => m.id === visit.id));
    },
  ],
};
