"""Compare a proof project with independent manual line/word annotations."""
import argparse
import json
import math
import statistics
from pathlib import Path


def error_summary(errors):
    if not errors:
        return {"count": 0, "medianMs": None, "p95Ms": None}
    ordered = sorted(errors)
    return {"count": len(errors), "medianMs": statistics.median(errors),
            "p95Ms": ordered[math.ceil(len(ordered) * .95) - 1]}


def evaluate(project, annotations):
    predicted = {line["id"]: line for line in project["lines"]}
    references = annotations["lines"]
    if not references:
        raise ValueError("At least one independently annotated line is required")
    ids = set()
    line_errors, word_errors = [], []
    timed, unscored_words = 0, 0
    for reference in references:
        identity = reference["id"]
        if identity in ids or identity not in predicted:
            raise ValueError("Duplicate or unknown reference line ID")
        ids.add(identity)
        actual = predicted[identity]
        if reference["text"] != actual["text"]:
            raise ValueError("Reference text differs from supplied lyrics")
        start, end = reference["startMs"], reference["endMs"]
        if not all(type(t) is int for t in (start, end)) or not 0 <= start < end <= project["durationMs"]:
            raise ValueError("Invalid reference timing")
        words = reference.get("words", [])
        previous = 0
        for word in words:
            a, b = word["startMs"], word["endMs"]
            if not all(type(t) is int for t in (a, b)) or not previous <= a < b <= end - start:
                raise ValueError("Invalid reference word timing")
            previous = b
        if words and "".join(w["text"] for w in words) != reference["text"]:
            raise ValueError("Reference words do not reconstruct lyric text")
        if actual["startMs"] is None:
            unscored_words += len(words)
            continue
        timed += 1
        line_errors.extend([abs(actual["startMs"] - start),
                            abs(actual["startMs"] + actual["durationMs"] - end)])
        if [w["text"] for w in actual["words"]] != [w["text"] for w in words]:
            unscored_words += len(words)
            continue
        for a, b in zip(actual["words"], words):
            # Compare absolute times so a shifted line does not hide word error.
            word_errors.extend(abs(actual["startMs"] + a[key] - start - b[key]) for key in ("startMs", "endMs"))
    return {"annotatedLines": len(references), "timedAnnotatedLines": timed,
            "matchedCoverage": timed / len(references), "unscoredReferenceWords": unscored_words,
            "lineBoundaryError": error_summary(line_errors), "wordBoundaryError": error_summary(word_errors),
            "scope": "Only independently annotated lines; not a full-corpus quality claim"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("annotations", type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.project.read_text(encoding="utf-8")),
                      json.loads(args.annotations.read_text(encoding="utf-8")))
    print(json.dumps(result, indent=2))
