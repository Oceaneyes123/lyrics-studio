import unittest
import tempfile
import wave
from pathlib import Path
from unittest.mock import patch

from lyric_align import AlignedLine, Segment, Word
from align import map_lines, split_sentences, peak_memory_bytes


class AlignmentContractTest(unittest.TestCase):
    def test_peak_memory_reports_current_worker_or_unavailable_platform(self):
        import sys
        peak = peak_memory_bytes()
        if sys.platform == "win32":
            self.assertGreater(peak, 1024 * 1024)
        else:
            self.assertIsNone(peak)

    def test_sentence_split_reuses_word_times_and_preserves_remainders(self):
        words = [Word(1, 2, "Hello."), Word(3, 4, " Again!"), Word(5, 6, " Last")]
        result = split_sentences([Segment(1, 6, "Hello. Again! Last", words)])
        self.assertEqual([(s.start, s.end) for s in result], [(1, 2), (3, 4), (5, 6)])
        self.assertEqual([w for s in result for w in s.words], words)

    def test_coarse_transcription_exceeding_pairing_cap_matches_each_sentence(self):
        words = [Word(i, i + 1, text) for i, text in enumerate(["Red.", " Blue.", " Green.", " Gold."], 1)]
        lines = map_lines("Red.\nBlue.\nGreen.\nGold.", [Segment(1, 5, "Red. Blue. Green. Gold.", words)], 6000)
        self.assertEqual([l["startMs"] for l in lines], [1000, 2000, 3000, 4000])

    def test_merged_lines_do_not_require_punctuation_or_pairing_ratio(self):
        segments = [Segment(1, 9, "You look red I look green", [
            Word(1, 2, "You"), Word(2, 3, "look"), Word(3, 4, "red"),
            Word(6, 7, "I"), Word(7, 8, "look"), Word(8, 9, "green")])]
        lines = map_lines("You look red\nI look green", segments, 10000)
        self.assertEqual([(l["startMs"], l["durationMs"]) for l in lines], [(1000, 3000), (6000, 3000)])
        self.assertTrue(all(l["words"] for l in lines))

    def test_karaoke_uses_word_bounds_including_pauses_and_unequal_lengths(self):
        segment = Segment(0, 10, "Wonderful I", [Word(1, 2, "Wonderful"), Word(5, 8, "I")])
        line = map_lines("Wonderful I", [segment], 10000)[0]
        self.assertEqual((line["startMs"], line["durationMs"]), (1000, 7000))
        self.assertEqual(line["words"], [{"text": "Wonderful ", "startMs": 0, "endMs": 1000},
                                         {"text": "I", "startMs": 4000, "endMs": 7000}])

    def test_missing_backing_words_are_not_squeezed_into_lead_vocal(self):
        segment = Segment(1, 4, "Hey there Mr Apple", [Word(i, i + .5, token)
                          for i, token in enumerate(["Hey", "there", "Mr.", "Apple"], 1)])
        line = map_lines("Hey there Mr Apple (Hello hello)", [segment], 10000)[0]
        self.assertEqual(line["startMs"], 1000)
        self.assertEqual(line["durationMs"], 3500)
        self.assertEqual(line["words"], [])
        self.assertIn("lack reliable", line["reason"])

    def test_extra_recognized_words_do_not_block_later_lyrics(self):
        tokens = ["Sing", "again"] + ["noise"] * 10 + ["Bye", "bye", "bye"]
        segment = Segment(0, len(tokens), " ".join(tokens),
                          [Word(i, i + 1, token) for i, token in enumerate(tokens)])
        lines = map_lines("Sing again\nBye bye bye", [segment], 20000)
        self.assertEqual([l["startMs"] for l in lines], [0, 12000])

    def test_case_punctuation_and_mister_match_without_changing_supplied_text(self):
        segment = Segment(1, 3, "MR. APPLE", [Word(1, 2, "MR."), Word(2, 3, "APPLE")])
        line = map_lines("Mister Apple!", [segment], 4000)[0]
        self.assertEqual([w["text"] for w in line["words"]], ["Mister ", "Apple!"])

    def test_long_repeated_choruses_keep_their_occurrence_order(self):
        tokens = ["Hi", "hello"] * 110
        segment = Segment(0, 220, " ".join(tokens), [Word(i, i + 1, token) for i, token in enumerate(tokens)])
        lines = map_lines("\n".join(["Hi hello"] * 110), [segment], 220000)
        self.assertEqual([l["startMs"] for l in lines], list(range(0, 220000, 2000)))

    def test_zero_duration_word_requires_review_without_inventing_word_times(self):
        segment = Segment(1, 2, "Happy dance", [Word(1, 1, "Happy"), Word(1, 2, "dance")])
        line = map_lines("Happy dance", [segment], 3000)[0]
        self.assertEqual((line["startMs"], line["durationMs"]), (1000, 1000))
        self.assertEqual(line["words"], [])
        self.assertIn("reason", line)

    def test_one_shared_word_does_not_place_an_unrecognized_phrase(self):
        segment = Segment(1, 2, "hello", [Word(1, 2, "hello")])
        line = map_lines("Missing hello", [segment], 3000)[0]
        self.assertEqual(line["status"], "unmatched")
        self.assertIsNone(line["startMs"])

    def test_cjk_keeps_character_matching(self):
        segment = Segment(1, 3, "你好世界", [Word(1, 2, "你好"), Word(2, 3, "世界")])
        line = map_lines("你好世界", [segment], 4000)[0]
        self.assertEqual(line["startMs"], 1000)
        self.assertEqual("".join(word["text"] for word in line["words"]), "你好世界")

    def test_sentence_split_preserves_segment_without_word_times(self):
        segment = Segment(1, 2, "Hello.", [])
        self.assertEqual(split_sentences([segment]), [segment])

    def test_section_headers_are_not_sung_but_repeated_lyrics_remain(self):
        segments = [Segment(start, start + 2, "Sing again", [
            Word(start, start + 1, "Sing"), Word(start + 1, start + 2, "again")
        ]) for start in (1, 5)]
        lines = map_lines("[Chorus]\nSing again\n\n[Final Chorus]\nSing again\n# note", segments, 8000)
        self.assertEqual([l["id"] for l in lines], ["line-2", "line-5"])
        self.assertEqual([l["startMs"] for l in lines], [1000, 5000])

    def test_real_audio_decoder_compatibility(self):
        from faster_whisper.audio import decode_audio
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "silence.wav"
            with wave.open(str(source), "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                output.writeframes(bytes(3200))
            self.assertEqual(decode_audio(str(source)).shape, (1600,))

    def test_repeated_lines_have_stable_order_and_relative_word_times(self):
        segments = [Segment(start, start + 2, "Sing again", [
            Word(start, start + 1, "Sing"), Word(start + 1, start + 2, "again")
        ]) for start in (1, 5)]
        lines = map_lines("Sing again\n\nSing again", segments, 8000)
        self.assertEqual([l["id"] for l in lines], ["line-1", "line-3"])
        self.assertEqual([l["startMs"] for l in lines], [1000, 5000])
        self.assertEqual(lines[0]["words"], lines[1]["words"])
        self.assertEqual(lines[0]["words"][0]["startMs"], 0)

    def test_unmatched_line_has_no_guessed_timing(self):
        line = map_lines("Missing lyrics", [], 10000)[0]
        self.assertEqual(line["status"], "unmatched")
        self.assertIsNone(line["startMs"])
        self.assertIsNone(line["durationMs"])
        self.assertEqual(line["words"], [])

    def test_original_whitespace_and_punctuation_survive(self):
        segments = [Segment(1, 3, "Hello world", [Word(1, 2, "Hello"), Word(2, 3, "world")])]
        line = map_lines("  Hello,  world!  ", segments, 4000)[0]
        self.assertEqual("".join(w["text"] for w in line["words"]), line["text"])
        self.assertEqual(line["text"], "  Hello,  world!  ")

    def test_invalid_engine_bounds_remain_untimed(self):
        with patch("align.align", return_value=[AlignedLine("Hello", -1, 2, 1, True)]):
            line = map_lines("Hello", [], 4000)[0]
        self.assertEqual(line["status"], "unmatched")
        self.assertIn("Invalid", line["reason"])

    def test_bad_token_mapping_requires_correction(self):
        result = AlignedLine("Wrong", 1, 2, 1, True, [{"char": "W", "start": 1, "end": 2}])
        with patch("align.align", return_value=[result]):
            line = map_lines("Hello", [], 4000)[0]
        self.assertEqual(line["words"], [])
        self.assertEqual(line["status"], "review")
        self.assertIn("reason", line)


if __name__ == "__main__":
    unittest.main()
