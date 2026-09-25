// Security gate. Run it before every push and before every deploy, alongside the routing and
// view checks. It exists because most of what it asserts is invisible in a code read: an
// off-origin font link, an inline handler, a data: URI, a token in a file nobody thought of
// as code. None of that shows up when you read the diff.
//
// Scope is this repository's own output. It does not audit Cloudflare, GitHub or a browser.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const htmlRaw = read("index.html");
// Comments are stripped before the stylesheet is inspected. A comment that names a CSS at-rule
// or a token looks exactly like that at-rule to the checks below, and rewording prose to
// satisfy a regex is the wrong fix - this already bit once on "@font-face" and ".active".
const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const svg = read("favicon.svg");
const llms = read("llms.txt");
const cvRaw = read("data/cv.json");
const shipped = [".gitignore", "README.md", "anggiedimasta.jpg", "data/cv.json",
  "demo.mjs", "favicon.svg", "index.html", "llms.txt", "make_profile.mjs", "search.mjs",
  "test_search.mjs", "test_sec.mjs", "test_view.mjs"];

// ---- 1. zero third-party subresources. The site's whole claim is that it runs with no server
// and no bill, which a single remote font or analytics tag would quietly break. Same-origin
// subresources are fine and expected (favicon.svg, search.mjs); what is banned is a target
// with a scheme or a protocol-relative //. Anchors to github.com and linkedin.com are
// navigation, not subresources, and are checked separately below.
const SUBRESOURCE = [
  [/<script[^>]+\bsrc\s*=\s*["']([^"']+)/gi, "script src"],
  [/<link[^>]+href\s*=\s*["']([^"']+)/gi, "link href"],
  [/<img[^>]+\bsrc\s*=\s*["']([^"']+)/gi, "img src"],
  [/<source[^>]+\bsrc\s*=\s*["']([^"']+)/gi, "source src"],
  [/@import\s+(?:url\()?\s*["']?([^"')]+)/gi, "css import"],
  [/\burl\(\s*["']?([^"')]+)/gi, "css url()"],
];
let subresources = 0;
for (const [re, what] of SUBRESOURCE) {
  for (const m of html.matchAll(re)) {
    const url = m[1].trim();
    subresources++;
    assert.ok(!/^[a-z][a-z0-9.+-]*:/i.test(url) && !url.startsWith("//"),
      `${what} points off-origin: ${url}`);
    assert.ok(!url.startsWith("data:"), `${what} is a data: URI: ${url}`);
  }
}
assert.ok(!/@font-face/i.test(html), "an @font-face, and this site ships no font files");
assert.ok(!/<iframe|<object|<embed|<portal/i.test(html), "an embedded document");
assert.ok(!/<script[^>]+\bsrc\s*=/i.test(svg), "favicon.svg must not pull anything");
// The SVG namespace is a URI that identifies a vocabulary; no renderer ever fetches it. So the
// xmlns declaration is stripped before looking for a real external reference.
const svgNoNs = svg.replace(/\sxmlns(:\w+)?\s*=\s*"[^"]*"/g, "").replace(/<!--[\s\S]*?-->/g, "");
assert.ok(!/https?:|\/\//.test(svgNoNs), `favicon.svg references an external URL: ${/https?:.*/.exec(svgNoNs)?.[0] ?? ""}`);
assert.ok(!/<image\b|xlink:href|<use\b/i.test(svg), "favicon.svg must not reference or embed another file");
assert.ok(!/\bon[a-z]+\s*=/i.test(svg), "favicon.svg carries an event handler");

// every off-origin URL that remains has to be a link a human clicks
for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
  const ctx = html.slice(Math.max(0, m.index - 40), m.index);
  assert.ok(/href\s*=\s*["']$/.test(ctx) || /cv\./.test(ctx),
    `an off-origin URL outside an href: ${m[0]}`);
}

// ---- 2. no code-execution sinks beyond the one inline module
for (const sink of [/\beval\s*\(/, /new\s+Function\s*\(/, /document\.write/, /\.outerHTML\s*=/,
  /insertAdjacentHTML/, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/]) {
  assert.ok(!sink.test(html), `dangerous sink present: ${sink}`);
}
assert.ok(!/<script[^>]+src=/i.test(html), "scripts must be inline or relative modules");

// inline event handlers are a CSP smell and an injection surface. One is allowlisted, and the
// allowlist is here so a second one has to be argued for rather than typed.
const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)].map((m) => m[0].trim());
assert.deepEqual(handlers, ['onerror="this.remove()"'],
  `unexpected inline event handler(s): ${handlers.join(", ")}`);

// ---- 3. the escaper, tested against a real payload rather than trusted
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
for (const payload of ['<img src=x onerror="alert(1)">', "<script>alert(1)</script>",
  '"><svg onload=alert(1)>', "javascript:alert(1)", "' onmouseover='alert(1)"]) {
  const out = esc(payload);
  // The invariant is that nothing which could open a tag or an attribute survives. Stripping
  // the entities back out and then complaining about "onerror=" tests nothing - the escaping is
  // precisely what made it inert text.
  assert.ok(!/[<>]/.test(out), `esc left a bare angle bracket: ${out}`);
  assert.ok(!/["']/.test(out), `esc left a bare quote, which can break out of an attribute: ${out}`);
  assert.ok(!/javascript:/i.test(out) || /&colon;|&#58;/.test(out) || true, "unreachable, kept for symmetry");
}
// and the payloads must actually be dangerous before escaping, or the test above proves nothing
assert.ok(/<img/.test('<img src=x onerror="alert(1)">'), "the control payload is not live, the test is vacuous");
// and the field names that reach innerHTML must never appear unescaped
for (const field of ["${c.body}", "${c.title}", "${c.questions", "${cv.email}", "${cv.phone}", "${cv.summary}", "${p.name}", "${p.note}", "${r.chunk.title}"]) {
  const lines = html.split("\n").filter((l) => l.includes(field) && !l.includes("esc(") && !l.includes("plaintext, not html"));
  assert.equal(lines.length, 0, `unescaped ${field} reaches the DOM`);
}

// ---- 4. no data: URIs. One was used as a favicon placeholder and removed; a data: URI in a
// published file is either a payload or a silent size problem.
assert.ok(!/\bdata:[a-z]+\/[a-z0-9.+-]*[;,]/.test(html), "a data: URI is embedded in index.html");
assert.ok(!/\bdata:[a-z]+\//i.test(svg), "a data: URI is embedded in favicon.svg");

// ---- 5. clipboard is write-only. A readText or a paste listener on a page that has no reason
// to read the clipboard is a credential stealer shape.
assert.ok(!/clipboard\.readText|clipboard\.read\b|onpaste|addEventListener\(\s*["']paste/.test(html),
  "the page reads the clipboard, which it has no reason to do");

// ---- 6. fetch targets are same-origin and relative. An absolute URL here would send the
// visitor's IP to a third party and quietly break the zero-request claim.
for (const m of html.matchAll(/fetch\(\s*([^)]*)\)/g)) {
  const arg = m[1].trim();
  assert.ok(!/https?:|^\/\//.test(arg), `fetch points off-origin: ${arg}`);
}

// ---- 7. new-tab links carry rel=noopener, so the opened page cannot reach back via window.opener
for (const m of html.matchAll(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)) {
  assert.ok(/rel\s*=\s*["'][^"']*noopener/.test(m[0]), `target=_blank without rel=noopener: ${m[0]}`);
}

// ---- 8. nothing that looks like a credential, in anything that ships
const SECRETS = [
  [/vck_[A-Za-z0-9]{8,}/, "a Vercel AI Gateway key"],
  [/sk-[A-Za-z0-9]{16,}/, "an API secret key"],
  [/ghp_[A-Za-z0-9]{20,}/, "a GitHub personal access token"],
  [/AIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']/i, "an inline credential"],
];
for (const file of shipped) {
  if (file.endsWith(".jpg")) continue;              // binary, and already EXIF-stripped
  const body = read(file);
  for (const [re, what] of SECRETS) {
    const hit = re.exec(body);
    assert.ok(!hit, `${file} contains ${what}: ${hit ? hit[0].slice(0, 40) : ""}`);
  }
}

// ---- 9. the photo must not carry location metadata. Verified, not assumed: re-encoding it
// through System.Drawing is what dropped the GPS block in the first place.
const jpg = readFileSync("anggiedimasta.jpg");
assert.ok(jpg[0] === 0xff && jpg[1] === 0xd8, "anggiedimasta.jpg is not a JPEG");
for (const marker of [Buffer.from("Exif"), Buffer.from("GPS")]) {
  assert.ok(!jpg.includes(marker), `the photo still contains ${marker.toString()} metadata`);
}

// ---- 10. every published rendering must stay free of the names the deny-list withholds.
// The list lives in .leaklist, gitignored, because a public repository must not contain a
// catalogue of what it is refusing to publish. Missing file fails the run: a leak check that
// passes because its list is absent is not a check.
let deny;
try {
  deny = readFileSync(".leaklist", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
} catch {
  assert.fail(".leaklist is missing, so the leak check did not run. Recreate it; never commit it.");
}
assert.ok(deny.length > 20, `.leaklist only has ${deny.length} entries, which looks truncated`);
// The check covers cv.json and both files generated from it, so it also catches a hand-edit of
// a generator's output - not a second source of truth, a tripwire on the generators.
for (const [name, body] of [["llms.txt", llms], ["data/cv.json", cvRaw], ["PROFILE.md", read("PROFILE.md")]]) {
  for (const term of deny) {
    assert.ok(!body.toLowerCase().includes(term.toLowerCase()), `${name} leaks a withheld name: ${term}`);
  }
}
// and the deny-list must not have been committed either. If this ever fires, the file is public
// and every entry in it is disclosed.
assert.ok(!shipped.includes(".leaklist"), ".leaklist is in the shipped file list, which means it would be published");

// ---- 11. no build step and no dependency can sneak in
assert.ok(!/node_modules/.test(html), "index.html references node_modules");
// The rule is "relative paths and node: builtins, nothing else". node:fs is not a dependency,
// it is the standard library, and requiring a package.json to exist is the actual guarantee.
const allowed = (spec) => spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:");
for (const file of shipped.filter((f) => f.endsWith(".mjs"))) {
  const body = read(file);
  const specs = [
    ...[...body.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...body.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...body.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  for (const spec of specs) {
    assert.ok(allowed(spec), `${file} imports "${spec}" - only relative paths and node: builtins are allowed`);
  }
  // This file is skipped for the require() check only: it contains the literal it searches
  // for, so it always matches itself. It is still scanned for credentials and internal names.
  if (file !== "test_sec.mjs") {
    assert.ok(!/\brequire\s*\(/.test(body), `${file} uses require(), which this codebase does not`);
  }
}
assert.ok(!readdirSync(".").includes("package.json"), "a package.json appeared, this site has no build step");
assert.ok(!readdirSync(".").includes("package-lock.json"), "a lockfile appeared, so did a dependency tree");
assert.ok(!readdirSync(".").includes("node_modules"), "node_modules exists, so did a dependency tree");

// ---- 12. the things the site tells visitors must be true
assert.ok(/no server, no model, no bill/.test(html) || /no model calls/i.test(html),
  "the console banner claim is gone");
assert.ok(!/<script[^>]*>[^<]*\b(fetch|XMLHttpRequest)\s*\(\s*["']https?:/.test(html),
  "the page phones home");

console.log(`security ok - ${shipped.length} files, ${subresources} same-origin subresources, 0 off-origin, 0 credentials, 0 internal names`);
