"""Assert decoded export audio stays synchronized with the original song."""
import argparse
import json
import numpy as np
from faster_whisper.audio import decode_audio

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("original")
parser.add_argument("export")
parser.add_argument("--fps", type=int, choices=[24, 25, 30], default=30)
args = parser.parse_args()
rate = 8000
reference = decode_audio(args.original, sampling_rate=rate)
output = decode_audio(args.export, sampling_rate=rate)
measurements = []
for second in (5, 45, 80):
    start, margin = second * rate, 400
    expected = reference[start:start + rate]
    search = output[start - margin:start + rate + margin]
    assert len(expected) == rate and len(search) == rate + margin * 2, "Use a full-length fixture longer than 81 seconds"
    assert np.linalg.norm(expected) > .001, "Reference window is silent; choose a different measurement point"
    correlations = np.correlate(search, expected, mode="valid")
    offset = int(np.argmax(correlations)) - margin
    matched = output[start + offset:start + offset + rate]
    coefficient = float(np.dot(expected, matched) / (np.linalg.norm(expected) * np.linalg.norm(matched)))
    assert coefficient > .9, f"Audio differs materially around {second}s"
    assert abs(offset) / rate <= 1 / args.fps, f"Audio offset exceeds one frame around {second}s"
    measurements.append({"atSeconds": second, "offsetMs": offset * 1000 / rate, "correlation": coefficient})
assert max(m["offsetMs"] for m in measurements) - min(m["offsetMs"] for m in measurements) <= 1000 / args.fps, "Accumulating drift exceeds one frame"
print(json.dumps({"sampleRate": rate, "fps": args.fps, "measurements": measurements}, indent=2))
