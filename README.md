# anggiedimasta.dev

A personal site that is one FAQ plus a box. Every answer is a quote from
[`data/cv.json`](data/cv.json) — nothing is generated, so nothing can be invented.

No server, no model, no API key, no build step, no `node_modules`. Cloudflare Pages
serves the folder as-is, and the BM25 scorer runs in the visitor's browser.

The GitHub profile README is generated from the same JSON by `make_profile.mjs` and
lives in [`anggiedimasta/anggiedimasta`](https://github.com/anggiedimasta/anggiedimasta), so
the two cannot disagree.

## Files

| | |
|---|---|
| `data/cv.json` | **the site.** Every chunk, its keywords, and the questions it answers |
| `index.html` | layout + the ask box |
| `search.mjs` | tokenizer, Indonesian/English stemmer, BM25 |
| `llms.txt` | the page is JS-rendered, so this is what a crawler or an LLM reads instead |
| `favicon.svg` | the mark, sampled from its source path onto a 13×13 dot grid |
| `make_profile.mjs` | writes `PROFILE.md` for the profile repository |
| `test_search.mjs` | routing assertions + a check that no withheld internal name reached `cv.json` |
| `test_view.mjs` | the render contract, the palette contrast, and the layout contract |
| `test_sec.mjs` | the pre-push gate: no off-origin request, no credential, no dependency |
| `demo.mjs` | `node demo.mjs` to see what the scorer routes where |

## Run it

```sh
node test_search.mjs && node test_view.mjs && node test_sec.mjs   # all three must pass
python -m http.server 8099                   # then open localhost:8099
```

`file://` will not work — the browser blocks `fetch` on local files.

## Deploy

**GitHub, zero commands.** Push to `main`, then in Cloudflare Pages: *Create → Pages →
Connect to Git*, pick this repo, leave the build command empty and the output directory `/`.
Every push redeploys. You get a `*.pages.dev` URL immediately; attach the domain later by
adding one DNS record.

**Manual, if you'd rather not connect Git.**

```sh
npx wrangler login                              # once, opens a browser
npx wrangler pages deploy . --project-name anggiedimasta-dev
```

Wrangler is not installed and is not added to this project — `npx` fetches it on
demand and caches it outside the folder.

## Editing the CV

1. Edit `data/cv.json`. `id` is the key; `featured` lists the 5 shown at the top.
2. `node test_search.mjs` — it fails if a `featured` id is missing or a withheld internal
   name reached the published data.
3. `node make_profile.mjs` — regenerates `PROFILE.md`; copy it to the profile repository.
4. Push.

To route a new question to a chunk, add the words to that chunk's `keywords` — that
array is the manual synonym table the stemmer can't reach (`bikin`/`buat`,
`nulis`/`tulis`).

## Two files are deliberately not in this repository

- **`.leaklist`** — the deny-list the leak checks read at run time. It names the things
  this project refuses to publish, so committing it would publish exactly what it
  withholds. The checks fail loudly when it is absent, because a leak check that passes
  because its list is missing is not a check.
- **the source CV** — the PDF and the hand-made text extracts. `data/cv.json` is what ships.

## Not here, on purpose

- **A build step / minifier.** Minifying hides nothing: `data/cv.json` is the site and is
  readable by design. It would cost a `package.json` and a build command to obscure forty
  lines of readable code.
- **An embedding model.** `paraphrase-multilingual-MiniLM` is ~120 MB per first visit and
  needs a bundler. `keywords[]` covers the same synonyms for 0 KB.
- **A language model in the retrieval path.** Measured, not assumed: on twelve adversarial
  routing queries BM25 scored 9 and a hosted classifier 2. The classifier also lost on
  shipping grounds — its only endpoint sat at 32% uptime, and the free tier wanted a
  credit card. Re-check any provider with no key needed:
  `curl https://ai-gateway.vercel.sh/v1/models/typesafe-ai/jev/endpoints`
- **A backend.** Nothing to bill, so nothing can be billed.
