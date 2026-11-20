const assert = require("node:assert/strict");
const fs = require("node:fs");
const { world, image, error } = require("./support/world.cjs");
const LIMIT = 10 * 1024 * 1024;
function files(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile()).length;
}
module.exports = {
  U01: [
    "真实PNGJPEGWebP上传后授权读取字节与类型正确",
    async (t) => {
      const w = await world(t);
      for (const [format, mime] of [
        ["png", "image/png"],
        ["jpeg", "image/jpeg"],
        ["webp", "image/webp"],
      ]) {
        const bytes = image(format),
          media = await w.upload(bytes, mime, "fixture." + format);
        assert.equal(media.mimeType, mime);
        assert.equal(media.sizeBytes, bytes.length);
        const read = await w.request(
          "GET",
          "/media/" + media.id,
          undefined,
          w.a.token,
          200,
        );
        assert.deepEqual(read.bytes, bytes);
        assert.equal(read.headers.get("content-type")?.split(";")[0], mime);
      }
    },
  ],
  U02: [
    "10MiB边界图片允许上传且大小准确",
    async (t) => {
      const w = await world(t),
        media = await w.upload(image("png", LIMIT));
      assert.equal(media.sizeBytes, LIMIT);
    },
  ],
  U03: [
    "超过10MiB一个字节拒绝且不创建可见随笔",
    async (t) => {
      const w = await world(t);
      const result = await w.upload(
        image("png", LIMIT + 1),
        "image/png",
        "large.png",
        w.a,
        413,
      );
      assert.equal(result.code, "FILE_TOO_LARGE");
    },
  ],
  U04: [
    "扩展名和MIME伪装不能把HTML当成图片",
    async (t) => {
      const w = await world(t),
        result = await w.upload(
          Buffer.from("<html><script>alert(1)</script></html>"),
          "image/png",
          "fake.png",
          w.a,
          415,
        );
      assert.equal(result.code, "UNSUPPORTED_MEDIA_TYPE");
    },
  ],
  U05: [
    "SVG和GIF等非约定实际图片类型拒绝",
    async (t) => {
      const w = await world(t);
      for (const [bytes, mime, name] of [
        [
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          "image/svg+xml",
          "a.svg",
        ],
        [
          Buffer.from(
            "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            "base64",
          ),
          "image/gif",
          "a.gif",
        ],
      ])
        assert.equal(
          (await w.upload(bytes, mime, name, w.a, 415)).code,
          "UNSUPPORTED_MEDIA_TYPE",
        );
    },
  ],
  U06: [
    "上传必须使用单个file字段且拒绝空表单",
    async (t) => {
      const w = await world(t),
        wrong = new FormData();
      wrong.append(
        "photo",
        new Blob([image()], { type: "image/png" }),
        "a.png",
      );
      for (const data of [new FormData(), wrong])
        assert.equal(
          (await w.request("POST", "/media", data, w.a.token)).status,
          400,
        );
    },
  ],
  U07: [
    "私人图片的匿名及跨用户读取删除均拒绝",
    async (t) => {
      const w = await world(t),
        media = await w.upload();
      error(
        await w.request("GET", "/media/" + media.id),
        401,
        "UNAUTHENTICATED",
      );
      for (const method of ["GET", "DELETE"])
        error(
          await w.request(method, "/media/" + media.id, undefined, w.b.token),
          404,
          "NOT_FOUND",
        );
    },
  ],
  U08: [
    "仍被随笔引用的图片不能直接删除",
    async (t) => {
      const w = await world(t),
        media = await w.upload();
      await w.journal(await w.visit(), { mediaIds: [media.id] });
      error(
        await w.request("DELETE", "/media/" + media.id, undefined, w.a.token),
        409,
        "MEDIA_IN_USE",
      );
      await w.request("GET", "/media/" + media.id, undefined, w.a.token, 200);
    },
  ],
  U09: [
    "一篇最多9张且拒绝重复图片ID而不留下关联",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        ids = [];
      for (let i = 0; i < 10; i++) ids.push((await w.upload()).id);
      for (const mediaIds of [[ids[0], ids[0]], ids])
        assert.equal(
          (
            await w.request(
              "POST",
              "/journals",
              { visitedPlaceId: v.id, title: "图片", body: "正文", mediaIds },
              w.a.token,
            )
          ).status,
          400,
        );
      const j = await w.journal(v, { mediaIds: ids.slice(0, 9) });
      assert.deepEqual(j.mediaIds, ids.slice(0, 9));
      await w.call("DELETE", "/media/" + ids[9], undefined, 204);
    },
  ],
  U10: [
    "他人图片不能用于创建或替换本人随笔关联",
    async (t) => {
      const w = await world(t),
        foreign = await w.upload(image(), "image/png", "b.png", w.b),
        v = await w.visit(),
        j = await w.journal(v);
      error(
        await w.request(
          "POST",
          "/journals",
          {
            visitedPlaceId: v.id,
            title: "越权",
            body: "正文",
            mediaIds: [foreign.id],
          },
          w.a.token,
        ),
        404,
        "NOT_FOUND",
      );
      error(
        await w.request(
          "PATCH",
          "/journals/" + j.id,
          { mediaIds: [foreign.id] },
          w.a.token,
        ),
        404,
        "NOT_FOUND",
      );
      assert.deepEqual((await w.call("GET", "/journals/" + j.id)).mediaIds, []);
    },
  ],
  U11: [
    "图片顺序完整替换且解除关联后可以重新关联",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        a = await w.upload(),
        b = await w.upload(),
        first = await w.journal(v, { mediaIds: [a.id, b.id] });
      assert.deepEqual(
        (
          await w.call("PATCH", "/journals/" + first.id, {
            mediaIds: [b.id, a.id],
          })
        ).mediaIds,
        [b.id, a.id],
      );
      await w.call("PATCH", "/journals/" + first.id, { mediaIds: [b.id] });
      const second = await w.journal(v, { mediaIds: [a.id] });
      assert.deepEqual(second.mediaIds, [a.id]);
    },
  ],
  U12: [
    "上传写文件后数据库失败会补偿删除新文件",
    async (t) => {
      const w = await world(t);
      await w.upload();
      const before = files(w.mediaRoot);
      assert.ok(before > 0, "First verify that test storage is actually used");
      await w.failInsert("media_assets");
      const result = await w.upload(
        image(),
        "image/png",
        "rollback.png",
        w.a,
        500,
      );
      assert.equal(result.code, "INTERNAL_ERROR");
      assert.equal(
        files(w.mediaRoot),
        before,
        "Failed upload must not leave an orphan file in the configured test storage",
      );
    },
  ],
  U13: [
    "媒体元数据不包含服务器存储路径且文件名不能越界",
    async (t) => {
      const w = await world(t),
        media = await w.upload(image(), "image/png", "../../outside.png");
      for (const key of [
        "path",
        "storagePath",
        "absolutePath",
        "diskPath",
        "accessToken",
      ])
        assert.equal(media[key], undefined);
      assert.ok(!JSON.stringify(media).includes(w.mediaRoot));
      assert.ok(
        files(w.mediaRoot) > 0,
        "MEDIA_STORAGE_DIR must select the isolated test storage",
      );
      await w.request("GET", "/media/" + media.id, undefined, w.a.token, 200);
    },
  ],
  U14: [
    "并发关联同一图片只有一篇随笔可以成功",
    async (t) => {
      const w = await world(t),
        v = await w.visit(),
        media = await w.upload();
      const results = await Promise.all(
        ["甲", "乙"].map((title) =>
          w.request(
            "POST",
            "/journals",
            { visitedPlaceId: v.id, title, body: "正文", mediaIds: [media.id] },
            w.a.token,
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    },
  ],
  U15: [
    "未关联图片删除后无法再次读取",
    async (t) => {
      const w = await world(t),
        media = await w.upload();
      await w.call("DELETE", "/media/" + media.id, undefined, 204);
      error(
        await w.request("GET", "/media/" + media.id, undefined, w.a.token),
        404,
        "NOT_FOUND",
      );
    },
  ],
};
