import { makePdf } from './pdf.js';

const examKinds = {
  Midterm: /\bMID[ -]?TERM(?:S)?\b/,
  Final: /\bFINALS?\b/,
  Quiz: /\bQUIZ(?:ZES)?\b/,
  Test: /\bTESTS?\b/,
  Exam: /\bEXAMS?\b/,
  Assignment: /\bASSIGNMENTS?\b|\bHOMEWORK\b|\bPROBLEM[ -]SET\b|\bPS[ -]?\d+\b|\bHW[ -]?\d+\b|\bA[ -]?\d+\b/,
  Lab: /\bLABS?\b|\bLABORATOR(?:Y|IES)\b/,
  Tutorial: /\bTUTORIALS?\b/,
  Workshop: /\bWORKSHOPS?\b/,
  Project: /\bPROJECTS?\b/,
  Practice: /\bPRACTICE\b|\bMOCK\b|\bSAMPLE[ -]+(?:MID[ -]?TERM|FINAL|EXAM|TEST|QUIZ)\b/,
};
const assessmentTypes = new Set([...Object.keys(examKinds), 'Other']);
const seasonNames = { WINTER: 'W', SPRING: 'S', SUMMER: 'S', FALL: 'F', AUTUMN: 'F' };
const uniqueMatch = values => [...new Set(values)].length === 1 ? values[0] : '';

function detectFromLabel(label) {
  const text = typeof label === 'string' ? label.slice(0, 320).toUpperCase().replace(/[_–—]/g, ' ') : '';
  const courses = [...text.matchAll(/\b([A-Z]{2,8})[ -]*(\d{3}[A-Z]?)\b/g)]
    .filter(match => !/^(YEAR|WINTER|SPRING|SUMMER|FALL|AUTUMN|MIDTERM|FINAL|QUIZ|TEST|EXAM|PAGE|LAB|PROJECT|MARKS|TERM)$/.test(match[1]))
    .map(match => match[1] + match[2]);
  const terms = [];
  for (const match of text.matchAll(/\b(WINTER|SPRING|SUMMER|FALL|AUTUMN)[ -]+((?:19|20)\d{2})\b|\b((?:19|20)\d{2})[ -]+(WINTER|SPRING|SUMMER|FALL|AUTUMN)\b/g)) {
    terms.push((match[2] || match[3]) + '-' + seasonNames[match[1] || match[4]]);
  }
  for (const match of text.matchAll(/\b([WSF])[ -]?(\d{2})\b|\b((?:19|20)\d{2})[ -]([WSF])\b/g)) {
    const twoDigitYear = Number(match[2]);
    const century = twoDigitYear > new Date().getFullYear() % 100 ? '19' : '20';
    terms.push((match[3] || century + match[2]) + '-' + (match[1] || match[4]));
  }
  for (const match of text.matchAll(/\bTERM[ -]+1(\d{2})([159])\b/g)) {
    terms.push('20' + match[1] + '-' + { 1: 'W', 5: 'S', 9: 'F' }[match[2]]);
  }
  let kinds = Object.keys(examKinds).filter(kind => examKinds[kind].test(text));
  if (kinds.includes('Practice')) kinds = ['Practice'];
  if (kinds.includes('Midterm') || kinds.includes('Final') || kinds.includes('Quiz')) {
    kinds = kinds.filter(kind => kind !== 'Exam' && kind !== 'Test');
  }
  const assessment = uniqueMatch(kinds);
  const numbers = [...text.matchAll(/\b(MID[ -]?TERM|FINAL|QUIZ|TEST|EXAM|ASSIGNMENT|HOMEWORK|PROBLEM[ -]SET|LAB|TUTORIAL|WORKSHOP|PROJECT|HW|PS|A)[ -]*(?:#|NO\.?[ -]*)?([1-9]\d?)\b/g)]
    .filter(match => assessment && (assessment === 'Practice' || examKinds[assessment].test(match[1] + ' ' + match[2])))
    .map(match => match[2]);
  return { course: uniqueMatch(courses), term: uniqueMatch(terms), assessment, number: uniqueMatch(numbers) || null };
}

// The booklet name alone is sometimes not enough (for example "workshop-3-e2525"). Crowdmark's own course name
// ("STAT 230 - Fall 2026") and assessment title fill in whatever the booklet name did not give.
function detectDetails(booklet, extra) {
  const details = detectFromLabel(booklet);
  if (details.course && details.term && details.assessment) return details;
  const more = detectFromLabel(extra);
  return {
    course: details.course || more.course,
    term: details.term || more.term,
    assessment: details.assessment || more.assessment,
    number: details.assessment ? details.number : more.number,
  };
}

const entryId = '[a-f0-9-]{36}';
const bankHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const seasonLabels = { W: 'Winter', S: 'Spring', F: 'Fall' };

// What a pasted link should say in a chat app: /e/<id> is one assessment, /MATH137 is a course. Only public entries.
async function sharePageMeta(pathname, env, origin) {
  if (!env.DB) return;
  const exam = /^\/e\/([a-f0-9-]{36})$/.exec(pathname);
  const course = /^\/([A-Za-z]{2,8}\d{3}[A-Za-z]?)$/.exec(pathname);
  const spaced = code => code.replace(/([A-Z]+)(\d)/, '$1 $2');
  try {
    if (exam) {
      const row = await env.DB.prepare("SELECT course, term, assessment, assessment_number, page_count FROM exam_bank WHERE id = ? AND status = 'approved' AND course <> ''").bind(exam[1]).first();
      if (!row) return;
      const termName = row.term && seasonLabels[row.term.at(-1)] ? seasonLabels[row.term.at(-1)] + ' ' + row.term.slice(0, 4) : '';
      const kind = row.assessment ? row.assessment + (row.assessment_number ? ' ' + row.assessment_number : '') : '';
      return {
        title: spaced(row.course) + ' · ' + [termName, kind].filter(Boolean).join(' '),
        description: 'A blank ' + row.page_count + '-page copy' + ' to practise with. Free on unmarked.',
        image: origin + '/api/bank/thumb/' + exam[1] + '.jpg',
      };
    }
    if (course) {
      const code = course[1].toUpperCase();
      const row = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(term) AS latest FROM exam_bank WHERE course = ? AND status = 'approved'").bind(code).first();
      if (!row?.n) return;
      const newest = await env.DB.prepare("SELECT id FROM exam_bank WHERE course = ? AND status = 'approved' ORDER BY term DESC, submitted_at DESC LIMIT 1").bind(code).first();
      const latest = row.latest && seasonLabels[row.latest.at(-1)] ? ' Latest: ' + seasonLabels[row.latest.at(-1)] + ' ' + row.latest.slice(0, 4) + '.' : '';
      return {
        title: spaced(code) + ' assessments',
        description: row.n + (row.n === 1 ? ' past assessment' : ' past assessments') + ' to practise with.' + latest + ' Free on unmarked.',
        image: newest ? origin + '/api/bank/thumb/' + newest.id + '.jpg' : undefined,
      };
    }
  } catch (error) {
    console.error('Share preview failed:', error.name, String(error.message).split('\n')[0]);
  }
}

function bankJson(data, status = 200) {
  return Response.json(data, { status, headers: bankHeaders });
}

function bankError(message, status = 400) {
  return bankJson({ error: message }, status);
}

function normalizedCourse(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function validTerm(value) {
  return /^(?:19|20)\d{2}-[WSF]$/.test(value);
}

// Retain image data and decoding tables. Drop JPEG metadata and bytes after the end marker.
function cleanJpeg(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid JPEG');
  const chunks = [bytes.subarray(0, 2)];
  let pos = 2;
  while (pos + 1 < bytes.length) {
    const start = pos;
    if (bytes[pos++] !== 255) break;
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 217) {
      chunks.push(bytes.subarray(start, pos));
      const result = new Uint8Array(chunks.reduce((length, part) => length + part.length, 0));
      let offset = 0;
      for (const part of chunks) {
        result.set(part, offset);
        offset += part.length;
      }
      return result;
    }
    if (pos + 1 >= bytes.length) break;
    const length = bytes[pos] * 256 + bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) break;
    pos += length;
    if (marker >= 224 && marker <= 239 || marker === 254) continue;
    if (marker === 218) {
      while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 255) { pos++; continue; }
        const next = bytes[pos + 1];
        if (next === 0 || (next >= 208 && next <= 215)) { pos += 2; continue; }
        if (next === 255) { pos++; continue; }
        break;
      }
    }
    chunks.push(bytes.subarray(start, pos));
  }
  throw new Error('Invalid JPEG');
}

async function hashPdf(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function findLegacyMatch(rendered, pageImages, hash, onlyPublished, env) {
  // Page offsets narrow the lookup. Only identical PDF bytes count as a match.
  const { results } = await env.DB.prepare(
    "SELECT id, status FROM exam_bank WHERE content_hash IS NULL AND page_count = ? AND page_images = ? " +
    "AND (? = 0 OR status = 'approved') ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END"
  ).bind(rendered.pageImages.length, pageImages, Number(onlyPublished)).all();
  for (const entry of results) {
    const object = await env.BUCKET.get('exams/' + entry.id + '.pdf');
    if (!object || (Number.isSafeInteger(object.size) && object.size !== rendered.pdf.size)) continue;
    if (await hashPdf(await new Response(object.body).arrayBuffer()) === hash) return entry;
  }
}

// Free-plan guard: stop publishing new assessments long before storage or writes could pass Cloudflare's free allowance.
// A page is roughly 100 to 130 KB, so the default page cap is about 4 GB of the 10 GB free R2 storage. Limits come from wrangler.jsonc.
async function checkPublishLimits(env) {
  const limit = (value, fallback) => value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const maxPages = limit(env.MAX_STORED_PAGES, 30000);
  const maxDaily = limit(env.MAX_DAILY_PUBLISHES, 300);
  const usage = await env.DB.prepare(
    "SELECT COALESCE(SUM(page_count), 0) AS pages, COALESCE(SUM(submitted_at > datetime('now', '-1 day')), 0) AS today FROM exam_bank"
  ).first();
  if (usage.pages >= maxPages || usage.today >= maxDaily) {
    console.error('LIMIT_REACHED: publishing is paused', JSON.stringify({ pages: usage.pages, today: usage.today, maxPages, maxDaily }));
    throw new ExportError(503, 'unmarked. has reached its free storage limit for now, so new assessments can’t be added. Please try again later.');
  }
}

async function saveExam(details, rendered, env) {
  const hash = await hashPdf(await rendered.pdf.arrayBuffer());
  const pageImages = JSON.stringify(rendered.pageImages);
  const matchingExam = env.DB.prepare('SELECT id, status FROM exam_bank WHERE content_hash = ?').bind(hash);
  let existing = await matchingExam.first();
  if (existing?.status !== 'approved') {
    existing = await findLegacyMatch(rendered, pageImages, hash, Boolean(existing), env) || existing;
  }
  // Only assessments whose course, term, and type were all recognised are added to the public bank. The rest are stored
  // hidden (status 'pending') so the person who converted still gets a preview and download.
  const recognised = Boolean(details.course && details.term && details.assessment);
  if (existing) {
    // A hidden copy of the same PDF is published once it is recognised. Removed ('rejected') copies stay removed.
    if (existing.status === 'pending' && recognised) {
      await checkPublishLimits(env);
      const promoted = await env.DB.prepare(
        "UPDATE exam_bank SET course = ?, term = ?, assessment = ?, assessment_number = ?, status = 'approved' WHERE id = ? AND status = 'pending'"
      ).bind(details.course, details.term, details.assessment, details.number ? Number(details.number) : null, existing.id).run();
      if (promoted.meta.changes) return { id: existing.id, status: 'published', published: true };
    }
    return { id: existing.id, status: existing.status === 'approved' ? 'duplicate' : 'unlisted', published: existing.status === 'approved' };
  }

  await checkPublishLimits(env);
  const id = crypto.randomUUID();
  const key = 'exams/' + id + '.pdf';
  await env.BUCKET.put(key, rendered.pdf, { httpMetadata: { contentType: 'application/pdf' } });
  try {
    const result = await env.DB.prepare(
      'INSERT INTO exam_bank (id, course, term, assessment, assessment_number, page_count, page_images, content_hash, status) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(content_hash) DO NOTHING"
    ).bind(id, details.course, details.term, details.assessment, details.number ? Number(details.number) : null,
      rendered.pageImages.length, pageImages, hash, recognised ? 'approved' : 'pending').run();
    if (result.meta.changes) return { id, status: recognised ? 'published' : 'unlisted', published: recognised };
  } catch (error) {
    await env.BUCKET.delete(key);
    throw error;
  }
  await env.BUCKET.delete(key);
  const winner = await matchingExam.first();
  return { id: winner.id, status: winner.status === 'approved' ? 'duplicate' : 'unlisted', published: winner.status === 'approved' };
}

async function createPdfPreview(id, filename, env) {
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomUUID();
  await env.DB.prepare('DELETE FROM pdf_previews WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO pdf_previews (token, exam_id, filename, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, id, filename, now + 2 * 60 * 60).run();
  return '/api/bank/preview/' + token + '.pdf';
}

async function readStoredPdf(id, filename, inline, headers, env) {
  const object = await env.BUCKET.get('exams/' + id + '.pdf');
  if (!object) return bankError('PDF not found.', 404);
  return new Response(object.body, { headers: {
    ...bankHeaders,
    ...headers,
    ...(Number.isSafeInteger(object.size) ? { 'Content-Length': String(object.size) } : {}),
    'Content-Type': 'application/pdf',
    'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + filename + '"',
  } });
}

async function getPdfPreview(token, env) {
  const preview = await env.DB.prepare('SELECT exam_id, filename FROM pdf_previews WHERE token = ? AND expires_at > ?')
    .bind(token, Math.floor(Date.now() / 1000)).first();
  if (!preview) return bankError('PDF preview expired. Prepare the PDF again.', 404);
  return readStoredPdf(preview.exam_id, preview.filename, true, { 'Referrer-Policy': 'no-referrer' }, env);
}

const bankFields = 'id, course, term, assessment, assessment_number, page_count';

async function listExams(url, env) {
  const ids = url.searchParams.get('ids');
  if (ids !== null) {
    // A saved or shared study list: fetch these assessments by id.
    if (!new RegExp('^' + entryId + '(?:,' + entryId + '){0,59}$').test(ids)) return bankError('Check the list link.');
    const list = ids.split(',');
    const { results: exams } = await env.DB.prepare(
      "SELECT " + bankFields + " FROM exam_bank WHERE status = 'approved' AND course <> '' AND id IN (" + list.map(() => '?').join(',') + ")"
    ).bind(...list).all();
    return bankJson({ exams, terms: [], courses: [] });
  }
  const course = normalizedCourse(url.searchParams.get('course'));
  const term = url.searchParams.get('term');
  const assessment = url.searchParams.get('assessment');
  const year = url.searchParams.get('year');
  const season = url.searchParams.get('season');
  if (!/^[A-Z0-9]{0,12}$/.test(course) || (term && !validTerm(term)) ||
      (year && !/^(?:19|20)\d{2}$/.test(year)) || (season && !/^[WSF]$/.test(season)) ||
      (assessment && !assessmentTypes.has(assessment))) return bankError('Check the search filters.');
  const exactCourse = url.searchParams.get('exact') === '1';
  const courseMatch = exactCourse ? course : course + '%';
  const coursePredicate = exactCourse ? 'course = ?' : 'course LIKE ?';
  const values = [courseMatch];
  let filters = '';
  if (term) { filters += ' AND term = ?'; values.push(term); }
  if (year) { filters += ' AND substr(term, 1, 4) = ?'; values.push(year); }
  if (season) { filters += ' AND substr(term, 6) = ?'; values.push(season); }
  if (assessment) { filters += ' AND assessment = ?'; values.push(assessment); }
  const { results: exams } = await env.DB.prepare(
    "SELECT " + bankFields + " FROM exam_bank WHERE status = 'approved' AND course <> '' AND " + coursePredicate + filters +
    " ORDER BY substr(term, 1, 4) DESC, CASE substr(term, 6) WHEN 'F' THEN 3 WHEN 'S' THEN 2 ELSE 1 END DESC, course, assessment, assessment_number LIMIT 200"
  ).bind(...values).all();
  const { results: terms } = await env.DB.prepare(
    "SELECT DISTINCT term FROM exam_bank WHERE status = 'approved' AND term <> '' AND " + coursePredicate
  ).bind(courseMatch).all();
  const { results: courses } = course && !exactCourse ? await env.DB.prepare(
    "SELECT course, COUNT(*) AS count FROM exam_bank WHERE status = 'approved' AND course <> '' AND course LIKE ? GROUP BY course ORDER BY course LIMIT 12"
  ).bind(course + '%').all() : { results: [] };
  return bankJson({ exams, terms: terms.map(row => row.term), courses });
}

// The first page of a public assessment as a JPEG, for link previews. The PDF already holds each page as a JPEG, so this
// reads just those bytes from R2 using the offsets recorded when the PDF was made.
async function getThumbnail(id, env) {
  const entry = await env.DB.prepare("SELECT page_images FROM exam_bank WHERE id = ? AND status = 'approved' AND course <> ''").bind(id).first();
  let first;
  try {
    first = JSON.parse(entry?.page_images || '[]')[0];
  } catch {
    // An unreadable record has no thumbnail.
  }
  if (!Array.isArray(first) || !Number.isSafeInteger(first[0]) || !Number.isSafeInteger(first[1]) || first[1] < 1) return bankError('Thumbnail not found.', 404);
  const object = await env.BUCKET.get('exams/' + id + '.pdf', { range: { offset: first[0], length: first[1] } });
  if (!object) return bankError('Thumbnail not found.', 404);
  return new Response(object.body, { headers: {
    'Content-Type': 'image/jpeg',
    'Content-Length': String(first[1]),
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function getBankPdf(id, inline, env) {
  const entry = await env.DB.prepare(
    'SELECT ' + bankFields + ', page_images, status FROM exam_bank WHERE id = ?'
  ).bind(id).first();
  if (!entry || entry.status !== 'approved') {
    return bankError('Assessment not found.', 404);
  }
  const filename = ([entry.course, entry.term, entry.assessment, entry.assessment_number].filter(Boolean).join('-') || 'pending-blank-assessment') + '.pdf';
  return readStoredPdf(id, filename, inline, {
    'X-Page-Images': entry.page_images,
    'X-Page-Count': String(entry.page_count),
  }, env);
}

async function bankSummary(env) {
  const approved = "status = 'approved' AND course <> ''";
  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS exams, COUNT(DISTINCT NULLIF(course, '')) AS courses FROM exam_bank WHERE " + approved
  ).first();
  const { results: recent } = await env.DB.prepare(
    "SELECT " + bankFields + " FROM exam_bank WHERE " + approved + " AND course <> '' AND term <> '' AND assessment <> '' ORDER BY submitted_at DESC, id LIMIT 6"
  ).all();
  const { results: courses } = await env.DB.prepare(
    "SELECT course, COUNT(*) AS count FROM exam_bank WHERE " + approved + " AND course <> '' GROUP BY course ORDER BY count DESC, course LIMIT 12"
  ).all();
  return bankJson({ exams: totals?.exams || 0, courseCount: totals?.courses || 0, recent, courses });
}

// Sync without accounts: a private 16-character code identifies one saved copy of a person's lists.
// Only a hash of the code is stored, and the code travels in a header so it never appears in a URL or log line.
const syncAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const syncShape = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/;

async function syncHash(code) {
  const normal = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!syncShape.test(normal)) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('blank-sync:' + normal));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function newSyncCode() {
  const letters = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => syncAlphabet[byte & 31]).join('');
  return letters.match(/.{4}/g).join('-');
}

// Same shape and limits as the lists kept in the browser: up to 20 lists of up to 60 assessments.
function cleanSyncLists(value) {
  const items = (Array.isArray(value) ? value : []).filter(item => item && /^[a-z0-9]{4,12}$/.test(item.id) && typeof item.name === 'string');
  // A deleted list is kept as a bare marker so other devices cannot bring it back.
  const gone = items.filter(item => item.gone === true).slice(-100).map(item => ({ id: item.id, name: '', ids: [], gone: true }));
  const lists = items
    .filter(item => item.gone !== true)
    .slice(0, 20)
    .map(item => ({
      id: item.id,
      name: item.name.slice(0, 40),
      ids: (Array.isArray(item.ids) ? item.ids : []).filter(id => new RegExp('^' + entryId + '$').test(id)).slice(0, 60),
    }));
  return [...lists, ...gone];
}

async function handleSync(request, url, env) {
  const mode = request.method;
  if (mode !== 'GET' && !allowedWriteOrigin(request, url)) return bankError('Forbidden.', 403);
  if (!env.DB) return bankError('Sync is unavailable.', 503);
  let body;
  if (mode === 'POST' || mode === 'PUT') {
    const text = await request.text();
    if (text.length > 64 * 1024) return bankError('That is too much to sync.', 413);
    try {
      body = JSON.parse(text);
    } catch {
      return bankError('Check the request.');
    }
  }
  if (mode === 'POST') {
    const limited = await rateLimit(request, env, 'sync-create');
    if (limited) return Response.json({ error: limited.message }, { status: 429, headers: { ...bankHeaders, 'Retry-After': String(limited.retryAfter) } });
    const limit = Number(env.MAX_DAILY_SYNC_PROFILES);
    const maxDaily = Number.isFinite(limit) && env.MAX_DAILY_SYNC_PROFILES !== '' && env.MAX_DAILY_SYNC_PROFILES !== undefined ? limit : 500;
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_profiles WHERE created_at > datetime('now', '-1 day')").first();
    if (today.n >= maxDaily) {
      console.error('LIMIT_REACHED: new sync codes paused', JSON.stringify({ today: today.n, maxDaily }));
      return bankError('Sync is busy right now. Try again later.', 503);
    }
    const code = newSyncCode();
    await env.DB.prepare('INSERT INTO sync_profiles (key_hash, data) VALUES (?, ?)')
      .bind(await syncHash(code), JSON.stringify(cleanSyncLists(body?.lists))).run();
    return bankJson({ code, version: 1 }, 201);
  }
  const key = await syncHash(request.headers.get('x-sync-code'));
  if (!key) return bankError('That code isn’t valid.', 400);
  const row = await env.DB.prepare('SELECT data, version FROM sync_profiles WHERE key_hash = ?').bind(key).first();
  if (!row) return bankError('That code wasn’t found.', 404);
  if (mode === 'GET') return bankJson({ lists: JSON.parse(row.data), version: row.version });
  if (mode === 'DELETE') {
    await env.DB.prepare('DELETE FROM sync_profiles WHERE key_hash = ?').bind(key).run();
    return bankJson({ ok: true });
  }
  if (mode === 'PUT') {
    const saved = row.version === body?.baseVersion && (await env.DB.prepare(
      "UPDATE sync_profiles SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE key_hash = ? AND version = ?"
    ).bind(JSON.stringify(cleanSyncLists(body.lists)), key, row.version).run()).meta.changes;
    if (!saved) {
      // Another device saved first. Hand back its copy so this device can merge and retry.
      const latest = await env.DB.prepare('SELECT data, version FROM sync_profiles WHERE key_hash = ?').bind(key).first();
      return bankJson({ lists: JSON.parse(latest.data), version: latest.version }, 409);
    }
    return bankJson({ version: row.version + 1 });
  }
  return bankError('Not found.', 404);
}

const reportReasons = new Set(['student-work', 'wrong-details', 'other']);

async function reportExam(request, env) {
  const limited = await rateLimit(request, env, 'report');
  if (limited) return Response.json({ error: limited.message }, { status: 429, headers: { ...bankHeaders, 'Retry-After': String(limited.retryAfter) } });
  const input = await request.json().catch(() => null);
  const unverified = await verifyTurnstile(request, env, input?.turnstileToken);
  if (unverified) return bankError(unverified.message, unverified.status);
  if (!new RegExp('^' + entryId + '$').test(input?.id) || !reportReasons.has(input?.reason)) {
    return bankError('Choose what is wrong with this assessment.');
  }
  const exam = await env.DB.prepare("SELECT id FROM exam_bank WHERE id = ? AND status = 'approved'").bind(input.id).first();
  if (!exam) return bankError('Assessment not found.', 404);
  // Reports never remove an entry by themselves. Cap per-exam volume so they cannot be used to flood the table.
  await env.DB.prepare(
    "INSERT INTO exam_reports (exam_id, reason) SELECT ?, ? WHERE (SELECT COUNT(*) FROM exam_reports WHERE exam_id = ?) < 50"
  ).bind(input.id, input.reason, input.id).run();
  return bankJson({ ok: true }, 201);
}

async function handleExamBank(request, url, env) {
  const path = url.pathname;
  const mode = request.method;
  if (mode === 'POST' && !allowedWriteOrigin(request, url)) return bankError('Forbidden.', 403);
  if (!env.DB || !env.BUCKET) return bankError('Assessment bank storage is unavailable.', 503);

  if (path === '/api/bank/exams' && mode === 'GET') return listExams(url, env);
  if (path === '/api/bank/summary' && mode === 'GET') return bankSummary(env);
  if (path === '/api/bank/courses' && mode === 'GET') {
    const { results: courses } = await env.DB.prepare(
      "SELECT course, COUNT(*) AS count, MAX(CASE WHEN term = '' THEN '' ELSE substr(term, 1, 4) || CASE substr(term, 6) WHEN 'F' THEN 3 WHEN 'S' THEN 2 ELSE 1 END END) AS latest " +
      "FROM exam_bank WHERE status = 'approved' AND course <> '' GROUP BY course ORDER BY course LIMIT 2000"
    ).all();
    return bankJson({ courses });
  }
  if (path === '/api/bank/report' && mode === 'POST') return reportExam(request, env);
  const preview = new RegExp('^/api/bank/preview/(' + entryId + ')\\.pdf$').exec(path);
  if (preview && mode === 'GET') return getPdfPreview(preview[1], env);
  const thumb = new RegExp('^/api/bank/thumb/(' + entryId + ')\\.jpg$').exec(path);
  if (thumb && mode === 'GET') return getThumbnail(thumb[1], env);
  const pdfMatch = new RegExp('^/api/bank/pdf/(' + entryId + ')$').exec(path);
  if (pdfMatch && mode === 'GET') return getBankPdf(pdfMatch[1], url.searchParams.get('view') === '1', env);
  return bankError('Not found.', 404);
}
