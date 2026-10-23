import {spawnSync} from 'node:child_process';
import path from 'node:path';

const executable = path.resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const result = spawnSync(executable, process.argv.slice(2), {stdio: 'inherit'});
if (result.error) console.error(`Local Python could not start: ${result.error.message}. Create .venv first (see README).`);
process.exit(result.status ?? 1);
