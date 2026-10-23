"""M0 local alignment adapter. Never invent timestamps for unmatched lyrics."""
import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import time
from importlib.metadata import version
from pathlib import Path
from difflib import SequenceMatcher

from lyric_align import AlignedLine, Segment, Word, align
from lyric_align.charmap import char_timings, syllable_timings
from lyric_align.normalize import cjk_ratio
from lyric_align.cli import SECTION_DIRECTION, SECTION_MARKER


def peak_memory_bytes():
    """Read the actual Python worker peak, not the Windows venv launcher."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class MemoryCounters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                "PagefileUsage", "PeakPagefileUsage")]

    counters = MemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    query = ctypes.WinDLL("psapi", use_last_error=True).GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    query.restype = wintypes.BOOL
    if not query(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return counters.PeakWorkingSetSize


def split_sentences(segments):
    """Split coarse ASR segments using recognized punctuation and word bounds."""
    out = []
    for segment in segments:
        if not segment.words:
            out.append(segment)
            continue
        group = []
        for word in segment.words:
            group.append(word)
            if word.word.rstrip().endswith((".", "!", "?", "。", "！", "？")):
                out.append(Segment(group[0].start, group[-1].end, "".join(w.word for w in group), group))
                group = []
        if group:
            out.append(Segment(group[0].start, group[-1].end, "".join(w.word for w in group), group))
    return out


def align_words(segments, lyrics):
    """Match the whole lyric sequence to observed words, independent of ASR segments."""
    def normalize(token):
        token = "".join(c for c in token.casefold() if c.isalnum())
        return "mister" if token == "mr" else token

    tokens = [re.findall(r"\S+", line) for line in lyrics]
    expected = [normalize(token) for line in tokens for token in line]
    words = [word for segment in segments for word in segment.words if normalize(word.word)]
    observed = [normalize(word.word) for word in words]
    positions = {}
    # Repeated choruses must remain matchable even in songs with hundreds of words.
    for tag, a, b, c, d in SequenceMatcher(None, expected, observed, autojunk=False).get_opcodes():
        if tag == "equal":
            positions.update((a + i, c + i) for i in range(b - a))
        elif tag == "replace" and b - a == d - c:
            for i in range(b - a):
                if SequenceMatcher(None, expected[a + i], observed[c + i]).ratio() >= 0.6:
                    positions[a + i] = c + i

    results = []
    offset = 0
    for line, units in zip(lyrics, tokens):
        mapped = [words[positions[i]] if i in positions else None
                  for i in range(offset, offset + len(units))]
        offset += len(units)
        found = [word for word in mapped if word is not None]
        score = len(found) / len(units)
        if score < 0.5 or len(found) < min(2, len(units)):
            results.append(AlignedLine(line, None, None, score, False))
            continue
        chars = None
        if all(word is not None and word.start < word.end for word in mapped):
            # Interpolate characters only inside their recognized word, never across words or pauses.
            chars = [char for token, word in zip(units, mapped)
                     for char in char_timings(token, [word])]
        results.append(AlignedLine(line, found[0].start, found[-1].end, score, True, chars))
    return results


def map_lines(text, segments, duration_ms):
    source = [(i, line) for i, line in enumerate(text.splitlines())
              if line.strip() and not line.strip().startswith("#")
              and not SECTION_MARKER.fullmatch(line.strip())
              and not SECTION_DIRECTION.fullmatch(line.strip())]
    lyrics = [line.strip() for _, line in source]
    if cjk_ratio(text) < 0.2 and any(segment.words for segment in segments):
        results = align_words(segments, lyrics)
    else:
        results = align(split_sentences(segments), lyrics, karaoke=True)
    if len(results) != len(source):
        raise ValueError("Engine did not return one result per lyric line")
    lines = []
    previous_end = 0
    for (index, original), result in zip(source, results):
        line = {"id": f"line-{index + 1}", "text": original, "status": "unmatched",
                "startMs": None, "durationMs": None, "words": [], "score": result.score}
        if not result.matched:
            line["reason"] = "Not enough recognized words to place this lyric; manual timing required"
        if result.matched and result.start is not None and result.end is not None:
            if not all(math.isfinite(t) for t in (result.start, result.end)):
                raise ValueError("Non-finite engine timing")
            start, end = round(result.start * 1000), round(result.end * 1000)
            if not (previous_end <= start < end <= duration_ms):
                line["reason"] = "Invalid, overlapping, or out-of-bounds engine timing"
            else:
                line.update(startMs=start, durationMs=end - start, status="review")
                units = syllable_timings(result.line, result.chars or [])
                # CJK units may be characters; preserve exact original spacing.
                cursor = 0
                for unit in units:
                    token = unit["text"]
                    offset = original.find(token, cursor)
                    if offset < 0 or original[cursor:offset].strip():
                        line["reason"] = "Engine tokens do not reconstruct supplied lyrics"
                        break
                    token_end = offset + len(token)
                    while token_end < len(original) and original[token_end].isspace():
                        token_end += 1
                    rendered = original[cursor:token_end]
                    a, b = round(unit["start"] * 1000) - start, round(unit["end"] * 1000) - start
                    if not (0 <= a < b <= end - start) or (line["words"] and a < line["words"][-1]["endMs"]):
                        line["reason"] = "Invalid engine word timing"
                        break
                    line["words"].append({"text": rendered, "startMs": a, "endMs": b})
                    cursor = token_end
                if cursor != len(original) or "reason" in line:
                    line["words"] = []
                    line.setdefault("reason", "Some words lack reliable transcription timing; manual correction required")
                previous_end = end
        lines.append(line)
    return lines


def run(audio, lyrics, output, model, language, cache_dir):
    started = time.perf_counter()
    duration = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(audio)
    ]))["format"]["duration"]
    duration_ms = round(float(duration) * 1000)
    if duration_ms <= 0:
        raise ValueError("Audio duration must be positive")
    config = {"model": model, "language": language, "device": "cpu", "computeType": "int8",
              "conditionOnPreviousText": False,
              "vad": False, "fasterWhisper": version("faster-whisper"), "engine": version("lyric-align")}
    with audio.open("rb") as source:
        audio_hash = hashlib.file_digest(source, "sha256").hexdigest()
    key = hashlib.sha256((audio_hash + json.dumps(config, sort_keys=True)).encode()).hexdigest()
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / f"{key}.json"
    cache_hit = cache.exists()
    model_setup_seconds = transcription_seconds = None
    if cache_hit:
        segments = [Segment.from_dict(s) for s in json.loads(cache.read_text(encoding="utf-8"))]
    else:
        from faster_whisper import WhisperModel
        print(f"Transcribing with {model}: CPU/int8, VAD disabled for sustained vocals", file=sys.stderr, flush=True)
        stage = time.perf_counter()
        recognizer = WhisperModel(model, device="cpu", compute_type="int8")
        model_setup_seconds = round(time.perf_counter() - stage, 3)
        stage = time.perf_counter()
        recognized, _ = recognizer.transcribe(str(audio), language=language, word_timestamps=True,
                                             vad_filter=False, condition_on_previous_text=False)
        segments = [Segment(s.start, s.end, s.text,
                            [Word(w.start, w.end, w.word) for w in (s.words or [])]) for s in recognized]
        transcription_seconds = round(time.perf_counter() - stage, 3)
        temporary = cache.with_suffix(".tmp")
        temporary.write_text(json.dumps([s.to_dict() for s in segments], ensure_ascii=False), encoding="utf-8")
        temporary.replace(cache)
    text = lyrics.read_text(encoding="utf-8-sig")
    stage = time.perf_counter()
    lines = map_lines(text, segments, duration_ms)
    mapping_seconds = round(time.perf_counter() - stage, 3)
    project = {"schemaVersion": 1, "id": "alignment", "fps": 30, "width": 1280, "height": 720,
               "durationMs": duration_ms, "audioFile": audio.name, "sourceLyrics": text, "lines": lines}
    metrics = {"config": config, "audioSha256": audio_hash, "cacheHit": cache_hit,
               "segments": len(segments), "lines": len(lines),
               "matchedLines": sum(l["startMs"] is not None for l in lines),
               "wordTimedLines": sum(bool(l["words"]) for l in lines),
               "elapsedSeconds": round(time.perf_counter() - started, 3),
               "modelSetupSeconds": model_setup_seconds,
               "transcriptionSeconds": transcription_seconds, "mappingSeconds": mapping_seconds,
               "peakWorkingSetBytes": peak_memory_bytes(),
               "accuracy": "Not measured: no independent manual annotations supplied"}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(output)
    output.with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("lyrics", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="small", help="Downloads model weights on first use (~500 MB for small)")
    parser.add_argument("--language", default="en")
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/transcription"))
    args = parser.parse_args()
    try:
        run(args.audio.resolve(strict=True), args.lyrics.resolve(strict=True), args.output,
            args.model, args.language, args.cache_dir)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Alignment failed: {error}", file=sys.stderr)
        raise SystemExit(1)
