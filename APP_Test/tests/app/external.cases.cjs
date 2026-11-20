const assert = require("node:assert/strict");
const {
  sut,
  config,
  fixtures,
  recommendation,
  environmentError,
} = require("../tdd/support/context.cjs");
const { evidence } = require("./support/world.cjs");
function model() {
  if (process.env.TPA_APP_REAL_MODEL !== "1")
    throw environmentError("真实模型专项需显式配置 TPA_APP_REAL_MODEL=1");
  for (const key of ["LLM_API_BASE_URL", "LLM_MODEL", "LLM_API_KEY"])
    if (!process.env[key]) throw environmentError("真实模型配置不完整：" + key);
  return {
    values: sut("b/config.js").readBConfig({
      ...process.env,
      B_LLM_ENABLED: "true",
      B_LLM_TIMEOUT_MS: "60000",
      B_GENERATION_TIMEOUT_MS: "60000",
      AMAP_WEB_SERVICE_KEY: "",
    }),
  };
}
function maps() {
  if (
    process.env.TPA_APP_REAL_AMAP !== "1" ||
    !process.env.AMAP_WEB_SERVICE_KEY
  )
    throw environmentError("真实高德专项需 TPA_APP_REAL_AMAP=1 和服务端 Key");
  return config({
    amapKey: process.env.AMAP_WEB_SERVICE_KEY,
    externalTimeoutMs: 15000,
  });
}
function recordedModel(records) {
  return async (url, options) => {
    const request = JSON.parse(options.body),
      start = Date.now();
    const response = await fetch(url, options);
    records.push({
      endpoint: new URL(url).origin + new URL(url).pathname,
      prompt: request.messages,
      responseFormat: request.response_format,
      httpStatus: response.status,
      elapsedMs: Date.now() - start,
      rawResponse: await response.clone().text(),
    });
    return response;
  };
}
module.exports = {
  EX01: [
    "真实开源兼容模型接收prompt并返回完整有效景点排列",
    async () => {
      const settings = model(),
        f = fixtures(),
        records = [];
      try {
        const advisor = new (sut("integrations/llm/llm.advisor.js").LlmAdvisor)(
          settings,
          recordedModel(records),
        );
        const result = await advisor.suggest(
          f.input,
          f.places,
          AbortSignal.timeout(65000),
        );
        assert.equal(records.length, 1);
        assert.equal(records[0].httpStatus, 200);
        assert.ok(
          result.order,
          "Unsupported strict output is a failed real-model capability check, not a success",
        );
        assert.deepEqual(
          [...result.order].sort(),
          [...f.input.selectedPlaceIds].sort(),
        );
        assert.equal(
          new Set(result.order).size,
          f.input.selectedPlaceIds.length,
        );
      } finally {
        evidence("real-model-prompt-response", { caseId: "EX01", records });
      }
    },
  ],
  EX02: [
    "真实模型建议经过实际推荐编排并形成可读取方案",
    async () => {
      const settings = model(),
        r = recommendation(),
        records = [];
      const advisor = new (sut("integrations/llm/llm.advisor.js").LlmAdvisor)(
        settings,
        recordedModel(records),
      );
      r.advisor.suggest = advisor.suggest.bind(advisor);
      r.settings.values = settings.values;
      const geo = new (sut("integrations/amap/geo.service.js").GeoService)(
        new (sut("integrations/amap/amap.client.js").AmapClient)(
          settings,
          fetch,
        ),
        r.places,
      );
      r.geo.route = geo.route.bind(geo);
      const input = {
        ...r.data.input,
        selectedPlaceIds: r.data.input.selectedPlaceIds.slice(0, 2),
      };
      try {
        const proposal = await r.service.generate(
          input,
          "10000000-0000-4000-8000-000000000001",
        );
        assert.equal(records.length, 1);
        assert.ok(!proposal.warnings.some((w) => w.code === "MODEL_FALLBACK"));
        assert.deepEqual(proposal.unassignedPlaceIds, []);
        assert.deepEqual(
          proposal.days.flatMap((d) => d.items.map((i) => i.placeId)).sort(),
          [...input.selectedPlaceIds].sort(),
        );
        assert.deepEqual(
          await r.service.getOwnedProposal(
            proposal.proposalId,
            "10000000-0000-4000-8000-000000000001",
          ),
          proposal,
        );
        records.push({
          proposal,
          persistence:
            "test memory repository; production database persistence is covered separately by DB03 and T11",
        });
      } finally {
        evidence("real-model-prompt-response", { caseId: "EX02", records });
      }
    },
  ],
  EX03: [
    "真实高德步行驾车公交均返回有效路线分钟",
    async () => {
      const client = new (sut("integrations/amap/amap.client.js").AmapClient)(
          maps(),
          fetch,
        ),
        f = fixtures(),
        records = [];
      try {
        for (const mode of ["walking", "driving", "transit"]) {
          const minutes = await client.route(
            f.places[0].coordinates,
            f.places[1].coordinates,
            mode,
            "0571",
            AbortSignal.timeout(20000),
          );
          assert.ok(Number.isInteger(minutes) && minutes > 0);
          records.push({ mode, durationMinutes: minutes });
        }
      } finally {
        evidence("real-amap", { caseId: "EX03", records });
      }
    },
  ],
  EX04: [
    "真实高德逆地理地点经目录映射为杭州城市",
    async () => {
      const r = recommendation(),
        client = new (sut("integrations/amap/amap.client.js").AmapClient)(
          maps(),
          fetch,
        );
      const geo = new (sut("integrations/amap/geo.service.js").GeoService)(
        client,
        r.places,
      );
      const result = await geo.reverse(r.data.places[0].coordinates);
      evidence("real-amap", { caseId: "EX04", result });
      assert.ok(result.placeName);
      assert.equal(result.cityId, r.data.input.cityId);
      assert.equal(result.cityAdcode, "330100");
    },
  ],
  EX05: [
    "真实GPS转换返回供应商GCJ02坐标",
    async () => {
      const client = new (sut("integrations/amap/amap.client.js").AmapClient)(
        maps(),
        fetch,
      );
      const result = await client.convertGps(120.148, 30.245);
      evidence("real-amap", { caseId: "EX05", result });
      assert.equal(result.coordinateSystem, "GCJ-02");
      assert.ok(
        Number.isFinite(result.longitude) && Number.isFinite(result.latitude),
      );
      assert.ok(
        result.longitude >= -180 &&
          result.longitude <= 180 &&
          result.latitude >= -90 &&
          result.latitude <= 90,
      );
      assert.ok(
        result.longitude !== 120.148 || result.latitude !== 30.245,
        "A conversion must not only relabel the supplied coordinate system",
      );
    },
  ],
};
