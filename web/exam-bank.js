const bankView = document.querySelector('#bank-view');
const converterView = document.querySelector('#converter-view');
const bankCourse = document.querySelector('#bank-course');
const bankTerm = document.querySelector('#bank-term');
const bankAssessment = document.querySelector('#bank-assessment');
const bankList = document.querySelector('#bank-list');
const bankStatus = document.querySelector('#bank-status');
const bankSignin = document.querySelector('#bank-signin');
const bankReview = document.querySelector('#bank-review');
const contribution = document.querySelector('#contribution');
const contributionForm = document.querySelector('#contribution-form');
const contributionFile = document.querySelector('#contribution-file');
const contributionStatus = document.querySelector('#contribution-status');
const contributionSubmit = document.querySelector('#contribution-submit');
const seasons = { W: 'Winter', S: 'Spring', F: 'Fall' };
const termOrder = { W: 1, S: 2, F: 3 };
const submissionLimit = 24 * 1024 * 1024;
let bankRequest = 0;
let bankPreviewRequest = 0;
let bankSearchTimer;
let contributionSource;
let uploadCheck = 0;
let pdfLibrary;
let uploadAutofill = {};

function courseLabel(code) {
  return code.replace(/([A-Z]+)(\d)/, '$1 $2');
}

function termLabel(term) {
  return seasons[term.at(-1)] + ' ' + term.slice(0, 4);
}

function examLabel(exam) {
  return exam.assessment + (exam.assessment_number ? ' ' + exam.assessment_number : '');
}

async function bankFetch(path, options) {
  const response = await fetch('/api/bank/' + path, options);
  if (!response.ok) {
    const message = await response.json().catch(() => null);
    throw new Error(message?.error || 'The exam bank could not complete this request.');
  }
  return response;
}

function bankMode() {
  return location.hash === '#review' ? 'review' :
    location.hash.startsWith('#exam-bank') ? 'bank' : 'converter';
}

function goToBankCourse(course) {
  location.hash = 'exam-bank/' + course;
}

function applyBankRoute() {
  const mode = bankMode();
  clearTimeout(bankSearchTimer);
  bankRequest++;
  bankPreviewRequest++;
  hidePreview();
  converterView.hidden = mode !== 'converter';
  bankView.hidden = mode === 'converter';
  for (const link of document.querySelectorAll('.site-nav a')) {
    if ((link.hash === '#converter') === (mode === 'converter')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (mode === 'converter') return;

  const routeCourse = /^#exam-bank\/([A-Za-z]{2,8}\d{3}[A-Za-z]?)$/.exec(location.hash);
  if (routeCourse) bankCourse.value = courseLabel(routeCourse[1].toUpperCase());
  bankList.replaceChildren();
  bankSignin.hidden = true;
  bankStatus.textContent = '';
  document.querySelector('#bank-heading').textContent = mode === 'review' ? 'Review submissions' :
    routeCourse ? courseLabel(routeCourse[1].toUpperCase()) + ' Exams' : 'Waterloo Exam Bank';
  document.querySelector('#bank-filters').hidden = mode === 'review';
  document.querySelector('#bank-upload').hidden = mode === 'review';
  bankReview.textContent = mode === 'review' ? 'Back to exam bank' : 'Review submissions';
  if (mode === 'review') loadReviewQueue();
  else loadExamList();
}

function selectableTerms(terms) {
  const selected = bankTerm.value;
  const sorted = [...new Set([...terms, ...(selected ? [selected] : [])])].sort((a, b) =>
    b.slice(0, 4).localeCompare(a.slice(0, 4)) || termOrder[b.at(-1)] - termOrder[a.at(-1)]
  );
  bankTerm.replaceChildren(new Option('All terms', ''), ...sorted.map(term => new Option(termLabel(term), term)));
  bankTerm.value = selected;
}

async function loadExamList() {
  if (bankMode() !== 'bank') return;
  const request = ++bankRequest;
  bankList.replaceChildren();
  bankPreviewRequest++;
  hidePreview();
  const query = new URLSearchParams({
    course: bankCourse.value,
    term: bankTerm.value,
    assessment: bankAssessment.value,
  });
  bankStatus.textContent = 'Loading exams…';
  try {
    const { exams, terms } = await (await bankFetch('exams?' + query)).json();
    if (request !== bankRequest) return;
    selectableTerms(terms);
    bankStatus.textContent = exams.length ? '' : 'No approved exams match these filters.';
    const groups = Map.groupBy(exams, exam => exam.course);
    for (const [course, entries] of groups) {
      const heading = document.createElement('h2');
      heading.className = 'course-title';
      const link = document.createElement('a');
      link.href = '#exam-bank/' + course;
      link.textContent = courseLabel(course);
      heading.append(link);
      const group = document.createElement('section');
      group.className = 'panel';
      for (const exam of entries) group.append(createExamEntry(exam));
      bankList.append(heading, group);
    }
  } catch (error) {
    if (request === bankRequest) bankStatus.textContent = error.message;
  }
}

async function loadReviewQueue() {
  const request = ++bankRequest;
  bankStatus.textContent = 'Loading submissions…';
  try {
    const session = await (await bankFetch('session')).json();
    if (request !== bankRequest) return;
    if (!session.editor) {
      bankSignin.hidden = session.signedIn;
      bankStatus.textContent = session.signedIn ? 'This queue is available to exam bank editors.' : '';
      return;
    }
    const { exams } = await (await bankFetch('review')).json();
    if (request !== bankRequest) return;
    bankStatus.textContent = exams.length ? '' : 'No pending submissions.';
    bankList.replaceChildren();
    if (exams.length) {
      const queue = document.createElement('div');
      queue.className = 'panel';
      for (const exam of exams) queue.append(createExamEntry(exam, true));
      bankList.append(queue);
    }
  } catch (error) {
    if (request === bankRequest) bankStatus.textContent = error.message;
  }
}

function bankButton(label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  return button;
}

function createExamEntry(exam, review = false) {
  const article = document.createElement('article');
  article.className = 'bank-entry';
  const title = document.createElement('h3');
  title.textContent = (review ? courseLabel(exam.course) + ' · ' : '') + examLabel(exam);
  const details = document.createElement('p');
  details.className = 'exam-detail';
  details.textContent = termLabel(exam.term) + ' · ' + exam.page_count + (exam.page_count === 1 ? ' page' : ' pages');
  const actions = document.createElement('div');
  actions.className = 'bank-actions';
  const button = bankButton('Preview PDF');
  button.setAttribute('aria-controls', 'viewer');
  button.setAttribute('aria-expanded', 'false');
  const filePath = 'pdf/' + exam.id;
  let loadedPdf;
  let ranges;
  let onPreview;
  const feedback = document.createElement('p');
  feedback.className = 'bank-status';
  feedback.setAttribute('role', 'status');
  button.addEventListener('click', async () => {
    if (button === activePreview) {
      hidePreview();
      return;
    }
    const request = ++bankPreviewRequest;
    button.disabled = true;
    feedback.textContent = '';
    try {
      if (!loadedPdf) {
        const response = await bankFetch(filePath);
        ranges = JSON.parse(response.headers.get('X-Page-Images') || '[]');
        if (!ranges.length) throw new Error('This PDF has no preview pages.');
        loadedPdf = await response.blob();
      }
      if (request !== bankPreviewRequest) return;
      showPdf(button, loadedPdf, ranges);
      onPreview?.();
    } catch (error) {
      if (request === bankPreviewRequest) feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  actions.append(button);
  article.append(title, details, actions, feedback);
  if (!review) {
    const download = document.createElement('a');
    download.className = 'download';
    download.href = '/api/bank/' + filePath;
    download.textContent = 'Download PDF';
    actions.append(download);
    return article;
  }

  const confirmation = document.createElement('label');
  confirmation.className = 'check-row review-confirmation';
  const check = document.createElement('input');
  check.type = 'checkbox';
  confirmation.append(check, ' I reviewed every page and verified this is a blank exam.');
  confirmation.hidden = true;
  article.insertBefore(confirmation, actions);
  const approve = bankButton('Approve');
  approve.disabled = true;
  const reject = bankButton('Reject');
  actions.append(approve, reject);
  onPreview = () => { confirmation.hidden = false; };
  check.addEventListener('change', () => { approve.disabled = !check.checked; });

  async function decide(action) {
    approve.disabled = true;
    reject.disabled = true;
    feedback.textContent = '';
    try {
      await bankFetch('review/' + exam.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, blankConfirmed: check.checked }),
      });
      if (activePreview === button) hidePreview();
      if (bankMode() === 'review') loadReviewQueue();
    } catch (error) {
      feedback.textContent = error.message;
      approve.disabled = !check.checked;
      reject.disabled = false;
    }
  }
  approve.addEventListener('click', () => decide('approve'));
  reject.addEventListener('click', () => decide('reject'));
  return article;
}

bankCourse.addEventListener('input', () => {
  clearTimeout(bankSearchTimer);
  bankRequest++;
  if (location.hash.startsWith('#exam-bank/')) {
    history.replaceState(null, '', '#exam-bank');
    document.querySelector('#bank-heading').textContent = 'Waterloo Exam Bank';
  }
  bankSearchTimer = setTimeout(loadExamList, 220);
});
bankTerm.addEventListener('change', loadExamList);
bankAssessment.addEventListener('change', loadExamList);
bankReview.addEventListener('click', () => { location.hash = bankMode() === 'review' ? 'exam-bank' : 'review'; });
bankCourse.addEventListener('keydown', event => {
  const course = bankCourse.value.toUpperCase().replace(/\s/g, '');
  if (event.key === 'Enter' && /^[A-Z]{2,8}\d{3}[A-Z]?$/.test(course)) goToBankCourse(course);
});
window.addEventListener('hashchange', applyBankRoute);
applyBankRoute();

function inferMetadata(...sources) {
  const matches = { course: new Set(), term: new Set(), assessment: new Set(), assessmentNumber: new Set() };
  const seasonCodes = { WINTER: 'W', SPRING: 'S', SUMMER: 'S', FALL: 'F', AUTUMN: 'F' };
  for (const source of sources) {
    const text = String(source || '').slice(0, 2500).replace(/[_–—]/g, ' ').toUpperCase();
    for (const match of text.matchAll(/\b([A-Z]{2,8})[\s-]*(\d{3}[A-Z]?)\b/g)) {
      if (!/^(WINTER|SPRING|SUMMER|FALL|AUTUMN|MIDTERM|FINAL|TEST|EXAM|QUIZ|PAGE|MARKS)$/.test(match[1])) {
        matches.course.add(match[1] + match[2]);
      }
    }
    for (const match of text.matchAll(/\b(WINTER|SPRING|SUMMER|FALL|AUTUMN)[\s-]+((?:19|20)\d{2})\b|\b((?:19|20)\d{2})[\s-]+(WINTER|SPRING|SUMMER|FALL|AUTUMN)\b/g)) {
      matches.term.add((match[2] || match[3]) + '-' + seasonCodes[match[1] || match[4]]);
    }
    for (const match of text.matchAll(/\b([WSF])[ -]?(\d{2})\b|\b((?:19|20)\d{2})[ -]?([WSF])\b/g)) {
      const year = match[3] || ((Number(match[2]) > Number(String(new Date().getFullYear()).slice(-2)) ? '19' : '20') + match[2]);
      matches.term.add(year + '-' + (match[1] || match[4]));
    }
    for (const match of text.matchAll(/\b(MID[ -]?TERM|FINAL|QUIZ|TEST)(?:\s*(?:#|NO\.?\s*)?([1-9]\d?)(?!\d)\b)?/g)) {
      if (!/^(MID[ -]?TERM|FINAL|QUIZ|TEST)$/.test(match[1]) ||
          /[A-Z]/.test(text[match.index + match[0].length] || '')) continue;
      const type = match[1].replace(/[ -]/g, '').toLowerCase();
      matches.assessment.add(type[0].toUpperCase() + type.slice(1));
      if (match[2]) matches.assessmentNumber.add(match[2]);
    }
  }
  const values = Object.fromEntries(Object.entries(matches).map(([name, options]) =>
    [name, options.size === 1 ? [...options][0] : '']
  ));
  if (!values.assessment) values.assessmentNumber = '';
  return values;
}

function prefillContribution(values, previous = {}) {
  const fields = contributionForm.elements;
  const candidates = {
    course: values.course ? courseLabel(values.course) : '',
    year: values.term.slice(0, 4),
    season: values.term.at(-1) || '',
    assessment: values.assessment,
    assessmentNumber: values.assessmentNumber,
  };
  for (const [name, value] of Object.entries(candidates)) {
    if (fields[name].value === (previous[name] || '')) fields[name].value = value;
  }
  return candidates;
}

function openContribution(source) {
  uploadCheck++;
  contributionSource = source;
  uploadAutofill = {};
  contributionForm.reset();
  document.querySelector('#upload-field').hidden = !!source;
  contributionFile.required = !source;
  contributionStatus.textContent = 'Check the details and fill in anything missing.';
  contributionSubmit.disabled = false;
  if (source) prefillContribution(inferMetadata(source.title));
  contribution.showModal();
}

document.querySelector('#bank-upload').addEventListener('click', () => openContribution());
document.querySelector('#contribution-cancel').addEventListener('click', () => contribution.close());
contribution.addEventListener('cancel', event => {
  if (contributionForm.getAttribute('aria-busy') === 'true') event.preventDefault();
});
contribution.addEventListener('close', () => {
  uploadCheck++;
  contributionSource = undefined;
  contributionForm.reset();
});

async function readPdf(file) {
  if (!file || file.size > submissionLimit) throw new Error('Choose a PDF under 24 MB.');
  pdfLibrary ||= import('/pdfjs.mjs');
  const pdfjs = await pdfLibrary;
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs-worker.mjs';
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useWasm: false,
    enableXfa: false,
  }).promise;
}

contributionFile.addEventListener('change', async () => {
  const request = ++uploadCheck;
  const file = contributionFile.files[0];
  if (!file) return;
  const filename = file.name.replace(/\.pdf$/i, '');
  const prefilled = prefillContribution(inferMetadata(filename), uploadAutofill);
  uploadAutofill = prefilled;
  contributionStatus.textContent = 'Reading the first page…';
  contributionSubmit.disabled = true;
  try {
    const doc = await readPdf(file);
    try {
      const first = await doc.getPage(1);
      const content = await first.getTextContent();
      const text = content.items.map(item => item.str || '').join(' ');
      if (request !== uploadCheck) return;
      uploadAutofill = prefillContribution(inferMetadata(filename, text), prefilled);
      contributionStatus.textContent = 'Check the details and fill in anything missing.';
    } finally {
      await doc.destroy();
    }
  } catch {
    if (request === uploadCheck) contributionStatus.textContent = 'Could not read the first page. Check the file and fill in the exam details.';
  } finally {
    if (request === uploadCheck) contributionSubmit.disabled = false;
  }
});

async function renderUpload(file) {
  const doc = await readPdf(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const pages = [];
  try {
    if (!doc.numPages || doc.numPages > 40) throw new Error('A submission must have 1–40 pages.');
    let total = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      contributionStatus.textContent = 'Preparing page ' + pageNumber + ' of ' + doc.numPages + '…';
      const page = await doc.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1800 / Math.max(width, height) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport, annotationMode: 0 }).promise;
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .91));
      if (!image) throw new Error('Could not prepare every PDF page.');
      total += image.size;
      if (total > submissionLimit) throw new Error('The prepared pages exceed 24 MB.');
      pages.push(image);
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

contributionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (contributionSubmit.disabled) return;
  contributionSubmit.disabled = true;
  const cancel = document.querySelector('#contribution-cancel');
  cancel.disabled = true;
  contributionForm.setAttribute('aria-busy', 'true');
  contributionStatus.textContent = 'Preparing PDF…';
  const details = new FormData(contributionForm);
  const source = contributionSource;
  try {
    const images = source ? source.ranges.map(([offset, length]) =>
      source.pdf.slice(offset, offset + length, 'image/jpeg')
    ) : await renderUpload(contributionFile.files[0]);
    const submission = new FormData();
    submission.set('course', details.get('course'));
    submission.set('term', details.get('year') + '-' + details.get('season'));
    submission.set('assessment', details.get('assessment'));
    submission.set('assessmentNumber', details.get('assessmentNumber'));
    submission.set('blankConfirmed', 'yes');
    images.forEach(image => submission.append('page', image, 'page.jpg'));
    contributionStatus.textContent = 'Submitting for review…';
    await bankFetch('submissions', { method: 'POST', body: submission });
    contribution.close();
    const message = 'Submitted. Your PDF is pending editor review.';
    if (bankMode() === 'converter') {
      status.classList.remove('error');
      status.textContent = message;
    } else {
      ++bankRequest;
      bankStatus.textContent = message;
    }
  } catch (error) {
    contributionStatus.textContent = error.message || 'The PDF could not be submitted.';
  } finally {
    contributionSubmit.disabled = false;
    cancel.disabled = false;
    contributionForm.removeAttribute('aria-busy');
  }
});
