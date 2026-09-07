/**
 * One origin, every door. The client half of the content plane derives each
 * URL from the origin the bridge reports, in rig's route grammar — so a
 * target that implements `contentOrigin()` inherits every route, and the
 * citation grammar the documents ability emits resolves only against digests
 * the view already holds, exactly one of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configUrl, ingressUrl, manifestUrl, parseAttachmentHref, representationUrl, resolvePrefix, sourceUrl,
} from "../../targets/_shared/content-urls.js";

const DIGEST = "sha256:" + "a1b2c3d4e5f6".padEnd(64, "0");

test("every door derives from one origin and matches the route grammar", () => {
  const origin = "http://host:8787";
  assert.equal(ingressUrl(origin), "http://host:8787/v1/media/ingress");
  assert.equal(manifestUrl(origin, DIGEST), `http://host:8787/v1/media/${encodeURIComponent(DIGEST)}`);
  assert.equal(configUrl(origin, DIGEST), `http://host:8787/v1/media/${encodeURIComponent(DIGEST)}/config`);
  assert.equal(representationUrl(origin, DIGEST), `http://host:8787/v1/media/${encodeURIComponent(DIGEST)}/representations/0`);
  assert.equal(representationUrl(origin, DIGEST, 2), `http://host:8787/v1/media/${encodeURIComponent(DIGEST)}/representations/2`);
  assert.equal(sourceUrl(origin, DIGEST), `http://host:8787/v1/media/${encodeURIComponent(DIGEST)}/source`);
  // The relative origin (dev proxy) is the empty string, and stays same-origin.
  assert.equal(ingressUrl(""), "/v1/media/ingress");
  for (const url of [manifestUrl(origin, DIGEST), configUrl(origin, DIGEST), sourceUrl(origin, DIGEST), representationUrl(origin, DIGEST, 1)]) {
    assert.match(url, /^http:\/\/host:8787\/v1\/media\/sha256%3A[0-9a-f]{64}(\/config|\/source|\/representations\/\d+)?$/);
  }
});

test("the citation grammar: a hex prefix and a page, nothing else", () => {
  assert.deepEqual(parseAttachmentHref("attachment://a1b2c3d4e5f6/page/7"), { prefix: "a1b2c3d4e5f6", page: 7 });
  assert.deepEqual(parseAttachmentHref("attachment://A1B2C3D4E5F6/page/1"), { prefix: "a1b2c3d4e5f6", page: 1 });
  assert.equal(parseAttachmentHref("attachment://not-hex/page/7"), null);
  assert.equal(parseAttachmentHref("attachment://a1b2c3d4e5f6/page/"), null);
  assert.equal(parseAttachmentHref("attachment://a1b2c3d4e5f6"), null);
  assert.equal(parseAttachmentHref("https://example.com/attachment://a1b2c3d4e5f6/page/7"), null);
});

test("a prefix resolves to exactly one digest the view holds, or to nothing", () => {
  const other = "sha256:" + "a1b2c3d4e5f6".padEnd(64, "1");
  assert.equal(resolvePrefix("a1b2c3d4e5f6", [DIGEST]), DIGEST);
  assert.equal(resolvePrefix("a1b2c3d4e5f6", [DIGEST, other]), null, "two matches is no answer");
  assert.equal(resolvePrefix("a1b2c3d4e5f6", []), null);
  assert.equal(resolvePrefix("ffffff", [DIGEST]), null);
});
