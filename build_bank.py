#!/usr/bin/env python3
"""
build_bank.py — turn the parser's out/questions.tsv into data/bank.json

Usage, from the repo root:
    python3 tools/build_bank.py

Optional:
    python3 tools/build_bank.py --tsv out/questions.tsv --out data/bank.json

Only the columns the app actually reads are carried over, which is what keeps
bank.json small enough to ship. Everything else stays in the TSV.
"""
import argparse, csv, json, os, sys

csv.field_size_limit(10 ** 8)

# Columns the runtime consumes. Anything not listed is dropped.
KEEP = [
    "QuestionID",
    "PassageText", "PromptText",
    "OptionA", "OptionB", "OptionC", "OptionD",
    "CorrectAnswer",
    "Difficulty", "Domain", "Skill", "QuestionType",
    "QuestionHTML", "FigureHTML", "TableHTML", "ImagePath",
    "RationaleCorrect", "WhyNotA", "WhyNotB", "WhyNotC", "WhyNotD",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", default="out/questions.tsv")
    ap.add_argument("--out", default="data/bank.json")
    ap.add_argument("--pretty", action="store_true", help="indent the JSON (bigger file)")
    a = ap.parse_args()

    if not os.path.exists(a.tsv):
        sys.exit(f"not found: {a.tsv}\nRun the parser first, or pass --tsv")

    with open(a.tsv, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))

    out, skipped = [], 0
    for r in rows:
        if not r.get("QuestionID") or not r.get("OptionA"):
            skipped += 1
            continue
        ans = (r.get("CorrectAnswer") or "").strip().upper()[:1]
        if ans not in "ABCD":
            skipped += 1
            continue
        rec = {k: (r.get(k) or "").strip() for k in KEEP}
        # relative path the browser can resolve from the repo root
        if rec["ImagePath"]:
            rec["ImagePath"] = "./images/" + os.path.basename(rec["ImagePath"])
        out.append(rec)

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1 if a.pretty else None)

    size = os.path.getsize(a.out) / 1_048_576
    print(f"wrote {len(out)} questions -> {a.out}  ({size:.1f} MB)")
    if skipped:
        print(f"skipped {skipped} rows (missing ID, options, or answer key)")

    have_img = sum(1 for r in out if r["ImagePath"])
    if have_img:
        print(f"{have_img} questions reference an image — copy the parser's Images/ folder to ./images/")


if __name__ == "__main__":
    main()
