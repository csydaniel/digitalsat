# Mortar & Pestle SAT

Static site. No build step, no server, no framework. Vercel serves it as-is.

## Repo layout

```
mortar-and-pestle-sat/
├── index.html              ← entry point, must sit at the repo root
├── assets/
│   ├── styles.css
│   └── app.js              ← all logic; edit TOKENS near the top
├── data/
│   └── bank.json           ← the question bank the app reads at load
├── images/                 ← figures referenced by bank.json (ImagePath)
│   ├── Q-0043.png
│   └── ...
├── tools/
│   └── build_bank.py       ← out/questions.tsv → data/bank.json
└── README.md
```

The parser's `in/` and `out/` folders do **not** belong in this repo. Keep them
on your Mac. `out/questions.tsv` is 30–40 MB and the browser should never see it.

## Getting the bank in

From the repo root, with the parser output alongside:

```bash
python3 tools/build_bank.py --tsv ~/Desktop/PDFQDB/out/questions.tsv
cp -R ~/Desktop/PDFQDB/Images/ ./images/
git add data/bank.json images
git commit -m "bank: 607 questions"
git push
```

The converter keeps only the columns the runtime reads and rewrites `ImagePath`
to `./images/<file>`. Everything else stays in the TSV.

`data/bank.json` currently holds 10 hand-written sample questions so the site
works before you push the real bank. Running the converter overwrites them.

## Deploying

1. `git init`, commit, push to a GitHub repo.
2. Vercel → Add New → Project → import the repo.
3. Framework preset: **Other**. Build command: none. Output directory: `./`.
4. Deploy.

Because everything is relative (`./assets/...`, `./data/bank.json`), it works
identically at a custom domain, a preview URL, or opened over `file://` — except
`file://` blocks `fetch`, so the bank won't load locally that way. To test
locally run `python3 -m http.server 8000` and open `localhost:8000`.

## Tokens

`assets/app.js`, near the top:

```js
var TOKENS = ['MP-DEMO-0001', 'MP-DEMO-0002', ...];
```

Replace with your own list, one per friend. A token is checked against the list
and then recorded as redeemed **in that browser**, so it can't be reused on the
same machine. Genuine one-shot-globally isn't possible client-side — for that
the redemption list has to live behind a serverless function. Say the word and
that's a twenty-line addition.

Tokens are visible to anyone who reads the JS. That's fine for a handful of
friends; it is not access control.

## Storage

Everything the user generates lives in `localStorage` under the `mp.v1.` prefix:

| Key | Contents |
|---|---|
| `mp.v1.profile` | name, baseline score, exam date, token, device id |
| `mp.v1.attempts` | append-only array; every analytics number is a reduction over this |
| `mp.v1.sessions` | one row per finished session |
| `mp.v1.collections` | custom sets; `redemption` is built in and auto-fills on every miss |
| `mp.v1.notes` | personal notes, tagged General or by question type |
| `mp.v1.vocab` | word, part of speech, common definition, tested sense, your notes |

An attempt row:

```json
{ "id":"a_...", "qid":"Q-0417", "sessionId":"s_...", "mode":"timed",
  "type":"Transitions", "domain":"Expression of Ideas", "difficulty":"H",
  "selected":"C", "correct":false, "seconds":112,
  "flagged":true, "flagReason":"Misread question", "collections":["redemption"],
  "ts":1785568216975 }
```

No derived values are stored. L10/L20/L50/OVR, the trend chart, pace per type
and the error and flag logs are all computed from `attempts` on render, so
nothing can drift out of sync.

Footer has **Export data** (JSON download) and **Reset**. Tell your friends to
export before clearing their cache.

## Question types

Thirteen, derived from prompt wording first and the bank's `Skill` column as
fallback (`normaliseType` in `app.js`):

- **Information and Ideas** — Central idea, Detail retrieval, Inference, Textual evidence, Quantitative evidence
- **Craft and Structure** — Words in context, Text structure, Function of underlined portion, Purpose of the text, Cross-text connections
- **Expression of Ideas** — Transitions, Rhetorical synthesis
- **Standard English Conventions** — Boundaries & form

If the classifier mislabels items once the real bank is in, fix the regexes in
`normaliseType` rather than editing the TSV.

## Not built

- **Transition bank** — placeholder panel, waiting on your content.
- **Score prediction** — deliberately absent until there's a Bluebook anchor to calibrate against.
- **Spaced repetition** — Redemption is the v1 stand-in; a Leitner box field on the attempt row is the upgrade path.
- **Cross-device sync** — everything is per-browser by design.
