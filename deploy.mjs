// Deploys to Cloudflare Pages from a staging directory built out of `git ls-files`.
//
//   node deploy.mjs                      # production, from main
//   node deploy.mjs --preview my-branch  # a preview deployment
//
// Why this file exists, and why it is not a one-liner in the README:
//
//   wrangler pages deploy .  uploads the WORKING DIRECTORY. It does not read .gitignore,
//   and wrangler 4.141 has no ignore option for pages deploy at all - .cfignore is silently
//   ignored. So a plain `deploy .` publishes every untracked file in the folder, which
//   here means the source CV (a 425 KB PDF), two hand-made text extracts, and .leaklist,
//   which is the deny-list naming the things this project refuses to publish. That happened,
//   and the CV was reachable from a public pages.dev URL until the project was deleted.
//
// Deleting a deployment does not help either: the assets live on the project, so a stale
// copy keeps being served. The project itself has to be recreated.
//
// So the deploy path is a directory that can only contain tracked files. This script builds
// it, hands it to wrangler, and throws away what it staged. There is no way to run the
// unsafe command by accident, because the staging directory is the argument and the working
// directory is not.
//
// Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const branch = args.includes("--preview") ? args[args.indexOf("--preview") + 1] : "main";
const project = process.env.PAGES_PROJECT || "anggiedimasta";

for (const v of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  if (!process.env[v]) {
    console.error(`${v} is not set. Create a token at dash.cloudflare.com/profile/api-tokens and export both.`);
    process.exit(1);
  }
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean);

// The staging directory is the whole point, so it is worth being loud about what lands in it.
console.log(`staging ${tracked.length} tracked files for ${project} (${branch})`);
for (const f of tracked) console.log(`  ${f}`);

const stage = mkdtempSync(join(tmpdir(), "pages-deploy-"));
try {
  for (const f of tracked) {
    const dst = join(stage, f);
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(f, dst);
  }
  const staged = [];
  (function walk(d, p = "") {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), p ? `${p}/${e.name}` : e.name);
      else staged.push(p ? `${p}/${e.name}` : e.name);
    }
  })(stage);
  if (staged.length !== tracked.length) {
    console.error(`staged ${staged.length} files but git listed ${tracked.length}. Aborting.`);
    process.exit(1);
  }
  console.log(`\nverified ${staged.length} files, none untracked. running wrangler...\n`);
  execFileSync("npx", ["--yes", "wrangler", "pages", "deploy", stage,
    "--project-name", project, "--branch", branch], { stdio: "inherit" });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
