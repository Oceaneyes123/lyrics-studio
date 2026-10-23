import {defineConfig} from 'vite';
export default defineConfig(({command}) => ({publicDir: command === 'serve' ? '.cache/proof' : false, server: {host: '127.0.0.1', strictPort: true,
  fs: {deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/storage/**', '**/music/**', '**/.venv/**', '**/artifacts/**', '**/.cache/transcription*/**']},
  watch: {ignored: ['**/.cache/**', '**/storage/**', '**/artifacts/**', '**/music/**', '**/dist/**']},
  proxy: {'/api': 'http://127.0.0.1:3001'}}}));
