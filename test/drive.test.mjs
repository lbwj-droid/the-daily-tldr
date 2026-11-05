// The Drive uploads folder: link parsing, the folder check, and the image and Doc endpoints against a fake Drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveFileId, cleanDocHtml, FOLDER } from "../lib/drive.mjs";

const IMG = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const DOCID = "1DocDocDocDocDocDocDocDocDocDocDoc0";
const OUTSIDE = "1OutsideOutsideOutsideOutside00000";
const SUB = "1SubfolderSubfolderSubfolder000000";

test("Drive and Docs links give their file id", () => {
  assert.equal(driveFileId(`https://drive.google.com/file/d/${IMG}/view?usp=sharing`), IMG);
  assert.equal(driveFileId(`https://drive.google.com/open?id=${IMG}`), IMG);
  assert.equal(driveFileId(`https://drive.google.com/uc?export=view&id=${IMG}`), IMG);
  assert.equal(driveFileId(`https://docs.google.com/document/d/${DOCID}/edit?usp=drivesdk`), DOCID);
  assert.equal(driveFileId("https://www.youtube.com/watch?v=abc"), "");
  assert.equal(driveFileId("not a link"), "");
});

test("a Doc's exported HTML is reduced to plain, safe tags", () => {
  const html = `<html><head><style>.c1{color:red}</style></head><body class="c5"><p class="c2"><span style="font-weight:700">Bold</span> and <span style="font-style:italic">italic</span></p><p></p><script>alert(1)</script><p><a href="https://www.google.com/url?q=https://scroll.in/x&amp;sa=D">a link</a> <a href="javascript:alert(1)">bad</a></p><img src="https://lh7.googleusercontent.com/abc" style="width:100px"><h2 id="h.1">Heading</h2></body></html>`;
  const out = cleanDocHtml(html);
  assert.equal(out, `<p><b>Bold</b> and <i>italic</i></p><p><a href="https://scroll.in/x" target="_blank" rel="noopener">a link</a> <a>bad</a></p><img src="https://lh7.googleusercontent.com/abc" alt="" loading="lazy" referrerpolicy="no-referrer"><h2>Heading</h2>`);
});

// A fake Drive: the uploads folder holds an image and a subfolder with a Doc; another file sits outside it.
function fakeDrive() {
  const files = {
    [IMG]: { id: IMG, name: "protest.jpg", mimeType: "image/jpeg", parents: [FOLDER], size: "5000000", thumbnailLink: `https://lh3.googleusercontent.com/thumb=s220` },
    [SUB]: { id: SUB, mimeType: "application/vnd.google-apps.folder", parents: [FOLDER] },
    [DOCID]: { id: DOCID, name: "Primer 1: what an LLM is", mimeType: "application/vnd.google-apps.document", parents: [SUB] },
    [OUTSIDE]: { id: OUTSIDE, name: "private.jpg", mimeType: "image/jpeg", parents: ["0Root"] },
  };
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.startsWith("https://lh3.googleusercontent.com/")) return new Response(Buffer.from("small-jpeg"), { headers: { "content-type": "image/jpeg" } });
    const id = u.split("/files/")[1]?.split(/[/?]/)[0];
    if (u.includes("/export?")) return new Response(`<html><body><p>Large language models <span style="font-weight:700">predict</span> the next word.</p></body></html>`);
    if (!files[id]) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(files[id]), { headers: { "content-type": "application/json" } });
  };
  process.env.SHEET_ID = "sheet-1";
  process.env.GOOGLE_SA_KEY = "{}";
  process.env.SHEETS_TEST_TOKEN = "t";
  return seen;
}
const fakeRes = () => {
  const r = { code: 0, headers: {}, body: undefined, location: "" };
  r.status = (c) => ((r.code = c), r);
  r.setHeader = (k, v) => (r.headers[k.toLowerCase()] = v);
  r.send = (b) => ((r.body = b), r);
  r.end = () => r;
  r.redirect = (c, l) => ((r.code = c), (r.location = l), r);
  return r;
};

test("/api/media serves images from the uploads folder only, resized by Drive", async () => {
  const real = globalThis.fetch;
  try {
    const seen = fakeDrive();
    const { default: media } = await import("../api/media.js");
    const ok = fakeRes();
    await media({ query: { id: IMG } }, ok);
    assert.equal(ok.code, 200);
    assert.equal(String(ok.body), "small-jpeg");
    assert.ok(seen.some((u) => u.endsWith("=s1600")), "asks Drive for the 1600px copy");
    const outside = fakeRes();
    await media({ query: { id: OUTSIDE } }, outside);
    assert.equal(outside.code, 404, "a file outside the folder is refused");
    const doc = fakeRes();
    await media({ query: { id: DOCID } }, doc);
    assert.equal(doc.code, 404, "a Doc is not an image");
  } finally {
    globalThis.fetch = real;
    for (const k of ["SHEET_ID", "GOOGLE_SA_KEY", "SHEETS_TEST_TOKEN"]) delete process.env[k];
  }
});

test("/p/<id> shows a Doc from a folder inside the uploads folder; other Docs open on Google", async () => {
  const real = globalThis.fetch;
  try {
    fakeDrive();
    const { default: doc } = await import("../api/doc.js");
    const ok = fakeRes();
    await doc({ query: { id: DOCID } }, ok);
    assert.equal(ok.code, 200);
    assert.match(ok.body, /<h1>Primer 1: what an LLM is<\/h1>/);
    assert.match(ok.body, /Large language models <b>predict<\/b> the next word/);
    const elsewhere = fakeRes();
    await doc({ query: { id: "1NotSharedWithTheRobotAtAll0000000" } }, elsewhere);
    assert.equal(elsewhere.code, 302);
    assert.equal(elsewhere.location, "https://docs.google.com/document/d/1NotSharedWithTheRobotAtAll0000000/view");
  } finally {
    globalThis.fetch = real;
    for (const k of ["SHEET_ID", "GOOGLE_SA_KEY", "SHEETS_TEST_TOKEN"]) delete process.env[k];
  }
});
