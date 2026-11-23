import { makePdf } from './pdf.js';

const crowdmarkOrigin = 'https://app.crowdmark.com';
// Writes must come from this site's own pages. (The Origin header can be faked by a script, which is why the
// guards in guard.js, not this check, are what actually limit abuse.)
function allowedWriteOrigin(request, url) {
  return request.headers.get('origin') === url.origin;
}
const scorePath = /^\/score\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i;
const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

class ExportError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function scoreId(value) {
  let url;
  try {
    if (typeof value === 'string' && value.length <= 2048) url = new URL(value.trim());
  } catch {
    // Invalid links share the same error message.
  }
  const match = url?.origin === crowdmarkOrigin && !url.username && !url.password && scorePath.exec(url.pathname);
  if (!match) throw new ExportError(400, 'Paste a Crowdmark results link from Get shareable link.');
  return match[1].toLowerCase();
}

function templatePages(payload) {
  const exam = payload?.data;
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const resource = (reference) => included.find(item => item.type === reference?.type && item.id === reference.id);
  const master = resource(exam?.relationships?.['exam-master']?.data);
  const refs = master?.relationships?.['exam-master-pages']?.data;
  if (!Array.isArray(refs) || !refs.length) {
    throw new ExportError(422, 'Crowdmark does not provide blank booklet pages for this link. Use the original assessment PDF if you have it.');
  }
  if (refs.length > 40) throw new ExportError(422, 'This booklet exceeds the 40-page export limit.');

  const pages = new Map();
  let booklet;
  for (const ref of refs) {
    const row = ref.type === 'exam-master-pages' ? resource(ref) : undefined;
    const raw = row?.attributes;
    // Crowdmark can wrap the attributes and relationship metadata in an array.
    const attributes = Array.isArray(raw) ? raw[0] : raw;
    const number = attributes?.number;
    if (!Number.isInteger(number) || number < 1 || pages.has(number)) {
      throw new ExportError(422, 'Crowdmark returned an incomplete or ambiguous booklet.');
    }
    let url;
    try {
      url = new URL(attributes.url);
    } catch {
      throw new ExportError(422, 'Crowdmark did not provide every blank booklet page.');
    }
    if (url.origin !== 'https://assets.crowdmark.com' || url.username || url.password ||
        !/^\/exam_masters\/[a-z0-9_-]+\/preview_jpegs\/[a-z0-9_-]+\.jpe?g$/i.test(url.pathname)) {
      throw new ExportError(422, 'Crowdmark returned an unrecognized blank-page format.');
    }
    const assetBooklet = url.pathname.split('/')[2];
    if (booklet && assetBooklet !== booklet) throw new ExportError(422, 'The blank pages come from different booklets.');
    booklet = assetBooklet;
    pages.set(number, url);
  }
  const ordered = [...pages].sort(([a], [b]) => a - b);
  if (ordered.some(([number], index) => index > 0 && number !== ordered[index - 1][0] + 1)) {
    throw new ExportError(422, 'Some blank pages are missing from Crowdmark’s booklet.');
  }
  return { ordered, booklet };
}

async function upstream(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return fetch(url, {
    ...init,
    headers,
    redirect: 'manual',
    cf: { cacheTtl: 0 },
    signal: AbortSignal.timeout(12000),
  });
}

async function readBytes(response, limit) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    throw new ExportError(422, 'One of the source files is too large to export.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ExportError(422, 'One of the source files is too large to export.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fetchResults(id) {
  const response = await upstream(crowdmarkOrigin + '/api/v1/student/results/' + id, {
    headers: { Accept: 'application/json' },
  });
  if ([401, 403, 404].includes(response.status)) {
    throw new ExportError(404, 'Crowdmark couldn’t open this assessment. Check that the shareable results link opens while signed out.');
  }
  if (!response.ok) throw new Error('Crowdmark response failed.');
  return JSON.parse(new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024)));
}

// The course name ("STAT 230 - Fall 2026") and assessment title that came with the results, used only to fill in
// whatever the booklet name did not give. The pages themselves always come from Crowdmark's own asset host.
function crowdmarkLabels(payload) {
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const text = value => (typeof value === 'string' ? value.slice(0, 120) : '');
  const course = text(included.find(item => item.type === 'courses')?.attributes?.name);
  const title = text(included.find(item => item.type === 'exam-masters')?.attributes?.title);
  return course + ' ' + title;
}

async function exportAssessment(request, env) {
  const body = await readBytes(new Response(request.body, { headers: request.headers }), 48 * 1024);
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ExportError(400, 'Paste a valid Crowdmark results link.');
  }
  const id = scoreId(input?.link);
  if (input?.submitForReview !== true) {
    throw new ExportError(422, 'Refresh blank. before preparing this PDF.');
  }
  if (!env.DB || !env.BUCKET) throw new ExportError(503, 'The assessment bank is currently unavailable.');
  // Both guards run before anything is requested from Crowdmark.
  const limited = await rateLimit(request, env, 'export');
  if (limited) throw new ExportError(429, limited.message, { 'Retry-After': String(limited.retryAfter) });
  const unverified = await verifyTurnstile(request, env, input.turnstileToken);
  if (unverified) throw new ExportError(unverified.status, unverified.message);
  let payload = input.template;
  if (payload?.data?.id !== id) payload = await fetchResults(id);
  const { ordered, booklet } = templatePages(payload);
  const images = [];
  let total = 0;
  for (let start = 0; start < ordered.length; start += 4) {
    const batch = ordered.slice(start, start + 4);
    const files = await Promise.all(batch.map(async ([, url]) => {
      const image = await upstream(url);
      if (!image.ok || !/^image\/jpeg\b/i.test(image.headers.get('content-type') || '')) {
        throw new Error('Blank page unavailable.');
      }
      return readBytes(image, 4 * 1024 * 1024);
    }));
    for (const image of files) {
      total += image.length;
      if (total > 24 * 1024 * 1024) throw new ExportError(422, 'This booklet exceeds the 24 MB export limit.');
      images.push(cleanJpeg(image));
    }
  }
  let details = detectFromLabel(booklet);
  if (!(details.course && details.term && details.assessment)) details = detectDetails(booklet, crowdmarkLabels(payload));
  const rendered = makePdf(images);
  const entry = await saveExam(details, rendered, env);
  const { pdf, pageImages } = rendered;
  const term = details.term && { W: 'Winter', S: 'Spring', F: 'Fall' }[details.term.at(-1)] + ' ' + details.term.slice(0, 4);
  const course = details.course.replace(/([A-Z]+)(\d)/, '$1 $2');
  const title = [term, course, details.assessment, details.number].filter(Boolean).join(' ') || 'Crowdmark assessment';
  const filename = (title.replace(/[^a-z\d]+/gi, '-').replace(/^-|-$/g, '') || 'crowdmark-assessment') + '-blank.pdf';
  return new Response(pdf, { headers: {
    ...privateHeaders,
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'X-Assessment-Title': encodeURIComponent(title),
    'X-Bank-Status': entry.status,
    ...(entry.published ? { 'X-Bank-Published': '1' } : {}),
    // What the page needs to offer Copy link, Add to list and Report on a public entry.
    ...(entry.published ? { 'X-Bank-Exam': JSON.stringify({ id: entry.id, course: details.course, term: details.term, assessment: details.assessment, assessment_number: details.number || null, page_count: images.length }) } : {}),
    ...(input.nativePreview === true ? { 'X-PDF-Preview': await createPdfPreview(entry.id, filename, env) } : {}),
    'X-Page-Images': JSON.stringify(pageImages),
    'X-Page-Count': String(images.length),
    'X-First-Page': String(ordered[0][0]),
    'X-Last-Page': String(ordered.at(-1)[0]),
  } });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === '/api/sync') {
    try {
      return await handleSync(request, url, env);
    } catch (error) {
      console.error('Sync request failed:', error.name, error.message.split('\n')[0]);
      return bankError('Sync could not complete this request.', 502);
    }
  }
  if (pathname.startsWith('/api/bank/')) {
    try {
      return await handleExamBank(request, url, env);
    } catch (error) {
      console.error('Assessment bank request failed:', error.name, error.message.split('\n')[0]);
      return bankError('The assessment bank could not complete this request.', 502);
    }
  }
  if (request.method === 'GET' && Object.hasOwn(APP_ASSETS, pathname)) {
    const [contentType, content] = APP_ASSETS[pathname];
    return new Response(content, { headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    } });
  }
  const sharePath = /^\/(?:e\/[a-f0-9-]{36}|[A-Za-z]{2,8}\d{3}[A-Za-z]?)$/.test(pathname);
  if ((pathname === '/' || sharePath) && request.method === 'GET') {
    // The Turnstile site key is public config. The challenge host is only allowed by the page's CSP when a key is set.
    const siteKey = turnstileSiteKey(env);
    const challenge = siteKey ? ' https://challenges.cloudflare.com' : '';
    let page = siteKey ? HTML.replace('name="turnstile-site-key" content=""', 'name="turnstile-site-key" content="' + siteKey + '"') : HTML;
    const meta = sharePath ? await sharePageMeta(pathname, env) : undefined;
    if (meta) {
      const title = escapeHtml(meta.title + ' · blank.');
      const description = escapeHtml(meta.description);
      page = page
        .replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>')
        .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + description + '">')
        .replace('</head>', '<meta property="og:type" content="website"><meta property="og:site_name" content="blank."><meta property="og:title" content="' + title + '"><meta property="og:description" content="' + description + '"><meta property="og:url" content="' + escapeHtml(url.origin + pathname) + '"><meta name="twitter:card" content="summary"></head>');
    }
    return new Response(page, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'" + challenge + "; worker-src 'self'; frame-src 'self' blob:" + challenge + "; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' https://app.crowdmark.com" + challenge + "; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      ...privateHeaders,
    } });
  }
  if (pathname !== '/api/export') return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  if (!allowedWriteOrigin(request, url)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    return await exportAssessment(request, env);
  } catch (error) {
    const known = error instanceof ExportError;
    return Response.json({ error: known ? error.message : 'The blank pages couldn’t be downloaded from Crowdmark. Try again in a moment.' }, {
      status: known ? error.status : 502,
      headers: { ...privateHeaders, ...(known ? error.headers : {}) },
    });
  }
}

export default {
  fetch: (request, env = {}) => handleRequest(request, env),
};
