const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const base = require("../../tdd/support/context.cjs");
const { fixtures } = require("../../tdd/support/fixtures.cjs");

function evidence(name, data) {
  if (!process.env.TPA_TDD_REPORT_DIR) return;
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  fs.appendFileSync(
    path.join(process.env.TPA_TDD_REPORT_DIR, safe + ".jsonl"),
    JSON.stringify(data) + "\n",
  );
}
function actor(label = "user") {
  return {
    email: `${label}-${randomUUID()}@tdd.invalid`,
    password: `Tdd!${randomUUID()}`,
    displayName: `测试${label}`,
  };
}
function page(body) {
  assert.ok(Array.isArray(body.items));
  assert.ok(Number.isInteger(body.page) && body.page >= 1);
  assert.ok(
    Number.isInteger(body.pageSize) &&
      body.pageSize >= 1 &&
      body.pageSize <= 100,
  );
  assert.ok(Number.isInteger(body.total) && body.total >= 0);
  return body.items;
}
function uuid(value) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}
function error(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, "string");
  assert.ok(response.body.message.length > 0);
}
function sameSet(actual, expected) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}
function cleanTrip(trip) {
  return {
    id: trip.id,
    ownerId: trip.ownerId,
    title: trip.title,
    revision: trip.revision,
    status: trip.status,
    planningInput: trip.planningInput,
    days: trip.days,
  };
}
function image(type = "png", size) {
  const samples = Object.fromEntries(
    Object.entries(require("../../../cases/image-fixtures.json")).map(
      ([key, value]) => [key, Buffer.from(value, "base64")],
    ),
  );
  const bytes = samples[type];
  if (!bytes) throw new Error("Unknown test image type");
  if (!size) return bytes;
  // Put padding inside a valid ancillary PNG chunk, rather than after IEND.
  assert.equal(type, "png");
  const padding = size - bytes.length;
  assert.ok(padding >= 20);
  const chunkType = Buffer.from("tEXt"),
    data = Buffer.alloc(padding - 12, 32);
  data.write("padding\0");
  const chunk = Buffer.alloc(padding);
  chunk.writeUInt32BE(data.length);
  chunkType.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([chunkType, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, padding - 4);
  return Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]);
}
async function world(t, options = {}) {
  // LIFO cleanup closes application pools before removing this test's schema.
  const cleanup = [];
  t.after(async () => {
    const failures = [];
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (e) {
        failures.push(e);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Test resource cleanup failed");
  });
  const db = await base.database(
    { after: (fn) => cleanup.push(fn) },
    { users: false },
  );
  // Do not fall through to unrelated public tables when a business migration is missing.
  await db.admin.query(`SET search_path TO "${db.schema}",pg_catalog`);
  const isolatedUrl = new URL(db.url);
  isolatedUrl.searchParams.set(
    "options",
    `-c search_path=${db.schema},pg_catalog`,
  );
  db.url = isolatedUrl.toString();
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-app-test-"));
  cleanup.push(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const env = {
    DATABASE_URL: db.url,
    AMAP_WEB_SERVICE_KEY: "",
    B_LLM_ENABLED: "false",
    B_PROPOSAL_TTL_MINUTES: "30",
    PORT: "3000",
    CORS_ORIGIN: "http://127.0.0.1:4179",
    MEDIA_STORAGE_DIR: mediaRoot,
    AUTH_TOKEN_TTL_SECONDS: String(options.tokenTtlSeconds ?? 3600),
    JWT_SECRET: "app-test-only-secret-with-no-production-use",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  let app;
  try {
    Object.assign(process.env, env);
    const { createApp } = base.sut("app.js");
    assert.equal(
      typeof createApp,
      "function",
      "The API skeleton must export createApp",
    );
    app = await createApp({ logger: false, abortOnError: false });
    cleanup.push(() => app.close());
    await app.listen(0, "127.0.0.1");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  let url = await app.getUrl();
  async function request(method, route, body, token, expected) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(url + "/api" + route, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let parsed;
    if (response.headers.get("content-type")?.includes("json")) {
      parsed = bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
    }
    evidence("http-requests", {
      caseId: t.name?.split(" ")[0],
      method,
      route: route.split("?")[0],
      status: response.status,
    });
    // Never include response bodies/passwords/tokens in status-assertion messages.
    if (expected !== undefined)
      assert.equal(
        response.status,
        expected,
        `${method} ${route.split("?")[0]}`,
      );
    return {
      status: response.status,
      body: parsed,
      bytes,
      headers: response.headers,
    };
  }
  const w = { db, app, url, request, mediaRoot, fixtures: fixtures() };
  w.restart = async () => {
    await app.close();
    const saved = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]]),
    );
    try {
      Object.assign(process.env, env);
      app = await base
        .sut("app.js")
        .createApp({ logger: false, abortOnError: false });
      await app.listen(0, "127.0.0.1");
      url = await app.getUrl();
      w.app = app;
      w.url = url;
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  w.register = async (identity = actor()) => {
    const response = await request(
      "POST",
      "/auth/register",
      identity,
      undefined,
      201,
    );
    uuid(response.body.user.id);
    return { ...identity, user: response.body.user };
  };
  w.login = async (identity) => {
    const response = await request(
      "POST",
      "/auth/login",
      { email: identity.email, password: identity.password },
      undefined,
      200,
    );
    assert.equal(typeof response.body.accessToken, "string");
    assert.ok(response.body.accessToken.length > 0);
    assert.ok(Date.parse(response.body.expiresAt) > Date.now());
    return {
      ...identity,
      user: response.body.user,
      token: response.body.accessToken,
    };
  };
  w.newUser = async (label) => w.login(await w.register(actor(label)));
  if (options.users !== false) {
    w.a = await w.newUser("a");
    w.b = await w.newUser("b");
  }
  w.call = async (method, route, body, expected = 200, who = w.a) =>
    (await request(method, route, body, who?.token, expected)).body;
  w.createTrip = async (who = w.a) =>
    w.call(
      "POST",
      "/trips",
      { title: "杭州测试行程", cityId: w.fixtures.input.cityId },
      201,
      who,
    );
  w.getTrip = async (trip, who = w.a) =>
    w.call("GET", "/trips/" + trip.id, undefined, 200, who);
  w.patchTrip = async (trip, patch, expected = 200, who = w.a) =>
    w.call(
      "PATCH",
      "/trips/" + trip.id,
      { expectedRevision: trip.revision, ...patch },
      expected,
      who,
    );
  w.preparedTrip = async () => {
    let trip = await w.createTrip();
    const { selectedPlaceIds, ...planningInput } = w.fixtures.input;
    trip = await w.patchTrip(trip, { planningInput });
    return w.call("PUT", `/trips/${trip.id}/selections`, {
      expectedRevision: trip.revision,
      placeIds: selectedPlaceIds.slice(0, 2),
    });
  };
  w.propose = async (trip) =>
    w.call("POST", "/recommendations/itinerary", trip.planningInput);
  w.expireProposal = async (proposal) => {
    const generatedAt = new Date(Date.now() - 7200000).toISOString();
    const expiresAt = new Date(Date.now() - 3600000).toISOString();
    await db.admin.query(
      "UPDATE recommendation_proposals SET generated_at=$2::timestamptz, expires_at=$3::timestamptz, proposal=jsonb_set(jsonb_set(proposal,'{generatedAt}',to_jsonb($2::text)),'{expiresAt}',to_jsonb($3::text)) WHERE id=$1",
      [proposal.proposalId, generatedAt, expiresAt],
    );
  };
  w.apply = async (trip, proposal, expected = 200, who = w.a) =>
    w.call(
      "POST",
      `/trips/${trip.id}/apply-proposal`,
      { expectedRevision: trip.revision, proposalId: proposal.proposalId },
      expected,
      who,
    );
  w.plannedTrip = async () => {
    const trip = await w.preparedTrip();
    return w.apply(trip, await w.propose(trip));
  };
  w.visit = async (patch = {}, who = w.a) =>
    w.call(
      "POST",
      "/visited-places",
      { placeId: w.fixtures.places[0].id, visitedOn: "2025-11-01", ...patch },
      201,
      who,
    );
  w.journal = async (visit, patch = {}, who = w.a) =>
    w.call(
      "POST",
      "/journals",
      {
        visitedPlaceId: visit.id,
        title: "测试随笔",
        body: "纯文本旅行记录",
        mediaIds: [],
        ...patch,
      },
      201,
      who,
    );
  w.upload = async (
    bytes = image(),
    mime = "image/png",
    filename = "test.png",
    who = w.a,
    status = 201,
  ) => {
    const data = new FormData();
    data.append("file", new Blob([bytes], { type: mime }), filename);
    return (await request("POST", "/media", data, who?.token, status)).body;
  };
  w.footprints = async (query = "", who = w.a) =>
    w.call("GET", "/footprints" + query, undefined, 200, who);
  w.failInsert = async (table, nth = 1) => {
    assert.ok(["trip_items", "journals", "media_assets"].includes(table));
    const suffix = randomUUID().replaceAll("-", "");
    await db.admin.query(`CREATE SEQUENCE fail_${suffix}`);
    await db.admin.query(
      `CREATE FUNCTION fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('fail_${suffix}') >= ${Number(nth)} THEN RAISE EXCEPTION 'injected-app-test-failure'; END IF; RETURN NEW; END $$`,
    );
    await db.admin.query(
      `CREATE TRIGGER fail_${suffix} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_${suffix}()`,
    );
  };
  return w;
}
module.exports = {
  world,
  actor,
  page,
  uuid,
  error,
  sameSet,
  cleanTrip,
  image,
  evidence,
  ...{ fixtures },
};
