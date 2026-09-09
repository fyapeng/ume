(() => {
  'use strict';
  const KEY = 'ume-reading-progress-v1';
  const $ = (id) => document.getElementById(id);
  const papers = (window.UME_READINGS || []).map(([id, week, year, authors, en, zh, url, linkLabel, source]) => ({id, week, year, authors, en, zh, url, linkLabel, source}));
  const ids = new Set(papers.map(p => p.id));
  if (papers.length !== 59 || ids.size !== 59) {
    $('readings').textContent = '清单数据未能完整加载，请刷新页面。';
    return;
  }
  const groups = Array.from({length: 28}, (_, i) => ({week: i + 1, papers: papers.filter(p => p.week === i + 1)}));
  let state = {version: 1, completed: {}, updatedAt: null};
  let status = 'all';
  let noticeTimer;
  let storageOK = true;
  const elements = new Map();
  const sections = new Map();
  function notify(message) {
    clearTimeout(noticeTimer);
    $('notice').textContent = message;
    $('notice').hidden = false;
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 4500);
  }
  // Import only known IDs and booleans. Never evaluate imported content.
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !value.completed || typeof value.completed !== 'object' || Array.isArray(value.completed)) throw new Error('不是有效的UME进度文件。');
    const completed = {};
    for (const [id, done] of Object.entries(value.completed)) {
      if (!ids.has(id) || typeof done !== 'boolean') throw new Error('进度文件含有未知编号或无效状态。');
      if (done) completed[id] = true;
    }
    return {version: 1, completed, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null};
  }
  function storageWarning() {
    storageOK = false;
    $('storage-note').textContent = '浏览器无法保存进度；离开前请导出备份。';
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      try { state = validate(JSON.parse(saved)); }
      catch (_) { notify('已保存的进度无法读取，暂以空白清单显示。原数据未被覆盖。'); }
    }
  } catch (_) { storageWarning(); }
  function persist() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOK = true;
      $('storage-note').textContent = '进度仅保存在此浏览器，换设备请导出、导入。';
    } catch (_) { storageWarning(); notify('未能自动保存，请导出进度备份。'); }
  }
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function link(url, label, className, title) {
    const a = node('a', className, label);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('不支持的原文链接。');
    a.href = parsed.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = title;
    a.setAttribute('aria-label', title + '，在新标签页打开');
    return a;
  }
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const section = node('section', 'week');
    section.id = 'week-' + group.week;
    section.setAttribute('aria-labelledby', 'week-title-' + group.week);
    const heading = node('div', 'week-heading');
    const h2 = node('h2'); h2.id = 'week-title-' + group.week;
    h2.append('第 ', node('span', '', String(group.week).padStart(2, '0')), ' 周');
    const count = node('span', 'week-count');
    heading.append(h2, count);
    const list = node('ul', 'paper-list');
    for (const p of group.papers) {
      const li = node('li', 'paper'); li.id = 'paper-' + p.id;
      const checkWrap = node('div', 'check-wrap');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'check-' + p.id;
      checkbox.setAttribute('aria-label', '标记已读：' + p.id + ' ' + p.zh);
      checkbox.checked = state.completed[p.id] === true;
      checkWrap.append(checkbox);
      const body = node('div', 'paper-body');
      const meta = node('div', 'meta');
      const companion = p.id.startsWith('C');
      meta.append(node('span', 'code' + (companion ? ' companion' : ''), p.id + (companion ? ' 伴读' : ' 主读')), node('span', 'author', p.authors), node('span', 'year', '· ' + p.year));
      const label = document.createElement('label'); label.htmlFor = checkbox.id;
      const en = node('h3', 'title-en', p.en); en.lang = 'en';
      label.append(en, node('p', 'title-zh', p.zh));
      body.append(meta, label);
      const links = node('div', 'paper-links');
      links.append(link(p.url, p.linkLabel + ' ↗', 'file-link', p.en + ' — ' + p.linkLabel));
      if (p.source && p.source !== p.url) links.append(link(p.source, '来源 ↗', 'source-link', p.en + ' — 来源页面'));
      li.append(checkWrap, body, links);
      list.append(li);
      elements.set(p.id, {li, checkbox});
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.completed[p.id] = true;
        else delete state.completed[p.id];
        persist(); refresh();
        if (storageOK) notify((checkbox.checked ? '已读 · ' : '恢复未读 · ') + p.id);
      });
    }
    section.append(heading, list); fragment.append(section);
    sections.set(group.week, {section, count});
    const option = node('option', '', '第 ' + String(group.week).padStart(2, '0') + ' 周');
    option.value = String(group.week); $('week-select').append(option);
  }
  $('readings').replaceChildren(fragment);
  const normalize = s => s.normalize('NFKC').toLocaleLowerCase().replace(/[’‘“”]/g, "'");
  function refresh() {
    const completed = papers.filter(p => state.completed[p.id] === true).length;
    const weeks = groups.filter(g => g.papers.every(p => state.completed[p.id] === true)).length;
    $('completed-count').textContent = completed;
    $('weeks-count').textContent = '完成 ' + weeks + ' / 28 周';
    $('total-progress').value = completed;
    $('total-progress').textContent = completed + ' / 59';
    $('continue').disabled = completed === 59;
    $('continue').firstChild.textContent = completed === 59 ? '全部读完 ' : '继续阅读 ';
    const terms = normalize($('search').value.trim()).split(/\s+/).filter(Boolean);
    const week = $('week-select').value;
    let visible = 0;
    for (const group of groups) {
      let groupVisible = 0;
      let groupDone = 0;
      for (const p of group.papers) {
        const {li, checkbox} = elements.get(p.id);
        const done = state.completed[p.id] === true;
        checkbox.checked = done; li.classList.toggle('read', done);
        if (done) groupDone++;
        const haystack = normalize([p.id, p.authors, p.year, p.en, p.zh, p.id.startsWith('M') ? '主读' : '伴读'].join(' '));
        const show = (week === 'all' || p.week === Number(week)) && (status === 'all' || (status === 'read' ? done : !done)) && terms.every(t => haystack.includes(t));
        li.hidden = !show; if (show) groupVisible++;
      }
      const {section, count} = sections.get(group.week);
      section.hidden = groupVisible === 0;
      count.textContent = groupDone + ' / ' + group.papers.length + ' 已读';
      count.classList.toggle('complete', groupDone === group.papers.length);
      visible += groupVisible;
    }
    $('empty').hidden = visible !== 0;
  }
  function clearFilters() {
    status = 'all'; $('search').value = ''; $('week-select').value = 'all';
    document.querySelectorAll('[data-filter]').forEach(b => { const active = b.dataset.filter === 'all'; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    refresh();
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    status = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    refresh();
  }));
  $('search').addEventListener('input', refresh);
  $('week-select').addEventListener('change', () => { refresh(); $('readings').scrollIntoView({block: 'start'}); });
  $('clear-filters').addEventListener('click', clearFilters);
  $('continue').addEventListener('click', () => {
    clearFilters();
    const next = papers.find(p => state.completed[p.id] !== true);
    if (next) {
      const {li, checkbox} = elements.get(next.id);
      li.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      checkbox.focus({preventScroll: true});
    }
  });
  $('export').addEventListener('click', () => {
    const data = {...state, app: 'ume', exportedAt: new Date().toISOString()};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'ume-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    notify('已导出进度备份。');
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 100000) throw new Error('进度文件过大，请选择UME导出的JSON文件。');
      const imported = validate(JSON.parse(await file.text()));
      const total = Object.keys(imported.completed).length;
      if (!confirm('导入文件中已读 ' + total + ' 篇。是否用它替换此浏览器当前的进度？')) return;
      state = imported; persist(); refresh();
      if (storageOK) notify('已导入 ' + total + ' 篇已读进度。');
    } catch (error) { notify(error instanceof SyntaxError ? '无法读取文件，请选择有效的JSON进度备份。' : error.message); }
    finally { event.target.value = ''; }
  });
  // Keep open tabs consistent without sending progress to a server.
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    try {
      state = event.newValue ? validate(JSON.parse(event.newValue)) : {version: 1, completed: {}, updatedAt: null};
      refresh();
    } catch (_) { notify('另一标签页的进度无法读取，当前显示保持不变。'); }
  });
  refresh();
})();
