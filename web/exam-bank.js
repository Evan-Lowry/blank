const bankView = document.querySelector('#bank-view');
const converterView = document.querySelector('#converter-view');
const bankCourse = document.querySelector('#bank-course');
const headerSearch = document.querySelector('#course-search');
const bankNav = document.querySelector('#bank-nav');
const courseMatches = document.querySelector('#course-matches');
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
const reviewTypes = ['Midterm', 'Final', 'Quiz', 'Test', 'Exam', 'Assignment', 'Lab', 'Tutorial', 'Project', 'Practice', 'Other'];
let bankRequest = 0;
let bankSearchTimer;
let headerQueryVersion = 0;
let pdfLibrary;

function courseKey(value) {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

function courseLabel(code) {
  return code.replace(/([A-Z]+)(\d)/, '$1 $2');
}

function termLabel(term) {
  return term ? seasons[term.at(-1)] + ' ' + term.slice(0, 4) : 'Term unknown';
}

function examLabel(exam) {
  return (exam.assessment || 'Unclassified assessment') + (exam.assessment_number ? ' ' + exam.assessment_number : '');
}

async function bankFetch(path, options) {
  const response = await fetch(apiBase + '/api/bank/' + path, options);
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
  hidePreview();
  converterView.hidden = mode !== 'converter';
  bankView.hidden = mode === 'converter';
  if (mode === 'converter') bankNav.removeAttribute('aria-current');
  else bankNav.setAttribute('aria-current', 'page');
  courseMatches.hidden = true;
  headerQueryVersion++;
  if (mode === 'converter') return;

  const routeCourse = /^#exam-bank\/([A-Za-z]{2,8}\d{3}[A-Za-z]?)$/.exec(location.hash);
  if (routeCourse) bankCourse.value = courseLabel(routeCourse[1].toUpperCase());
  bankList.replaceChildren();
  bankSignin.hidden = true;
  bankStatus.textContent = '';
  document.querySelector('#bank-heading').textContent = mode === 'review' ? 'Review submissions' :
    routeCourse ? courseLabel(routeCourse[1].toUpperCase()) + ' Exams' : 'Waterloo Exam Bank';
  document.querySelector('#bank-filters').hidden = mode === 'review';
  courseMatches.hidden = true;
  document.querySelector('#bank-upload').hidden = mode === 'review';
  bankReview.hidden = mode !== 'review';
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

async function loadExamList({ notice } = {}) {
  if (bankMode() !== 'bank') return;
  const request = ++bankRequest;
  bankList.replaceChildren();
  hidePreview();
  const query = new URLSearchParams({
    course: courseKey(bankCourse.value),
    term: bankTerm.value,
    assessment: bankAssessment.value,
    exact: location.hash.startsWith('#exam-bank/') ? '1' : '0',
  });
  bankStatus.textContent = 'Loading exams…';
  try {
    const { exams, terms, courses } = await (await bankFetch('exams?' + query)).json();
    if (request !== bankRequest) return;
    selectableTerms(terms);
    const coursePage = location.hash.startsWith('#exam-bank/');
    showCourseMatches(coursePage ? [] : courses);
    bankStatus.textContent = notice || (exams.length ? '' : 'No exams match these filters.');
    const groups = Map.groupBy(exams, exam => exam.course);
    for (const [course, entries] of groups) {
      const heading = document.createElement('h2');
      heading.className = 'course-title';
      if (course) {
        const link = document.createElement('a');
        link.href = '#exam-bank/' + course;
        link.textContent = courseLabel(course);
        heading.append(link);
      } else heading.textContent = 'Course unknown';
      const group = document.createElement('section');
      group.className = 'panel';
      for (const exam of entries) group.append(createExamEntry(exam));
      if (!coursePage) bankList.append(heading);
      bankList.append(group);
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
  title.textContent = (review && exam.course ? courseLabel(exam.course) + ' · ' : '') + examLabel(exam);
  const details = document.createElement('p');
  details.className = 'exam-detail';
  details.textContent = termLabel(exam.term) + ' · ' + exam.page_count + (exam.page_count === 1 ? ' page' : ' pages');
  const actions = document.createElement('div');
  actions.className = 'bank-actions';
  const button = bankButton('Preview PDF');
  button.setAttribute('aria-controls', 'viewer');
  button.setAttribute('aria-expanded', 'false');
  const filePath = 'pdf/' + exam.id;
  let onPreview;
  const feedback = document.createElement('p');
  feedback.className = 'bank-status';
  feedback.setAttribute('role', 'status');
  button.addEventListener('click', () => {
    const opening = button !== activePreview;
    showPdf(button, apiBase + '/api/bank/' + filePath + '?view=1');
    if (opening) onPreview?.();
  });
  actions.append(button);
  article.append(title, details, actions, feedback);
  if (!review) {
    const download = document.createElement('a');
    download.className = 'download';
    download.href = apiBase + '/api/bank/' + filePath;
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
  const metadata = editorMetadata(exam);
  article.insertBefore(metadata.group, confirmation);
  metadata.group.hidden = true;
  onPreview = () => {
    confirmation.hidden = false;
    metadata.group.hidden = false;
  };
  const validateReview = () => { approve.disabled = !check.checked || !metadata.valid(); };
  check.addEventListener('change', validateReview);
  metadata.group.addEventListener('input', validateReview);
  metadata.group.addEventListener('change', validateReview);

  async function decide(action) {
    approve.disabled = true;
    reject.disabled = true;
    feedback.textContent = '';
    try {
      await bankFetch('review/' + exam.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, blankConfirmed: check.checked, details: metadata.details() }),
      });
      if (activePreview === button) hidePreview();
      if (bankMode() === 'review') loadReviewQueue();
    } catch (error) {
      feedback.textContent = error.message;
      validateReview();
      reject.disabled = false;
    }
  }
  approve.addEventListener('click', () => decide('approve'));
  reject.addEventListener('click', () => decide('reject'));
  return article;
}

function editorMetadata(exam) {
  const group = document.createElement('div');
  group.className = 'contribution-fields';
  function field(label, input) {
    const item = document.createElement('label');
    item.className = 'form-field';
    item.append(label, input);
    group.append(item);
    return input;
  }
  function input(label, value, maxLength) {
    const element = document.createElement('input');
    element.value = value;
    element.maxLength = maxLength;
    return field(label, element);
  }
  function select(label, options, value) {
    const element = document.createElement('select');
    element.append(new Option('Choose ' + label.toLowerCase(), ''), ...options);
    element.value = value;
    return field(label, element);
  }
  const course = input('Course code', courseLabel(exam.course), 16);
  const year = input('Year', exam.term.slice(0, 4), 4);
  year.inputMode = 'numeric';
  const term = select('Term', Object.entries(seasons).map(([code, name]) => new Option(name, code)), exam.term.at(-1) || '');
  const assessment = select('Assessment type', reviewTypes.map(type => new Option(type)), exam.assessment);
  const number = input('Assessment number (optional)', exam.assessment_number || '', 2);
  number.inputMode = 'numeric';
  function details() {
    return {
      course: courseKey(course.value), term: year.value.trim() + '-' + term.value,
      assessment: assessment.value, assessmentNumber: number.value.trim(),
    };
  }
  function valid() {
    const data = details();
    return /^[A-Z]{2,8}\d{3}[A-Z]?$/.test(data.course) &&
      /^(?:19|20)\d{2}-[WSF]$/.test(data.term) && !!data.assessment &&
      (!data.assessmentNumber || /^[1-9]\d?$/.test(data.assessmentNumber));
  }
  return { group, details, valid };
}

function showCourseMatches(courses) {
  courseMatches.replaceChildren();
  for (const match of courses) {
    const link = document.createElement('a');
    link.href = '#exam-bank/' + match.course;
    link.textContent = courseLabel(match.course) + ' · ' + match.count + (match.count === 1 ? ' exam' : ' exams');
    link.addEventListener('click', () => { courseMatches.hidden = true; });
    courseMatches.append(link);
  }
  courseMatches.hidden = !courses.length || !headerSearch.contains(document.activeElement);
}

async function searchFromHeader() {
  const course = courseKey(bankCourse.value);
  const version = ++headerQueryVersion;
  if (!/^[A-Z0-9]{1,12}$/.test(course)) {
    showCourseMatches([]);
    return;
  }
  try {
    const { courses } = await (await bankFetch('exams?' + new URLSearchParams({ course }))).json();
    if (version === headerQueryVersion) showCourseMatches(courses);
  } catch {
    if (version === headerQueryVersion) showCourseMatches([]);
  }
}

bankCourse.addEventListener('input', () => {
  clearTimeout(bankSearchTimer);
  headerQueryVersion++;
  bankRequest++;
  if (location.hash.startsWith('#exam-bank/')) {
    history.replaceState(null, '', '#exam-bank');
    document.querySelector('#bank-heading').textContent = 'Waterloo Exam Bank';
  }
  bankSearchTimer = setTimeout(bankMode() === 'bank' ? loadExamList : searchFromHeader, 220);
});
headerSearch.addEventListener('submit', event => {
  event.preventDefault();
  courseMatches.hidden = true;
  const course = courseKey(bankCourse.value);
  if (/^[A-Z]{2,8}\d{3}[A-Z]?$/.test(course)) goToBankCourse(course);
  else if (bankMode() !== 'bank') location.hash = 'exam-bank';
  else loadExamList();
});
headerSearch.addEventListener('focusout', event => {
  if (!headerSearch.contains(event.relatedTarget)) courseMatches.hidden = true;
});
headerSearch.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    courseMatches.hidden = true;
    bankCourse.focus();
  }
});
bankTerm.addEventListener('change', loadExamList);
bankAssessment.addEventListener('change', loadExamList);
bankReview.addEventListener('click', () => {
  if (apiBase) window.location.assign(apiBase + '/#review');
  else location.hash = bankMode() === 'review' ? 'exam-bank' : 'review';
});
window.addEventListener('hashchange', applyBankRoute);
applyBankRoute();

document.querySelector('#bank-upload').addEventListener('click', () => {
  contributionForm.reset();
  contributionStatus.textContent = '';
  contribution.showModal();
});
document.querySelector('#contribution-cancel').addEventListener('click', () => contribution.close());
contribution.addEventListener('cancel', event => {
  if (contributionForm.getAttribute('aria-busy') === 'true') event.preventDefault();
});
contributionFile.required = true;

async function readPdf(file) {
  if (!file || file.size > submissionLimit) throw new Error('Choose a PDF under 24 MB.');
  pdfLibrary ||= import('./pdfjs.mjs');
  const pdfjs = await pdfLibrary;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs-worker.mjs', location.href).href;
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useWasm: false,
    enableXfa: false,
  });
}

async function renderUpload(file) {
  const task = await readPdf(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const pages = [];
  let firstPage = '';
  try {
    const doc = await task.promise;
    if (!doc.numPages || doc.numPages > 40) throw new Error('A submission must have 1–40 pages.');
    let total = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      contributionStatus.textContent = 'Preparing page ' + pageNumber + ' of ' + doc.numPages + '…';
      const page = await doc.getPage(pageNumber);
      if (pageNumber === 1) {
        const text = await page.getTextContent().catch(() => null);
        firstPage = text?.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').slice(0, 1500) || '';
      }
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
    return { pages, firstPage };
  } finally {
    await task.destroy();
  }
}

contributionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (contributionSubmit.disabled) return;
  contributionSubmit.disabled = true;
  const cancel = document.querySelector('#contribution-cancel');
  cancel.disabled = true;
  contributionForm.setAttribute('aria-busy', 'true');
  try {
    const file = contributionFile.files[0];
    const { pages, firstPage } = await renderUpload(file);
    const submission = new FormData();
    submission.set('filename', file.name.slice(0, 320));
    submission.set('firstPage', firstPage);
    submission.set('blankConfirmed', 'yes');
    pages.forEach(image => submission.append('page', image, 'page.jpg'));
    contributionStatus.textContent = 'Adding PDF…';
    const { status, published } = await (await bankFetch('submissions', { method: 'POST', body: submission })).json();
    contribution.close();
    const notice = status === 'published' ? 'Added to the exam bank.' :
      published ? 'This PDF is already in the exam bank.' : 'This PDF has already been submitted.';
    await loadExamList({ notice });
  } catch (error) {
    contributionStatus.textContent = error.message || 'The PDF could not be submitted.';
  } finally {
    contributionSubmit.disabled = false;
    cancel.disabled = false;
    contributionForm.removeAttribute('aria-busy');
  }
});
