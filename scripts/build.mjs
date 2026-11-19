import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const html = await readFile('web/index.html', 'utf8');
const pdf = await readFile('worker/pdf.js', 'utf8');
const worker = await readFile('worker/index.js', 'utf8');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', [
  'const HTML = ' + JSON.stringify(html) + ';',
  pdf,
  worker.replace("import { makePdf } from './pdf.js';", ''),
].join('\n'));
