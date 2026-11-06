const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { LlmAdvisor, validateModelOrder } = require('../dist/integrations/llm/llm.advisor.js');
const { readBConfig } = require('../dist/b/config.js');
const { fixture, serviceFixture } = require('./helpers/b.cjs');
const input = fixture.requests.recommendationRequest;

function config() {
  return {
    values: readBConfig({
      B_LLM_ENABLED: 'true',
      LLM_API_BASE_URL: 'https://model.example/v1',
      LLM_API_KEY: 'test-secret',
      LLM_MODEL: 'configured-model',
    }),
  };
}
function completion(content, finishReason = 'stop') {
  return {
    choices: [
      {
        finish_reason: finishReason,
        message: { content: typeof content === 'string' ? content : JSON.stringify(content) },
      },
    ],
  };
}
test('disabled model makes no network request and invalid model settings fail early', async () => {
  let calls = 0;
  const advisor = new LlmAdvisor({ values: readBConfig({}) }, async () => {
    calls++;
    throw new Error('not called');
  });
  assert.deepEqual(
    await advisor.suggest(input, fixture.places, globalThis.AbortSignal.timeout(1000)),
    { order: null },
  );
  assert.equal(calls, 0);
  for (const env of [
    { B_LLM_TIMEOUT_MS: '0' },
    { B_LLM_TIMEOUT_MS: '60001' },
    { B_LLM_TIMEOUT_MS: '1.5' },
    { B_LLM_ENABLED: 'yes' },
    { B_LLM_ENABLED: 'true' },
    {
      B_LLM_ENABLED: 'true',
      LLM_API_BASE_URL: 'http://remote.example/v1',
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'm',
    },
    {
      B_LLM_ENABLED: 'true',
      LLM_API_BASE_URL: 'https://user:secret@example.com',
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'm',
    },
  ])
    assert.throws(() => readBConfig(env));
});
test('model orders must be exact permutations; fabricated/duplicate/unknown content is rejected', () => {
  assert.deepEqual(
    validateModelOrder({ orderedPlaceIds: [...input.selectedPlaceIds].reverse() }, input),
    [...input.selectedPlaceIds].reverse(),
  );
  for (const value of [
    null,
    {},
    { orderedPlaceIds: [] },
    { orderedPlaceIds: [...input.selectedPlaceIds], reason: 'invented' },
    { orderedPlaceIds: input.selectedPlaceIds.map(() => input.selectedPlaceIds[0]) },
    { orderedPlaceIds: [fixture.actors.other.userId, ...input.selectedPlaceIds.slice(1)] },
  ])
    assert.throws(() => validateModelOrder(value, input));
});
test('model failures, refusals, truncation, malformed JSON and invented places return safe rule fallback', async () => {
  for (const payload of [
    null,
    completion('not JSON'),
    completion({ orderedPlaceIds: [] }),
    completion({ orderedPlaceIds: input.selectedPlaceIds }, 'length'),
    {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            refusal: 'no',
            content: JSON.stringify({ orderedPlaceIds: input.selectedPlaceIds }),
          },
        },
      ],
    },
  ]) {
    const advisor = new LlmAdvisor(config(), async () => ({ ok: true, json: async () => payload }));
    const result = await advisor.suggest(
      input,
      fixture.places,
      globalThis.AbortSignal.timeout(1000),
    );
    assert.equal(result.order, null);
    assert.equal(result.warning.code, 'MODEL_FALLBACK');
    assert.ok(!JSON.stringify(result).includes('test-secret'));
  }
  for (const transport of [
    async () => {
      throw new Error('test-secret');
    },
    async () => ({ ok: false }),
  ]) {
    assert.equal(
      (
        await new LlmAdvisor(config(), transport).suggest(
          input,
          fixture.places,
          globalThis.AbortSignal.timeout(1000),
        )
      ).warning.code,
      'MODEL_FALLBACK',
    );
  }
});
test('local HTTP model adapter sends strict schema, validates completion and enforces real fetch timeout', async () => {
  let requestBody;
  const server = createServer(async (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) body += chunk;
    requestBody = JSON.parse(body);
    assert.equal(request.headers.authorization, 'Bearer test-secret');
    if (request.url.startsWith('/slow/')) await delay(80);
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(completion({ orderedPlaceIds: [...input.selectedPlaceIds].reverse() })),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c = config();
    c.values.llmBaseUrl = `${base}/v1`;
    const advisor = new LlmAdvisor(c, fetch);
    assert.deepEqual(
      (await advisor.suggest(input, fixture.places, globalThis.AbortSignal.timeout(1000))).order,
      [...input.selectedPlaceIds].reverse(),
    );
    assert.equal(requestBody.response_format.json_schema.strict, true);
    assert.equal(
      requestBody.response_format.json_schema.schema.properties.orderedPlaceIds.minItems,
      input.selectedPlaceIds.length,
    );
    assert.equal(
      requestBody.response_format.json_schema.schema.properties.orderedPlaceIds.maxItems,
      input.selectedPlaceIds.length,
    );
    assert.deepEqual(
      JSON.parse(requestBody.messages[1].content).selectedPlaceIds,
      input.selectedPlaceIds,
    );
    assert.equal(requestBody.store, false);
    assert.ok(!requestBody.messages[1].content.includes(fixture.actors.primary.userId));
    c.values.llmBaseUrl = `${base}/slow`;
    c.values.llmTimeoutMs = 10;
    assert.equal(
      (await advisor.suggest(input, fixture.places, globalThis.AbortSignal.timeout(1000))).warning
        .code,
      'MODEL_FALLBACK',
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('model suggestion is re-planned and adopted only when it improves a valid schedule', async () => {
  const { service, geo, advisor } = serviceFixture();
  const order = [input.selectedPlaceIds[0], input.selectedPlaceIds[2], input.selectedPlaceIds[1]];
  advisor.suggest = async () => ({ order });
  geo.route = async (from, to) => ({
    durationMinutes:
      from.longitude === fixture.places[0].coordinates.longitude &&
      to.longitude === fixture.places[1].coordinates.longitude
        ? 100
        : 1,
    source: 'provider',
    warnings: [],
  });
  const result = await service.generate(input, fixture.actors.primary.userId);
  assert.equal(result.source, 'llm-assisted');
  assert.deepEqual(
    result.days[0].items.map((item) => item.placeId),
    order,
  );
  assert.deepEqual(result.inputSnapshot.selectedPlaceIds, input.selectedPlaceIds);
});
test('bad model candidate route cannot destroy the already computed baseline proposal', async () => {
  const { service, geo, advisor } = serviceFixture();
  advisor.suggest = async () => ({ order: [...input.selectedPlaceIds].reverse() });
  geo.route = async (from) => {
    if (from.longitude === fixture.places[2].coordinates.longitude)
      throw new Error('model candidate route failure');
    return { durationMinutes: 45, source: 'estimate', warnings: [] };
  };
  const result = await service.generate(input, fixture.actors.primary.userId);
  assert.equal(result.source, 'rule');
  assert.equal(result.unassignedPlaceIds.length, 0);
  assert.ok(result.warnings.some((w) => w.code === 'MODEL_FALLBACK'));
});
