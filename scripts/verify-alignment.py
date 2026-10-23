"""Build local singing stress cases and report coverage, never guessed accuracy."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path('services/lyric-alignment').resolve()))
from align import run


def digest(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    root = Path('artifacts/acceptance/alignment')
    root.mkdir(parents=True, exist_ok=True)
    original = Path('music/test.wav')
    lyrics = Path('music/lyrics.txt')
    original_hash = digest(original)
    original_lyrics_hash = digest(lyrics)
    filters = {
        'long-gap': '[0:a]asplit[a][b];[a]atrim=end=40,asetpts=PTS-STARTPTS[x];'
                    '[b]atrim=start=40,asetpts=PTS-STARTPTS[y];'
                    'anullsrc=r=48000:cl=stereo,atrim=duration=20[s];[x][s][y]concat=n=3:v=0:a=1[out]',
        'fast': '[0:a]atempo=1.25[out]',
    }
    cases = [('original', original, lyrics, 'Original English song; repeated choruses')]
    hymn = Path('.cache/proof/amazing-grace.mp3')
    if hymn.exists():
        cases.append(('sustained-hymn', hymn, Path('tests/fixtures/amazing-grace.txt'),
                      'Previously attributed public-domain hymn with sustained vocals'))
    for name, graph in filters.items():
        audio = root / f'{name}.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(original),
                        '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', str(audio)], check=True)
        cases.append((name, audio, lyrics, '20 seconds of silence inserted at 40s (may split a vocal)' if name == 'long-gap'
                      else 'Artificial 1.25x tempo stress; not a representative natural fast singer'))
    inaccurate = root / 'inaccurate.txt'
    inaccurate.write_text(lyrics.read_text(encoding='utf-8-sig') + '\nQuantum teapots orbit Saturn sideways.\n', encoding='utf-8')
    cases.append(('inaccurate', original, inaccurate, 'Deliberately unrelated appended lyric'))
    results = []
    for name, audio, text, description in cases:
        output = root / f'{name}.json'
        cache = Path('.cache/transcription/acceptance')
        run(audio.resolve(), text.resolve(), output, 'small', 'en', cache)
        first = json.loads(output.with_suffix('.metrics.json').read_text())
        if not first['cacheHit']:
            assert first['modelSetupSeconds'] >= 0 and first['transcriptionSeconds'] >= 0
        project = json.loads(output.read_text(encoding='utf-8'))
        assert all(line['status'] in ('review', 'unmatched') for line in project['lines'])
        previous = 0
        for line in project['lines']:
            if line['startMs'] is None:
                assert line['durationMs'] is None and not line['words']
                continue
            assert previous <= line['startMs'] < line['startMs'] + line['durationMs'] <= project['durationMs']
            previous = line['startMs'] + line['durationMs']
            if line['words']:
                assert ''.join(word['text'] for word in line['words']) == line['text']
        if name == 'inaccurate':
            assert project['lines'][-1]['startMs'] is None
        run(audio.resolve(), text.resolve(), output, 'small', 'en', cache)
        cached = json.loads(output.with_suffix('.metrics.json').read_text())
        assert cached['cacheHit'] and cached['modelSetupSeconds'] is None
        # Keep predictions out of the independent review template; never overwrite human work.
        template = root / f'{name}.annotations.json'
        if not template.exists():
            template.write_text(json.dumps({'audioSha256': digest(audio), 'reviewer': '',
                'instructions': 'Measure absolute line times and relative word times independently. Delete unreviewed rows before evaluation.',
                'lines': [{key: line[key] for key in ('id', 'text')} | {'startMs': None, 'endMs': None, 'words': []}
                          for line in project['lines']]}, ensure_ascii=False, indent=2), encoding='utf-8')
        results.append({'case': name, 'description': description, 'audio': str(audio),
                        'audioSha256': digest(audio), 'lyricsSha256': digest(text),
                        'firstRun': first, 'cachedRun': cached, 'accuracy': None})
        print(f'{name}: {first["matchedLines"]}/{first["lines"]} matched; accuracy unmeasured', flush=True)
    assert digest(original) == original_hash and digest(lyrics) == original_lyrics_hash
    (root / 'report.json').write_text(json.dumps({'language': 'en', 'cases': results,
        'manualAccuracyReview': 'Pending; null timings are intentionally not valid evaluation input',
        'naturalFastVocalFixture': 'Still needed; tempo transformation is only a stress test',
        'memoryScope': 'Worker process lifetime peak; cases share a process, so later peaks are not isolated case measurements.'}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
