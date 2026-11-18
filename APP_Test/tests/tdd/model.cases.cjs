const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const {
  sut,
  config,
  fixtures,
  recommendation,
  localHttp,
  json,
} = require("./support/context.cjs");
const { userA, userB } = require("./support/fixtures.cjs");
function completion(content, finish = "stop", refusal) {
  return {
    choices: [
      {
        finish_reason: finish,
        message: {
          content:
            typeof content === "string" ? content : JSON.stringify(content),
          ...(refusal ? { refusal } : {}),
        },
      },
    ],
  };
}
function advisor(settings, transport) {
  return new (sut("integrations/llm/llm.advisor.js").LlmAdvisor)(
    settings,
    transport,
  );
}
function signal() {
  return AbortSignal.timeout(5000);
}
async function modelServer(t, response) {
  const server = await localHttp(t, async (request, res) =>
    json(res, await response(request)),
  );
  return {
    ...server,
    settings: config({ llmEnabled: true, llmBaseUrl: server.base + "/v1" }),
  };
}
module.exports = {
  M01: [
    "关闭模型不调用网络且规则方案仍完整",
    async () => {
      const f = fixtures();
      let calls = 0;
      const result = await advisor(config(), async () => {
        calls++;
        throw new Error("must not fetch");
      }).suggest(f.input, f.places, signal());
      assert.deepEqual(result, { order: null });
      assert.equal(calls, 0);
      const runtime = recommendation(),
        proposal = await runtime.service.generate(runtime.data.input, userA);
      assert.equal(proposal.source, "rule");
      assert.deepEqual(proposal.unassignedPlaceIds, []);
    },
  ],
  M02: [
    "模型启用缺配置或不安全地址启动前拒绝",
    () => {
      const read = sut("b/config.js").readBConfig;
      for (const env of [
        { B_LLM_ENABLED: "yes" },
        { B_LLM_ENABLED: "true" },
        {
          B_LLM_ENABLED: "true",
          LLM_API_BASE_URL: "http://remote.invalid/v1",
          LLM_MODEL: "m",
          LLM_API_KEY: "fixture-private",
        },
        {
          B_LLM_ENABLED: "true",
          LLM_API_BASE_URL: "https://user:password@model.invalid/v1",
          LLM_MODEL: "m",
          LLM_API_KEY: "fixture-private",
        },
        { B_LLM_TIMEOUT_MS: "0" },
      ])
        assert.throws(() => read(env));
    },
  ],
  M03: [
    "实际模型请求含严格Schema与完整选择数量",
    async (t) => {
      const f = fixtures(),
        server = await modelServer(t, () =>
          completion({ orderedPlaceIds: f.input.selectedPlaceIds }),
        );
      const result = await advisor(server.settings, fetch).suggest(
        f.input,
        f.places,
        signal(),
      );
      assert.deepEqual(result.order, f.input.selectedPlaceIds);
      const request = server.requests[0];
      assert.equal(request.url.pathname, "/v1/chat/completions");
      assert.equal(request.body.store, false);
      assert.equal(request.body.response_format.json_schema.strict, true);
      const schema = request.body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["orderedPlaceIds"]);
      assert.equal(schema.properties.orderedPlaceIds.minItems, 3);
      assert.equal(schema.properties.orderedPlaceIds.maxItems, 3);
      assert.deepEqual(
        schema.properties.orderedPlaceIds.items.enum,
        f.input.selectedPlaceIds,
      );
      assert.deepEqual(
        JSON.parse(request.body.messages[1].content).selectedPlaceIds,
        f.input.selectedPlaceIds,
      );
      assert.ok(!JSON.stringify(request.body.messages).includes(userA));
    },
  ],
  M04: [
    "模型完整原景点排列可被采用为候选",
    async (t) => {
      const f = fixtures(),
        order = [...f.input.selectedPlaceIds].reverse(),
        server = await modelServer(t, () =>
          completion({ orderedPlaceIds: order }),
        );
      assert.deepEqual(
        (
          await advisor(server.settings, fetch).suggest(
            f.input,
            f.places,
            signal(),
          )
        ).order,
        order,
      );
    },
  ],
  M05: [
    "漏项重复编造景点与额外字段被拒绝",
    async (t) => {
      const f = fixtures();
      let output;
      const server = await modelServer(t, () => completion(output));
      for (output of [
        { orderedPlaceIds: f.input.selectedPlaceIds.slice(1) },
        { orderedPlaceIds: Array(3).fill(f.input.selectedPlaceIds[0]) },
        { orderedPlaceIds: [userB, ...f.input.selectedPlaceIds.slice(1)] },
        { orderedPlaceIds: f.input.selectedPlaceIds, price: 0 },
      ]) {
        const result = await advisor(server.settings, fetch).suggest(
          f.input,
          f.places,
          signal(),
        );
        assert.equal(result.order, null);
        assert.equal(result.warning.code, "MODEL_FALLBACK");
      }
    },
  ],
  M06: [
    "非法JSON空内容拒绝和截断被拒绝",
    async (t) => {
      const f = fixtures();
      let payload;
      const server = await modelServer(t, () => payload);
      for (payload of [
        completion("not JSON"),
        completion(""),
        completion({ orderedPlaceIds: f.input.selectedPlaceIds }, "length"),
        completion(
          { orderedPlaceIds: f.input.selectedPlaceIds },
          "stop",
          "refused",
        ),
        { choices: [] },
        completion("x".repeat(32001)),
      ]) {
        const result = await advisor(server.settings, fetch).suggest(
          f.input,
          f.places,
          signal(),
        );
        assert.equal(result.order, null);
        assert.equal(result.warning.code, "MODEL_FALLBACK");
      }
    },
  ],
  M07: [
    "HTTP网络和超时均回退且不泄漏供应商信息",
    async (t) => {
      const f = fixtures(),
        server = await localHttp(t, async (request, res) => {
          if (request.url.pathname.includes("slow")) {
            await delay(120);
            return json(
              res,
              completion({ orderedPlaceIds: f.input.selectedPlaceIds }),
            );
          }
          json(res, {}, 429);
        });
      for (const transport of [
        async () => {
          throw new Error("tdd-fixture-only");
        },
        fetch,
      ]) {
        const result = await advisor(
          config({ llmEnabled: true, llmBaseUrl: server.base + "/v1" }),
          transport,
        ).suggest(f.input, f.places, signal());
        assert.equal(result.warning.code, "MODEL_FALLBACK");
        assert.ok(!JSON.stringify(result).includes("tdd-fixture-only"));
      }
      const result = await advisor(
        config({
          llmEnabled: true,
          llmBaseUrl: server.base + "/slow",
          llmTimeoutMs: 20,
        }),
        fetch,
      ).suggest(f.input, f.places, signal());
      assert.equal(result.order, null);
      assert.equal(result.warning.code, "MODEL_FALLBACK");
    },
  ],
  M08: [
    "模型候选必须用实际路线重新计算预算",
    async () => {
      const f = recommendation(),
        input = {
          ...f.data.input,
          endDate: f.data.input.startDate,
          transportMode: "driving",
        },
        ids = input.selectedPlaceIds,
        calls = [];
      f.advisor.suggest = async () => ({ order: [...ids].reverse() });
      f.geo.route = async (from, to) => {
        calls.push(from.longitude + ">" + to.longitude);
        return {
          durationMinutes:
            from.longitude === f.data.places[2].coordinates.longitude ? 600 : 1,
          source: "provider",
          warnings: [],
        };
      };
      const result = await f.service.generate(input, userA);
      assert.ok(calls.includes("120.028>120.102"));
      assert.equal(result.source, "rule");
      assert.equal(result.unassignedPlaceIds.length, 0);
      assert.deepEqual(
        result.days[0].items.map((p) => p.placeId),
        ids,
      );
    },
  ],
  M09: [
    "只有真实改善才采用且输入快照保留原顺序",
    async () => {
      const f = recommendation(),
        ids = f.data.input.selectedPlaceIds,
        order = [ids[0], ids[2], ids[1]];
      f.advisor.suggest = async () => ({ order });
      f.geo.route = async (from, to) => ({
        durationMinutes:
          from.longitude === f.data.places[0].coordinates.longitude &&
          to.longitude === f.data.places[1].coordinates.longitude
            ? 120
            : 1,
        source: "provider",
        warnings: [],
      });
      const result = await f.service.generate(f.data.input, userA);
      assert.equal(result.source, "llm-assisted");
      assert.deepEqual(
        result.days[0].items.map((p) => p.placeId),
        order,
      );
      assert.deepEqual(result.inputSnapshot.selectedPlaceIds, ids);
      const unchanged = recommendation();
      unchanged.advisor.suggest = async () => ({
        order: [...unchanged.data.input.selectedPlaceIds].reverse(),
      });
      assert.equal(
        (await unchanged.service.generate(unchanged.data.input, userA)).source,
        "rule",
      );
    },
  ],
  M10: [
    "候选路线失败或非法建议回退时基线方案仍可保存",
    async () => {
      const f = recommendation(),
        ids = f.data.input.selectedPlaceIds;
      f.advisor.suggest = async () => ({ order: [...ids].reverse() });
      f.geo.route = async (from) => {
        if (from.longitude === f.data.places[2].coordinates.longitude)
          throw new Error("candidate route unavailable");
        return { durationMinutes: 30, source: "provider", warnings: [] };
      };
      const result = await f.service.generate(f.data.input, userA);
      assert.equal(result.source, "rule");
      assert.equal(result.unassignedPlaceIds.length, 0);
      assert.ok(result.warnings.some((w) => w.code === "MODEL_FALLBACK"));
      assert.equal(f.proposals.rows.size, 1);
    },
  ],
};
