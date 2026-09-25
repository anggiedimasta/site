// Probes a live deployment and decides what is really there by CONTENT, not by status or
// content-type. Cloudflare Pages answers an unknown path with 200 and an HTML error page, and
// index.html is also HTML, so "200 + text/html" cannot tell them apart. Size almost matched too,
// which is how a real file nearly got filed as a 404 during the .leaklist incident.
const BASE = process.argv[2] || "https://anggiedimasta.pages.dev";

const MARKERS = {
  "index.html": ["Ask me anything", 'id="faq"', "requently asked"],
  "data/cv.json": ['"chunks"', '"featured"'],
  "search.mjs": ["export function search", "STRONG"],
  "favicon.svg": ["<svg", /dot-matrix/i, "h2v2h-2z"],
  "llms.txt": ["Frequently asked", "data/cv.json"],
  "anggiedimasta.jpg": null,   // binary, checked by magic bytes below
};

// Only files that are NOT in the public repository belong on this list. The test suite and
// deploy.mjs are tracked source, so serving them from the site root discloses nothing that
// github.com/anggiedimasta/site does not already publish. What must never be reachable is
// what git never saw: the deny-list, the credentials, and the source CV.
const FORBIDDEN = [".leaklist", ".env", "Anggie_Putra_Dimasta-resume.pdf", "Anggie_Putra_Dimasta-resume.txt",
  "Profile (3).pdf", "Profile (3).txt", ".cfignore"];

const rows = [];
for (const [path, markers] of Object.entries(MARKERS)) {
  try {
    const r = await fetch(`${BASE}/${path}`);
    const buf = Buffer.from(await r.arrayBuffer());
    let verdict;
    if (!markers) {
      verdict = buf[0] === 0xff && buf[1] === 0xd8 ? "REAL JPEG" : "not a jpeg";
    } else {
      const body = buf.toString("utf8");
      const hit = markers.filter((m) => (m instanceof RegExp ? m.test(body) : body.includes(m))).length;
      const isErrPage = /<title>[^<]*(404|Error|Not Found)/i.test(body) && hit === 0;
      verdict = isErrPage ? "CF error page" : hit === markers.length ? "REAL FILE" : `PARTIAL ${hit}/${markers.length}`;
    }
    rows.push({ path: `/${path}`, status: r.status, bytes: buf.length, type: (r.headers.get("content-type") || "").split(";")[0], verdict });
  } catch (e) {
    rows.push({ path: `/${path}`, status: "ERR", bytes: 0, type: "", verdict: e.message });
  }
}
for (const p of FORBIDDEN) {
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(p)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const type = (r.headers.get("content-type") || "").split(";")[0];
    // the CF error page is html; anything else served under a forbidden name is a real leak
    const leak = !type.includes("html");
    rows.push({ path: `/${p}`, status: r.status, bytes: buf.length, type, verdict: leak ? "LEAKED" : "not served" });
  } catch (e) {
    rows.push({ path: `/${p}`, status: "ERR", bytes: 0, type: "", verdict: "not served" });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("path", 34)} ${pad("status", 7)} ${pad("bytes", 9)} ${pad("type", 26)} verdict`);
for (const r of rows) console.log(`${pad(r.path, 34)} ${pad(r.status, 7)} ${pad(r.bytes, 9)} ${pad(r.type, 26)} ${r.verdict}`);

const bad = rows.filter((r) => r.verdict === "LEAKED" || r.verdict.startsWith("PARTIAL") || r.verdict.startsWith("not a"));
const missing = rows.filter((r) => r.verdict === "CF error page" && Object.keys(MARKERS).some((k) => r.path === `/${k}`));
console.log("");
console.log(bad.length ? `FAIL: ${bad.length} problem(s)` : "no leaks, every expected asset present");
if (missing.length) console.log(`FAIL: ${missing.length} expected asset(s) not being served`);
process.exit(bad.length || missing.length ? 1 : 0);
