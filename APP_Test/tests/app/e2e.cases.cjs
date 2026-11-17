const assert = require("node:assert/strict");
const { world, image, page: items } = require("./support/world.cjs");
const { browser } = require("./support/browser.cjs");
async function planning(t, width) {
  const w = await world(t),
    u = await browser(t, { real: w, viewport: { width, height: 900 } });
  await u.login();
  await u.page.getByTestId("new-trip").click();
  await u.page.getByTestId("trip-title").fill("端到端杭州两日游");
  await u.page.getByTestId("trip-city").selectOption(w.fixtures.input.cityId);
  await u.page.getByTestId("create-trip").click();
  await u.page.getByTestId("trip-start-date").fill("2026-11-01");
  await u.page.getByTestId("trip-end-date").fill("2026-11-02");
  await u.page.getByTestId("save-dates").click();
  await u.page.getByTestId("theme-nature").check();
  await u.page.getByTestId("pace").selectOption("standard");
  await u.page.getByTestId("transport-mode").selectOption("walking");
  await u.page.getByTestId("save-preferences").click();
  for (const id of w.fixtures.input.selectedPlaceIds)
    await u.page.getByTestId("select-place-" + id).check();
  await u.page.getByTestId("save-selections").click();
  await u.page.getByTestId("generate-itinerary").click();
  await u.expect(u.page.getByTestId("proposal-preview")).toBeVisible();
  let trips = items(await w.call("GET", "/trips"));
  assert.equal(trips.length, 1);
  assert.equal(trips[0].status, "draft");
  await u.page.getByTestId("confirm-proposal").click();
  await u.expect(u.page.getByTestId("daily-schedule")).toBeVisible();
  const saved = await w.getTrip(trips[0]);
  assert.equal(saved.status, "planned");
  assert.equal(saved.days.flatMap((d) => d.items).length, 3);
  assert.deepEqual((await w.footprints()).litCities, []);
  await u.page.reload();
  await u.open("/trips/" + saved.id);
  await u.expect(u.page.getByTestId("daily-schedule")).toBeVisible();
  await u.noOverflow();
}
async function journaling(t, width) {
  const w = await world(t),
    u = await browser(t, { real: w, viewport: { width, height: 900 } });
  await u.login();
  await u.page.getByTestId("nav-footprints").click();
  await u.page.getByTestId("record-visit").click();
  await u.page.getByTestId("visit-place").selectOption(w.fixtures.places[0].id);
  await u.page.getByTestId("visited-on").fill("2025-11-01");
  await u.page.getByTestId("save-visit").click();
  await u
    .expect(u.page.getByTestId("city-lit-" + w.fixtures.input.cityId))
    .toBeVisible();
  const fp = await w.footprints();
  assert.equal(fp.markers.length, 1);
  const visit = fp.markers[0];
  await u.page.getByTestId("new-journal-" + visit.id).click();
  await u.page.getByTestId("journal-title").fill("真实端到端随笔");
  await u.page.getByTestId("journal-body").fill("两张合成图片和纯文本正文");
  await u.page.getByTestId("journal-media-input").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: image() },
    { name: "two.png", mimeType: "image/png", buffer: image() },
  ]);
  await u.expect(u.page.getByTestId("uploaded-media")).toHaveCount(2);
  await u.page.getByTestId("save-journal").click();
  await u
    .expect(u.page.getByTestId("journal-body-text"))
    .toHaveText("两张合成图片和纯文本正文");
  const j = items(await w.call("GET", "/journals"))[0];
  assert.equal(j.mediaIds.length, 2);
  for (const id of j.mediaIds)
    assert.deepEqual(
      (await w.request("GET", "/media/" + id, undefined, w.a.token, 200)).bytes,
      image(),
    );
  await u.page.reload();
  await u.open("/journals/" + j.id);
  await u.expect(u.page.getByTestId("journal-body-text")).toBeVisible();
  assert.equal((await w.footprints()).litCities[0].visitCount, 1);
  await u.noOverflow();
}
module.exports = {
  E2E01: ["1280像素真实登录到规划确认保存刷新全流程", (t) => planning(t, 1280)],
  E2E02: ["390像素真实登录到规划确认保存刷新全流程", (t) => planning(t, 390)],
  E2E03: [
    "1280像素真实到访点亮图文上传与刷新全流程",
    (t) => journaling(t, 1280),
  ],
  E2E04: ["390像素真实到访点亮图文上传与刷新全流程", (t) => journaling(t, 390)],
};
