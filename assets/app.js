/* ============================================================
   值日日历 — 逻辑
   ------------------------------------------------------------
   轮值规则（用户给定）：
     11.1 林才煜 → 11.2 林润铮 → 11.3 路子通 →
     11.4 张嘉诺 → 11.5 董国民 → 11.6 马一辰，6 天一轮，循环。

   基准日（谁从哪天开始）：
     仓库根目录 base_date.txt，内容形如
         26.11.1              → 2026-11-01 由「林才煜」（名单第 1 位）值日
         26.11.1 张嘉诺        → 2026-11-01 由「张嘉诺」值日，其后照名单顺序
     放假没来得及上传 GitHub 时，可在页面里「紧急重设」，
     本机立即生效，同时给出要提交的 txt 文本 / 直接下载该文件。

   基准优先级：URL 参数 > 本机临时基准 > base_date.txt > 内置默认
   ============================================================ */
(function () {
  'use strict';

  /* ==================== 常量 ==================== */

  /* 名单顺序：改这里就能改轮值顺序（色相 h 只是配色） */
  const PEOPLE = [
    { name: '林才煜', h: 218 },
    { name: '林润铮', h: 152 },
    { name: '路子通', h: 40 },
    { name: '张嘉诺', h: 286 },
    { name: '董国民', h: 350 },
    { name: '马一辰', h: 190 }
  ];
  const CYCLE = PEOPLE.length;

  const BASE_FILE = 'base_date.txt';
  /* 读取时兼容几个同义文件名，正式名就是 base_date.txt */
  const BASE_FILE_CANDIDATES = ['base_date.txt', 'basedate.txt', 'base-date.txt'];
  const DEFAULT_BASE_TEXT = '26.11.1';
  const FALLBACK = { y: 2026, m: 10, d: 1, who: 0 };

  const KEY_BASE = 'dlj.base.v1';   /* 本机临时基准（紧急重设） */
  const KEY_UI = 'dlj.ui.v1';       /* 主题 / 标记「我」 */

  const MS_DAY = 86400000;
  const WEEK_SHORT = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const WEEK_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

  const SOURCE_LABEL = {
    url: 'URL 参数（临时）',
    local: '本机临时基准（还没上传仓库）',
    file: '仓库 base_date.txt',
    default: '内置默认值'
  };

  /* ==================== 小工具 ==================== */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function mod(n, m) { return ((n % m) + m) % m; }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* 以 UTC 天序号表示日期，避开夏令时 / 时区偏移 */
  function dayNum(y, m, d) { return Date.UTC(y, m, d) / MS_DAY; }
  function todayNum() {
    const t = new Date();
    return dayNum(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function partsOf(n) {
    const d = new Date(n * MS_DAY);
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth(),
      d: d.getUTCDate(),
      wd: (d.getUTCDay() + 6) % 7   /* 0 = 周一 */
    };
  }
  function isoOf(n) { const p = partsOf(n); return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`; }
  function mdOf(n) { const p = partsOf(n); return `${p.m + 1}.${p.d}`; }
  function mdShort(n) { const p = partsOf(n); return `${pad2(p.m + 1)}-${pad2(p.d)}`; }
  function cnOf(n) { const p = partsOf(n); return `${p.m + 1} 月 ${p.d} 日`; }
  function weekOf(n) { return WEEK_FULL[partsOf(n).wd]; }
  function weekShortOf(n) { return WEEK_SHORT[partsOf(n).wd]; }

  /* 人名：一个圆点 + 名字。颜色只做辅助，名字始终在（§5.7） */
  function whoHTML(p, cls) {
    return `<span class="who${cls ? ' ' + cls : ''}" style="--ph:${p.h}">` +
      `<i class="dot"></i><span>${p.name}</span></span>`;
  }

  /* 写入 base_date.txt 的规范文本：26.11.1 / 26.11.1 张嘉诺 */
  function baseText(base) {
    const t = `${String(base.y).slice(2)}.${base.m + 1}.${base.d}`;
    return base.who ? `${t} ${PEOPLE[base.who].name}` : t;
  }
  function baseTextFull(base) {
    return `${base.y}.${base.m + 1}.${base.d}`;
  }

  /* 解析 base_date.txt：容忍 26.11.1 / 2026.11.1 / 2026-11-01 / 26/11/1、BOM、注释行 */
  function parseBaseText(text) {
    if (!text) return null;
    const line = String(text)
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .find(s => s && !s.startsWith('#') && !s.startsWith('//'));
    if (!line) return null;

    const m = line.match(/(\d{2,4})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})/);
    if (!m) return null;

    let y = Number(m[1]);
    if (y < 100) y += 2000;
    const mo = Number(m[2]) - 1;
    const dd = Number(m[3]);
    if (mo < 0 || mo > 11 || dd < 1 || dd > 31) return null;

    const tail = line.slice(m.index + m[0].length);
    let who = PEOPLE.findIndex(p => tail.indexOf(p.name) >= 0);
    if (who < 0) who = 0;
    return { y, m: mo, d: dd, who: who };
  }

  /* ==================== 状态 ==================== */

  const state = {
    base: Object.assign({}, FALLBACK),
    source: 'default',
    fileName: BASE_FILE,  /* 实际读到的文件名 */
    fileText: '',      /* base_date.txt 原文 */
    fileBase: null,    /* 解析结果 */
    fileOk: false,     /* 是否成功读到文件 */
    override: null,    /* 本机临时基准 */
    urlBase: null
  };

  const ui = { view: 'calendar', y: 0, m: 0, theme: 'dark', me: -1 };
  let drawerDay = null;

  /* ---------------- 基准计算 ---------------- */

  function baseNum() { return dayNum(state.base.y, state.base.m, state.base.d); }
  function dutyOfDayNum(n) { return mod(state.base.who + (n - baseNum()), CYCLE); }
  function personOfDayNum(n) { return PEOPLE[dutyOfDayNum(n)]; }
  function cycleStartOf(n) { return n - mod(n - baseNum(), CYCLE); }

  function nextDutyFrom(startNum, idx) {
    for (let i = 0; i < CYCLE; i++) {
      if (dutyOfDayNum(startNum + i) === idx) return startNum + i;
    }
    return startNum;
  }

  function resolveBase() {
    if (state.urlBase) { state.base = state.urlBase; state.source = 'url'; return; }
    if (state.override) { state.base = state.override; state.source = 'local'; return; }
    if (state.fileBase) { state.base = state.fileBase; state.source = 'file'; return; }
    state.base = Object.assign({}, FALLBACK);
    state.source = 'default';
  }

  /* ---------------- 本机存储 ---------------- */

  function loadOverride() {
    try {
      const raw = localStorage.getItem(KEY_BASE);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.date) return null;
      const m = String(o.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      return { y: +m[1], m: +m[2] - 1, d: +m[3], who: mod(Number(o.who) || 0, CYCLE) };
    } catch (e) { return null; }
  }

  function saveOverride(base) {
    try {
      localStorage.setItem(KEY_BASE, JSON.stringify({
        date: isoOf(dayNum(base.y, base.m, base.d)),
        who: base.who
      }));
    } catch (e) { /* 隐私模式写不进去就只在本次会话生效 */ }
  }

  function dropOverride() {
    state.override = null;
    try { localStorage.removeItem(KEY_BASE); } catch (e) { /* 忽略 */ }
  }

  function loadUI() {
    try {
      const raw = localStorage.getItem(KEY_UI);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && (o.theme === 'dark' || o.theme === 'light')) ui.theme = o.theme;
      if (o && typeof o.me === 'number') ui.me = o.me;
    } catch (e) { /* 忽略 */ }
  }

  function saveUI() {
    try { localStorage.setItem(KEY_UI, JSON.stringify({ theme: ui.theme, me: ui.me })); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- URL 参数：?base=26.11.1&who=张嘉诺 ---------------- */

  function readUrl() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    const b = q.get('base');
    if (!b) return;
    const parsed = parseBaseText(b);
    if (!parsed) return;
    const who = q.get('who');
    if (who) {
      const idx = PEOPLE.findIndex(p => p.name === who);
      if (idx >= 0) parsed.who = idx;
    }
    state.urlBase = parsed;
  }

  /* ---------------- 读仓库文件 ---------------- */

  function loadBaseFile() {
    const tryOne = i => {
      if (i >= BASE_FILE_CANDIDATES.length) return Promise.reject(new Error('no file'));
      const name = BASE_FILE_CANDIDATES[i];
      return fetch(`${name}?t=${Date.now()}`, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text().then(text => ({ name: name, text: text }));
        })
        .catch(() => tryOne(i + 1));
    };

    return tryOne(0)
      .then(hit => {
        state.fileName = hit.name;
        state.fileText = String(hit.text).trim();
        state.fileBase = parseBaseText(hit.text);
        state.fileOk = !!state.fileBase;
      })
      .catch(() => {
        state.fileName = BASE_FILE;
        state.fileText = '';
        state.fileBase = null;
        state.fileOk = false;
      });
  }

  /* ==================== 渲染：通用 ==================== */

  function applyTheme() {
    /* 图标由 CSS 依 data-theme 切换，JS 不再改文本 */
    document.body.setAttribute('data-theme', ui.theme);
  }

  function renderHead() {
    const badge = $('#baseBadge');
    if (badge) {
      badge.textContent = `基准 ${mdOf(dayNum(state.base.y, state.base.m, state.base.d))}`;
      badge.setAttribute('data-source', state.source);
      badge.title = `基准日：${baseTextFull(state.base)}（${PEOPLE[state.base.who].name} 起）\n来源：${SOURCE_LABEL[state.source]}`;
    }
    const today = todayNum();
    const p = personOfDayNum(today);
    const sub = $('#brandSub');
    if (sub) sub.textContent = `六人轮值 · 6 天一轮 · 今天 ${p.name}`;
    document.title = `今天 ${p.name} 值日 · 值日日历`;
  }

  /* 读不到仓库文件、或正在用本机临时基准时，页面顶部给一条明确状态（§8.4 空/错状态） */
  function renderNotice() {
    const el = $('#stateNotice');
    if (!el) return;
    if (state.source === 'default') {
      el.innerHTML =
        `<div class="notice">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.6" r=".9"/></svg>
          <div>
            <p>没读到 <b>base_date.txt</b>，现在按内置默认值 <b>26.11.1</b> 计算。用本地服务或 GitHub Pages 打开会读取仓库文件。</p>
            <button type="button" class="notice-act" data-goto="settings">去设置看看</button>
          </div>
        </div>`;
      return;
    }
    if (state.source === 'local' || state.source === 'url') {
      el.innerHTML =
        `<div class="notice">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.6" r=".9"/></svg>
          <div>
            <p>正在用${state.source === 'url' ? '链接里的' : '本机临时'}基准 <b>${baseTextFull(state.base)}</b>（${PEOPLE[state.base.who].name} 起），还没同步到仓库。下载 <b>base_date.txt</b> 覆盖到仓库根目录即可让所有人看到。</p>
            <button type="button" class="notice-act" data-goto="settings">去设置看看</button>
          </div>
        </div>`;
      return;
    }
    el.innerHTML = '';
  }
  /* ==================== 渲染：月历 ==================== */

  function renderCalendar() {
    const y = ui.y, m = ui.m;
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((lead + daysInMonth) / 7);
    const start = dayNum(y, m, 1) - lead;
    const today = todayNum();

    const head = $('#calHead');
    head.innerHTML = WEEK_SHORT
      .map((w, i) => `<span class="${i >= 5 ? 'we' : ''}">${w}</span>`)
      .join('');

    const html = [];
    for (let i = 0; i < rows * 7; i++) {
      const n = start + i;
      const p = partsOf(n);
      const person = personOfDayNum(n);
      const cls = ['day'];
      if (p.m !== m) cls.push('other');
      
      if (n === today) cls.push('today');
      if (ui.me >= 0 && dutyOfDayNum(n) === ui.me) cls.push('mine');

      const isMe = ui.me >= 0 && dutyOfDayNum(n) === ui.me;

      html.push(
        `<button type="button" class="${cls.join(' ')}" data-day="${n}" style="--ph:${person.h}"` +
        (n === today ? ' aria-current="date"' : '') +
        ` aria-label="${p.m + 1} 月 ${p.d} 日 ${weekOf(n)}，${person.name}值日">` +
          `<span class="d-top"><span class="d-num">${p.d}</span>${n === today ? '<span class="d-today">今天</span>' : ''}</span>` +
          `<span class="d-name"><span class="d-full" aria-hidden="true">${person.name}</span><span class="d-mini" aria-hidden="true">${person.name.length > 2 ? person.name.slice(1) : person.name}</span>${isMe ? '<span class="d-me"> · 我</span>' : ''}</span>` +
        `</button>`
      );
    }
    const grid = $('#calGrid');
    grid.innerHTML = html.join('');

    $('#monthTitle').textContent = `${y} 年 ${m + 1} 月`;
    const end = dayNum(y, m, daysInMonth);
    $('#monthRange').textContent =
      `${mdShort(dayNum(y, m, 1))} – ${mdShort(end)} · ${daysInMonth} 天`;

    const legend = $('#calLegend');
    legend.innerHTML = PEOPLE.map(p => (
      `<span class="lg-item"><i class="lg-dot" style="--ph:${p.h}"></i>${p.name}</span>`
    )).join('') + '<span class="lg-hint">点任意一天看详情 / 可把该天设为新基准</span>';

    /* 月份下拉跟着当前月走 */
    const sel = $('#monthSelect');
    if (sel && sel.value !== `${y}-${m}`) sel.value = `${y}-${m}`;
  }

  /* ==================== 渲染：侧栏 ==================== */

  function renderToday() {
    const n = todayNum();
    const person = personOfDayNum(n);
    const nextIdx = mod(dutyOfDayNum(n) + 1, CYCLE);
    const cs = partsOf(cycleStartOf(n));
    const ce = partsOf(cycleStartOf(n) + CYCLE - 1);

    $('#todayBody').innerHTML =
      `<div class="duty-who" style="--ph:${person.h}">
        <i class="dot"></i>
        <span class="duty-name">${person.name}</span>
      </div>
      <p class="duty-meta">${cnOf(n)} · ${weekOf(n)}</p>
      <div class="kv">
        <div class="kv-row"><span>换人倒计时</span><span class="countdown" id="countdown">--:--:--</span></div>
        <div class="kv-row"><span>明天</span><span>${PEOPLE[nextIdx].name}</span></div>
        <div class="kv-row"><span>本轮</span><span>${cs.m + 1}.${cs.d} – ${ce.m + 1}.${ce.d}</span></div>
      </div>`;
  }

  function renderNext() {
    const n = todayNum();
    const items = [];
    for (let i = 1; i <= CYCLE; i++) {
      const d = n + i;
      const p = personOfDayNum(d);
      const isMe = ui.me >= 0 && dutyOfDayNum(d) === ui.me;
      items.push(
        `<div class="mini-row${i === 1 ? ' is-cur' : ''}" style="--ph:${p.h}">` +
          `<span class="mr-date">${mdShort(d)} ${weekShortOf(d)}</span>` +
          `<i class="mr-dot"></i>` +
          `<span class="mr-name">${p.name}${isMe ? ' · 我' : ''}</span>` +
          `<span class="mr-right">${i === 1 ? '明天' : i + ' 天后'}</span>` +
        `</div>`
      );
    }
    $('#nextBody').innerHTML = `<div class="mini-list" style="margin-top:0">${items.join('')}</div>`;
  }

  function renderSummary() {
    const y = ui.y, m = ui.m;
    const days = new Date(y, m + 1, 0).getDate();
    const counts = new Array(CYCLE).fill(0);
    for (let i = 0; i < days; i++) counts[dutyOfDayNum(dayNum(y, m, 1) + i)]++;
    const max = Math.max.apply(null, counts.concat([1]));

    const box = $('#summaryBody');
    if (!box) return;   /* 该卡片已从日历页移除，数据只在「统计」里出现 */
    box.innerHTML = `<div class="mini-bars">` + PEOPLE.map((p, i) => (
      `<div class="mb-row">
        <span class="mb-name">${p.name}</span>
        <span class="mb-track"><i class="mb-fill" style="--ph:${p.h};width:${(counts[i] / max) * 100}%"></i></span>
        <span class="mb-val">${counts[i]}</span>
      </div>`
    )).join('') + `</div>`;
  }

  /* ==================== 渲染：轮值表 ==================== */

  function renderAgenda() {
    const n = todayNum();
    const rows = [];
    for (let i = 0; i < 30; i++) {
      const d = n + i;
      const p = personOfDayNum(d);
      const isToday = i === 0;
      rows.push(
        `<div class="agenda-row${isToday ? ' is-today' : ''}">` +
          `<span class="ar-date">${isoOf(d)}${isToday ? ' · 今天' : ''}</span>` +
          `<span class="ar-week">${weekShortOf(d)}</span>` +
          `${whoHTML(p)}` +
          `<span class="ar-meta right">${isToday ? '今天' : i + ' 天后'}</span>` +
        `</div>`
      );
    }
    $('#agendaList').innerHTML = rows.join('');
  }

  /* ==================== 渲染：统计 ==================== */

  function renderStats() {
    const n = todayNum();
    const y = ui.y, m = ui.m;
    const days = new Date(y, m + 1, 0).getDate();
    const counts = new Array(CYCLE).fill(0);
    for (let i = 0; i < days; i++) counts[dutyOfDayNum(dayNum(y, m, 1) + i)]++;

    const ny = m === 11 ? y + 1 : y;
    const nm = (m + 1) % 12;
    const ndays = new Date(ny, nm + 1, 0).getDate();
    const nextCounts = new Array(CYCLE).fill(0);
    for (let i = 0; i < ndays; i++) nextCounts[dutyOfDayNum(dayNum(ny, nm, 1) + i)]++;

    const distinct = counts.filter(c => c > 0).length;
    const myNext = ui.me >= 0 ? nextDutyFrom(n, ui.me) : null;

    $('#statCards').innerHTML =
      card('轮值周期', `${CYCLE}`, '天 / 人', '六人按名单顺序循环，不跳人') +
      card(`${m + 1} 月参与人数`, `${distinct}`, '人', `${days} 天分摊到 ${distinct} 个人`) +
      card('今天值日', personOfDayNum(n).name, '', `${cnOf(n)} · ${weekOf(n)}`) +
      (myNext !== null
        ? card('我的下次值日', mdShort(myNext), '', myNext === n ? '就是今天' : `还有 ${myNext - n} 天`)
        : card('我的下次值日', '未标记', '', '在「设置」里标记自己'));

    const max = Math.max.apply(null, counts.concat(nextCounts).concat([1]));
    $('#chartPeople').innerHTML = PEOPLE.map((p, i) =>
      `<div class="mb-row">
        <span class="mb-name">${p.name}</span>
        <span class="mb-track"><i class="mb-fill" style="--ph:${p.h};width:${(counts[i] / max) * 100}%"></i></span>
        <span class="mb-val">${counts[i]} 天</span>
      </div>`
    ).join('');

    $('#chartHint').textContent =
      `${y} 年 ${m + 1} 月 · 共 ${days} 天，每人约 ${(days / CYCLE).toFixed(1)} 天；下月（${nm + 1} 月）见下方明细。`;

    const trs = PEOPLE.map((p, i) => {
      const d = nextDutyFrom(n, i);
      return `<tr class="${d === n ? 'is-today' : ''}">
        <td>${whoHTML(p)}</td>
        <td class="num">${counts[i]}</td>
        <td class="num">${nextCounts[i]}</td>
        <td>${isoOf(d)}</td>
        <td class="num">${d === n ? '今天' : (d - n) + ' 天'}</td>
      </tr>`;
    }).join('');

    $('#statsBody').innerHTML = trs;
  }

  function card(label, value, unit, sub) {
    return `<div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}${unit ? `<small>${unit}</small>` : ''}</div>
      <div class="stat-sub">${sub || ''}</div>
    </div>`;
  }

  /* ==================== 渲染：设置 ==================== */

  function renderSettings() {
    const b = state.base;
    const baseDay = dayNum(b.y, b.m, b.d);

    $('#setBaseDate').textContent = baseTextFull(b);
    $('#setBaseWho').textContent = PEOPLE[b.who].name;
    $('#setSource').textContent = SOURCE_LABEL[state.source];
    $('#setToday').textContent = `${personOfDayNum(todayNum()).name}（${cnOf(todayNum())}）`;

    let fileState;
    if (state.fileOk) {
      fileState = `已读取 ${state.fileName}：${baseTextFull(state.fileBase)} · ${PEOPLE[state.fileBase.who].name} 起`;
    } else if (!state.fileText && !state.fileBase) {
      fileState = '没读到 base_date.txt（直接双击打开 html 时读不到同目录 txt，见下方说明）';
    } else {
      fileState = '文件内容无法解析，已回退到内置默认值';
    }

    $('#setFileState').textContent = fileState;
    $('#fileBox').textContent = baseText(b);

    /* 名单 */
    const n = todayNum();
    $('#peopleList').innerHTML = PEOPLE.map((p, i) => {
      const d = nextDutyFrom(n, i);
      return `<div class="people-row">
        <span class="pr-no">${i + 1}</span>
        ${whoHTML(p)}
        <span class="pr-next">${d === n ? '今天值日' : `${mdShort(d)} · ${d - n} 天后`}</span>
      </div>`;
    }).join('');

    /* 标记我 */
    const meSel = $('#selectMe');
    if (meSel) meSel.value = String(ui.me);

    /* 撤销按钮状态 */
    const btnClear = $('#btnClearOverride');
    if (btnClear) {
      btnClear.disabled = !state.override;
    }

    /* 基准前后各 3 天，确认规律 */
    const around = [];
    for (let i = -3; i <= 8; i++) {
      const d = baseDay + i;
      const p = personOfDayNum(d);
      around.push(
        `<div class="mini-row${i === 0 ? ' is-cur' : ''}" style="--ph:${p.h}">` +
          `<span class="mr-date">${mdShort(d)} ${weekShortOf(d)}</span>` +
          `<i class="mr-dot"></i>` +
          `<span class="mr-name">${p.name}</span>` +
          `<span class="mr-right">${i === 0 ? '基准日' : (i > 0 ? '+' + i : i)}</span>` +
        `</div>`
      );
    }
    $('#baseAround').innerHTML = around.join('');
  }

  /* ==================== 全量渲染 ==================== */

  function renderAll() {
    renderHead();
    renderNotice();
    renderCalendar();
    renderToday();
    renderNext();
    renderSummary();
    renderAgenda();
    renderStats();
    renderSettings();
    tick();
  }

  /* ==================== 倒计时 ==================== */

  function msToMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return next - now;
  }

  function fmtCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
  }

  let lastToday = todayNum();

  function tick() {
    const el = $('#countdown');
    if (el) el.textContent = fmtCountdown(msToMidnight());
    const now = todayNum();
    if (now !== lastToday) {   /* 跨过 0 点：整页按新的一天重排 */
      lastToday = now;
      renderAll();
    }
  }

  /* ==================== 交互：抽屉 ==================== */

  function openDrawer(n) {
    drawerDay = n;
    const p = partsOf(n);
    const person = personOfDayNum(n);
    const delta = n - todayNum();
    const cs = cycleStartOf(n);

    $('#drawerTitle').textContent = `${p.y} 年 ${p.m + 1} 月 ${p.d} 日 · ${weekOf(n)}`;
    $('#drawerBody').innerHTML =
      `<div>
        <div class="duty-who" style="--ph:${person.h}">
          <i class="dot"></i>
          <span class="duty-name" style="font-size:24px">${person.name}</span>
        </div>
        <p class="duty-meta">${weekOf(n)} · ${isoOf(n)}</p>
      </div>
      <div class="detail-list">
        <div class="kv-row"><span>距今天</span><span>${delta === 0 ? '就是今天' : (delta > 0 ? `还有 ${delta} 天` : `${-delta} 天前`)}</span></div>
        <div class="kv-row"><span>距基准</span><span>${n - baseNum() === 0 ? '基准日' : (n - baseNum() > 0 ? '+' + (n - baseNum()) : n - baseNum()) + ' 天'}</span></div>
        <div class="kv-row"><span>本轮日期</span><span>${mdOf(cs)} – ${mdOf(cs + CYCLE - 1)}</span></div>
        <div class="kv-row"><span>下一位</span><span>${PEOPLE[mod(dutyOfDayNum(n) + 1, CYCLE)].name}</span></div>
      </div>
      <div>
        <p class="mini-title">前后 5 天</p>
        <div class="mini-list" style="margin-top:0">
          ${[-2, -1, 0, 1, 2].map(i => {
            const d = n + i;
            const pp = personOfDayNum(d);
            return `<div class="mini-row${i === 0 ? ' is-cur' : ''}" style="--ph:${pp.h}">
              <span class="mr-date">${mdShort(d)} ${weekShortOf(d)}</span>
              <i class="mr-dot"></i>
              <span class="mr-name">${pp.name}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    $('#drawer').hidden = false;
    $('#drawerMask').hidden = false;
  }

  function closeDrawer() {
    drawerDay = null;
    $('#drawer').hidden = true;
    $('#drawerMask').hidden = true;
  }

  /* ==================== 交互：紧急重设 ==================== */

  function whoOptions() {
    return PEOPLE.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  }

  function openReset(preDay) {
    const n = preDay == null ? todayNum() : preDay;
    const p = partsOf(n);
    $('#fBaseDate').value = `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`;
    /* 默认跟随现有轮值：这天本来是谁值日，就还是谁 */
    $('#fBaseWho').value = String(dutyOfDayNum(n));
    $('#formError').hidden = true;
    updateResetPreview();
    $('#modalMask').hidden = false;
    setTimeout(() => { const el = $('#fBaseDate'); if (el && el.focus) el.focus(); }, 30);
  }

  function closeReset() { $('#modalMask').hidden = true; }

  function readResetForm() {
    const v = $('#fBaseDate').value;
    const m = v && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3], who: Number($('#fBaseWho').value) || 0 };
  }

  function updateResetPreview() {
    const base = readResetForm();
    const box = $('#fPreview');
    if (!base) { box.textContent = '先选一个日期'; return; }
    const n = dayNum(base.y, base.m, base.d);
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const d = n + i;
      const idx = mod(base.who + i, CYCLE);
      rows.push(`<div class="pv-line"><span class="pv-date">${mdShort(d)} ${weekShortOf(d)}</span>` +
        `${whoHTML(PEOPLE[idx])}` +
        (i === 0 ? '<span class="muted">基准日</span>' : '') +
        `</div>`);
    }
    box.innerHTML = rows.join('') +
      `<div class="muted" style="margin-top:4px">之后每 ${CYCLE} 天回到 ${PEOPLE[base.who].name}</div>`;
  }

  function applyOverride(base, download) {
    state.override = { y: base.y, m: base.m, d: base.d, who: base.who };
    saveOverride(state.override);
    resolveBase();
    ui.y = base.y; ui.m = base.m;
    buildMonthSelect();
    renderAll();
    if (download) downloadBaseFile(state.base);
    toast(`基准已改为 ${mdOf(dayNum(base.y, base.m, base.d))} · ${PEOPLE[base.who].name} 起`, 'ok');
  }

  function downloadBaseFile(base) {
    const text = baseText(base) + '\n';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = BASE_FILE;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function copyText(text, okMsg) {
    const done = () => toast(okMsg || `已复制：${text}`, 'ok');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中文本', 'err'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  /* 复制一行「基准」文本，方便直接粘贴进 txt */
  function copyBaseText() {
    copyText(baseText(state.base), `已复制：${baseText(state.base)}`);
  }

  /* 复制一段 git 命令，方便把新基准推到仓库 */
  function copyGitCommand() {
    const b = state.base;
    const cmd =
      `echo ${baseText(b)} > base_date.txt\n` +
      `git add base_date.txt\n` +
      `git commit -m "chore(base): 基准日 ${mdOf(dayNum(b.y, b.m, b.d))} ${PEOPLE[b.who].name}"\n` +
      `git push`;
    copyText(cmd, '已复制 git 命令（4 行）');
  }

  /* ==================== Toast ==================== */

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast' + (kind ? ' ' + kind : ''); }, 2400);
  }

  /* ==================== 月份下拉 ==================== */

  function buildMonthSelect() {
    const sel = $('#monthSelect');
    if (!sel) return;
    const t = new Date();
    const items = [];
    for (let i = -12; i <= 12; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
      items.push({ y: d.getFullYear(), m: d.getMonth() });
    }
    const cur = ui.y * 12 + ui.m;
    if (!items.some(it => it.y * 12 + it.m === cur)) items.push({ y: ui.y, m: ui.m });
    items.sort((a, b) => (a.y * 12 + a.m) - (b.y * 12 + b.m));
    sel.innerHTML = items.map(it => `<option value="${it.y}-${it.m}">${it.y}-${pad2(it.m + 1)}</option>`).join('');
    sel.value = `${ui.y}-${ui.m}`;
  }

  function shiftMonth(delta) {
    const d = new Date(ui.y, ui.m + delta, 1);
    ui.y = d.getFullYear();
    ui.m = d.getMonth();
    buildMonthSelect();
    renderCalendar();
    renderSummary();
    renderStats();
  }

  function gotoToday() {
    const t = new Date();
    ui.y = t.getFullYear();
    ui.m = t.getMonth();
    buildMonthSelect();
    renderCalendar();
    renderSummary();
    renderStats();
  }

  /* ==================== 事件绑定 ==================== */

  function switchView(view) {
    ui.view = view;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindEvents() {
    $$('.tab').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('#btnTheme').addEventListener('click', () => {
      ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveUI();
    });

    $('#btnPrint').addEventListener('click', () => window.print());

    $('#btnPrevMonth').addEventListener('click', () => shiftMonth(-1));
    $('#btnNextMonth').addEventListener('click', () => shiftMonth(1));
    $('#btnToday').addEventListener('click', gotoToday);

    $('#monthSelect').addEventListener('change', e => {
      const parts = String(e.target.value).split('-');
      ui.y = Number(parts[0]);
      ui.m = Number(parts[1]);
      renderCalendar();
      renderSummary();
      renderStats();
    });

    $('#calGrid').addEventListener('click', e => {
      const btn = e.target.closest('.day');
      if (btn) openDrawer(Number(btn.dataset.day));
    });

    /* 抽屉 */
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerMask').addEventListener('click', closeDrawer);
    $('#drawerClose2').addEventListener('click', closeDrawer);
    $('#drawerSetBase').addEventListener('click', () => {
      if (drawerDay == null) return;
      const n = drawerDay;
      const p = partsOf(n);
      const who = dutyOfDayNum(n);
      closeDrawer();
      applyOverride({ y: p.y, m: p.m, d: p.d, who: who }, false);
      toast(`已把 ${isoOf(n)} 设为基准日 · ${PEOPLE[who].name} 起`, 'ok');
    });

    /* 紧急重设弹窗 */
    $('#btnQuickReset').addEventListener('click', () => openReset(todayNum()));
    $('#btnOpenReset2').addEventListener('click', () => openReset(todayNum()));
    $('#modalClose').addEventListener('click', closeReset);
    $('#modalCancel').addEventListener('click', closeReset);
    $('#modalMask').addEventListener('click', e => { if (e.target === $('#modalMask')) closeReset(); });
    $('#fBaseDate').addEventListener('change', () => {
      const base = readResetForm();
      if (base) $('#fBaseWho').value = String(dutyOfDayNum(dayNum(base.y, base.m, base.d)));
      updateResetPreview();
    });
    $('#fBaseWho').addEventListener('change', updateResetPreview);

    $('#btnApplyOnly').addEventListener('click', () => {
      const base = readResetForm();
      if (!base) { showFormError('请先选一个有效日期'); return; }
      applyOverride(base, false);
      closeReset();
    });

    $('#resetForm').addEventListener('submit', e => {
      e.preventDefault();
      const base = readResetForm();
      if (!base) { showFormError('请先选一个有效日期'); return; }
      applyOverride(base, true);
      closeReset();
    });

    /* 设置页动作 */
    $('#btnCopyBase').addEventListener('click', copyBaseText);
    $('#btnCopyGit').addEventListener('click', copyGitCommand);
    $('#btnDownloadBase').addEventListener('click', () => {
      downloadBaseFile(state.base);
      toast(`已下载 ${BASE_FILE}，覆盖到仓库根目录即可`, 'ok');
    });
    $('#btnReloadFile').addEventListener('click', () => {
      loadBaseFile().then(() => {
        resolveBase();
        renderAll();
        toast(state.fileOk ? '已重新读取 base_date.txt' : '没读到 base_date.txt（见下方说明）', state.fileOk ? 'ok' : 'err');
      });
    });
    $('#btnClearOverride').addEventListener('click', () => {
      if (!state.override) return;
      dropOverride();
      resolveBase();
      renderAll();
      toast('已撤销本机临时基准，回到 base_date.txt', 'ok');
    });

    $('#selectMe').addEventListener('change', e => {
      ui.me = Number(e.target.value);
      saveUI();
      renderCalendar();
      renderNext();
      renderStats();
      renderSettings();
    });

    /* 状态条里的跳转 */
    document.addEventListener('click', e => {
      const act = e.target.closest && e.target.closest('.notice-act');
      if (act) switchView(act.getAttribute('data-goto') || 'settings');
    });
    /* 键盘：← → 翻月，t 回到今天，Esc 关浮层 */
    document.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') { closeDrawer(); closeReset(); return; }
      if (ui.view !== 'calendar') return;
      if (e.key === 'ArrowLeft') { shiftMonth(-1); }
      else if (e.key === 'ArrowRight') { shiftMonth(1); }
      else if (e.key === 't' || e.key === 'T') { gotoToday(); }
    });
  }

  function showFormError(msg) {
    const el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  }

  /* ==================== 启动 ==================== */

  function boot() {
    loadUI();
    applyTheme();

    state.override = loadOverride();
    readUrl();
    resolveBase();

    const t = new Date();
    ui.y = t.getFullYear();
    ui.m = t.getMonth();

    $('#fBaseWho').innerHTML = whoOptions();
    $('#selectMe').innerHTML = '<option value="-1">不标记</option>' + whoOptions();

    buildMonthSelect();
    bindEvents();
    renderAll();
    buildMonthSelect();

    /* 仓库里的 base_date.txt 是权威来源之一，读到后重排 */
    loadBaseFile().then(() => {
      resolveBase();
      renderAll();
      buildMonthSelect();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  setInterval(tick, 1000);
})();











