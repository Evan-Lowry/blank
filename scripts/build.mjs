import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const [template, bankScript, pdf, bank, worker, pdfjs, pdfjsWorker] = await Promise.all([
  read('web/index.html'),
  read('web/exam-bank.js'),
  read('worker/pdf.js'),
  read('worker/exam-bank.js'),
  read('worker/index.js'),
  read('node_modules/pdfjs-dist/build/pdf.min.mjs'),
  read('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
]);
const html = template.replace('<!-- exam-bank-script -->', () => '<script>\n' + bankScript + '\n</script>');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', [
  'const HTML = ' + JSON.stringify(html) + ';',
  'const PDFJS = ' + JSON.stringify(pdfjs) + ';',
  'const PDFJS_WORKER = ' + JSON.stringify(pdfjsWorker) + ';',
  pdf,
  bank.replace("import { makePdf } from './pdf.js';", ''),
  worker.replace(/^import .*;$/gm, ''),
].join('\n'));
