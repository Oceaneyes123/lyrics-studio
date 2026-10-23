"""Prepare original marker audio and optionally the upstream public-domain song."""
import argparse
import json
import math
import struct
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / ".cache" / "proof"
SONG_URL = (
    "https://upload.wikimedia.org/wikipedia/commons/8/8f/"
    "Amazing_Grace_%28vocalist_with_guitar%29_-_Southern_Aire_-_"
    "United_States_Air_Force_Reserve_Band.mp3"
)


def prepare(download_song=False):
    PUBLIC.mkdir(parents=True, exist_ok=True)
    rate = 48000
    # Original 10-second fixture: pulses at 1, 5, and 9 seconds measure drift.
    with wave.open(str(PUBLIC / "marker.wav"), "wb") as out:
        out.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        samples = bytearray()
        for i in range(10 * rate):
            t = i / rate
            pulse = any(start <= t < start + 0.1 for start in (1, 5, 9))
            value = int(16000 * math.sin(2 * math.pi * 1000 * t)) if pulse else 0
            samples.extend(struct.pack("<h", value))
        out.writeframes(samples)
    project = {
        "schemaVersion": 1, "id": "marker", "fps": 30,
        "width": 1280, "height": 720, "durationMs": 10000,
        "audioFile": "marker.wav",
        "lines": [
            {"id": "one", "text": "One clear signal", "startMs": 1000,
             "durationMs": 2000, "status": "manual", "words": [
                 {"text": "One ", "startMs": 0, "endMs": 600},
                 {"text": "clear ", "startMs": 600, "endMs": 1200},
                 {"text": "signal", "startMs": 1200, "endMs": 2000}]},
            {"id": "two", "text": "Keep time together", "startMs": 5000,
             "durationMs": 2000, "status": "manual", "words": [
                 {"text": "Keep ", "startMs": 0, "endMs": 600},
                 {"text": "time ", "startMs": 600, "endMs": 1200},
                 {"text": "together", "startMs": 1200, "endMs": 2000}]},
            {"id": "three", "text": "Last signal", "startMs": 9000,
             "durationMs": 1000, "status": "manual", "words": [
                 {"text": "Last ", "startMs": 0, "endMs": 400},
                 {"text": "signal", "startMs": 400, "endMs": 1000}]}],
    }
    (PUBLIC / "marker.project.json").write_text(json.dumps(project, indent=2), encoding="utf-8")
    if download_song:
        target = PUBLIC / "amazing-grace.mp3"
        if not target.exists():
            temporary = target.with_suffix(".download")
            request = urllib.request.Request(SONG_URL, headers={"User-Agent": "LyricsStudio-M0/0.0 (local evaluation)"})
            with urllib.request.urlopen(request, timeout=90) as response:
                temporary.write_bytes(response.read())
            temporary.replace(target)
        print(f"Public-domain fixture: {target}")
    print(f"Marker fixture: {PUBLIC / 'marker.project.json'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download-song", action="store_true")
    prepare(parser.parse_args().download_song)
