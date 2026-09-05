/* ===== 安冉的学习助手 - 主逻辑 ===== */
let state = loadData();
let currentSubject = null;
let currentKnowledge = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let selectedWishIcon = '🎁';
let currentPdfData = null;

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

function renderLearnTextbook(subj, point) {
  // 查找该学科上传的教材
  const textbooks = state.textbooks.filter(t => t.subject === subj.name || t.subject === '');
  const container = document.getElementById('learnTextbook');
  
  if (textbooks.length === 0) {
    container.innerHTML = `
      <div class="learn-section-title">📖 教材内容</div>
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>尚未上传 ${subj.name} 教材</p>
        <p style="font-size:13px;margin-top:8px;">前往"教材"页面上传人教版${subj.name}教材 PDF，系统将自动提取相关章节内容</p>
      </div>
    `;
    return;
  }

  let html = `<div class="learn-section-title">📖 教材内容（关联 ${subj.name} 教材）</div>`;
  textbooks.forEach(t => {
    const chapters = t.chapters || [];
    html += `
      <div class="textbook-ref">
        <div class="textbook-ref-name">📄 ${t.name}</div>
        <div class="textbook-ref-meta">上传于 ${formatTime(t.uploadTime)} · ${chapters.length}个章节</div>
        ${chapters.length ? '<div class="chapters-mini">' + chapters.slice(0, 15).map((c, i) => `<span class="chapter-chip">${i+1}. ${c}</span>`).join('') + '</div>' : '<p style="color:var(--text-light);font-size:13px;">未提取到章节</p>'}
        <button class="btn-secondary" style="margin-top:10px;" onclick="viewTextbook('${t.id}')">查看完整教材内容</button>
      </div>
    `;
  });
  container.innerHTML = html;
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
  list.innerHTML = state.textbooks.map(t => `
    <div class="textbook-item">
      <div class="textbook-icon">📄</div>
      <div class="textbook-info">
        <div class="textbook-name">${t.name}</div>
        <div class="textbook-meta">${t.subject || '未分类'} · ${t.chapters ? t.chapters.length : 0}个章节 · ${formatSize(t.size)} · ${formatTime(t.uploadTime)}</div>
      </div>
      <button class="textbook-action" onclick="viewTextbook('${t.id}')">查看</button>
    </div>
  `).join('');
}

function viewTextbook(id) {
  const t = state.textbooks.find(x => x.id === id);
  if (!t) return;
  let html = `<h3 style="margin-bottom:12px;">${t.name}</h3>`;
  if (t.chapters && t.chapters.length) {
    html += '<div class="section-title">提取的章节</div>';
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
  document.getElementById('knowledgeModal').classList.add('show');
}

// PDF 处理
function handlePdfUpload(file) {
  if (!file) return;
  currentPdfData = { name: file.name, size: file.size, chapters: [] };

  document.getElementById('pdfStatus').textContent = '正在读取 PDF...';
  document.getElementById('pdfProgressFill').style.width = '10%';
  document.getElementById('pdfExtracted').hidden = true;
  document.getElementById('btnPdfSave').disabled = true;
  document.getElementById('pdfModal').classList.add('show');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      document.getElementById('pdfStatus').textContent = '正在解析 PDF...';
      document.getElementById('pdfProgressFill').style.width = '40%';

      const pdf = await pdfjsLib.getDocument({ data }).promise;
      document.getElementById('pdfStatus').textContent = `共 ${pdf.numPages} 页，正在提取文本...`;

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(it => it.str).join(' ');
        fullText += text + '\n';
        document.getElementById('pdfProgressFill').style.width = (40 + (i / pdf.numPages) * 50) + '%';
      }

      // 提取章节标题（匹配"第X章/第X单元/第X课"等模式）
      const chapters = extractChapters(fullText);
      currentPdfData.chapters = chapters;

      document.getElementById('pdfStatus').textContent = `提取完成！识别到 ${chapters.length} 个章节`;
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

function closePdfModal() {
  document.getElementById('pdfModal').classList.remove('show');
  currentPdfData = null;
}

function saveTextbook() {
  if (!currentPdfData) return;
  // 尝试匹配学科
  const subject = guessSubject(currentPdfData.name);
  state.textbooks.unshift({
    id: 't' + Date.now(),
    name: currentPdfData.name,
    subject: subject,
    size: currentPdfData.size,
    uploadTime: Date.now(),
    chapters: currentPdfData.chapters
  });
  saveData(state);
  renderTextbooks();
  closePdfModal();
  showToast(`教材已保存${subject ? '（识别为：'+subject+'）' : ''}`);
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
