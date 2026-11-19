import { makePdf } from './pdf.js';

const crowdmarkOrigin = 'https://app.crowdmark.com';
const scorePath = /^\/score\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i;
const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

class ExportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
    pages.set(number, url);
  }
  const ordered = [...pages].sort(([a], [b]) => a - b);
  if (ordered.some(([number], index) => index > 0 && number !== ordered[index - 1][0] + 1)) {
    throw new ExportError(422, 'Some blank pages are missing from Crowdmark’s booklet.');
  }
  return { ordered, title: String(master.attributes?.title || 'Crowdmark assessment').slice(0, 180) };
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

async function exportAssessment(request) {
  const body = await readBytes(new Response(request.body, { headers: request.headers }), 48 * 1024);
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ExportError(400, 'Paste a valid Crowdmark results link.');
  }
  const id = scoreId(input?.link);
  let payload = input.template;
  if (payload?.data?.id !== id) {
    const response = await upstream(crowdmarkOrigin + '/api/v1/student/results/' + id, {
      headers: { Accept: 'application/json' },
    });
    if ([401, 403, 404].includes(response.status)) {
      throw new ExportError(404, 'Crowdmark couldn’t open this assessment. Check that the shareable results link opens while signed out.');
    }
    if (!response.ok) throw new Error('Crowdmark response failed.');
    payload = JSON.parse(new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024)));
  }
  const { ordered, title } = templatePages(payload);
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
      images.push(image);
    }
  }
  const { pdf, pageImages } = makePdf(images);
  const filename = (title.replace(/[^a-z\d]+/gi, '-').replace(/^-|-$/g, '') || 'crowdmark-assessment') + '-blank.pdf';
  return new Response(pdf, { headers: {
    ...privateHeaders,
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'X-Assessment-Title': encodeURIComponent(title),
    'X-Page-Images': JSON.stringify(pageImages),
    'X-Page-Count': String(images.length),
    'X-First-Page': String(ordered[0][0]),
    'X-Last-Page': String(ordered.at(-1)[0]),
  } });
}

export default {
  async fetch(request) {
    const { pathname, origin } = new URL(request.url);
    if (pathname === '/' && request.method === 'GET') {
      return new Response(HTML, { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' https://app.crowdmark.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        ...privateHeaders,
      } });
    }
    if (pathname !== '/api/export') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.has('origin') && request.headers.get('origin') !== origin) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      return await exportAssessment(request);
    } catch (error) {
      const known = error instanceof ExportError;
      return Response.json({ error: known ? error.message : 'The blank pages couldn’t be downloaded from Crowdmark. Try again in a moment.' }, {
        status: known ? error.status : 502,
        headers: privateHeaders,
      });
    }
  },
};
