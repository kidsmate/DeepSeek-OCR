/* ===== 安冉的学习助手 - 主逻辑 ===== */
let state = loadData();
let currentSubject = null;
let currentKnowledge = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let selectedWishIcon = '🎁';
let currentPdfData = null;

// ============ IndexedDB 工具（保存 PDF 原始文件）============
const DB_NAME = 'anran_learning';
const DB_VERSION = 1;
const STORE_NAME = 'pdf_files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function savePdfToDB(id, arrayBuffer, name) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, data: arrayBuffer, name, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function loadPdfFromDB(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = () => reject(req.error);
  }));
}

function deletePdfFromDB(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// PDF.js 文档缓存
const _pdfDocCache = {};
async function getPdfDoc(textbookId, arrayBuffer) {
  if (_pdfDocCache[textbookId]) {
    console.log('[PDF] 使用缓存的文档:', textbookId);
    return _pdfDocCache[textbookId];
  }
  if (!arrayBuffer) {
    console.log('[PDF] 从 IndexedDB 加载:', textbookId);
    arrayBuffer = await loadPdfFromDB(textbookId);
  }
  if (!arrayBuffer) {
    console.error('[PDF] IndexedDB 中未找到 PDF:', textbookId);
    return null;
  }
  console.log('[PDF] PDF 数据大小:', arrayBuffer.byteLength, 'bytes');
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  console.log('[PDF] 文档加载成功，共', doc.numPages, '页');
  _pdfDocCache[textbookId] = doc;
  return doc;
}

// ============ 初始化 ============
function init() {
  renderAll();
  setupEventListeners();
  // 设置 PDF.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

function renderAll() {
  updateTopBar();
  renderDashboard();
  renderSubjects();
  renderRewards();
  renderWishlist();
  renderTextbooks();
  renderSettings();
}

// ============ 顶部栏 ============
function updateTopBar() {
  document.getElementById('pointsValue').textContent = state.points;
  document.getElementById('streakValue').textContent = state.streak;
}

// ============ 仪表盘 ============
function renderDashboard() {
  // 日期
  const d = new Date();
  const weekdays = ['日','一','二','三','四','五','六'];
  document.getElementById('todayDate').textContent =
    `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;

  // 问候
  const hour = d.getHours();
  let greet = '早上好';
  if (hour >= 11 && hour < 13) greet = '中午好';
  else if (hour >= 13 && hour < 18) greet = '下午好';
  else if (hour >= 18) greet = '晚上好';
  document.getElementById('greetingTitle').textContent = `${greet}，${state.nickname}！`;
  document.getElementById('dailyQuote').textContent =
    DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)];

  // 打卡按钮
  const btn = document.getElementById('btnDailyCheckin');
  if (isTodayChecked(state)) {
    btn.textContent = '✓ 已打卡';
    btn.classList.add('done');
    btn.disabled = true;
  } else {
    btn.textContent = '每日打卡';
    btn.classList.remove('done');
    btn.disabled = false;
  }

  // 今日任务 - 推荐未学的知识点
  renderTodayTasks();

  // 统计
  document.getElementById('statLearned').textContent = masteredCount(state);
  document.getElementById('statMastered').textContent = masteredCount(state);
  document.getElementById('statThisWeek').textContent = thisWeekCheckinCount(state);
  document.getElementById('statDays').textContent = state.checkinDates.length;

  // 日历
  renderCalendar();
}

function renderTodayTasks() {
  const grid = document.getElementById('todayTasks');
  // 找未学的知识点，每个学科取1个，凑够 dailyGoal 个
  const tasks = [];
  for (const subj of SUBJECTS) {
    for (const chap of subj.chapters) {
      for (const p of chap.points) {
        if (!state.learnedPoints[p.id] && tasks.length < state.dailyGoal) {
          tasks.push({ subject: subj, point: p });
        }
      }
    }
    if (tasks.length >= state.dailyGoal) break;
  }

  if (tasks.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div>太棒了！所有知识点都学完啦</div>';
    return;
  }

  const today = todayStr();
  const todayCount = todayLearnedCount(state);

  grid.innerHTML = tasks.map(t => {
    const learned = !!state.learnedPoints[t.point.id];
    return `
      <div class="task-card ${learned ? 'done' : ''}" onclick="openKnowledge('${t.subject.id}','${t.point.id}')">
        <div class="task-icon" style="background:${hexToRgba(t.subject.color,0.12)}">${t.subject.icon}</div>
        <div class="task-info">
          <div class="task-name">${t.point.title}</div>
          <div class="task-sub">${t.subject.name} · ${t.subject.chapters.find(c=>c.points.some(p=>p.id===t.point.id)).title}</div>
        </div>
        <div class="task-check">${learned ? '✓' : ''}</div>
      </div>
    `;
  }).join('');

  // 今日进度提示
  if (todayCount >= state.dailyGoal) {
    grid.insertAdjacentHTML('beforebegin',
      `<div style="background:linear-gradient(135deg,#00B894,#55EFC4);color:white;padding:12px 16px;border-radius:12px;margin-bottom:12px;font-weight:600;">
        🎉 今日目标已完成（${todayCount}/${state.dailyGoal}），继续保持！
      </div>`);
  }
}

function renderCalendar() {
  const monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  document.getElementById('calTitle').textContent = `${calYear}年 ${monthNames[calMonth]}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const checked = state.checkinDates.includes(dateStr);
    const isToday = dateStr === today;
    const classes = ['cal-day'];
    if (checked) classes.push('checked');
    if (isToday) classes.push('today');
    html += `<div class="${classes.join(' ')}">${day}</div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

// ============ 每日打卡 ============
function dailyCheckin() {
  if (isTodayChecked(state)) {
    showToast('今天已经打卡过啦～');
    return;
  }
  const today = todayStr();
  state.checkinDates.push(today);

  // 连续打卡
  if (isYesterdayChecked(state) || state.streak === 0) {
    state.streak += 1;
  } else {
    state.streak = 1;
  }

  // 打卡奖励
  state.points += 10;
  addRecord(state, 'reward', '每日打卡', 10);

  // 连续7天额外奖励
  if (state.streak > 0 && state.streak % 7 === 0) {
    state.points += 30;
    addRecord(state, 'reward', `连续打卡${state.streak}天奖励`, 30);
    showToast(`🔥 连续打卡${state.streak}天！额外奖励30积分`);
  } else {
    showToast('🎉 打卡成功！+10积分');
  }

  saveData(state);
  renderAll();
}

// ============ 学科列表 ============
function renderSubjects() {
  const grid = document.getElementById('subjectsGrid');
  grid.innerHTML = SUBJECTS.map(s => {
    let total = 0, learned = 0;
    s.chapters.forEach(c => c.points.forEach(p => {
      total++;
      if (state.learnedPoints[p.id]) learned++;
    }));
    const pct = total ? Math.round(learned / total * 100) : 0;
    return `
      <div class="subject-card" style="border-top-color:${s.color}" onclick="openSubject('${s.id}')">
        <div class="subject-icon">${s.icon}</div>
        <div class="subject-name">${s.name}</div>
        <div class="subject-desc">${s.desc}</div>
        <div class="subject-progress-mini"><div class="fill" style="width:${pct}%;background:${s.color}"></div></div>
        <div class="subject-progress-text">${learned} / ${total} 知识点</div>
      </div>
    `;
  }).join('');
}

// ============ 学科详情 ============
function openSubject(subjectId) {
  currentSubject = SUBJECTS.find(s => s.id === subjectId);
  if (!currentSubject) return;
  document.getElementById('subjectDetailTitle').textContent = `${currentSubject.icon} ${currentSubject.name}`;

  let total = 0, learned = 0;
  currentSubject.chapters.forEach(c => c.points.forEach(p => {
    total++;
    if (state.learnedPoints[p.id]) learned++;
  }));
  const pct = total ? Math.round(learned / total * 100) : 0;
  document.getElementById('subjectProgressFill').style.width = pct + '%';
  document.getElementById('subjectProgressText').textContent = `${learned} / ${total}（${pct}%）`;

  const list = document.getElementById('knowledgeList');
  list.innerHTML = currentSubject.chapters.map(c => `
    <div class="chapter-block">
      <div class="section-title" style="color:${currentSubject.color}">📚 ${c.title}</div>
      ${c.points.map(p => {
        const isLearned = !!state.learnedPoints[p.id];
        return `
          <div class="kp-item ${isLearned ? 'learned' : ''}" onclick="openKnowledge('${currentSubject.id}','${p.id}')">
            <div class="kp-status">${isLearned ? '✓' : ''}</div>
            <div class="kp-info">
              <div class="kp-title">${p.title}</div>
              <div class="kp-chapter">${c.title}</div>
            </div>
            <div class="kp-action">${isLearned ? '已掌握' : '去学习'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');

  navigate('subject-detail');
}

// ============ 知识点详情（学习页）============
function openKnowledge(subjectId, pointId) {
  const subj = SUBJECTS.find(s => s.id === subjectId);
  const point = subj.chapters.flatMap(c => c.points).find(p => p.id === pointId);
  if (!point) return;
  currentKnowledge = { subject: subj, point };
  openLearnPage(subj, point);
}

function openLearnPage(subj, point) {
  currentKnowledge = { subject: subj, point };
  document.getElementById('learnTitle').textContent = point.title;
  document.getElementById('learnSubjectTag').innerHTML =
    `<span class="badge" style="background:${hexToRgba(subj.color,0.12)};color:${subj.color};padding:6px 14px;border-radius:8px;font-size:14px;font-weight:600;">${subj.icon} ${subj.name}</span>`;

  const content = LEARNING_CONTENT[point.id] || {};

  // 知识总结
  document.getElementById('learnSummary').innerHTML = `
    <div class="learn-section-title">📝 知识总结</div>
    <p class="learn-text">${content.summary || point.content || '暂无总结内容'}</p>
  `;

  // 核心要点
  const kps = content.keyPoints || [];
  document.getElementById('learnKeyPoints').innerHTML = `
    <div class="learn-section-title">🔑 核心要点</div>
    ${kps.length ? kps.map((k, i) => `
      <div class="keypoint-item">
        <div class="kp-num">${i+1}</div>
        <div class="kp-text">${k}</div>
      </div>
    `).join('') : '<p class="learn-text">暂无核心要点</p>'}
  `;

  // 教材内容（从上传的 PDF 关联）
  renderLearnTextbook(subj, point);

  // 教学视频
  renderLearnVideo(content.videoKeywords || point.title);

  // 习题练习
  const exs = content.exercises || [];
  document.getElementById('learnExercise').innerHTML = `
    <div class="learn-section-title">✏️ 习题练习</div>
    ${exs.length ? exs.map((e, i) => `
      <div class="exercise-item" id="ex-${i}">
        <div class="ex-q"><span class="ex-tag">第${i+1}题</span>${e.q}</div>
        <div class="ex-answer" id="ex-ans-${i}" style="display:none;">
          <div class="ex-ans-label">参考答案</div>
          <div class="ex-ans-text">${e.a}</div>
          <div class="ex-exp-label">解析</div>
          <div class="ex-exp-text">${e.e}</div>
        </div>
        <button class="btn-secondary ex-toggle" onclick="toggleAnswer(${i})" id="ex-btn-${i}">查看答案与解析</button>
      </div>
    `).join('') : '<p class="learn-text">暂无习题</p>'}
  `;

  // 标记已学按钮状态
  const isLearned = !!state.learnedPoints[point.id];
  const btn = document.getElementById('learnMarkBtn');
  if (isLearned) {
    btn.textContent = '取消标记 (-5🪙)';
    btn.style.background = 'var(--danger)';
  } else {
    btn.textContent = '标记已学 (+5🪙)';
    btn.style.background = 'var(--accent)';
  }

  // 默认显示第一个 tab
  switchLearnSection('summary');
  document.querySelectorAll('.learn-tab').forEach(t => t.classList.toggle('active', t.dataset.section === 'summary'));

  navigate('learn');
}

// 记录当前选中的教材章节索引 {textbookIdx: sectionIdx}
const currentTbSelection = {};
// 缓存当前渲染的教材列表（供 selectTbSection 访问 sections 数据）
let _renderedTextbooks = [];

function renderLearnTextbook(subj, point) {
  const textbooks = state.textbooks.filter(t => t.subject === subj.name || t.subject === '');
  _renderedTextbooks = textbooks;
  const container = document.getElementById('learnTextbook');
  
  if (textbooks.length === 0) {
    container.innerHTML = `
      <div class="learn-section-title">📖 教材内容</div>
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>尚未上传 ${subj.name} 教材</p>
        <p style="font-size:13px;margin-top:8px;">前往"教材"页面上传人教版${subj.name}教材 PDF，系统将自动按单元整理课文</p>
      </div>
    `;
    return;
  }

  let html = `<div class="learn-section-title">📖 教材内容（${subj.name}）</div>`;
  
  textbooks.forEach((t, ti) => {
    const units = t.units && t.units.length ? t.units : null;
    const sections = t.sections || [];
    const chapters = t.chapters || [];
    window._renderedTextbook = window._renderedTextbook || {};
    window._renderedTextbook[ti] = t;
    
    html += `<div class="textbook-ref">`;
    html += `<div class="textbook-ref-name">📄 ${t.name}</div>`;
    const totalLessons = units ? units.reduce((s, u) => s + u.lessons.length, 0) : sections.length;
    html += `<div class="textbook-ref-meta">上传于 ${formatTime(t.uploadTime)} · ${units ? units.length + ' 个单元' : sections.length + ' 个章节'} · ${totalLessons} 篇课文</div>`;

    if (!units && sections.length === 0) {
      html += `
        <div class="textbook-old-notice">
          ⚠️ 该教材为旧版数据，未保存正文内容。请删除后重新上传以查看完整教材正文。
        </div>
        ${chapters.length ? '<div class="chapters-mini">' + chapters.slice(0, 15).map((c, i) => `<span class="chapter-chip">${i+1}. ${c}</span>`).join('') + '</div>' : ''}
      `;
    } else {
      // 优先使用 units 结构；若没有 units 则把 sections 包装成一个单元
      const bookUnits = units || [{ title: '教材内容', lessons: sections.map(s => ({ title: s.title, content: s.content })) }];
      html += renderBookReader(bookUnits, ti, point);
    }
    html += `</div>`;
  });
  
  container.innerHTML = html;
}

// 渲染书本式阅读器：左侧目录 + 右侧正文（左右分栏）
function renderBookReader(units, ti, point) {
  let html = '';
  const readerId = `reader-${ti}`;

  // 找到匹配的课文索引
  let matchedU = -1, matchedL = -1;
  units.forEach((u, ui) => {
    u.lessons.forEach((l, li) => {
      if (matchedU < 0 && point && (l.title.includes(point.title) || point.title.includes(l.title.substring(0, 2)) || findRelevantSection({sections:[{title:l.title,content:l.content}]}, point) === 0)) {
        matchedU = ui; matchedL = li;
      }
    });
  });
  if (matchedU < 0) { matchedU = 0; matchedL = 0; }

  // 构建所有课文的扁平列表，便于右侧渲染
  const allLessons = [];
  units.forEach((u, ui) => {
    u.lessons.forEach((l, li) => {
      allLessons.push({ unitTitle: u.title, ui, li, ...l });
    });
  });
  const flatIdx = matchedU >= 0 ? allLessons.findIndex(l => l.ui === matchedU && l.li === matchedL) : 0;

  // 存储当前选中状态
  window._tbSelection = window._tbSelection || {};
  window._tbSelection[ti] = { flatIdx };

  html += `<div class="tb-reader" id="${readerId}">`;

  // ===== 左侧目录 =====
  html += `<div class="tb-toc">`;
  html += `<div class="tb-toc-title">📑 目录</div>`;
  html += `<div class="tb-toc-list" id="tb-toc-list-${ti}">`;
  units.forEach((u, ui) => {
    html += `<div class="tb-toc-unit-label">${escapeHtml(u.title)}</div>`;
    u.lessons.forEach((l, li) => {
      const fIdx = allLessons.findIndex(x => x.ui === ui && x.li === li);
      const active = (ui === matchedU && li === matchedL);
      html += `
        <div class="tb-toc-item ${active ? 'active' : ''}" 
             id="tb-toc-item-${ti}-${fIdx}"
             onclick="selectBookLesson('${ti}', ${fIdx})">
          <span class="tb-toc-text">${escapeHtml(l.title)}</span>
        </div>
      `;
    });
  });
  html += `</div></div>`;

  // ===== 右侧正文 =====
  html += `<div class="tb-content" id="tb-content-${ti}">`;
  html += `<div class="tb-content-header">`;
  html += `<div class="tb-content-unit" id="tb-content-unit-${ti}">${escapeHtml(allLessons[flatIdx].unitTitle)}</div>`;
  html += `<h2 class="tb-content-title" id="tb-content-title-${ti}">${escapeHtml(allLessons[flatIdx].title)}</h2>`;
  html += `<div class="tb-content-nav">`;
  html += `<button class="btn-secondary btn-sm" onclick="navBookLesson('${ti}', -1)" ${flatIdx === 0 ? 'disabled' : ''}>← 上一篇</button>`;
  html += `<span class="tb-content-page">${flatIdx+1} / ${allLessons.length}</span>`;
  html += `<button class="btn-secondary btn-sm" onclick="navBookLesson('${ti}', 1)" ${flatIdx === allLessons.length-1 ? 'disabled' : ''}>下一篇 →</button>`;
  html += `</div></div>`;
  html += `<div class="tb-content-body" id="tb-content-body-${ti}">`;
  html += formatTextbookContent(allLessons[flatIdx].content);
  html += `</div></div>`;

  html += `</div>`;

  // 存储课文数据供切换使用
  window._tbLessons = window._tbLessons || {};
  window._tbLessons[ti] = allLessons;
  window._tbSelection = window._tbSelection || {};
  window._tbSelection[ti] = { flatIdx };

  // 存储教材 ID 和是否有 PDF
  const textbook = window._renderedTextbook && window._renderedTextbook[ti];
  window._tbTextbookId = window._tbTextbookId || {};
  window._tbHasPdf = window._tbHasPdf || {};
  window._tbTextbookId[ti] = textbook ? textbook.id : null;
  window._tbHasPdf[ti] = textbook ? !!textbook.hasPdf : false;
  console.log('[教材阅读器] ti=', ti, 'textbook=', textbook ? { id: textbook.id, hasPdf: textbook.hasPdf, units: textbook.units && textbook.units.length } : null);

  // 如果有 PDF，初始也渲染 PDF 页面
  if (textbook && textbook.hasPdf) {
    const l = allLessons[flatIdx];
    console.log('[教材阅读器] 初始渲染 PDF，课文=', l.title, 'startPage=', l.startPage);
    if (l.startPage) {
      setTimeout(() => {
        const bodyEl = document.getElementById(`tb-content-body-${ti}`);
        if (bodyEl) {
          bodyEl.innerHTML = `<div class="pdf-loading">📄 正在加载 PDF 第 ${l.startPage} 页...</div>`;
          renderPdfPage(textbook.id, l.startPage, bodyEl, l.title);
        }
      }, 100);
    }
  } else {
    console.log('[教材阅读器] 无 PDF，显示文本内容。hasPdf=', textbook && textbook.hasPdf);
  }

  return html;
}

// 选中课文（更新右侧正文，优先渲染 PDF 页面）
function selectBookLesson(ti, fIdx) {
  const lessons = window._tbLessons && window._tbLessons[ti];
  if (!lessons || !lessons[fIdx]) return;
  const l = lessons[fIdx];
  window._tbSelection[ti] = { flatIdx: fIdx };

  // 更新目录高亮
  document.querySelectorAll(`#tb-toc-list-${ti} .tb-toc-item`).forEach((el, idx) => {
    el.classList.toggle('active', idx === fIdx);
  });

  // 更新单元、标题
  const unitEl = document.getElementById(`tb-content-unit-${ti}`);
  if (unitEl) unitEl.textContent = l.unitTitle;
  const titleEl = document.getElementById(`tb-content-title-${ti}`);
  if (titleEl) titleEl.textContent = l.title;

  // 更新导航按钮
  const navEl = document.querySelector(`#tb-content-${ti} .tb-content-nav`);
  if (navEl) {
    navEl.innerHTML = `
      <button class="btn-secondary btn-sm" onclick="navBookLesson('${ti}', -1)" ${fIdx === 0 ? 'disabled' : ''}>← 上一篇</button>
      <span class="tb-content-page">${fIdx+1} / ${lessons.length}</span>
      <button class="btn-secondary btn-sm" onclick="navBookLesson('${ti}', 1)" ${fIdx === lessons.length-1 ? 'disabled' : ''}>下一篇 →</button>
    `;
  }

  // 渲染 PDF 页面（优先）或文本内容
  const bodyEl = document.getElementById(`tb-content-body-${ti}`);
  const textbookId = window._tbTextbookId && window._tbTextbookId[ti];
  const hasPdf = window._tbHasPdf && window._tbHasPdf[ti];

  if (hasPdf && textbookId && l.startPage) {
    bodyEl.innerHTML = `<div class="pdf-loading">📄 正在加载 PDF 第 ${l.startPage} 页...</div>`;
    renderPdfPage(textbookId, l.startPage, bodyEl, l.title);
  } else {
    bodyEl.innerHTML = formatTextbookContent(l.content);
  }

  // 滚动正文到顶部
  const contentEl = document.getElementById(`tb-content-${ti}`);
  if (contentEl) contentEl.scrollTop = 0;
}

// 用 PDF.js 渲染指定页码到容器
async function renderPdfPage(textbookId, pageNum, container, lessonTitle) {
  try {
    const doc = await getPdfDoc(textbookId);
    if (!doc) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div><p>PDF 文件未找到，请重新上传教材</p></div>`;
      return;
    }
    if (pageNum > doc.numPages) pageNum = doc.numPages;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });

    // 清空容器
    container.innerHTML = '';

    // 课文标题 + 页码信息
    const info = document.createElement('div');
    info.className = 'pdf-page-info';
    info.innerHTML = `<span class="pdf-page-badge">第 ${pageNum} 页 / 共 ${doc.numPages} 页</span><button class="btn-secondary btn-sm" onclick="renderPdfPageNav('${textbookId}', ${pageNum-1}, this, '${lessonTitle.replace(/'/g,"\\'")}')" ${pageNum<=1?'disabled':''}>上一页</button><button class="btn-secondary btn-sm" onclick="renderPdfPageNav('${textbookId}', ${pageNum+1}, this, '${lessonTitle.replace(/'/g,"\\'")}')" ${pageNum>=doc.numPages?'disabled':''}>下一页</button>`;
    container.appendChild(info);

    // 渲染 canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    container.appendChild(canvas);
  } catch (err) {
    console.error('PDF 渲染失败:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>PDF 渲染失败：${err.message || '未知错误'}</p></div>`;
  }
}

// PDF 翻页
function renderPdfPageNav(textbookId, pageNum, btnEl, lessonTitle) {
  const container = btnEl.closest('.tb-content-body') || btnEl.parentElement.parentElement;
  renderPdfPage(textbookId, pageNum, container, lessonTitle);
}

// 上一篇/下一篇导航
function navBookLesson(ti, dir) {
  const lessons = window._tbLessons && window._tbLessons[ti];
  if (!lessons) return;
  const cur = (window._tbSelection && window._tbSelection[ti] && window._tbSelection[ti].flatIdx) || 0;
  const next = cur + dir;
  if (next >= 0 && next < lessons.length) {
    selectBookLesson(ti, next);
  }
}

// 根据知识点匹配教材中的相关章节（关键词重叠度）
function findRelevantSection(textbook, point) {
  if (!textbook.sections || textbook.sections.length === 0) return -1;
  // 停用词（常见无意义单字）
  const stopwords = new Set(['的','了','是','在','和','与','或','等','中','上','下','不','也','都','就','及','之','其','此','个','一','二','三','为','有','我','你','他','她','它','这','那','被','把','让','使','从','到','向','对','于']);
  // 提取知识点标题中的有效关键词（单字也保留，但过滤停用词）
  const pointText = point.title + ' ' + (point.content || '');
  const tokens = pointText.match(/[\u4e00-\u9fa5A-Za-z0-9]+/g) || [];
  const kwSet = new Set();
  tokens.forEach(t => {
    if (t.length >= 2) kwSet.add(t);
    else if (t.length === 1 && !stopwords.has(t)) kwSet.add(t);
  });
  let bestIdx = -1;
  let bestScore = 0;
  textbook.sections.forEach((sec, i) => {
    const titleText = sec.title;
    const bodyText = sec.content.substring(0, 500);
    let score = 0;
    kwSet.forEach(k => {
      if (titleText.includes(k)) score += (k.length >= 2 ? 3 : 1);  // 标题匹配
      else if (bodyText.includes(k)) score += (k.length >= 2 ? 1 : 0); // 正文匹配（单字不计）
    });
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestScore >= 1 ? bestIdx : -1;
}

// 格式化教材正文（简单换行和段落处理）
function formatTextbookContent(text) {
  if (!text) return '<p style="color:var(--text-light);">暂无内容</p>';
  // 按换行符分段，过滤空行
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return '<p style="color:var(--text-light);">暂无内容</p>';
  return lines.map(l => `<p class="tb-paragraph">${escapeHtml(l)}</p>`).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderLearnVideo(keywords) {
  const encoded = encodeURIComponent(keywords);
  const bilibiliUrl = `https://search.bilibili.com/all?keyword=${encoded}`;
  document.getElementById('learnVideo').innerHTML = `
    <div class="learn-section-title">🎬 教学视频</div>
    <div class="video-card">
      <div class="video-search">
        <div class="video-search-icon">🔍</div>
        <div class="video-search-text">
          <div style="font-weight:600;margin-bottom:4px;">在 B 站搜索教学视频</div>
          <div style="font-size:13px;color:var(--text-light);">关键词：${keywords}</div>
        </div>
        <a href="${bilibiliUrl}" target="_blank" class="btn-primary" style="text-decoration:none;">去搜索</a>
      </div>
    </div>
    <div class="video-tips">
      <p>💡 建议在 B 站搜索以下关键词组合：</p>
      <div class="keyword-tags">
        <span class="kw-tag">${keywords}</span>
        <span class="kw-tag">${keywords} 人教版</span>
        <span class="kw-tag">${keywords} 初中</span>
        <span class="kw-tag">${keywords} 讲解</span>
      </div>
      <p style="margin-top:12px;font-size:13px;color:var(--text-light);">点击上方"去搜索"按钮，将跳转至 B 站搜索相关教学视频。选择播放量高、评价好的视频观看学习效果更佳。</p>
    </div>
  `;
}

function switchLearnSection(section) {
  document.querySelectorAll('.learn-section').forEach(s => s.classList.remove('active'));
  document.getElementById('learn-section-' + section).classList.add('active');
  document.querySelectorAll('.learn-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));
}

function toggleAnswer(index) {
  const ans = document.getElementById('ex-ans-' + index);
  const btn = document.getElementById('ex-btn-' + index);
  if (ans.style.display === 'none') {
    ans.style.display = 'block';
    btn.textContent = '收起答案';
  } else {
    ans.style.display = 'none';
    btn.textContent = '查看答案与解析';
  }
}

function markLearnedFromPage() {
  if (!currentKnowledge) return;
  markLearned();
  // 重新渲染按钮
  const isLearned = !!state.learnedPoints[currentKnowledge.point.id];
  const btn = document.getElementById('learnMarkBtn');
  if (isLearned) {
    btn.textContent = '取消标记 (-5🪙)';
    btn.style.background = 'var(--danger)';
  } else {
    btn.textContent = '标记已学 (+5🪙)';
    btn.style.background = 'var(--accent)';
  }
}

function markLearned() {
  if (!currentKnowledge) return;
  const { point } = currentKnowledge;
  if (state.learnedPoints[point.id]) {
    delete state.learnedPoints[point.id];
    state.points = Math.max(0, state.points - 5);
    addRecord(state, 'punish', `取消学习：${point.title}`, -5);
    showToast('已取消标记，-5积分');
  } else {
    state.learnedPoints[point.id] = Date.now();
    state.points += 5;
    addRecord(state, 'learn', `学习：${point.title}`, 5);
    showToast('🎉 学习完成！+5积分');
    if (isDailyGoalDone(state)) {
      state.points += 10;
      addRecord(state, 'reward', '完成每日目标', 10);
      setTimeout(() => showToast('🎯 完成每日目标！额外+10积分'), 600);
    }
  }
  saveData(state);
  updateTopBar();
  if (currentSubject) openSubject(currentSubject.id);
}

function closeModal() {
  document.getElementById('knowledgeModal').classList.remove('show');
  document.getElementById('btnMarkLearned').style.display = '';
  // 恢复弹窗默认样式
  const modalContent = document.querySelector('#knowledgeModal .modal-content');
  if (modalContent) modalContent.classList.remove('modal-wide');
  const modalFooter = document.querySelector('#knowledgeModal .modal-footer');
  if (modalFooter) modalFooter.style.display = '';
  currentKnowledge = null;
}

// ============ 激励中心 ============
function renderRewards() {
  // 正向规则
  document.getElementById('positiveRules').innerHTML = POSITIVE_RULES.map(r => `
    <div class="rule-item">
      <div class="rule-icon">${r.icon}</div>
      <div class="rule-info">
        <div class="rule-name">${r.name}</div>
        <div class="rule-desc">${r.desc}</div>
      </div>
      <div class="rule-value positive">${r.value}🪙</div>
    </div>
  `).join('');

  // 惩罚规则
  document.getElementById('negativeRules').innerHTML = NEGATIVE_RULES.map(r => `
    <div class="rule-item">
      <div class="rule-icon">${r.icon}</div>
      <div class="rule-info">
        <div class="rule-name">${r.name}</div>
        <div class="rule-desc">${r.desc}</div>
      </div>
      <div class="rule-value negative">${r.value}🪙</div>
    </div>
  `).join('');

  // 奖励记录
  const rewards = state.records.filter(r => r.type === 'reward' || r.type === 'learn');
  document.getElementById('rewardRecords').innerHTML = rewards.length ? rewards.slice(0, 30).map(r => `
    <div class="record-item">
      <div class="record-left">
        <div class="record-icon">${r.type === 'learn' ? '📖' : '🎁'}</div>
        <div>
          <div class="record-name">${r.name}</div>
          <div class="record-time">${formatTime(r.time)}</div>
        </div>
      </div>
      <div class="record-value positive">+${r.value}🪙</div>
    </div>
  `).join('') : '<div class="empty-state">暂无奖励记录</div>';

  // 惩罚记录
  const punishes = state.records.filter(r => r.type === 'punish' || r.type === 'redeem');
  document.getElementById('punishRecords').innerHTML = punishes.length ? punishes.slice(0, 30).map(r => `
    <div class="record-item">
      <div class="record-left">
        <div class="record-icon">${r.type === 'redeem' ? '🌟' : '⚠️'}</div>
        <div>
          <div class="record-name">${r.name}</div>
          <div class="record-time">${formatTime(r.time)}</div>
        </div>
      </div>
      <div class="record-value negative">${r.value}🪙</div>
    </div>
  `).join('') : '<div class="empty-state">暂无惩罚记录</div>';
}

// ============ 心愿清单 ============
function renderWishlist() {
  document.getElementById('wishPoints').textContent = state.points;
  const grid = document.getElementById('wishlistGrid');
  if (state.wishes.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🌟</div>还没有心愿，点击右上角添加吧</div>';
    return;
  }
  grid.innerHTML = state.wishes.map(w => `
    <div class="wish-card ${w.granted ? 'granted' : ''}">
      <div class="wish-icon">${w.icon}</div>
      <div class="wish-name">${w.name}</div>
      <div class="wish-cost">${w.cost} 🪙</div>
      ${w.granted
        ? '<div class="wish-status">✓ 已实现</div>'
        : `<div class="wish-actions">
             <button class="wish-btn redeem" ${state.points < w.cost ? 'disabled' : ''} onclick="redeemWish('${w.id}')">兑换</button>
             <button class="wish-btn delete" onclick="deleteWish('${w.id}')">删除</button>
           </div>`
      }
    </div>
  `).join('');
}

function openWishModal() {
  selectedWishIcon = '🎁';
  document.getElementById('wishName').value = '';
  document.getElementById('wishCost').value = '';
  document.querySelectorAll('#emojiPicker span').forEach(s => s.classList.remove('selected'));
  document.getElementById('wishModal').classList.add('show');
}

function closeWishModal() {
  document.getElementById('wishModal').classList.remove('show');
}

function saveWish() {
  const name = document.getElementById('wishName').value.trim();
  const cost = parseInt(document.getElementById('wishCost').value);
  if (!name) { showToast('请输入心愿名称'); return; }
  if (!cost || cost <= 0) { showToast('请输入有效的积分'); return; }
  state.wishes.push({
    id: 'w' + Date.now(),
    name, cost, icon: selectedWishIcon, granted: false
  });
  saveData(state);
  renderWishlist();
  closeWishModal();
  showToast('心愿已添加 🎉');
}

function redeemWish(id) {
  const w = state.wishes.find(x => x.id === id);
  if (!w || w.granted) return;
  if (state.points < w.cost) { showToast('积分不足，继续努力吧！'); return; }
  if (!confirm(`确定用 ${w.cost} 积分兑换「${w.name}」吗？`)) return;
  state.points -= w.cost;
  w.granted = true;
  addRecord(state, 'redeem', `兑换心愿：${w.name}`, -w.cost);
  saveData(state);
  renderAll();
  showToast(`🌟 心愿「${w.name}」已实现！`);
}

function deleteWish(id) {
  if (!confirm('确定删除这个心愿吗？')) return;
  state.wishes = state.wishes.filter(w => w.id !== id);
  saveData(state);
  renderWishlist();
}

// ============ 教材管理 ============
function renderTextbooks() {
  const list = document.getElementById('textbooksList');
  if (state.textbooks.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div>还没有上传教材，上传后可自动整理知识点</div>';
    return;
  }
  list.innerHTML = state.textbooks.map(t => {
    const unitCount = t.units && t.units.length ? t.units.length : 0;
    const lessonCount = t.units ? t.units.reduce((s, u) => s + u.lessons.length, 0) : (t.sections ? t.sections.length : 0);
    const hasContent = unitCount > 0 || (t.sections && t.sections.length > 0);
    return `
    <div class="textbook-item">
      <div class="textbook-icon">📄</div>
      <div class="textbook-info">
        <div class="textbook-name">${t.name}</div>
        <div class="textbook-meta">${t.subject || '未分类'} · ${unitCount ? unitCount + ' 个单元 / ' + lessonCount + ' 篇课文' : (t.chapters ? t.chapters.length + ' 个章节' : '0')}${hasContent ? '（含正文）' : ''} · ${formatSize(t.size)} · ${formatTime(t.uploadTime)}</div>
      </div>
      <button class="textbook-action" onclick="viewTextbook('${t.id}')">查看</button>
      <button class="textbook-action text-danger" onclick="deleteTextbook('${t.id}')">删除</button>
    </div>
  `;
  }).join('');
}

function deleteTextbook(id) {
  if (!confirm('确定删除该教材吗？删除后无法恢复。')) return;
  state.textbooks = state.textbooks.filter(t => t.id !== id);
  saveData(state);
  renderTextbooks();
  // 同时清理 IndexedDB 中的 PDF 数据
  deletePdfFromDB(id).catch(err => console.warn('清理 PDF 缓存失败:', err));
  // 清除 PDF.js 文档缓存
  if (_pdfDocCache[id]) {
    try { _pdfDocCache[id].destroy(); } catch(e) {}
    delete _pdfDocCache[id];
  }
  showToast('教材已删除');
}

// 弹窗中当前查看的教材
let _modalTextbook = null;

function viewTextbook(id) {
  const t = state.textbooks.find(x => x.id === id);
  if (!t) return;
  _modalTextbook = t;
  const units = t.units && t.units.length ? t.units : null;
  const sections = t.sections || [];
  const totalLessons = units ? units.reduce((s, u) => s + u.lessons.length, 0) : sections.length;
  let html = `<h3 style="margin-bottom:8px;">${t.name}</h3>
    <div style="color:var(--text-light);font-size:13px;margin-bottom:16px;">${t.subject || '未分类'} · ${units ? units.length + ' 个单元' : sections.length + ' 个章节'} · ${totalLessons} 篇课文 · ${formatSize(t.size)} · ${formatTime(t.uploadTime)}</div>`;
  
  if (units || sections.length > 0) {
    const bookUnits = units || [{ title: '教材内容', lessons: sections.map(s => ({ title: s.title, content: s.content, startPage: 1 })) }];
    window._renderedTextbook = window._renderedTextbook || {};
    window._renderedTextbook['m'] = t;
    html += renderBookReader(bookUnits, 'm', null);
  } else if (t.chapters && t.chapters.length) {
    html += '<div class="section-title">提取的章节（旧版数据，无正文）</div>';
    html += t.chapters.map((c, i) => `
      <div class="pdf-chapter-item">
        <span class="chap-num">${i+1}</span>
        <span>${c}</span>
      </div>
    `).join('');
  } else {
    html += '<p style="color:var(--text-light)">未提取到章节信息</p>';
  }
  document.getElementById('kpTitle').textContent = '教材详情';
  document.getElementById('kpBody').innerHTML = html;
  document.getElementById('btnMarkLearned').style.display = 'none';
  // 教材阅读器使用宽版弹窗，隐藏底部操作栏
  const modalContent = document.querySelector('#knowledgeModal .modal-content');
  if (modalContent) modalContent.classList.add('modal-wide');
  const modalFooter = document.querySelector('#knowledgeModal .modal-footer');
  if (modalFooter) modalFooter.style.display = 'none';
  document.getElementById('knowledgeModal').classList.add('show');
}

// PDF 处理
function handlePdfUpload(file) {
  if (!file) return;
  currentPdfData = { name: file.name, size: file.size, chapters: [], arrayBuffer: null, pageTexts: [] };

  document.getElementById('pdfStatus').textContent = '正在读取 PDF...';
  document.getElementById('pdfProgressFill').style.width = '10%';
  document.getElementById('pdfExtracted').hidden = true;
  document.getElementById('btnPdfSave').disabled = true;
  document.getElementById('pdfModal').classList.add('show');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const arrayBuffer = e.target.result;
      const data = new Uint8Array(arrayBuffer);
      currentPdfData.arrayBuffer = arrayBuffer;
      document.getElementById('pdfStatus').textContent = '正在解析 PDF...';
      document.getElementById('pdfProgressFill').style.width = '40%';

      const pdf = await pdfjsLib.getDocument({ data }).promise;
      document.getElementById('pdfStatus').textContent = `共 ${pdf.numPages} 页，正在提取文本...`;

      // 按页提取文本，按行组织（根据 y 坐标分行），同时记录每页在全文中的起始字符位置
      const pageTexts = [];
      let fullText = '';
      const pageStartOffsets = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // 按 y 坐标分行（误差 2px 内视为同一行）
        const lines = [];
        const yMap = {};
        for (const item of textContent.items) {
          const y = Math.round(item.transform[5]);
          let lineKey = y;
          // 查找相近的 y
          for (const key of Object.keys(yMap)) {
            if (Math.abs(parseInt(key) - y) <= 3) { lineKey = parseInt(key); break; }
          }
          if (!yMap[lineKey]) yMap[lineKey] = [];
          yMap[lineKey].push({ x: item.transform[4], str: item.str });
        }
        // 按 y 降序（从上到下），每行内按 x 升序
        const sortedYs = Object.keys(yMap).map(Number).sort((a, b) => b - a);
        for (const y of sortedYs) {
          const lineItems = yMap[y].sort((a, b) => a.x - b.x);
          const line = lineItems.map(it => it.str).join('').trim();
          if (line) lines.push(line);
        }
        const pageText = lines.join('\n');
        pageStartOffsets.push(fullText.length);
        pageTexts.push(pageText);
        fullText += pageText + '\n\n';
        document.getElementById('pdfProgressFill').style.width = (40 + (i / pdf.numPages) * 50) + '%';
      }

      // 提取章节标题、正文及单元结构
      const chapters = extractChapters(fullText);
      const sections = extractSections(fullText);
      const units = extractUnits(fullText);

      // 为每个课文计算起始页码（根据标题在全文中的位置反查）
      units.forEach(u => {
        u.lessons.forEach(l => {
          const idx = fullText.indexOf(l.title);
          if (idx >= 0) {
            let pageNum = 1;
            for (let p = pageStartOffsets.length - 1; p >= 0; p--) {
              if (idx >= pageStartOffsets[p]) { pageNum = p + 1; break; }
            }
            l.startPage = pageNum;
          } else {
            l.startPage = 1;
          }
        });
      });

      currentPdfData.chapters = chapters;
      currentPdfData.sections = sections;
      currentPdfData.units = units;
      currentPdfData.fullText = fullText;
      currentPdfData.pageTexts = pageTexts;

      const totalLessons = units.reduce((s, u) => s + u.lessons.length, 0);
      document.getElementById('pdfStatus').textContent = `提取完成！识别到 ${units.length} 个单元、${totalLessons} 篇课文`;
      document.getElementById('pdfProgressFill').style.width = '100%';

      if (chapters.length > 0) {
        document.getElementById('pdfExtracted').hidden = false;
        document.getElementById('pdfChapters').innerHTML = chapters.slice(0, 30).map((c, i) => `
          <div class="pdf-chapter-item">
            <span class="chap-num">${i+1}</span>
            <span>${c}</span>
          </div>
        `).join('');
      }
      document.getElementById('btnPdfSave').disabled = false;
    } catch (err) {
      console.error(err);
      document.getElementById('pdfStatus').textContent = '解析失败：该 PDF 可能是扫描版，需 OCR 识别';
      document.getElementById('pdfProgressFill').style.width = '100%';
    }
  };
  reader.readAsArrayBuffer(file);
}

// 从文本中提取章节标题
function extractChapters(text) {
  const patterns = [
    /第[一二三四五六七八九十百零\d]+章[^\n]*/g,
    /第[一二三四五六七八九十百零\d]+单元[^\n]*/g,
    /第[一二三四五六七八九十百零\d]+课[^\n]*/g,
    /第[一二三四五六七八九十百零\d]+节[^\n]*/g,
    /^[一二三四五六七八九十]+[、.．][^\n]*/gm,
    /^\d+[、.．][^\n]*/gm,
  ];
  const found = new Set();
  patterns.forEach(p => {
    const matches = text.match(p);
    if (matches) matches.forEach(m => {
      const clean = m.trim().substring(0, 60);
      if (clean.length > 3) found.add(clean);
    });
  });
  return Array.from(found).slice(0, 50);
}

// 从文本中提取章节及其正文内容
function extractSections(text) {
  // 匹配章节标题的正则（第X章/单元/课/节）
  const headingRegex = /第[一二三四五六七八九十百零\d]+(?:章|单元|课|节)[^\n]*/g;
  const matches = [];
  let m;
  while ((m = headingRegex.exec(text)) !== null) {
    const title = m[0].trim().substring(0, 60);
    if (title.length > 3) {
      matches.push({ index: m.index, title });
    }
  }
  // 按出现位置排序
  matches.sort((a, b) => a.index - b.index);
  // 去重（同一位置的标题只保留一个）
  const unique = [];
  const seenIdx = new Set();
  for (const h of matches) {
    if (!seenIdx.has(h.index)) {
      seenIdx.add(h.index);
      unique.push(h);
    }
  }
  // 提取每个章节的正文
  const sections = [];
  for (let i = 0; i < unique.length; i++) {
    const start = unique[i].index;
    const end = i + 1 < unique.length ? unique[i + 1].index : text.length;
    const content = text.substring(start, end).trim();
    if (content.length > 20) {
      sections.push({ title: unique[i].title, content });
    }
  }
  // 如果没有匹配到章节标题，尝试按"一、""1."等序号切分
  if (sections.length === 0) {
    const subRegex = /^[一二三四五六七八九十]+[、.．][^\n]*$/gm;
    const subMatches = [];
    let sm;
    while ((sm = subRegex.exec(text)) !== null) {
      const title = sm[0].trim().substring(0, 60);
      if (title.length > 2) {
        subMatches.push({ index: sm.index, title });
      }
    }
    subMatches.sort((a, b) => a.index - b.index);
    for (let i = 0; i < subMatches.length; i++) {
      const start = subMatches[i].index;
      const end = i + 1 < subMatches.length ? subMatches[i + 1].index : text.length;
      const content = text.substring(start, end).trim();
      if (content.length > 20) {
        sections.push({ title: subMatches[i].title, content });
      }
    }
  }
  return sections;
}

// 按"单元"组织教材内容，返回 [{title, lessons:[{title,content}]}]
function extractUnits(text) {
  // 1. 匹配单元级标题：第X单元/章/节
  const unitRegex = /第[一二三四五六七八九十百零\d]+(?:单元|章|节)[^\n]*/g;
  // 匹配课文标题：第X课，或行首的"数字 课文名"格式（如"1 春"、"3* 雨的四季"）
  const lessonRegex = /(?:^|\n)(?:第[一二三四五六七八九十百零\d]+课[^\n]*|\d+\*?\s+[\u4e00-\u9fa5][^\n]{1,40})/g;

  const headings = [];
  let um;
  while ((um = unitRegex.exec(text)) !== null) {
    const title = um[0].trim().substring(0, 60);
    if (title.length > 2) headings.push({ index: um.index, title, type: 'unit' });
  }
  let lm;
  while ((lm = lessonRegex.exec(text)) !== null) {
    let title = lm[0].trim().substring(0, 60);
    // 去掉开头的换行符
    title = title.replace(/^\n/, '').trim();
    // 过滤掉纯数字行（页码）和过短的标题
    if (title.length > 2 && !/^\d+$/.test(title)) {
      // 过滤掉明显是目录的行（包含多个页码和斜杠）
      if (!(/\/\s*\d+\s+\d+\//.test(title) || /\d+\s+\d+\s+\d+/.test(title))) {
        headings.push({ index: lm.index + (lm[0].startsWith('\n') ? 1 : 0), title, type: 'lesson' });
      }
    }
  }
  headings.sort((a, b) => a.index - b.index);

  // 去重（同一位置只保留一个，优先 unit）
  const unique = [];
  const seenIdx = new Set();
  for (const h of headings) {
    if (!seenIdx.has(h.index)) {
      seenIdx.add(h.index);
      unique.push(h);
    }
  }
  // 移除 index 非常接近的重复标题（相差 < 3 视为重复，保留先出现的）
  const filtered = [];
  for (const h of unique) {
    if (filtered.length === 0 || h.index - filtered[filtered.length-1].index >= 3) {
      filtered.push(h);
    }
  }

  // 2. 如果有单元级标题，按单元分组；否则全部归入一个默认单元
  const hasUnit = filtered.some(h => h.type === 'unit');
  const units = [];

  if (hasUnit) {
    let curUnit = null;
    for (let i = 0; i < filtered.length; i++) {
      const h = filtered[i];
      const nextIdx = i + 1 < filtered.length ? filtered[i + 1].index : text.length;
      const content = text.substring(h.index, nextIdx).trim();
      if (h.type === 'unit') {
        curUnit = { title: h.title, lessons: [] };
        units.push(curUnit);
      } else {
        if (!curUnit) { curUnit = { title: '教材内容', lessons: [] }; units.push(curUnit); }
        if (content.length > 5) curUnit.lessons.push({ title: h.title, content });
      }
    }
  } else {
    // 没有单元/章/节，全部课文归入"教材内容"
    const curUnit = { title: '教材内容', lessons: [] };
    for (let i = 0; i < filtered.length; i++) {
      const h = filtered[i];
      const nextIdx = i + 1 < filtered.length ? filtered[i + 1].index : text.length;
      const content = text.substring(h.index, nextIdx).trim();
      if (content.length > 5) curUnit.lessons.push({ title: h.title, content });
    }
    units.push(curUnit);
  }

  return units.filter(u => u.lessons.length > 0);
}

function closePdfModal() {
  document.getElementById('pdfModal').classList.remove('show');
  currentPdfData = null;
}

function saveTextbook() {
  if (!currentPdfData) return;
  // 尝试匹配学科
  const subject = guessSubject(currentPdfData.name);
  const tid = 't' + Date.now();
  const textbook = {
    id: tid,
    name: currentPdfData.name,
    subject: subject,
    size: currentPdfData.size,
    uploadTime: Date.now(),
    chapters: currentPdfData.chapters || [],
    sections: currentPdfData.sections || [],
    units: currentPdfData.units || [],
    hasPdf: !!currentPdfData.arrayBuffer,
  };
  // 如果没有提取到章节，则把全文作为一个章节保存
  if (textbook.sections.length === 0 && currentPdfData.fullText) {
    textbook.sections = [{ title: '教材全文', content: currentPdfData.fullText }];
  }
  if (textbook.units.length === 0 && currentPdfData.fullText) {
    textbook.units = [{ title: '教材内容', lessons: [{ title: '教材全文', content: currentPdfData.fullText, startPage: 1 }] }];
  }
  state.textbooks.unshift(textbook);
  saveData(state);
  renderTextbooks();
  showToast(`教材已保存${subject ? '（识别为：'+subject+'）' : ''}`);

  // 保存 PDF 原始文件到 IndexedDB（异步，不阻塞 UI）
  // 注意：必须先取出 arrayBuffer 再关闭弹窗，否则 closePdfModal 会清空 currentPdfData
  const pdfBuffer = currentPdfData.arrayBuffer;
  const pdfName = currentPdfData.name;
  if (pdfBuffer) {
    console.log('[教材保存] 正在保存 PDF 到 IndexedDB，大小:', pdfBuffer.byteLength, 'bytes');
    savePdfToDB(tid, pdfBuffer, pdfName).then(() => {
      console.log('[教材保存] PDF 已保存到 IndexedDB:', tid);
      closePdfModal(); // 保存完成后再关闭弹窗并清空数据
    }).catch(err => {
      console.error('[教材保存] PDF 保存失败:', err);
      alert('PDF 文件保存失败：' + err.message);
      closePdfModal(); // 即使失败也关闭弹窗
    });
  } else {
    console.warn('[教材保存] 没有 PDF arrayBuffer，hasPdf 将为 false');
    closePdfModal();
  }
}

function guessSubject(filename) {
  const map = {
    '语文': '语文', '数学': '数学', '英语': '英语', '历史': '历史',
    '地理': '地理', '物理': '物理', '化学': '化学', '道德': '道德与法治',
    '道法': '道德与法治', '政治': '道德与法治'
  };
  for (const key in map) {
    if (filename.includes(key)) return map[key];
  }
  return '';
}

// ============ 设置 ============
function renderSettings() {
  document.getElementById('settingNickname').value = state.nickname;
  document.getElementById('settingDailyGoal').value = state.dailyGoal;
}

function saveSettings() {
  state.nickname = document.getElementById('settingNickname').value.trim() || '安冉';
  state.dailyGoal = parseInt(document.getElementById('settingDailyGoal').value) || 3;
  saveData(state);
  renderAll();
  showToast('设置已保存');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `安冉学习助手数据_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

// ============ 导航 ============
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.page === page);
  });
  document.querySelector('.content').scrollTop = 0;
}

// ============ 工具函数 ============
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + 'KB';
  return (bytes/1024/1024).toFixed(1) + 'MB';
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============ 事件监听 ============
function setupEventListeners() {
  // 底部导航
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => navigate(tab.dataset.page));
  });

  // 打卡
  document.getElementById('btnDailyCheckin').addEventListener('click', dailyCheckin);

  // 日历导航
  document.getElementById('calPrev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  // 标记已学
  document.getElementById('btnMarkLearned').addEventListener('click', markLearned);

  // 学习页 tab 切换
  document.querySelectorAll('.learn-tab').forEach(tab => {
    tab.addEventListener('click', () => switchLearnSection(tab.dataset.section));
  });

  // 奖励标签切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
    });
  });

  // 心愿
  document.getElementById('btnAddWish').addEventListener('click', openWishModal);
  document.querySelectorAll('#emojiPicker span').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#emojiPicker span').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      selectedWishIcon = s.textContent;
    });
  });

  // PDF 上传
  const uploadZone = document.getElementById('uploadZone');
  const pdfInput = document.getElementById('pdfInput');
  uploadZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') pdfInput.click();
  });
  pdfInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handlePdfUpload(e.target.files[0]);
  });
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePdfUpload(file);
    else showToast('请上传 PDF 文件');
  });

  // 设置
  document.getElementById('settingNickname').addEventListener('change', saveSettings);
  document.getElementById('settingDailyGoal').addEventListener('change', saveSettings);
  document.getElementById('btnReset').addEventListener('click', () => {
    if (confirm('确定要重置所有数据吗？此操作不可恢复！')) {
      resetData();
      state = loadData();
      renderAll();
      showToast('数据已重置');
    }
  });
  document.getElementById('btnExport').addEventListener('click', exportData);

  // 点击模态框背景关闭
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('show');
    });
  });
}

// 启动
document.addEventListener('DOMContentLoaded', init);
