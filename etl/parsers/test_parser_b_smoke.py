"""Smoke test for parser_b: run over every non-dual moguls PDF under the sample root.

Usage:
    python test_parser_b_smoke.py [sample_root]

Prints, per file: record count, distinct FIS codes vs meta num_competitors, and
any OK record that lacks run_score / turns_total / air_total / 5 base / 5 ded /
2 air jumps.  Exit code 1 when any file fails.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parser_b  # noqa: E402

DEFAULT_ROOT = r"D:\Claude\ジャッジ分析\全試合のリザルト"
META_KEYS = ("event", "round", "date", "start_time", "venue", "codex",
             "num_competitors", "pace_time", "course_length_m", "course_width_m",
             "gate_width_m", "gradient_deg")


def iter_pdfs(root):
    for dp, _dn, fn in os.walk(root):
        for f in sorted(fn):
            if f.lower().endswith(".pdf") and "デュアル" not in f:
                yield os.path.join(dp, f)


def check_record(rec):
    problems = []
    if rec["status"] != "OK":
        return problems
    for k in ("run_score", "turns_total", "air_total", "base_total", "ded_total",
              "seconds", "time_points"):
        if rec.get(k) is None:
            problems.append("missing %s" % k)
    if len(rec["base_scores"]) != 5:
        problems.append("base_scores=%d" % len(rec["base_scores"]))
    if len(rec["ded_scores"]) != 5:
        problems.append("ded_scores=%d" % len(rec["ded_scores"]))
    if len(rec["air_jumps"]) != 2:
        problems.append("air_jumps=%d" % len(rec["air_jumps"]))
    if rec["q_block"] is not None and rec["counting"] and rec["best_score"] is None:
        problems.append("missing best_score")
    return problems


def main(root):
    total_files = 0
    failed = 0
    for path in iter_pdfs(root):
        total_files += 1
        rel = os.path.relpath(path, root)
        try:
            meta, records = parser_b.parse_moguls_results(path)
        except Exception as e:  # noqa: BLE001
            print("FAIL %s: exception %r" % (rel, e))
            failed += 1
            continue
        codes = {r["fis_code"] for r in records}
        n = meta.get("num_competitors")
        ok = (n is not None and len(codes) == n)
        issues = []
        for r in records:
            p = check_record(r)
            if p:
                issues.append("  %s bib=%s %s: %s" % (r["fis_code"], r["bib"], r["name"], ", ".join(p)))
        missing_meta = [k for k in META_KEYS if meta.get(k) is None]
        if len(meta["judges"]) != 7:
            missing_meta.append("judges=%d" % len(meta["judges"]))
        status = "OK  " if ok and not issues and not meta["unparsed_lines"] and not missing_meta else "FAIL"
        if status == "FAIL":
            failed += 1
        print("%s %s: records=%d distinct_codes=%d num_competitors=%s" % (status, rel, len(records), len(codes), n))
        for i in issues:
            print(i)
        for pno, line in meta["unparsed_lines"]:
            print("  unparsed p%s: %s" % (pno, line))
        for w in meta["warnings"]:
            print("  warn p%s: %s | %s" % w)
        if missing_meta:
            print("  meta missing: %s" % ", ".join(missing_meta))
    print("\n%d files, %d failed" % (total_files, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT))
