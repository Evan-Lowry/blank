const bankView = document.querySelector('#bank-view');
const converterView = document.querySelector('#converter-view');
const bankCourse = document.querySelector('#bank-course');
const headerSearch = document.querySelector('#course-search');
const bankNav = document.querySelector('#bank-nav');
const converterNav = document.querySelector('#converter-nav');
const courseMatches = document.querySelector('#course-matches');
const bankAssessment = document.querySelector('#bank-assessment');
const bankToolbar = document.querySelector('#bank-toolbar');
const bankBack = document.querySelector('#bank-back');
const bankHeading = document.querySelector('#bank-heading');
const bankList = document.querySelector('#bank-list');
const bankStatus = document.querySelector('#bank-status');
const homeView = document.querySelector('#home-view');
const aboutView = document.querySelector('#about-view');
const mainView = document.querySelector('main');
const headerSlot = document.querySelector('#header-search-slot');
const heroSlot = document.querySelector('#hero-search-slot');
const bankZip = document.querySelector('#bank-zip');
const listsNav = document.querySelector('#lists-nav');
const listsView = document.querySelector('#lists-view');
const listsHeading = document.querySelector('#lists-heading');
const listsBack = document.querySelector('#lists-back');
const listsList = document.querySelector('#lists-list');
const listsStatus = document.querySelector('#lists-status');
const listsNew = document.querySelector('#lists-new');
const listsShare = document.querySelector('#lists-share');
const listsZip = document.querySelector('#lists-zip');
const listsMore = document.querySelector('#lists-more');
const listsKeep = document.querySelector('#lists-keep');
const listsSync = document.querySelector('#lists-sync');
const syncDialog = document.querySelector('#sync-dialog');
const listsKey = 'blank-lists';
const savedLimit = 60;
const maxLists = 20;
const reportDialog = document.querySelector('#report-dialog');
const reportForm = document.querySelector('#report-form');
const reportStatus = document.querySelector('#report-status');
const recentKey = 'clean-copy-recent-courses';
const zipLimit = 60;
const seasons = { W: 'Winter', S: 'Spring', F: 'Fall' };
const termOrder = { W: 1, S: 2, F: 3 };
let pendingExamId;
let shownExams = [];
let allCourses;
let bankRequest = 0;
let headerQueryVersion = 0;
let carriedSearch;
let searchedCourse;

function courseKey(value) {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

function courseLabel(code) {
  return code ? code.replace(/([A-Z]+)(\d)/, '$1 $2') : 'Course unknown';
}

function termLabel(term) {
  return term ? seasons[term.at(-1)] + ' ' + term.slice(0, 4) : 'Term unknown';
}

function examLabel(exam) {
  return (exam.assessment || 'Assessment (type unknown)') + (exam.assessment_number ? ' ' + exam.assessment_number : '');
}

async function bankFetch(path, options) {
  const response = await fetch(apiBase + '/api/bank/' + path, options);
  if (!response.ok) {
    const message = await response.json().catch(() => null);
    throw new Error(message?.error || 'The assessment bank could not complete this request.');
  }
  return response;
}

function bankMode() {
  if (location.hash.startsWith('#exam-bank') || location.hash === '#review') return 'bank';
  if (location.hash === '#about') return 'about';
  if (location.hash === '#lists' || location.hash.startsWith('#lists/') || location.hash.startsWith('#list=')) return 'lists';
  if (location.hash.startsWith('#convert=')) return 'converter';
  return location.hash === '#converter' ? 'converter' : 'home';
}

// A course page is #exam-bank/MATH137 (optionally /<exam id>); #exam-bank/unknown lists entries with no detected course.
function coursePage() {
  const match = /^#exam-bank\/([A-Za-z]{2,8}\d{3}[A-Za-z]?|unknown)(?:\/([a-f0-9-]{36}))?$/.exec(location.hash);
  if (!match) return;
  const unknown = match[1].toLowerCase() === 'unknown';
  return { course: unknown ? '' : match[1].toUpperCase(), id: match[2] };
}

function goToBankCourse(course) {
  location.hash = 'exam-bank/' + course;
}

function applyBankRoute() {
  const mode = bankMode();
  // The search box only holds what the person typed. Moving to another page clears it.
  const page = coursePage();
  bankCourse.value = carriedSearch ?? (page?.course && page.course === searchedCourse ? courseLabel(page.course) : '');
  carriedSearch = undefined;
  searchedCourse = undefined;
  bankRequest++;
  hidePreview();
  closeRowMenu();
  homeView.hidden = mode !== 'home';
  mainView.hidden = mode === 'home';
  converterView.hidden = mode !== 'converter';
  aboutView.hidden = mode !== 'about';
  listsView.hidden = mode !== 'lists';
  bankView.hidden = mode !== 'bank';
  (mode === 'home' ? heroSlot : headerSlot).append(headerSearch);
  bankNav.toggleAttribute('aria-current', mode === 'bank');
  converterNav.toggleAttribute('aria-current', mode === 'converter');
  listsNav.toggleAttribute('aria-current', mode === 'lists' && !location.hash.startsWith('#list='));
  courseMatches.hidden = true;
  headerQueryVersion++;
  if (mode === 'home') {
    loadHome();
    return;
  }
  if (mode === 'lists') {
    loadLists();
    return;
  }
  if (mode === 'converter' && location.hash.startsWith('#convert=')) {
    prefillConverter();
    history.replaceState(null, '', '#converter');
  }
  if (mode === 'converter' || mode === 'about') return;

  pendingExamId = page?.id;
  if (page?.course) rememberCourse(page.course);
  bankList.replaceChildren();
  bankStatus.textContent = '';
  bankToolbar.hidden = !page;
  bankBack.hidden = !page;
  bankHeading.textContent = page ? courseLabel(page.course) : 'Assessment Bank';
  if (page) loadCourse(page);
  else loadDirectory();
}

function cell(text, className) {
  const element = document.createElement('div');
  element.setAttribute('role', 'cell');
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeList(kind, label, heads) {
  const list = document.createElement('div');
  list.className = 'list ' + kind;
  list.setAttribute('role', 'table');
  list.setAttribute('aria-label', label);
  const head = document.createElement('div');
  head.className = 'list-head';
  head.setAttribute('role', 'row');
  for (const text of heads) {
    const item = document.createElement('div');
    item.setAttribute('role', 'columnheader');
    item.textContent = text;
    head.append(item);
  }
  list.append(head);
  return list;
}

function latestLabel(latest) {
  return latest ? termLabel(latest.slice(0, 4) + '-' + { 3: 'F', 2: 'S', 1: 'W' }[latest.at(4)]) : '';
}

async function loadHome() {
  const request = ++bankRequest;
  try {
    const summary = await (await bankFetch('summary')).json();
    if (request !== bankRequest) return;
    document.querySelector('#home-stats').textContent = summary.exams
      ? summary.exams + (summary.exams === 1 ? ' assessment' : ' assessments') + ' across ' + summary.courseCount + (summary.courseCount === 1 ? ' course' : ' courses')
        + (summary.exams < 25 ? '. The bank is just getting started. Convert a Crowdmark link to add yours.' : '')
      : 'No assessments yet. Convert a Crowdmark link to add the first one.';
    const recent = document.querySelector('#home-recent');
    recent.replaceChildren();
    document.querySelector('#home-recent-title').hidden = !summary.recent.length;
    if (!summary.recent.length) return;
    const list = makeList('recent', 'Recently added assessments', ['Course', 'Term', 'Type']);
    for (const exam of summary.recent) {
      const row = document.createElement('a');
      row.className = 'list-row';
      row.setAttribute('role', 'row');
      row.href = '#exam-bank/' + exam.course + '/' + exam.id;
      row.append(cell(courseLabel(exam.course), 'cell-strong'), cell(termLabel(exam.term), 'cell-term cell-muted'), cell(examLabel(exam), 'cell-type'));
      list.append(row);
    }
    recent.append(list);
  } catch (error) {
    if (request === bankRequest) document.querySelector('#home-stats').textContent = error.message;
  }
}

// Bank root: a list of courses, filtered by whatever is typed in the search box.
async function loadDirectory() {
  const request = ++bankRequest;
  bankStatus.textContent = 'Loading…';
  try {
    allCourses ||= (await (await bankFetch('courses')).json()).courses;
    if (request !== bankRequest) return;
    renderDirectory();
  } catch (error) {
    if (request === bankRequest) bankStatus.textContent = error.message;
  }
}

function renderDirectory() {
  if (!allCourses || bankMode() !== 'bank' || coursePage()) return;
  const query = courseKey(bankCourse.value);
  const matches = allCourses.filter(({ course }) => course ? course.startsWith(query) : !query)
    .sort((a, b) => !a.course - !b.course || a.course.localeCompare(b.course));
  bankList.replaceChildren();
  bankStatus.textContent = !allCourses.length ? 'No assessments yet.' : matches.length ? '' : 'No courses match “' + bankCourse.value.trim() + '”.';
  if (!matches.length) return;
  const list = makeList('courses', 'Courses', ['Course', 'Assessments', 'Latest term', '']);
  for (const { course, count, latest } of matches) {
    const row = document.createElement('a');
    row.className = 'list-row';
    row.setAttribute('role', 'row');
    row.href = '#exam-bank/' + (course || 'unknown');
    row.append(cell(courseLabel(course), 'cell-strong'), cell(count + (count === 1 ? ' assessment' : ' assessments'), 'cell-muted'), cell(latestLabel(latest), 'cell-latest cell-muted'), cell('›', 'cell-go'));
    list.append(row);
  }
  bankList.append(list);
}

// Course page: that course's exams, newest term first.
async function loadCourse(page) {
  const request = ++bankRequest;
  bankList.replaceChildren();
  bankZip.hidden = true;
  hidePreview();
  const query = new URLSearchParams({ course: page.course, assessment: bankAssessment.value, exact: '1' });
  bankStatus.textContent = 'Loading…';
  try {
    const { exams } = await (await bankFetch('exams?' + query)).json();
    if (request !== bankRequest) return;
    bankStatus.textContent = exams.length ? '' : bankAssessment.value ? 'No assessments of that type yet.' : 'No assessments for this course yet.';
    shownExams = exams;
    bankZip.hidden = exams.length < 2;
    bankZip.textContent = 'Download all (' + Math.min(exams.length, zipLimit) + ')';
    if (!exams.length) return;
    const label = (a, b) => examLabel(a).localeCompare(examLabel(b), undefined, { numeric: true });
    const key = exam => (exam.term || '0000-').slice(0, 4) + (termOrder[exam.term?.at(-1)] || 0);
    exams.sort((a, b) => key(b).localeCompare(key(a)) || label(a, b));
    const list = makeList('exams', 'Assessments', ['Term', 'Type', 'Pages', '']);
    for (const exam of exams) list.append(createExamRow(exam));
    bankList.append(list);
    if (pendingExamId) {
      list.querySelector('[data-id="' + pendingExamId + '"] .preview-button')?.click();
      pendingExamId = undefined;
    }
  } catch (error) {
    if (request === bankRequest) bankStatus.textContent = error.message;
  }
}

function createExamRow(exam, { showCourse = false } = {}) {
  const row = document.createElement('div');
  row.className = 'list-row';
  row.setAttribute('role', 'row');
  row.dataset.id = exam.id;
  const actions = cell(undefined, 'exam-actions');
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'secondary preview-button';
  preview.textContent = 'Preview';
  preview.setAttribute('aria-controls', 'viewer');
  preview.setAttribute('aria-expanded', 'false');
  preview.addEventListener('click', () => showPdf(preview, apiBase + '/api/bank/pdf/' + exam.id + '?view=1'));
  const download = document.createElement('a');
  download.className = 'download';
  download.href = apiBase + '/api/bank/pdf/' + exam.id;
  download.textContent = 'Download';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'secondary more-button';
  more.setAttribute('aria-label', 'More actions');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>';
  more.addEventListener('click', event => {
    event.stopPropagation();
    openRowMenu(more, exam);
  });
  actions.append(preview, download, more);
  if (showCourse) {
    const course = cell(undefined, 'cell-course cell-strong');
    if (exam.course) {
      const link = document.createElement('a');
      link.href = '#exam-bank/' + exam.course;
      link.textContent = courseLabel(exam.course);
      course.append(link);
    } else course.textContent = '—';
    row.append(
      course,
      cell(termLabel(exam.term), 'cell-term cell-muted'),
      typeCell(exam),
      cell(courseLabel(exam.course) + ' · ' + termLabel(exam.term), 'cell-meta cell-muted'),
      actions,
    );
    return row;
  }
  row.append(
    cell(termLabel(exam.term), 'cell-term cell-muted'),
    typeCell(exam),
    cell(exam.page_count + (exam.page_count === 1 ? ' page' : ' pages'), 'cell-pages cell-muted'),
    actions,
  );
  return row;
}

const rowMenu = document.createElement('div');
rowMenu.className = 'row-menu';
rowMenu.setAttribute('role', 'menu');
rowMenu.hidden = true;
document.body.append(rowMenu);
let menuOwner;

function closeRowMenu() {
  rowMenu.hidden = true;
  menuOwner?.setAttribute('aria-expanded', 'false');
  menuOwner = undefined;
}

function menuItem(label, onSelect) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  item.textContent = label;
  item.addEventListener('click', onSelect);
  return item;
}

function placeMenu() {
  const box = menuOwner.getBoundingClientRect();
  rowMenu.style.top = box.bottom + 4 + 'px';
  rowMenu.style.right = document.documentElement.clientWidth - box.right + 'px';
}

function showMenuItems(items) {
  rowMenu.replaceChildren(...items);
  placeMenu();
  rowMenu.hidden = false;
  items.find(item => item.tagName === 'BUTTON' || item.tagName === 'INPUT')?.focus();
}

function openMenu(button, build) {
  if (menuOwner === button) {
    closeRowMenu();
    return;
  }
  closeRowMenu();
  menuOwner = button;
  button.setAttribute('aria-expanded', 'true');
  showMenuItems(build());
}

function menuLabel(text) {
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.setAttribute('role', 'presentation');
  label.textContent = text;
  return label;
}

function openRowMenu(button, exam) {
  openMenu(button, () => examMenuItems(exam));
}

function examMenuItems(exam) {
  const items = [];
  if (exam.course) {
    const copy = menuItem('Copy link', async () => {
      try {
        await navigator.clipboard.writeText(location.origin + location.pathname + '#exam-bank/' + exam.course + '/' + exam.id);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(closeRowMenu, 700);
    });
    items.push(copy);
  }
  items.push(menuItem('Add to list…', () => showMenuItems(listPickerItems(exam))));
  const here = openListId();
  if (here && readLists().find(list => list.id === here)?.ids.includes(exam.id)) {
    items.push(menuItem('Remove from this list', () => {
      updateList(here, list => { list.ids = list.ids.filter(id => id !== exam.id); });
      closeRowMenu();
      markRows(exam.id);
      renderList();
    }));
  }
  items.push(menuItem('Report a problem', () => {
    closeRowMenu();
    openReport(exam);
  }));
  return items;
}

// Pick which lists an assessment belongs to. Tick or untick as many as you like.
function listPickerItems(exam) {
  const items = [menuLabel('Add to list')];
  for (const list of readLists()) {
    const item = menuItem('', () => {
      const now = toggleInList(list.id, exam.id);
      if (now === null) {
        items[0].textContent = 'That list is full (' + savedLimit + ')';
        return;
      }
      check.textContent = now ? '✓' : '';
      markRows(exam.id);
    });
    const check = document.createElement('span');
    check.className = 'menu-check';
    check.textContent = list.ids.includes(exam.id) ? '✓' : '';
    item.append(check, list.name);
    items.push(item);
  }
  items.push(menuItem('+ New list', () => showMenuItems(newListItems(exam))));
  return items;
}

function newListItems(exam) {
  const label = menuLabel('New list');
  if (readLists().length >= maxLists) {
    label.textContent = 'You have ' + maxLists + ' lists. Delete one first.';
    return [label];
  }
  const input = document.createElement('input');
  input.className = 'menu-input';
  input.placeholder = 'Name';
  input.maxLength = 40;
  input.setAttribute('aria-label', 'List name');
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    createList(input.value, [exam.id]);
    markRows(exam.id);
    closeRowMenu();
  });
  return [label, input];
}

document.addEventListener('click', event => {
  if (!event.composedPath().includes(rowMenu)) closeRowMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !rowMenu.hidden) {
    const owner = menuOwner;
    closeRowMenu();
    owner?.focus();
  }
});
window.addEventListener('scroll', closeRowMenu, { passive: true });
window.addEventListener('resize', closeRowMenu);

function showCourseMatches(courses) {
  courseMatches.replaceChildren();
  for (const match of courses) {
    const link = document.createElement('a');
    link.href = '#exam-bank/' + match.course;
    link.textContent = courseLabel(match.course) + ' · ' + match.count + (match.count === 1 ? ' assessment' : ' assessments');
    link.addEventListener('click', () => {
      searchedCourse = match.course;
      courseMatches.hidden = true;
    });
    courseMatches.append(link);
  }
  courseMatches.hidden = !courses.length || !headerSearch.contains(document.activeElement);
}

async function searchFromHeader() {
  const course = courseKey(bankCourse.value);
  const version = ++headerQueryVersion;
  if (!/^[A-Z0-9]{1,12}$/.test(course)) {
    showCourseMatches([]);
    showRecentCourses();
    return;
  }
  try {
    const { courses } = await (await bankFetch('exams?' + new URLSearchParams({ course }))).json();
    if (version === headerQueryVersion) showCourseMatches(courses);
  } catch {
    if (version === headerQueryVersion) showCourseMatches([]);
  }
}

let searchTimer;
bankCourse.addEventListener('input', () => {
  clearTimeout(searchTimer);
  headerQueryVersion++;
  if (bankMode() !== 'bank') {
    searchTimer = setTimeout(searchFromHeader, 220);
    return;
  }
  // In the bank, typing filters the course directory.
  if (coursePage()) {
    carriedSearch = bankCourse.value;
    location.hash = 'exam-bank';
  }
  else renderDirectory();
});
headerSearch.addEventListener('submit', event => {
  event.preventDefault();
  courseMatches.hidden = true;
  const course = courseKey(bankCourse.value);
  bankCourse.blur();
  if (/^[A-Z]{2,8}\d{3}[A-Z]?$/.test(course)) {
    searchedCourse = course;
    goToBankCourse(course);
  }
  else if (bankMode() !== 'bank') location.hash = 'exam-bank';
});
// Pressing the mouse on a suggestion must not take focus out of the box, or the list closes before the click lands.
courseMatches.addEventListener('mousedown', event => event.preventDefault());
headerSearch.addEventListener('focusout', event => {
  if (!headerSearch.contains(event.relatedTarget)) courseMatches.hidden = true;
});
// Arrow keys move through the suggestions, Enter opens the highlighted one.
let activeIndex = -1;
const menuLinks = () => [...courseMatches.querySelectorAll('a')];

function setActive(index) {
  const links = menuLinks();
  activeIndex = index;
  links.forEach((link, position) => {
    link.classList.toggle('active', position === index);
    link.setAttribute('aria-selected', String(position === index));
  });
  if (links[index]) {
    bankCourse.setAttribute('aria-activedescendant', links[index].id);
    links[index].scrollIntoView({ block: 'nearest' });
  } else bankCourse.removeAttribute('aria-activedescendant');
}

// Whenever the list is rebuilt, shown or hidden, label its items and clear the highlight.
new MutationObserver(() => {
  bankCourse.setAttribute('aria-expanded', String(!courseMatches.hidden));
  menuLinks().forEach((link, position) => {
    link.id = 'course-option-' + position;
    link.setAttribute('role', 'option');
  });
  courseMatches.querySelector('.recent-label')?.setAttribute('role', 'presentation');
  setActive(-1);
}).observe(courseMatches, { attributes: true, attributeFilter: ['hidden'], childList: true });

courseMatches.addEventListener('mouseover', event => {
  const link = event.target.closest('a');
  if (link) setActive(menuLinks().indexOf(link));
});

headerSearch.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    courseMatches.hidden = true;
    bankCourse.focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (courseMatches.hidden) showRecentCourses();
    const links = menuLinks();
    if (courseMatches.hidden || !links.length) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive(activeIndex === -1 ? (step === 1 ? 0 : links.length - 1) : (activeIndex + step + links.length) % links.length);
    return;
  }
  if (event.key === 'Enter' && !courseMatches.hidden && activeIndex >= 0) {
    event.preventDefault();
    menuLinks()[activeIndex].click();
  }
});
function recentCourses() {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey));
    return Array.isArray(list) ? list.filter(code => /^[A-Z]{2,8}\d{3}[A-Z]?$/.test(code)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberCourse(code) {
  try {
    localStorage.setItem(recentKey, JSON.stringify([code, ...recentCourses().filter(item => item !== code)].slice(0, 5)));
  } catch {
    // Recent courses are a convenience only.
  }
}

function showRecentCourses() {
  const recent = recentCourses();
  if (!recent.length || bankCourse.value) return;
  courseMatches.replaceChildren();
  const label = document.createElement('div');
  label.className = 'recent-label';
  label.textContent = 'Recent';
  courseMatches.append(label);
  for (const code of recent) {
    const link = document.createElement('a');
    link.href = '#exam-bank/' + code;
    link.textContent = courseLabel(code);
    link.addEventListener('click', () => {
      searchedCourse = code;
      courseMatches.hidden = true;
    });
    courseMatches.append(link);
  }
  courseMatches.hidden = false;
}

headerSearch.addEventListener('focusin', showRecentCourses);
// Clicking the box again after the list was dismissed (it keeps focus) should show it again.
bankCourse.addEventListener('click', showRecentCourses);
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  event.preventDefault();
  bankCourse.focus();
  bankCourse.select();
});

let reportTarget;
function openReport(exam) {
  reportTarget = exam;
  reportForm.reset();
  reportStatus.textContent = '';
  document.querySelector('#report-exam').textContent = (exam.course ? courseLabel(exam.course) + ' · ' : '') + examLabel(exam) + ' · ' + termLabel(exam.term);
  reportDialog.showModal();
}
document.querySelector('#report-cancel').addEventListener('click', () => reportDialog.close());
reportForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = document.querySelector('#report-submit');
  submit.disabled = true;
  try {
    await bankFetch('report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reportTarget.id, reason: new FormData(reportForm).get('reason') }),
    });
    reportDialog.close();
    bankStatus.textContent = 'Thanks. The report was sent.';
  } catch (error) {
    reportStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

// ZIP any set of assessments. Used by course pages and by the saved list.
async function zipExams(button, exams, archiveName, report, restoreLabel) {
  const chosen = exams.slice(0, zipLimit);
  const request = bankRequest;
  const files = [];
  button.disabled = true;
  button.textContent = 'Creating ZIP…';
  try {
    let next = 0;
    async function worker() {
      while (next < chosen.length) {
        const exam = chosen[next++];
        const response = await bankFetch('pdf/' + exam.id);
        const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || exam.id + '.pdf';
        files.push({ pdf: await response.blob(), filename: name });
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    await zipFiles(files, archiveName);
    if (request === bankRequest && exams.length > zipLimit) report('The ZIP has the first ' + zipLimit + ' assessments.');
  } catch {
    if (request === bankRequest) report('Couldn’t create the ZIP. Try again.');
  } finally {
    button.disabled = false;
    button.textContent = restoreLabel();
  }
}

bankZip.addEventListener('click', () => {
  const course = coursePage()?.course;
  zipExams(bankZip, shownExams, (course ? course + '-assessments' : 'blank-assessments') + '.zip',
    text => { bankStatus.textContent = text + ' Filter by type to get the rest.'; },
    () => 'Download all (' + Math.min(shownExams.length, zipLimit) + ')');
});

// Lists: named study lists kept in this browser. A share link carries the name and the ids, so anyone can open the same set.
let listsMemory;
let listItems = [];
let renameAfterLoad = false;

function cleanLists(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item && /^[a-z0-9]{4,12}$/.test(item.id) && typeof item.name === 'string')
    .slice(0, maxLists)
    .map(item => ({
      id: item.id,
      name: item.name.slice(0, 40),
      ids: (Array.isArray(item.ids) ? item.ids : []).filter(id => /^[a-f0-9-]{36}$/.test(id)).slice(0, savedLimit),
    }));
}

function readLists() {
  if (listsMemory) return listsMemory;
  try {
    return cleanLists(JSON.parse(localStorage.getItem(listsKey)));
  } catch {
    return [];
  }
}

function storeLists(lists) {
  try {
    localStorage.setItem(listsKey, JSON.stringify(lists));
    listsMemory = undefined;
  } catch {
    listsMemory = lists;
  }
}

// Every change you make is also queued to sync (when sync is on).
function writeLists(lists) {
  storeLists(lists);
  scheduleSyncPush();
}

// Starred items from the first version become one list called "Saved".
try {
  const old = JSON.parse(localStorage.getItem('blank-saved-assessments'));
  if (Array.isArray(old) && old.length && !localStorage.getItem(listsKey)) {
    writeLists(cleanLists([{ id: Math.random().toString(36).slice(2, 8).padEnd(6, '0'), name: 'Saved', ids: old }]));
  }
  localStorage.removeItem('blank-saved-assessments');
} catch {
  // Nothing to carry over.
}

function uniqueName(others, wanted) {
  const base = wanted.trim().slice(0, 40) || 'New list';
  let name = base;
  for (let n = 2; others.some(list => list.name.toLowerCase() === name.toLowerCase()); n++) name = base.slice(0, 34) + ' (' + n + ')';
  return name;
}

function createList(name, ids = []) {
  const lists = readLists();
  if (lists.length >= maxLists) return null;
  let id;
  do id = Math.random().toString(36).slice(2, 8).padEnd(6, '0'); while (lists.some(list => list.id === id));
  const list = { id, name: uniqueName(lists, name), ids: ids.slice(0, savedLimit) };
  writeLists([...lists, list]);
  return list;
}

function updateList(id, change) {
  const lists = readLists();
  const list = lists.find(item => item.id === id);
  if (!list) return;
  change(list);
  writeLists(lists);
  return list;
}

function toggleInList(listId, examId) {
  let result = false;
  updateList(listId, list => {
    if (list.ids.includes(examId)) list.ids = list.ids.filter(id => id !== examId);
    else if (list.ids.length >= savedLimit) result = null;
    else {
      list.ids = [...list.ids, examId];
      result = true;
    }
  });
  return result;
}

function listsFor(examId) {
  return readLists().filter(list => list.ids.includes(examId));
}

function typeCell(exam) {
  const element = cell(undefined, 'cell-type cell-strong');
  const dot = document.createElement('span');
  dot.className = 'in-list';
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', 'In one of your lists');
  setMark(dot, exam.id);
  element.append(dot, examLabel(exam));
  return element;
}

function setMark(dot, examId) {
  const lists = listsFor(examId);
  dot.hidden = !lists.length;
  dot.setAttribute('aria-hidden', String(!lists.length));
  dot.title = 'In: ' + lists.map(list => list.name).join(', ');
}

function markRows(examId) {
  for (const row of document.querySelectorAll('.list-row[data-id="' + examId + '"]')) {
    const dot = row.querySelector('.in-list');
    if (dot) setMark(dot, examId);
  }
}

// #lists is all your lists, #lists/<id> is one of them, #list=<ids>&name=<name> is someone else's shared list.
function listRoute() {
  const hash = location.hash;
  if (hash.startsWith('#list=')) {
    const params = new URLSearchParams(hash.slice(1));
    return { shared: {
      ids: (params.get('list') || '').split(',').filter(id => /^[a-f0-9-]{36}$/.test(id)).slice(0, savedLimit),
      name: (params.get('name') || '').slice(0, 40),
    } };
  }
  const match = /^#lists\/([a-z0-9]{4,12})$/.exec(hash);
  return match ? { id: match[1] } : {};
}

function openListId() {
  return listsView.hidden ? undefined : listRoute().id;
}

async function loadLists() {
  const request = ++bankRequest;
  const route = listRoute();
  for (const button of [listsNew, listsSync, listsShare, listsZip, listsMore, listsKeep, listsBack]) button.hidden = true;
  listsList.replaceChildren();
  listsStatus.textContent = '';
  listItems = [];
  if (route.shared) {
    listsHeading.textContent = route.shared.name || 'Shared list';
    if (!route.shared.ids.length) {
      listsStatus.textContent = 'This list link has no assessments.';
      return;
    }
    listsStatus.textContent = 'Loading…';
    try {
      const { exams } = await (await bankFetch('exams?ids=' + route.shared.ids.join(','))).json();
      if (request === bankRequest) {
        listItems = exams;
        renderList();
      }
    } catch (error) {
      if (request === bankRequest) listsStatus.textContent = error.message;
    }
    return;
  }
  if (!route.id) {
    listsHeading.textContent = 'Lists';
    listsNew.hidden = false;
    listsSync.hidden = Boolean(apiBase);
    renderIndex();
    return;
  }
  const list = readLists().find(item => item.id === route.id);
  listsBack.hidden = false;
  if (!list) {
    listsHeading.textContent = 'List not found';
    listsStatus.textContent = 'Lists are kept in the browser they were made in. Open a share link to get a copy here.';
    return;
  }
  listsHeading.textContent = list.name;
  if (renameAfterLoad) {
    renameAfterLoad = false;
    startRename();
  }
  if (!list.ids.length) {
    renderList();
    return;
  }
  listsStatus.textContent = 'Loading…';
  try {
    const { exams } = await (await bankFetch('exams?ids=' + list.ids.join(','))).json();
    if (request !== bankRequest) return;
    listItems = exams;
    // Forget assessments that are no longer in the bank.
    if (exams.length !== list.ids.length) updateList(list.id, item => { item.ids = item.ids.filter(id => exams.some(exam => exam.id === id)); });
    renderList();
  } catch (error) {
    if (request === bankRequest) listsStatus.textContent = error.message;
  }
}

function renderIndex() {
  const lists = readLists();
  listsList.replaceChildren();
  listsStatus.textContent = lists.length ? '' : 'No lists yet. Use ⋯ on any assessment and choose Add to list.';
  if (!lists.length) return;
  const table = makeList('lists', 'Your lists', ['Name', 'Assessments', '']);
  for (const list of lists) {
    const row = document.createElement('a');
    row.className = 'list-row';
    row.setAttribute('role', 'row');
    row.href = '#lists/' + list.id;
    row.append(cell(list.name, 'cell-strong'), cell(list.ids.length + (list.ids.length === 1 ? ' assessment' : ' assessments'), 'cell-muted'), cell('›', 'cell-go'));
    table.append(row);
  }
  listsList.append(table);
}

function renderList() {
  const route = listRoute();
  const own = route.id ? readLists().find(list => list.id === route.id) : undefined;
  const wanted = own ? new Set(own.ids) : undefined;
  const exams = (wanted ? listItems.filter(exam => wanted.has(exam.id)) : listItems)
    .sort((a, b) => a.course.localeCompare(b.course) ||
      ((b.term || '').slice(0, 4) + (termOrder[b.term?.at(-1)] || 0)).localeCompare((a.term || '').slice(0, 4) + (termOrder[a.term?.at(-1)] || 0)) ||
      examLabel(a).localeCompare(examLabel(b), undefined, { numeric: true }));
  hidePreview();
  listsList.replaceChildren();
  listsShare.hidden = !own || !exams.length;
  listsMore.hidden = !own;
  listsKeep.hidden = !route.shared || !exams.length;
  listsZip.hidden = exams.length < 2;
  listsZip.textContent = 'Download all (' + Math.min(exams.length, savedLimit) + ')';
  listsStatus.textContent = exams.length ? '' : route.shared ? 'These assessments are no longer in the bank.' : 'Nothing in this list yet. Use ⋯ on any assessment and choose Add to list.';
  if (!exams.length) return;
  const table = makeList('saved', 'Assessments in this list', ['Course', 'Term', 'Type', '']);
  for (const exam of exams) table.append(createExamRow(exam, { showCourse: true }));
  listsList.append(table);
}

listsNew.addEventListener('click', () => {
  const list = createList('New list');
  if (!list) {
    listsStatus.textContent = 'You have ' + maxLists + ' lists. Delete one first.';
    return;
  }
  renameAfterLoad = true;
  location.hash = 'lists/' + list.id;
});

function startRename() {
  const id = listRoute().id;
  const list = readLists().find(item => item.id === id);
  if (!list) return;
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = list.name;
  input.maxLength = 40;
  input.setAttribute('aria-label', 'List name');
  listsHeading.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = save => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (save && name) updateList(id, item => { item.name = uniqueName(readLists().filter(other => other.id !== id), name); });
    listsHeading.textContent = readLists().find(item => item.id === id)?.name || 'List';
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

listsMore.addEventListener('click', event => {
  event.stopPropagation();
  openMenu(listsMore, () => {
    const remove = menuItem('Delete list', () => {
      if (remove.dataset.confirm !== 'yes') {
        remove.dataset.confirm = 'yes';
        remove.textContent = 'Click again to delete';
        return;
      }
      const id = listRoute().id;
      writeLists(readLists().filter(list => list.id !== id));
      closeRowMenu();
      location.hash = 'lists';
    });
    return [menuItem('Rename', () => {
      closeRowMenu();
      startRename();
    }), remove];
  });
});

listsShare.addEventListener('click', async () => {
  const list = readLists().find(item => item.id === listRoute().id);
  if (!list) return;
  const url = location.origin + location.pathname + '#list=' + list.ids.join(',') + '&name=' + encodeURIComponent(list.name);
  try {
    await navigator.clipboard.writeText(url);
    listsShare.textContent = 'Link copied';
  } catch {
    listsShare.textContent = 'Copy failed';
  }
  setTimeout(() => { listsShare.textContent = 'Copy share link'; }, 1800);
});

listsKeep.addEventListener('click', () => {
  const shared = listRoute().shared;
  const list = shared && createList(shared.name || 'Shared list', shared.ids);
  if (!list) {
    listsStatus.textContent = 'You have ' + maxLists + ' lists. Delete one first.';
    return;
  }
  location.hash = 'lists/' + list.id;
});

listsZip.addEventListener('click', () => {
  const route = listRoute();
  const own = route.id ? readLists().find(list => list.id === route.id) : undefined;
  const exams = own ? listItems.filter(exam => own.ids.includes(exam.id)) : listItems;
  const slug = (own?.name || route.shared?.name || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  zipExams(listsZip, exams, slug + '.zip', text => { listsStatus.textContent = text; },
    () => 'Download all (' + Math.min(exams.length, savedLimit) + ')');
});

// Sync: one private code ties your lists on this device to a saved copy on the server. Nothing else is shared.
const syncCodeKey = 'blank-sync-code';
const syncVersionKey = 'blank-sync-version';
const syncCodeShape = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/;
let syncTimer;
let syncBusy = false;
let lastPull = 0;

const syncCode = () => { try { return localStorage.getItem(syncCodeKey) || ''; } catch { return ''; } };
const syncVersion = () => { try { return Number(localStorage.getItem(syncVersionKey)) || 0; } catch { return 0; } };
function saveSync(code, version) {
  try {
    if (code) {
      localStorage.setItem(syncCodeKey, code);
      localStorage.setItem(syncVersionKey, String(version));
    } else {
      localStorage.removeItem(syncCodeKey);
      localStorage.removeItem(syncVersionKey);
    }
  } catch {
    // Without storage, sync stays off.
  }
}

function formatCode(value) {
  const letters = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.match(/.{1,4}/g)?.join('-') || '';
}

async function syncCall(method, code, body) {
  const response = await fetch(apiBase + '/api/sync', {
    method,
    headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Sync-Code': code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

// Lists are matched by id. Assessments in either copy are kept, so merging never loses anything.
// The names from `incoming` win when both sides have the same list.
function mergeLists(base, incoming) {
  const merged = new Map();
  for (const list of [...base, ...incoming]) {
    const have = merged.get(list.id);
    if (!have) merged.set(list.id, { ...list, ids: [...list.ids] });
    else {
      have.name = list.name;
      have.ids = [...new Set([...have.ids, ...list.ids])].slice(0, savedLimit);
    }
  }
  return [...merged.values()].slice(0, maxLists);
}

const sameLists = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function refreshAfterSync() {
  if (!listsView.hidden) loadLists();
  else for (const row of document.querySelectorAll('.list-row[data-id]')) {
    const dot = row.querySelector('.in-list');
    if (dot) setMark(dot, row.dataset.id);
  }
}

// Download the saved copy, merge it with this device, and save the result back if this device had extra.
async function syncNow() {
  const code = syncCode();
  if (!code || syncBusy) return;
  syncBusy = true;
  try {
    let { status, data } = await syncCall('GET', code);
    if (status === 404) {
      saveSync('');
      return;
    }
    if (status !== 200) return;
    const local = readLists();
    const merged = mergeLists(local, data.lists);
    let version = data.version;
    if (!sameLists(merged, local)) {
      storeLists(merged);
      refreshAfterSync();
    }
    if (!sameLists(merged, data.lists)) {
      ({ status, data } = await syncCall('PUT', code, { lists: merged, baseVersion: version }));
      if (status === 409) {
        const again = mergeLists(data.lists, merged);
        storeLists(again);
        ({ status, data } = await syncCall('PUT', code, { lists: again, baseVersion: data.version }));
        refreshAfterSync();
      }
      if (status === 200) version = data.version;
    }
    saveSync(code, version);
  } catch {
    // Offline: the lists stay on this device and sync on the next try.
  } finally {
    syncBusy = false;
    lastPull = Date.now();
  }
}

function scheduleSyncPush() {
  if (!syncCode()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

function renderSyncDialog(message = '') {
  const on = Boolean(syncCode());
  document.querySelector('#sync-off').hidden = on;
  document.querySelector('#sync-on').hidden = !on;
  document.querySelector('#sync-code-text').textContent = formatCode(syncCode());
  document.querySelector('#sync-status').textContent = message;
}

listsSync.addEventListener('click', () => {
  renderSyncDialog();
  document.querySelector('#sync-code-input').value = '';
  syncDialog.showModal();
});
document.querySelector('#sync-close').addEventListener('click', () => syncDialog.close());

document.querySelector('#sync-start').addEventListener('click', async () => {
  const button = document.querySelector('#sync-start');
  button.disabled = true;
  try {
    const { status, data } = await syncCall('POST', '', { lists: readLists() });
    if (status !== 201) throw new Error(data.error || 'Sync could not start.');
    saveSync(data.code, data.version);
    renderSyncDialog();
  } catch (error) {
    renderSyncDialog(error.message || 'Sync could not start. Try again.');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#sync-join').addEventListener('submit', async event => {
  event.preventDefault();
  const code = String(document.querySelector('#sync-code-input').value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!syncCodeShape.test(code)) {
    renderSyncDialog('That code should be 16 letters and numbers.');
    return;
  }
  try {
    const { status, data } = await syncCall('GET', code);
    if (status === 404) throw new Error('That code wasn’t found.');
    if (status !== 200) throw new Error(data.error || 'Couldn’t connect.');
    // Lists already on this device are kept and added to the saved copy.
    const merged = mergeLists(readLists(), data.lists);
    storeLists(merged);
    saveSync(code, data.version);
    await syncNow();
    refreshAfterSync();
    renderSyncDialog('Connected. Your lists are in sync.');
  } catch (error) {
    renderSyncDialog(error.message || 'Couldn’t connect. Try again.');
  }
});

document.querySelector('#sync-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(formatCode(syncCode()));
    renderSyncDialog('Code copied.');
  } catch {
    renderSyncDialog('Select the code and copy it.');
  }
});

document.querySelector('#sync-stop').addEventListener('click', async () => {
  const code = syncCode();
  try {
    await syncCall('DELETE', code);
  } catch {
    // Turning off still works on this device if the server can't be reached.
  }
  saveSync('');
  renderSyncDialog('Sync is off. Your lists stay on this device.');
});

if (!apiBase) {
  syncNow();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && syncCode() && Date.now() - lastPull > 10000) syncNow();
  });
}

// Paste a Crowdmark link anywhere (search box or the page itself) and the converter opens with it filled in.
// It does not start by itself: converting publishes to the public bank, so you press Prepare PDF to confirm.
function prefillConverter() {
  let raw = '';
  try {
    raw = decodeURIComponent(location.hash.slice('#convert='.length));
  } catch {
    // An unreadable link falls through to the message below.
  }
  const links = [...new Set(raw.split(/\s+/).filter(isCrowdmarkLink))];
  if (!links.length) {
    status.classList.add('error');
    status.textContent = 'That isn’t a shareable Crowdmark results link.';
    return;
  }
  const existing = [...fields.querySelectorAll('input')].map(input => input.value.trim()).filter(Boolean);
  fields.replaceChildren();
  for (const link of new Set([...existing, ...links])) addField(link);
  status.classList.remove('error');
  status.textContent = '';
  prepare.focus();
}

document.addEventListener('paste', event => {
  const target = event.target;
  if (target !== bankCourse && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const links = [...new Set((event.clipboardData?.getData('text') || '').split(/\s+/).filter(isCrowdmarkLink))];
  if (!links.length) return;
  event.preventDefault();
  location.hash = 'convert=' + encodeURIComponent(links.join(' '));
});

// The bookmark opens this page with the Crowdmark link in the address after the #, which is never sent to a server.
document.querySelector('#bookmarklet').href = 'javascript:(function(){var u=location.href;' +
  'if(!/^https:\\/\\/app\\.crowdmark\\.com\\/score\\/[0-9a-f-]{36}/i.test(u)){alert("Open your shareable Crowdmark results link first, then click this again.");return;}' +
  'window.open(' + JSON.stringify(location.origin + location.pathname + '#convert=') + '+encodeURIComponent(u),"_blank");})();';

bankAssessment.addEventListener('change', () => {
  const page = coursePage();
  if (page) loadCourse(page);
});
window.addEventListener('hashchange', applyBankRoute);
applyBankRoute();
