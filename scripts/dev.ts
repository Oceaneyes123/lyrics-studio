import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
const {app} = await createApp();
await app.listen({host: '127.0.0.1', port: 3001});
const web = await createServer();
try {await web.listen(); console.log('Lyrics Studio: http://127.0.0.1:5173');}
catch (error) {await app.close(); throw error;}
let closing = false;
async function close() {if (closing) return; closing = true; await web.close(); await app.close(); process.exit(0);}
process.on('SIGINT', close); process.on('SIGTERM', close);
