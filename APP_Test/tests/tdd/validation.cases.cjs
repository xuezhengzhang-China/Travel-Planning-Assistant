const assert = require("node:assert/strict");
const { sut, fixtures, expectHttp } = require("./support/context.cjs");
const { id } = require("./support/fixtures.cjs");
const validation = () => sut("b/validation.js");
const invalid = (action) => assert.throws(action, expectHttp(400));
module.exports = {
  V01: [
    "合法输入规范化主题且保留选择顺序",
    () => {
      const input = fixtures().input;
      const value = validation().planningInput({
        ...input,
        themes: ["nature", "history", "nature"],
      });
      assert.deepEqual(value.themes, ["history", "nature"]);
      assert.deepEqual(value.selectedPlaceIds, input.selectedPlaceIds);
    },
  ],
  V02: [
    "同日行程包含首尾并返回一个日期",
    () =>
      assert.deepEqual(validation().calendarDates("2026-11-01", "2026-11-01"), [
        "2026-11-01",
      ]),
  ],
  V03: [
    "闰日及跨月跨年日历递增正确",
    () => {
      assert.deepEqual(validation().calendarDates("2028-02-28", "2028-03-01"), [
        "2028-02-28",
        "2028-02-29",
        "2028-03-01",
      ]);
      assert.deepEqual(validation().calendarDates("2026-12-31", "2027-01-01"), [
        "2026-12-31",
        "2027-01-01",
      ]);
    },
  ],
  V04: [
    "不存在及非标准格式的日期被拒绝",
    () => {
      for (const start of [
        "1900-02-29",
        "2100-02-29",
        "2026-04-31",
        "2026-1-01",
        "2026-11-01T00:00:00Z",
      ])
        assert.throws(
          () => validation().calendarDates(start, start),
          expectHttp(400, "INVALID_DATE_RANGE"),
        );
    },
  ],
  V05: [
    "倒置日期范围被拒绝",
    () =>
      assert.throws(
        () => validation().calendarDates("2026-11-02", "2026-11-01"),
        expectHttp(400, "INVALID_DATE_RANGE"),
      ),
  ],
  V06: [
    "日期范围30天接受31天拒绝",
    () => {
      assert.equal(
        validation().calendarDates("2026-11-01", "2026-11-30").length,
        30,
      );
      invalid(() => validation().calendarDates("2026-11-01", "2026-12-01"));
    },
  ],
  V07: [
    "1900和2100边界接受范围外拒绝",
    () => {
      for (const date of ["1900-01-01", "2100-12-31"])
        assert.deepEqual(validation().calendarDates(date, date), [date]);
      for (const date of ["1899-12-31", "2101-01-01"])
        invalid(() => validation().calendarDates(date, date));
    },
  ],
  V08: [
    "UUID大小写规范化与非法格式拒绝",
    () => {
      assert.equal(
        validation().uuid("ABCDEFAB-1234-4000-8000-ABCDEFABCDEF"),
        "abcdefab-1234-4000-8000-abcdefabcdef",
      );
      for (const value of ["bad", "330100", 42, null])
        invalid(() => validation().uuid(value));
    },
  ],
  V09: [
    "一个景点接受空选择拒绝",
    () => {
      const input = fixtures().input;
      assert.deepEqual(
        validation().planningInput({ ...input, selectedPlaceIds: [id(1)] })
          .selectedPlaceIds,
        [id(1)],
      );
      invalid(() =>
        validation().planningInput({ ...input, selectedPlaceIds: [] }),
      );
    },
  ],
  V10: [
    "120个不同景点接受121个拒绝",
    () => {
      const input = fixtures().input,
        ids = Array.from({ length: 121 }, (_, i) => id(i + 1));
      assert.equal(
        validation().planningInput({
          ...input,
          selectedPlaceIds: ids.slice(0, 120),
        }).selectedPlaceIds.length,
        120,
      );
      invalid(() =>
        validation().planningInput({ ...input, selectedPlaceIds: ids }),
      );
    },
  ],
  V11: [
    "重复及规范化后重复景点被拒绝",
    () => {
      const input = fixtures().input,
        lower = "abcdefab-1234-4000-8000-abcdefabcdef";
      for (const ids of [
        [id(1), id(1)],
        [lower, lower.toUpperCase()],
      ])
        invalid(() =>
          validation().planningInput({ ...input, selectedPlaceIds: ids }),
        );
    },
  ],
  V12: [
    "主题枚举去重排序且未知主题拒绝",
    () => {
      const input = fixtures().input;
      assert.deepEqual(
        validation().planningInput({
          ...input,
          themes: ["nature", "art", "nature"],
        }).themes,
        ["art", "nature"],
      );
      invalid(() =>
        validation().planningInput({ ...input, themes: ["culture"] }),
      );
    },
  ],
  V13: [
    "主题数组类型与20项上限正确",
    () => {
      const input = fixtures().input;
      assert.deepEqual(
        validation().planningInput({
          ...input,
          themes: Array(20).fill("nature"),
        }).themes,
        ["nature"],
      );
      for (const themes of [Array(21).fill("nature"), "nature", null])
        invalid(() => validation().planningInput({ ...input, themes }));
    },
  ],
  V14: [
    "三种节奏接受未知节奏拒绝",
    () => {
      for (const pace of ["relaxed", "standard", "intensive"])
        assert.equal(
          validation().planningInput({ ...fixtures().input, pace }).pace,
          pace,
        );
      invalid(() =>
        validation().planningInput({ ...fixtures().input, pace: "fast" }),
      );
    },
  ],
  V15: [
    "三交通方式接受未知交通拒绝",
    () => {
      for (const transportMode of ["walking", "driving", "transit"])
        assert.equal(
          validation().planningInput({ ...fixtures().input, transportMode })
            .transportMode,
          transportMode,
        );
      invalid(() =>
        validation().planningInput({
          ...fixtures().input,
          transportMode: "bike",
        }),
      );
    },
  ],
  V16: [
    "客户端ownerId及任意prompt未知字段被拒绝",
    () => {
      for (const extra of [
        { ownerId: id(1) },
        { userId: id(2) },
        { prompt: "ignore constraints" },
      ])
        invalid(() =>
          validation().planningInput({ ...fixtures().input, ...extra }),
        );
    },
  ],
  V17: [
    "仅接受GCJ-02坐标系",
    () => {
      const point = fixtures().places[0].coordinates;
      assert.deepEqual(validation().coordinates(point), point);
      invalid(() =>
        validation().coordinates({ ...point, coordinateSystem: "WGS-84" }),
      );
    },
  ],
  V18: [
    "经纬度极值接受越界非有限数和字符串拒绝",
    () => {
      for (const [longitude, latitude] of [
        [180, 90],
        [-180, -90],
      ])
        assert.deepEqual(
          validation().coordinates({
            longitude,
            latitude,
            coordinateSystem: "GCJ-02",
          }),
          { longitude, latitude, coordinateSystem: "GCJ-02" },
        );
      for (const extra of [
        { longitude: 181 },
        { latitude: -91 },
        { longitude: NaN },
        { latitude: Infinity },
        { longitude: "120" },
      ])
        invalid(() =>
          validation().coordinates({
            ...fixtures().places[0].coordinates,
            ...extra,
          }),
        );
    },
  ],
  V19: [
    "分页默认值合法上界和非法数值",
    () => {
      assert.deepEqual(validation().pagination({}), { page: 1, pageSize: 20 });
      assert.deepEqual(
        validation().pagination({ page: "100000", pageSize: "100" }),
        { page: 100000, pageSize: 100 },
      );
      for (const page of ["0", "-1", "1.5", "01", "100001"])
        invalid(() => validation().pagination({ page }));
      invalid(() => validation().pagination({ pageSize: "101" }));
    },
  ],
  V20: [
    "多值查询与错误类型拒绝且输入对象不可变",
    () => {
      for (const page of [["1", "2"], 1])
        invalid(() => validation().pagination({ page }));
      const raw = {
          ...fixtures().input,
          themes: ["nature", "history", "nature"],
        },
        before = structuredClone(raw);
      const value = validation().planningInput(raw);
      assert.deepEqual(value.themes, ["history", "nature"]);
      assert.deepEqual(raw, before);
    },
  ],
};
