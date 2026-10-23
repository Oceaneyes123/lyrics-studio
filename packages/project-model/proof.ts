// M0 contract only; the full editable project schema belongs to M1.
export type TimedWord = {text: string; startMs: number; endMs: number};
export type ProofLine = {
  id: string;
  text: string;
  status: 'manual' | 'review' | 'unmatched';
  startMs: number | null;
  durationMs: number | null;
  words: TimedWord[];
};
export type ProofProject = {
  schemaVersion: 1;
  id: string;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  audioFile: string;
  lines: ProofLine[];
};

export const msToFrame = (ms: number, fps: number) => Math.round(ms * fps / 1000);
export const durationFrames = (project: {durationMs: number; fps: number}) => msToFrame(project.durationMs, project.fps);

export function parseProofProject(input: unknown): ProofProject {
  const fail = (): never => {throw new Error('Invalid M0 proof project');};
  if (!input || typeof input !== 'object') fail();
  const p = input as ProofProject;
  if (p.schemaVersion !== 1 || typeof p.id !== 'string' || !p.id ||
      ![24, 25, 30].includes(p.fps) ||
      ![p.width, p.height].every(n => Number.isInteger(n) && n > 0 && n <= 4096 && n % 2 === 0) ||
      !Number.isInteger(p.durationMs) || p.durationMs <= 0 || durationFrames(p) <= 0 ||
      typeof p.audioFile !== 'string' || !/^[a-zA-Z0-9_-]+\.(mp3|wav)$/.test(p.audioFile) ||
      !Array.isArray(p.lines)) fail();
  const ids = new Set<string>();
  let lastEnd = 0;
  for (const line of p.lines) {
    if (!line || typeof line !== 'object' || typeof line.id !== 'string' || !line.id || ids.has(line.id) ||
        typeof line.text !== 'string' || !line.text.trim() || !Array.isArray(line.words) ||
        !['manual', 'review', 'unmatched'].includes(line.status)) fail();
    ids.add(line.id);
    if (line.startMs === null || line.durationMs === null) {
      if (line.startMs !== null || line.durationMs !== null || line.status !== 'unmatched' || line.words.length) fail();
      continue;
    }
    const end = line.startMs + line.durationMs;
    if (line.status === 'unmatched' || !Number.isInteger(line.startMs) || !Number.isInteger(line.durationMs) ||
        line.startMs < lastEnd || line.durationMs <= 0 || end > p.durationMs ||
        msToFrame(end, p.fps) <= msToFrame(line.startMs, p.fps)) fail();
    let lastWordEnd = 0;
    for (const word of line.words) {
      if (!word || typeof word.text !== 'string' || !word.text.trim() ||
          !Number.isInteger(word.startMs) || !Number.isInteger(word.endMs) ||
          word.startMs < lastWordEnd || word.endMs <= word.startMs || word.endMs > line.durationMs) fail();
      lastWordEnd = word.endMs;
    }
    if (line.words.length && line.words.map(w => w.text).join('') !== line.text) fail();
    lastEnd = end;
  }
  return p;
}

export function lineAtFrame(project: ProofProject, frame: number) {
  return project.lines.find(line => line.startMs !== null && line.durationMs !== null &&
    frame >= msToFrame(line.startMs, project.fps) &&
    frame < msToFrame(line.startMs + line.durationMs, project.fps));
}

export function wordProgress(word: TimedWord, relativeMs: number) {
  return Math.max(0, Math.min(1, (relativeMs - word.startMs) / (word.endMs - word.startMs)));
}
