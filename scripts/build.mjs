import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Builds the Cloudflare Worker (dist/server/index.js): the page, its assets and the server code in one file.
const read = path => readFile(path, 'utf8');
const [template, bankScript, pdf, bank, guard, worker] = await Promise.all([
  read('web/index.html'),
  read('web/exam-bank.js'),
  read('worker/pdf.js'),
  read('worker/exam-bank.js'),
  read('worker/guard.js'),
  read('worker/index.js'),
]);
const js = 'text/javascript; charset=utf-8';
const zipLicense = await read('node_modules/fflate/LICENSE');
const assets = {
  '/zip.mjs': [js, '/*\n' + zipLicense + '\n*/\n' + await read('node_modules/fflate/esm/browser.js')],
  '/favicon.svg': ['image/svg+xml', await read('web/favicon.svg')],
};
const html = template.replace('<!-- exam-bank-script -->', () => '<script>\n' + bankScript + '\n</script>');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', [
  'const HTML = ' + JSON.stringify(html) + ';',
  'const APP_ASSETS = ' + JSON.stringify(assets) + ';',
  pdf,
  bank.replace("import { makePdf } from './pdf.js';", ''),
  guard,
  worker.replace(/^import .*;$/gm, ''),
].join('\n'));
