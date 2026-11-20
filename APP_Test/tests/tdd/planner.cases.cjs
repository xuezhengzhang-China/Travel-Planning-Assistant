const assert = require("node:assert/strict");
const {
  fixtures,
  policies,
  sut,
  plan,
  assertSchedule,
  expectHttp,
} = require("./support/context.cjs");
const { id } = require("./support/fixtures.cjs");
function generated(count, duration = 1) {
  return Array.from({ length: count }, (_, index) => ({
    ...fixtures().places[0],
    id: id(index + 1),
    suggestedDurationMinutes: duration,
  }));
}
function inputFor(places, extra = {}) {
  return {
    ...fixtures().input,
    selectedPlaceIds: places.map((p) => p.id),
    ...extra,
  };
}
function firstFitCount(pace) {
  const places = generated(6),
    input = inputFor(places, { pace, endDate: "2026-11-01" }),
    result = plan(input, places);
  assert.equal(result.days[0].items.length, policies[pace].count);
  assert.equal(result.unassignedPlaceIds.length, 6 - policies[pace].count);
  assertSchedule(input, places, result);
}
module.exports = {
  P01: [
    "两天三景点基准日程完整合法",
    () => {
      const f = fixtures(),
        result = plan(f.input, f.places);
      assertSchedule(f.input, f.places, result);
      assert.equal(result.unassignedPlaceIds.length, 0);
    },
  ],
  P02: ["relaxed日上限为两个景点", () => firstFitCount("relaxed")],
  P03: ["standard日上限为三个景点", () => firstFitCount("standard")],
  P04: ["intensive日上限为四个景点", () => firstFitCount("intensive")],
  P05: [
    "三节奏首站开始时间符合契约",
    () => {
      const p = generated(1);
      for (const [pace, expected] of [
        ["relaxed", "10:00"],
        ["standard", "09:00"],
        ["intensive", "08:00"],
      ])
        assert.equal(
          plan(inputFor(p, { pace }), p).days[0].items[0].startTime,
          expected,
        );
    },
  ],
  P06: [
    "所有站点结束时间均在当日预算内",
    () => {
      const places = generated(12, 180);
      for (const pace of Object.keys(policies)) {
        const input = inputFor(places, { pace });
        const result = plan(input, places);
        assert.ok(result.days[0].items.length > 0);
        assertSchedule(input, places, result);
      }
    },
  ],
  P07: [
    "站间交通分钟实际计入日程",
    () => {
      const places = generated(2, 60),
        result = plan(inputFor(places), places, () => ({
          durationMinutes: 37,
          source: "provider",
          warnings: [],
        }));
      assert.equal(result.days[0].items[1].travelMinutesFromPrevious, 37);
      assert.equal(result.days[0].items[1].startTime, "10:52");
    },
  ],
  P08: [
    "三节奏的休息分钟计入第二站开始时间",
    () => {
      const places = generated(2, 1);
      for (const [pace, time] of [
        ["relaxed", "10:32"],
        ["standard", "09:17"],
        ["intensive", "08:12"],
      ]) {
        const result = plan(inputFor(places, { pace }), places, () => ({
          durationMinutes: 1,
          source: "provider",
          warnings: [],
        }));
        assert.equal(result.days[0].items[1].startTime, time);
      }
    },
  ],
  P09: [
    "游玩交通休息恰好用尽预算仍可安排",
    () => {
      for (const [pace, policy] of Object.entries(policies)) {
        const places = generated(2, 60);
        places[1].suggestedDurationMinutes =
          policy.end - policy.start - 60 - policy.rest - 30;
        const input = inputFor(places, { pace, endDate: "2026-11-01" }),
          result = plan(input, places);
        assert.equal(result.days[0].items.length, 2);
        assert.deepEqual(result.unassignedPlaceIds, []);
        assertSchedule(input, places, result);
      }
    },
  ],
  P10: [
    "时间预算多一分钟不可强行塞入",
    () => {
      for (const [pace, policy] of Object.entries(policies)) {
        const places = generated(2, 60);
        places[1].suggestedDurationMinutes =
          policy.end - policy.start - 60 - policy.rest - 30 + 1;
        const result = plan(
          inputFor(places, { pace, endDate: "2026-11-01" }),
          places,
        );
        assert.equal(result.days[0].items.length, 1);
        assert.deepEqual(result.unassignedPlaceIds, [places[1].id]);
      }
    },
  ],
  P11: [
    "首站交通为零且不冒充已核实出发段",
    () => {
      const f = fixtures(),
        result = plan(f.input, f.places);
      const first = result.days[0].items[0];
      assert.equal(first.travelMinutesFromPrevious, 0);
      assert.equal(first.travelTimeSource, "none");
      assert.match(first.reason, /未包含.*首站.*交通/);
    },
  ],
  P12: [
    "固定种子组合不重复不捏造不丢失景点",
    () => {
      let seed = 20261117;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      for (const pace of Object.keys(policies))
        for (let index = 0; index < 30; index++) {
          const places = generated(1 + (random() % 120)).map((p) => ({
              ...p,
              suggestedDurationMinutes: 1 + (random() % 700),
            })),
            days = 1 + (random() % 30),
            input = inputFor(places, {
              pace,
              endDate: `2026-11-${String(days).padStart(2, "0")}`,
            });
          assertSchedule(input, places, plan(input, places));
        }
    },
  ],
  P13: [
    "已安排和未安排集合互斥且并集等于选择",
    () => {
      const places = generated(6),
        input = inputFor(places, { pace: "relaxed", endDate: "2026-11-01" }),
        result = plan(input, places);
      assert.equal(result.days[0].items.length, 2);
      assert.equal(result.unassignedPlaceIds.length, 4);
      assertSchedule(input, places, result);
    },
  ],
  P14: [
    "未安排景点返回ID与明确警告",
    () => {
      const places = generated(3),
        result = plan(
          inputFor(places, { pace: "relaxed", endDate: "2026-11-01" }),
          places,
        );
      assert.deepEqual(result.unassignedPlaceIds, [id(3)]);
      assert.ok(
        result.warnings.some(
          (w) => w.code === "UNASSIGNED_PLACES" && w.placeIds.includes(id(3)),
        ),
      );
    },
  ],
  P15: [
    "过长景点不会阻塞后面的可安排项",
    () => {
      const places = generated(3, 60);
      places[0].suggestedDurationMinutes = 999;
      const result = plan(inputFor(places), places);
      assert.deepEqual(result.unassignedPlaceIds, [id(1)]);
      assert.deepEqual(
        result.days[0].items.map((p) => p.placeId),
        [id(2), id(3)],
      );
    },
  ],
  P16: [
    "所有日期含空日保留且每日位置从零连续",
    () => {
      const places = generated(2),
        input = inputFor(places, { endDate: "2026-11-03" }),
        result = plan(input, places);
      assert.deepEqual(
        result.days.map((d) => d.items.length),
        [2, 0, 0],
      );
      assertSchedule(input, places, result);
    },
  ],
  P17: [
    "未核实开放时间时明确返回警告",
    () => {
      const f = fixtures(),
        result = plan(f.input, f.places);
      assert.ok(
        result.warnings.some(
          (w) =>
            w.code === "OPENING_HOURS_UNVERIFIED" && w.placeIds.length === 3,
        ),
      );
    },
  ],
  P18: [
    "相同依赖下结果确定且不修改输入数据",
    () => {
      const f = fixtures(),
        before = structuredClone(f),
        result = plan(f.input, f.places);
      assert.deepEqual(plan(f.input, f.places), result);
      assert.deepEqual(f, before);
    },
  ],
  P19: [
    "缺失路线但有日期可改日并给出警告",
    () => {
      const places = generated(2),
        input = inputFor(places),
        result = plan(input, places, () => null);
      assert.deepEqual(
        result.days.map((d) => d.items.length),
        [1, 1],
      );
      assert.deepEqual(result.unassignedPlaceIds, []);
      assert.ok(
        result.warnings.some((w) => w.code === "ROUTE_UNAVAILABLE_SEPARATED"),
      );
      assertSchedule(input, places, result);
    },
  ],
  P20: [
    "必要路线未知时503而不是假称确定排不下",
    () => {
      const places = generated(2);
      assert.throws(
        () =>
          plan(inputFor(places, { endDate: "2026-11-01" }), places, () => null),
        expectHttp(503, "DEPENDENCY_UNAVAILABLE"),
      );
    },
  ],
  P21: [
    "120景点30天密集节奏全部覆盖且预算有效",
    () => {
      const places = generated(120),
        input = inputFor(places, { pace: "intensive", endDate: "2026-11-30" }),
        result = plan(input, places);
      assert.ok(result.days.every((d) => d.items.length === 4));
      assert.deepEqual(result.unassignedPlaceIds, []);
      assertSchedule(input, places, result);
    },
  ],
  P22: [
    "日程验证拒绝重叠遗漏重复非法时间位置和伪造ID",
    () => {
      const f = fixtures(),
        original = plan(f.input, f.places),
        validate = sut("recommendations/rule-planner.js").validateSchedule;
      for (const change of [
        (d) => {
          d[0].items[1].startTime = "09:01";
        },
        (d) => {
          d[0].items[0].startTime = "25:00";
        },
        (d) => {
          d[0].items[0].placeId = id(999);
        },
        (d) => {
          d[0].items[1].placeId = d[0].items[0].placeId;
        },
        (d) => {
          d[0].items[1].position = 99;
        },
        (d) => {
          d[0].items.pop();
        },
        (d) => {
          d.pop();
        },
      ]) {
        const days = structuredClone(original.days);
        change(days);
        assert.throws(
          () => validate(f.input, f.places, days, original.unassignedPlaceIds),
          expectHttp(400, "INVALID_SCHEDULE"),
        );
      }
    },
  ],
};
