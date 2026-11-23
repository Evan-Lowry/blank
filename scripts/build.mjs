import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const [template, bankScript, pdf, bank, worker] = await Promise.all([
  read('web/index.html'),
  read('web/exam-bank.js'),
  read('worker/pdf.js'),
  read('worker/exam-bank.js'),
  read('worker/index.js'),
]);
const js = 'text/javascript; charset=utf-8';
const assets = {
  '/pdfjs.mjs': [js, await read('node_modules/pdfjs-dist/build/pdf.min.mjs')],
  '/pdfjs-worker.mjs': [js, await read('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')],
  '/favicon.svg': ['image/svg+xml', await read('web/favicon.svg')],
};
let html = template.replace('<!-- exam-bank-script -->', () => '<script>\n' + bankScript + '\n</script>');
if (process.argv.includes('--pages')) {
  const backend = 'https://crowdmark-clean-copy.rbrlwy.chatgpt.site';
  html = html.replace('name="clean-copy-api" content=""', 'name="clean-copy-api" content="' + backend + '"');
  await mkdir('pages-dist', { recursive: true });
  await Promise.all([
    writeFile('pages-dist/index.html', html),
    writeFile('pages-dist/.nojekyll', ''),
    ...Object.entries(assets).map(([path, [, content]]) => writeFile('pages-dist' + path, content)),
  ]);
  process.exit(0);
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', [
  'const HTML = ' + JSON.stringify(html) + ';',
  'const APP_ASSETS = ' + JSON.stringify(assets) + ';',
  pdf,
  bank.replace("import { makePdf } from './pdf.js';", ''),
  worker.replace(/^import .*;$/gm, ''),
].join('\n'));
