import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';
import { bindings } from './local-bindings.mjs';

const port = Number(process.env.CLEAN_COPY_PORT || 4183);
createServer(async (incoming, outgoing) => {
  try {
    const options = { method: incoming.method, headers: incoming.headers };
    if (!['GET', 'HEAD'].includes(incoming.method)) {
      options.body = Readable.toWeb(incoming);
      options.duplex = 'half';
    }
    const result = await worker.fetch(new Request('http://' + (incoming.headers.host === 'localhost:' + port ? 'localhost' : '127.0.0.1') + ':' + port + incoming.url, options), bindings);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port));
