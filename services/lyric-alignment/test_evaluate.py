import unittest
from evaluate import evaluate


class EvaluationTest(unittest.TestCase):
    def test_absolute_boundary_errors_include_line_offset(self):
        project = {"durationMs": 5000, "lines": [{"id": "one", "text": "Sing",
            "startMs": 1100, "durationMs": 900, "words": [{"text": "Sing", "startMs": 0, "endMs": 900}]}]}
        annotations = {"lines": [{"id": "one", "text": "Sing", "startMs": 1000, "endMs": 2000,
                                 "words": [{"text": "Sing", "startMs": 0, "endMs": 1000}]}]}
        result = evaluate(project, annotations)
        self.assertEqual(result["lineBoundaryError"], {"count": 2, "medianMs": 50, "p95Ms": 100})
        self.assertEqual(result["wordBoundaryError"], result["lineBoundaryError"])

    def test_unmatched_lines_lower_coverage_without_invented_errors(self):
        project = {"durationMs": 5000, "lines": [{"id": "one", "text": "Missing",
                   "startMs": None, "durationMs": None, "words": []}]}
        result = evaluate(project, {"lines": [{"id": "one", "text": "Missing", "startMs": 1000, "endMs": 2000}]})
        self.assertEqual(result["matchedCoverage"], 0)
        self.assertIsNone(result["lineBoundaryError"]["medianMs"])

    def test_empty_reference_cannot_claim_accuracy(self):
        with self.assertRaises(ValueError):
            evaluate({"lines": []}, {"lines": []})

    def test_unknown_reference_id_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate({"lines": []}, {"lines": [{"id": "missing"}]})
