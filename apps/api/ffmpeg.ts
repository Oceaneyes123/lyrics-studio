import {spawn, execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

export function runFFmpeg(args: string[], signal: AbortSignal, timeoutMs = 30 * 60 * 1000): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let diagnostic = '', timedOut = false;
    child.stderr.on('data', chunk => {diagnostic = (diagnostic + chunk.toString()).slice(-16000);});
    const kill = () => {
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide: true}, () => {});
      else child.kill('SIGTERM');
    };
    signal.addEventListener('abort', kill, {once: true});
    const timer = setTimeout(() => {timedOut = true; kill();}, timeoutMs);
    const cleanup = () => {clearTimeout(timer); signal.removeEventListener('abort', kill);};
    child.once('error', error => {cleanup(); reject(error);});
    child.once('close', code => {cleanup();
      if (signal.aborted) reject(new Error('Cancelled'));
      else if (timedOut) reject(new Error('Audio processing exceeded 30 minutes'));
      else if (code !== 0) reject(new Error(`Audio processing failed: ${diagnostic.slice(-1800).trim()}`));
      else resolve(diagnostic);
    });
    if (signal.aborted) kill();
  });
}
export async function hashFile(file: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
