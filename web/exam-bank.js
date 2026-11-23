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
const bankShare = document.querySelector('#bank-share');
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

// Send a link: the phone's share sheet where there is one, otherwise copy it. Returns 'shared', 'copied', 'cancelled' or 'failed'.
async function shareUrl(url, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
const sharesNatively = () => Boolean(navigator.share) && matchMedia('(pointer: coarse)').matches;
const examUrl = exam => location.origin + '/e/' + exam.id;
const courseUrl = course => location.origin + '/' + course;

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
  const response = await fetch('/api/bank/' + path, options);
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
  clearSelection();
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
  bankShare.hidden = true;
  clearSelection();
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
    bankShare.hidden = !page.course;
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

function buildExamRow(exam, { showCourse = false } = {}) {
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
  preview.addEventListener('click', () => showPdf(preview, '/api/bank/pdf/' + exam.id + '?view=1'));
  const download = document.createElement('a');
  download.className = 'download';
  download.href = '/api/bank/pdf/' + exam.id;
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
  const height = rowMenu.offsetHeight;
  // Open upward when there is no room below (the selection bar sits at the bottom of the screen).
  const flip = box.bottom + 4 + height > innerHeight - 8 && box.top - height - 4 > 8;
  rowMenu.style.top = (flip ? box.top - height - 4 : box.bottom + 4) + 'px';
  rowMenu.style.right = document.documentElement.clientWidth - box.right + 'px';
}

function showMenuItems(items) {
  rowMenu.replaceChildren(...items);
  rowMenu.hidden = false;
  placeMenu();
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
    const copy = menuItem(sharesNatively() ? 'Share…' : 'Copy link', async () => {
      const result = await shareUrl(examUrl(exam), courseLabel(exam.course) + ' ' + examLabel(exam));
      if (result === 'cancelled') {
        closeRowMenu();
        return;
      }
      copy.textContent = result === 'copied' ? 'Link copied' : result === 'shared' ? 'Shared' : 'Copy failed';
      setTimeout(closeRowMenu, 700);
    });
    items.push(copy);
  }
  items.push(menuItem('Add to list…', () => showMenuItems(listPickerItems(exam))));
  const here = openListId();
  if (here && here !== importsId && readLists().find(list => list.id === here)?.ids.includes(exam.id)) {
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
  // My imports fills itself, so it is not offered here.
  for (const list of readLists().filter(item => item.id !== importsId)) {
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

function newListItems(target) {
  const ids = Array.isArray(target) ? target : [target.id];
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
    createList(input.value, ids);
    ids.forEach(markRows);
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
  else if (bankMode() !== 'bank') {
    // Keep what was typed so the course list opens already filtered by it.
    carriedSearch = bankCourse.value;
    location.hash = 'exam-bank';
  }
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
    const turnstileToken = await getTurnstileToken();
    await bankFetch('report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reportTarget.id, reason: new FormData(reportForm).get('reason'), turnstileToken }),
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

bankShare.addEventListener('click', async () => {
  const course = coursePage()?.course;
  if (!course) return;
  const result = await shareUrl(courseUrl(course), courseLabel(course) + ' assessments');
  if (result !== 'cancelled') bankShare.textContent = result === 'failed' ? 'Copy failed' : result === 'shared' ? 'Shared' : 'Link copied';
  setTimeout(() => { bankShare.textContent = 'Share'; }, 1800);
});

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

// "My imports" always exists, comes first, and cannot be renamed or deleted. Every assessment you prepare is added to it.
const importsId = 'imported';
const importsName = 'My imports';
function withImports(lists) {
  const own = lists.find(list => list.id === importsId);
  return [{ id: importsId, name: importsName, ids: own ? own.ids : [] }, ...lists.filter(list => list.id !== importsId)].slice(0, maxLists);
}

function readLists() {
  if (listsMemory) return withImports(listsMemory);
  try {
    return withImports(cleanLists(JSON.parse(localStorage.getItem(listsKey))));
  } catch {
    return withImports([]);
  }
}

function addToImports(id) {
  updateList(importsId, list => {
    list.ids = [id, ...list.ids.filter(other => other !== id)].slice(0, savedLimit);
  });
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
    listsSync.hidden = false;
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
  listsStatus.textContent = '';
  const listRow = list => {
    const row = document.createElement('a');
    row.className = 'list-row';
    row.setAttribute('role', 'row');
    row.href = '#lists/' + list.id;
    row.append(cell(list.name, 'cell-strong'), cell(list.ids.length + (list.ids.length === 1 ? ' assessment' : ' assessments'), 'cell-muted'), cell('›', 'cell-go'));
    return row;
  };
  const mine = lists.filter(list => list.id !== importsId);
  if (mine.length) {
    const table = makeList('lists', 'Your lists', ['Name', 'Assessments', '']);
    for (const list of mine) table.append(listRow(list));
    listsList.append(table);
  } else {
    listsStatus.textContent = 'No lists of your own yet. Use ⋯ on any assessment and choose Add to list.';
  }
  // The automatic list sits apart at the bottom.
  const auto = lists.find(list => list.id === importsId);
  if (auto) {
    const table = document.createElement('div');
    table.className = 'list lists list-auto';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Automatic list');
    table.append(listRow(auto));
    listsList.append(table);
  }
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
  listsMore.hidden = !own || own.id === importsId;
  listsKeep.hidden = !route.shared || !exams.length;
  listsZip.hidden = exams.length < 2;
  listsZip.textContent = 'Download all (' + Math.min(exams.length, savedLimit) + ')';
  listsStatus.textContent = exams.length ? '' : route.id === importsId ? 'Assessments you prepare on this browser are added here.' : route.shared ? 'These assessments are no longer in the bank.' : 'Nothing in this list yet. Use ⋯ on any assessment and choose Add to list.';
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
      writeGone([...readGone(), id]);
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
  const url = location.origin + '/#list=' + list.ids.join(',') + '&name=' + encodeURIComponent(list.name);
  const result = await shareUrl(url, list.name);
  if (result !== 'cancelled') listsShare.textContent = result === 'failed' ? 'Copy failed' : result === 'shared' ? 'Shared' : 'Link copied';
  setTimeout(() => { listsShare.textContent = sharesNatively() ? 'Share' : 'Copy share link'; }, 1800);
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
  const response = await fetch('/api/sync', {
    method,
    headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Sync-Code': code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

// Lists are matched by id. Assessments in either copy are kept, so merging never loses anything.
// The names from `incoming` win when both sides have the same list. A deleted list is kept as a marker
// ({ gone: true }) so another device cannot bring it back; a marker on either side wins.
function mergeLists(base, incoming) {
  const merged = new Map();
  for (const list of [...base, ...incoming]) {
    if (list.id === importsId && list.gone) continue;
    const have = merged.get(list.id);
    if (!have) merged.set(list.id, list.gone ? { id: list.id, name: '', ids: [], gone: true } : { ...list, ids: [...list.ids] });
    else if (list.gone || have.gone) merged.set(list.id, { id: list.id, name: '', ids: [], gone: true });
    else {
      have.name = list.name;
      have.ids = [...new Set([...have.ids, ...list.ids])].slice(0, savedLimit);
    }
  }
  const all = [...merged.values()];
  return [...all.filter(list => !list.gone).slice(0, maxLists), ...all.filter(list => list.gone).slice(-goneLimit)];
}

// Deleted lists are remembered here so a synced copy cannot restore them.
const goneKey = 'blank-lists-gone';
const goneLimit = 100;
function readGone() {
  try {
    const value = JSON.parse(localStorage.getItem(goneKey));
    return (Array.isArray(value) ? value : []).filter(id => /^[a-z0-9]{4,12}$/.test(id)).slice(-goneLimit);
  } catch {
    return [];
  }
}
function writeGone(ids) {
  try {
    localStorage.setItem(goneKey, JSON.stringify([...new Set(ids)].slice(-goneLimit)));
  } catch {
    // Without storage the marker is lost, which only means a deleted list can return on the next sync.
  }
}
const withGone = lists => [...lists, ...readGone().map(id => ({ id, name: '', ids: [], gone: true }))];
function storeMerged(all) {
  writeGone([...readGone(), ...all.filter(list => list.gone).map(list => list.id)]);
  storeLists(all.filter(list => !list.gone));
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
    const local = withGone(readLists());
    const merged = mergeLists(local, data.lists);
    let version = data.version;
    if (!sameLists(merged, local)) {
      storeMerged(merged);
      refreshAfterSync();
    }
    if (!sameLists(merged, data.lists)) {
      ({ status, data } = await syncCall('PUT', code, { lists: merged, baseVersion: version }));
      if (status === 409) {
        const again = mergeLists(data.lists, merged);
        storeMerged(again);
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
    const { status, data } = await syncCall('POST', '', { lists: withGone(readLists()) });
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
    const merged = mergeLists(withGone(readLists()), data.lists);
    storeMerged(merged);
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

syncNow();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && syncCode() && Date.now() - lastPull > 10000) syncNow();
});

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
  status.textContent = links.length > 1 ? links.length + ' assessments ready. Press Prepare PDF to add them.' : '';
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
// On a results link it sends that one link. Inside your Crowdmark courses it asks Crowdmark (as you, from your own
// signed-in tab) for your assignments and sends the links for the course you are viewing, or for all of them.
function crowdmarkBookmarklet() {
  var site = '__SITE__';
  var send = function (links) { window.open(site + encodeURIComponent(links.join(' ')), '_blank'); };
  var score = location.href.match(/^https:\/\/app\.crowdmark\.com\/score\/[0-9a-f-]{36}/i);
  if (score) return send([score[0]]);
  var course = location.origin === 'https://app.crowdmark.com' && (location.pathname.match(/^\/student\/courses\/([^\/]+)/) || [])[1];
  if (!course) {
    alert('Open one of your Crowdmark courses or a shareable results link first, then click this again.');
    return;
  }
  fetch('/api/v2/student/assignments?include[]=course', { credentials: 'include' })
    .then(function (response) { return response.json(); })
    .then(function (result) {
      var links = result.data
        .filter(function (a) { return a.attributes['score-uuid'] && a.relationships.course.data.id === course; })
        .map(function (a) { return 'https://app.crowdmark.com/score/' + a.attributes['score-uuid']; });
      if (links.length) send(links);
      else alert('No assessments found here.');
    })
    .catch(function () { alert('Could not read your Crowdmark assessments. Make sure you are signed in.'); });
}
document.querySelector('#bookmarklet').href = 'javascript:(' +
  crowdmarkBookmarklet.toString().replace('__SITE__', location.origin + location.pathname + '#convert=').replace(/\s*\n\s*/g, ' ') + ')()';

bankAssessment.addEventListener('change', () => {
  const page = coursePage();
  if (page) loadCourse(page);
});
window.addEventListener('hashchange', applyBankRoute);

// Bulk select: like a file manager. Click a row to select it, Ctrl/Cmd-click to add or remove one, Shift-click for a range,
// or use the checkboxes. A bar appears at the bottom while anything is selected.
const selectedIds = new Set();
const rowExams = new Map();
const selectBar = document.querySelector('#select-bar');
const selectCount = document.querySelector('#select-count');
const selectList = document.querySelector('#select-list');
const selectShare = document.querySelector('#select-share');
const selectZip = document.querySelector('#select-zip');
const converterStatus = document.querySelector('#status');
let selectAnchor;

const SELECTABLE = '.list-row[data-id], .result[data-id]';
const visibleSelectRows = () => {
  const view = [converterView, bankView, listsView].find(item => !item.hidden);
  return view ? [...view.querySelectorAll(SELECTABLE)] : [];
};

function createExamRow(exam, options) {
  const row = buildExamRow(exam, options);
  attachSelection(row, exam);
  return row;
}

// Makes a row (or a result card on the convert page) selectable.
function attachSelection(row, exam) {
  row.dataset.id = exam.id;
  rowExams.set(exam.id, exam);
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'row-check';
  check.setAttribute('aria-label', 'Select ' + examLabel(exam));
  check.addEventListener('click', event => {
    event.stopPropagation();
    if (event.shiftKey && selectAnchor) selectRange(exam.id, event.ctrlKey || event.metaKey);
    else {
      setSelected(exam.id, check.checked);
      selectAnchor = exam.id;
    }
    refreshSelection();
  });
  row.prepend(check);
  row.addEventListener('mousedown', event => {
    // Shift-click should select a range, not highlight text.
    if (event.shiftKey && !event.target.closest('input')) event.preventDefault();
  });
  row.addEventListener('click', event => {
    if (event.target.closest('button, a, input, select')) return;
    const toggle = event.ctrlKey || event.metaKey || matchMedia('(pointer: coarse)').matches;
    if (event.shiftKey && selectAnchor) selectRange(exam.id, toggle);
    else if (toggle) {
      setSelected(exam.id, !selectedIds.has(exam.id));
      selectAnchor = exam.id;
    } else {
      const only = selectedIds.size === 1 && selectedIds.has(exam.id);
      selectedIds.clear();
      if (!only) selectedIds.add(exam.id);
      selectAnchor = exam.id;
    }
    refreshSelection();
  });
  syncRowSelection(row);
}

function setSelected(id, on) {
  if (!on) selectedIds.delete(id);
  else if (selectedIds.size < savedLimit) selectedIds.add(id);
  else selectCount.textContent = 'Up to ' + savedLimit + ' at a time';
}

// Shift-click: everything between the last clicked row and this one (added to the selection with Ctrl/Cmd).
function selectRange(id, keep) {
  const ids = visibleSelectRows().map(row => row.dataset.id);
  const from = ids.indexOf(selectAnchor);
  const to = ids.indexOf(id);
  if (from < 0 || to < 0) return;
  if (!keep) selectedIds.clear();
  for (const other of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) setSelected(other, true);
}

function syncRowSelection(row) {
  const on = selectedIds.has(row.dataset.id);
  row.classList.toggle('row-selected', on);
  const box = row.querySelector('.row-check');
  if (box) box.checked = on;
}

function refreshSelection() {
  for (const row of document.querySelectorAll(SELECTABLE)) syncRowSelection(row);
  const count = selectedIds.size;
  selectBar.hidden = !count;
  document.body.classList.toggle('has-selection', count > 0);
  selectCount.textContent = count + ' selected';
  closeRowMenu();
}

function clearSelection() {
  selectedIds.clear();
  selectAnchor = undefined;
  refreshSelection();
}

const selectedExams = () => [...selectedIds].map(id => rowExams.get(id)).filter(Boolean);

document.querySelector('#select-done').addEventListener('click', clearSelection);
document.querySelector('#select-all').addEventListener('click', () => {
  const rows = visibleSelectRows().slice(0, savedLimit);
  const everyOne = rows.length && rows.every(row => selectedIds.has(row.dataset.id));
  selectedIds.clear();
  if (!everyOne) rows.forEach(row => selectedIds.add(row.dataset.id));
  refreshSelection();
});
document.addEventListener('keydown', event => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  if (event.key === 'Escape' && selectedIds.size && rowMenu.hidden && !document.querySelector('dialog[open]')) clearSelection();
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !typing) {
    const rows = visibleSelectRows().slice(0, savedLimit);
    if (!rows.length) return;
    event.preventDefault();
    selectedIds.clear();
    rows.forEach(row => selectedIds.add(row.dataset.id));
    refreshSelection();
  }
});

selectList.addEventListener('click', event => {
  event.stopPropagation();
  openMenu(selectList, bulkListItems);
});

function bulkListItems() {
  const ids = [...selectedIds];
  const items = [menuLabel('Add ' + ids.length + (ids.length === 1 ? ' assessment' : ' assessments') + ' to')];
  for (const list of readLists().filter(item => item.id !== importsId)) {
    const item = menuItem('', () => {
      let skipped = false;
      updateList(list.id, own => {
        for (const id of ids) {
          if (own.ids.includes(id)) continue;
          if (own.ids.length >= savedLimit) skipped = true;
          else own.ids.push(id);
        }
      });
      ids.forEach(markRows);
      check.textContent = '✓';
      items[0].textContent = skipped ? 'That list is full (' + savedLimit + ')' : 'Added to ' + list.name;
    });
    const check = document.createElement('span');
    check.className = 'menu-check';
    check.textContent = ids.every(id => list.ids.includes(id)) ? '✓' : '';
    item.append(check, list.name);
    items.push(item);
  }
  items.push(menuItem('+ New list', () => showMenuItems(newListItems(ids))));
  return items;
}

selectShare.addEventListener('click', async () => {
  const ids = [...selectedIds];
  const course = !bankView.hidden ? coursePage()?.course : '';
  const own = bankView.hidden ? readLists().find(list => list.id === listRoute().id) : undefined;
  const name = course ? courseLabel(course) : own?.name || 'Shared assessments';
  const result = await shareUrl(location.origin + '/#list=' + ids.join(',') + '&name=' + encodeURIComponent(name), name);
  if (result === 'cancelled') return;
  selectShare.textContent = result === 'failed' ? 'Copy failed' : result === 'shared' ? 'Shared' : 'Link copied';
  setTimeout(() => { selectShare.textContent = 'Share'; }, 1800);
});

selectZip.addEventListener('click', () => {
  const exams = selectedExams();
  const status = !converterView.hidden ? converterStatus : bankView.hidden ? listsStatus : bankStatus;
  zipExams(selectZip, exams, 'blank-assessments.zip', text => { status.textContent = text; }, () => 'Download');
});

// A shared address such as /MATH137 or /e/<id> opens the same page as the # address does.
function openSharedPath() {
  const course = /^\/([A-Za-z]{2,8}\d{3}[A-Za-z]?)$/.exec(location.pathname);
  const exam = /^\/e\/([a-f0-9-]{36})$/.exec(location.pathname);
  if (course) {
    history.replaceState(null, '', '/#exam-bank/' + course[1].toUpperCase());
    return;
  }
  if (!exam) return;
  return bankFetch('exams?ids=' + exam[1])
    .then(response => response.json())
    .then(({ exams }) => {
      const found = exams[0];
      history.replaceState(null, '', found?.course ? '/#exam-bank/' + found.course + '/' + found.id : '/#exam-bank');
    })
    .catch(() => history.replaceState(null, '', '/#exam-bank'));
}
const sharedPath = openSharedPath();
if (sharedPath) sharedPath.finally(applyBankRoute);
else applyBankRoute();
