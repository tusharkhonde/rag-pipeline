import unittest

from metrics import cosine, hit_at_k, is_relevant, percentile, phrase_coverage, precision_at_k, reciprocal_rank

ITEM = {"expected_doc": "runbook.md", "expected_phrases": ["72 hours", "7 days"]}


class RelevanceTest(unittest.TestCase):
    def test_requires_expected_doc_and_a_phrase(self):
        self.assertTrue(is_relevant({"filename": "runbook.md", "content": "Kept for 72\n hours."}, ITEM))
        self.assertFalse(is_relevant({"filename": "runbook.md", "content": "Unrelated section."}, ITEM))
        self.assertFalse(is_relevant({"filename": "faq.txt", "content": "72 hours"}, ITEM))


class RankingMetricsTest(unittest.TestCase):
    def test_precision_hit_and_rr(self):
        rels = [False, True, False, False, True]
        self.assertAlmostEqual(precision_at_k(rels, 5), 0.4)
        self.assertAlmostEqual(precision_at_k(rels, 1), 0.0)
        self.assertEqual(hit_at_k(rels, 1), 0.0)
        self.assertEqual(hit_at_k(rels, 2), 1.0)
        self.assertAlmostEqual(reciprocal_rank(rels), 0.5)
        self.assertEqual(reciprocal_rank([False] * 5), 0.0)

    def test_precision_counts_missing_positions_as_misses(self):
        self.assertAlmostEqual(precision_at_k([True], 5), 0.2)


class AnswerMetricsTest(unittest.TestCase):
    def test_phrase_coverage(self):
        self.assertAlmostEqual(phrase_coverage("Messages are kept 72 hours.", ITEM["expected_phrases"]), 0.5)
        self.assertEqual(phrase_coverage("anything", []), 0.0)

    def test_cosine_and_percentile(self):
        self.assertAlmostEqual(cosine([1, 0], [1, 0]), 1.0)
        self.assertAlmostEqual(cosine([1, 0], [0, 1]), 0.0)
        self.assertEqual(percentile([5, 1, 3, 2, 4], 50), 3)
        self.assertEqual(percentile([5, 1, 3, 2, 4], 95), 5)
        self.assertIsNone(percentile([], 50))


if __name__ == "__main__":
    unittest.main()
