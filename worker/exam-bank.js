import { makePdf } from './pdf.js';

const assessmentTypes = new Set(['Midterm', 'Final', 'Quiz', 'Test', 'Other']);
const maxSubmission = 24 * 1024 * 1024;
const entryId = '[a-f0-9-]{36}';
const bankHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function bankJson(data, status = 200) {
  return Response.json(data, { status, headers: bankHeaders });
}

function bankError(message, status = 400) {
  return bankJson({ error: message }, status);
}

function isBankEditor(request, env) {
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return !!(email && request.headers.get('oai-authenticated-user-id') &&
    env.EXAM_BANK_EDITORS?.split(',').some(editor => editor.trim().toLowerCase() === email));
}

function normalizedCourse(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function validTerm(value) {
  return /^(?:19|20)\d{2}-[WSF]$/.test(value);
}

function validateExam(fields) {
  const course = normalizedCourse(fields?.course);
  const term = String(fields?.term || '');
  const assessment = String(fields?.assessment || '');
  const numberText = String(fields?.assessmentNumber || '').trim();
  if (!/^[A-Z]{2,8}\d{3}[A-Z]?$/.test(course) || !validTerm(term) ||
      !assessmentTypes.has(assessment) || (numberText && !/^[1-9]\d?$/.test(numberText))) return;
  return { course, term, assessment, number: numberText ? Number(numberText) : null };
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

async function submitExam(request, env) {
  const limit = maxSubmission + 128 * 1024;
  const length = Number(request.headers.get('content-length'));
  if (length > limit) return bankError('The submitted pages exceed the 24 MB limit.', 413);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) return bankError('Select a blank PDF.');
  let form;
  try {
    const data = await readBytes(new Response(request.body, { headers: request.headers }), limit);
    form = await new Response(data, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
  } catch {
    return bankError('The upload could not be read or exceeds 24 MB.', 413);
  }
  const fields = Object.fromEntries(form);
  const details = validateExam(fields);
  if (!details || form.get('blankConfirmed') !== 'yes') return bankError('Confirm the PDF is blank and complete the exam details.');
  if (fields.duplicateConfirmed !== 'yes' && (await comparableExams(details, env)).length) {
    return bankError('Similar exams already exist. Check them before contributing this copy.', 409);
  }
  const pages = form.getAll('page');
  if (!pages.length || pages.length > 40 || pages.some(page => typeof page === 'string' || page.size > 4 * 1024 * 1024)) {
    return bankError('A submission must have 1–40 readable pages, up to 4 MB per page.', 422);
  }

  let rendered;
  try {
    const images = [];
    for (const page of pages) images.push(cleanJpeg(new Uint8Array(await page.arrayBuffer())));
    if (images.reduce((total, image) => total + image.length, 0) > maxSubmission) {
      return bankError('The submitted pages exceed the 24 MB limit.', 413);
    }
    rendered = makePdf(images);
  } catch {
    return bankError('One or more pages could not be converted to a blank PDF.', 422);
  }

  await savePendingExam(details, rendered, env);
  return bankJson({ status: 'pending' }, 201);
}

async function savePendingExam(details, rendered, env) {
  const id = crypto.randomUUID();
  const key = 'exams/' + id + '.pdf';
  await env.BUCKET.put(key, rendered.pdf, { httpMetadata: { contentType: 'application/pdf' } });
  try {
    await env.DB.prepare(
      'INSERT INTO exam_bank (id, course, term, assessment, assessment_number, page_count, page_images) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, details.course, details.term, details.assessment, details.number, rendered.pageImages.length,
      JSON.stringify(rendered.pageImages)).run();
  } catch (error) {
    await env.BUCKET.delete(key);
    throw error;
  }
}

const bankFields = 'id, course, term, assessment, assessment_number, page_count';

async function listExams(url, env) {
  const course = normalizedCourse(url.searchParams.get('course'));
  const term = url.searchParams.get('term');
  const assessment = url.searchParams.get('assessment');
  if (!/^[A-Z0-9]{0,12}$/.test(course) || (term && !validTerm(term)) ||
      (assessment && !assessmentTypes.has(assessment))) return bankError('Check the search filters.');
  const exactCourse = url.searchParams.get('exact') === '1';
  const courseMatch = exactCourse ? course : course + '%';
  const coursePredicate = exactCourse ? 'course = ?' : 'course LIKE ?';
  const values = [courseMatch];
  let filters = '';
  if (term) { filters += ' AND term = ?'; values.push(term); }
  if (assessment) { filters += ' AND assessment = ?'; values.push(assessment); }
  const { results: exams } = await env.DB.prepare(
    "SELECT " + bankFields + " FROM exam_bank WHERE status = 'approved' AND " + coursePredicate + filters +
    " ORDER BY substr(term, 1, 4) DESC, CASE substr(term, 6) WHEN 'F' THEN 3 WHEN 'S' THEN 2 ELSE 1 END DESC, course, assessment, assessment_number LIMIT 200"
  ).bind(...values).all();
  const { results: terms } = await env.DB.prepare(
    "SELECT DISTINCT term FROM exam_bank WHERE status = 'approved' AND " + coursePredicate
  ).bind(courseMatch).all();
  const { results: courses } = course && !exactCourse ? await env.DB.prepare(
    "SELECT course, COUNT(*) AS count FROM exam_bank WHERE status = 'approved' AND course LIKE ? GROUP BY course ORDER BY course LIMIT 12"
  ).bind(course + '%').all() : { results: [] };
  return bankJson({ exams, terms: terms.map(row => row.term), courses });
}

async function comparableExams(details, env) {
  const { results } = await env.DB.prepare(
    "SELECT " + bankFields + " FROM exam_bank WHERE status = 'approved' AND course = ? AND term = ? AND assessment = ?" +
    " AND (? IS NULL OR assessment_number IS NULL OR assessment_number = ?) LIMIT 10"
  ).bind(details.course, details.term, details.assessment, details.number, details.number).all();
  return results;
}

async function getBankPdf(id, editor, inline, env) {
  const entry = await env.DB.prepare(
    'SELECT ' + bankFields + ', page_images, status FROM exam_bank WHERE id = ?'
  ).bind(id).first();
  if (!entry || (entry.status !== 'approved' && !(editor && entry.status === 'pending'))) {
    return bankError('Exam not found.', 404);
  }
  const object = await env.BUCKET.get('exams/' + id + '.pdf');
  if (!object) return bankError('PDF not found.', 404);
  const filename = [entry.course, entry.term, entry.assessment, entry.assessment_number].filter(Boolean).join('-') + '.pdf';
  return new Response(object.body, { headers: {
    ...bankHeaders,
    'Content-Type': 'application/pdf',
    'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + filename + '"',
    'X-Page-Images': entry.page_images,
    'X-Page-Count': String(entry.page_count),
  } });
}

async function handleExamBank(request, url, env) {
  const path = url.pathname;
  const mode = request.method;
  if (mode === 'POST' && request.headers.get('origin') !== url.origin) return bankError('Forbidden.', 403);
  const editor = isBankEditor(request, env);
  if (path === '/api/bank/session' && mode === 'GET') {
    return bankJson({ editor, signedIn: !!request.headers.get('oai-authenticated-user-id') });
  }
  const reviewRoute = path === '/api/bank/review' || path.startsWith('/api/bank/review/');
  if (reviewRoute && !editor) return bankError('Editor access required.', 403);
  if (!env.DB || !env.BUCKET) return bankError('Exam bank storage is unavailable.', 503);

  if (path === '/api/bank/exams' && mode === 'GET') return listExams(url, env);
  if (path === '/api/bank/similar' && mode === 'GET') {
    const details = validateExam(Object.fromEntries(url.searchParams));
    return bankJson({ exams: details ? await comparableExams(details, env) : [] });
  }
  if (path === '/api/bank/submissions' && mode === 'POST') return submitExam(request, env);
  const pdfMatch = new RegExp('^/api/bank/pdf/(' + entryId + ')$').exec(path);
  if (pdfMatch && mode === 'GET') return getBankPdf(pdfMatch[1], editor, url.searchParams.get('view') === '1', env);
  if (path === '/api/bank/review' && mode === 'GET') {
    const { results: exams } = await env.DB.prepare(
      "SELECT " + bankFields + " FROM exam_bank WHERE status = 'pending' ORDER BY submitted_at, id LIMIT 200"
    ).all();
    return bankJson({ exams });
  }
  const review = new RegExp('^/api/bank/review/(' + entryId + ')$').exec(path);
  if (review && mode === 'POST') {
    const input = await request.json().catch(() => null);
    if (input?.action !== 'reject' && !(input?.action === 'approve' && input.blankConfirmed === true)) {
      return bankError('Confirm the PDF has been checked before approving it.');
    }
    const state = input.action === 'approve' ? 'approved' : 'rejected';
    const result = await env.DB.prepare(
      "UPDATE exam_bank SET status = ? WHERE id = ? AND status = 'pending'"
    ).bind(state, review[1]).run();
    if (!result.meta.changes) return bankError('This submission has already been reviewed or removed.', 409);
    return bankJson({ status: state });
  }
  return bankError('Not found.', 404);
}
