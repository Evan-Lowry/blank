// Uploads the assessments from the local database and PDFs (.local/) to the live Cloudflare D1 and R2.
// It is a dry run unless you pass --yes:   npm run cf:push-local            (shows the plan, changes nothing)
//                                          npm run cf:push-local -- --yes   (uploads)
// Only assessments with a recognised course, term, and type are uploaded.
// Anything already live (same id or same PDF contents) is skipped, so it is safe to run again.
// Uploaded assessments become public on the live site.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apply = process.argv.includes('--yes');
const database = 'blank';
const bucket = 'blank-assessments';

function wrangler(args) {
  return execFileSync('node_modules/.bin/wrangler', args, {
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function remoteQuery(sql) {
  const output = wrangler(['d1', 'execute', database, '--remote', '--json', '--command', sql]);
  return JSON.parse(output.slice(output.indexOf('[')))[0].results;
}

const quote = value => value === null || value === undefined ? 'NULL'
  : typeof value === 'number' ? String(value)
  : "'" + String(value).replaceAll("'", "''") + "'";

if (!existsSync('.local/db.sqlite')) throw new Error('No local database found at .local/db.sqlite.');
const local = new DatabaseSync('.local/db.sqlite');
const columns = 'id, course, term, assessment, assessment_number, page_count, page_images, content_hash, status, submitted_at';
const rows = local.prepare('SELECT ' + columns + " FROM exam_bank WHERE status = 'approved' ORDER BY course, term, assessment, assessment_number").all();

const live = remoteQuery('SELECT id, content_hash FROM exam_bank');
const liveIds = new Set(live.map(row => row.id));
const liveHashes = new Set(live.map(row => row.content_hash).filter(Boolean));

const plan = rows.map(row => {
  const file = join('.local/r2', encodeURIComponent('exams/' + row.id + '.pdf'));
  let skip = '';
  let size = 0;
  if (!existsSync(file)) skip = 'PDF file missing locally';
  else {
    size = statSync(file).size;
    if (size < 2000 || readFileSync(file).subarray(0, 4).toString() !== '%PDF') skip = 'not a real PDF';
  }
  if (!skip && !(row.course && row.term && row.assessment)) skip = 'course, term, or type not recognised';
  if (!skip && (liveIds.has(row.id) || (row.content_hash && liveHashes.has(row.content_hash)))) skip = 'already live';
  return { row, file, size, skip };
});

const label = ({ row }) => [row.course || 'course unknown', row.term || 'term unknown', (row.assessment || 'type unknown') + (row.assessment_number ? ' ' + row.assessment_number : '')].join(' · ');
console.log('Live site currently has ' + live.length + ' assessment(s). Local database has ' + rows.length + '.\n');
for (const item of plan) {
  console.log((item.skip ? 'skip  ' : 'upload') + '  ' + label(item).padEnd(44) + (item.size / 1048576).toFixed(2).padStart(6) + ' MB' + (item.skip ? '   (' + item.skip + ')' : ''));
}
const todo = plan.filter(item => !item.skip);
const megabytes = todo.reduce((total, item) => total + item.size, 0) / 1048576;
console.log('\n' + todo.length + ' to upload, ' + megabytes.toFixed(1) + ' MB.');

if (!apply) {
  console.log('Dry run: nothing was changed. Run with --yes to upload. Uploaded assessments become public.');
  process.exit(0);
}
if (!todo.length) process.exit(0);

// Files first, so no database row ever points at a missing PDF.
const uploaded = [];
for (const item of todo) {
  try {
    wrangler(['r2', 'object', 'put', bucket + '/exams/' + item.row.id + '.pdf', '--file', item.file, '--content-type', 'application/pdf', '--remote']);
    uploaded.push(item);
    console.log('stored  ' + label(item));
  } catch (error) {
    console.log('FAILED  ' + label(item) + ': ' + String(error.stderr || error.message).split('\n')[0]);
  }
}
if (uploaded.length) {
  const sql = uploaded.map(({ row }) =>
    'INSERT OR IGNORE INTO exam_bank (' + columns + ') VALUES (' + columns.split(', ').map(name => quote(row[name])).join(', ') + ');').join('\n');
  const folder = mkdtempSync(join(tmpdir(), 'blank-push-'));
  try {
    writeFileSync(join(folder, 'insert.sql'), sql);
    wrangler(['d1', 'execute', database, '--remote', '--file', join(folder, 'insert.sql')]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
const after = remoteQuery('SELECT COUNT(*) AS n FROM exam_bank')[0].n;
console.log('\nDone. ' + uploaded.length + ' uploaded, ' + (todo.length - uploaded.length) + ' failed. The live site now has ' + after + ' assessment(s).');
