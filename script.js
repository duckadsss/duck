// ── Tasks data ────────────────────────────────────────────────
const TASKS = {
  referrals: [
    { id:'ref_10',  key:'task_invite_10',  target:10,  reward:0.1,  type:'ref' },
    { id:'ref_20',  key:'task_invite_20',  target:20,  reward:0.5,  type:'ref' },
    { id:'ref_50',  key:'task_invite_50',  target:50,  reward:1.0,  type:'ref' },
    { id:'ref_100', key:'task_invite_100', target:100, reward:5.0,  type:'ref' },
  ],
  bots: [
    { id:'bot_any', key:'task_activate_bot', target:1,  reward:1.0,  type:'bot' },
  ],
  earn: [
    { id:'earn_10', key:'task_earn_10', target:10,  reward:1.0,  type:'earn' },
    { id:'earn_50', key:'task_earn_50', target:50,  reward:5.0,  type:'earn' },
  ],
};

// Claimed tasks in localStorage
function getClaimedTasks(){ try{ return JSON.parse(localStorage.getItem('claimedTasks')||'[]'); }catch(e){return[];} }
function claimTask(task) {
  const claimed = getClaimedTasks();
  if (claimed.includes(task.id)) return;
  claimed.push(task.id);
  localStorage.setItem('claimedTasks', JSON.stringify(claimed));
  balance += task.reward;
  updateBal();
  renderTasks();
  showToast(i18n.t('toast_task_claimed') + ' +' + task.reward + ' TON');
}

function getTaskProgress(task) {
  if (task.type === 'ref') return { current: (window._refCount || 0), total: task.target };
  if (task.type === 'bot') return { current: activeBots.length > 0 || window._everLaunched ? 1 : 0, total: 1 };
  if (task.type === 'earn') return { current: monthly || 0, total: task.target };
  return { current: 0, total: task.target };
}

function renderTasks() {
  const claimed = getClaimedTasks();
  function renderGroup(tasks, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = tasks.map(task => {
      const prog = getTaskProgress(task);
      const isDone = prog.current >= prog.total;
      const isClaimed = claimed.includes(task.id);
      const iconColor = isClaimed ? '#39D98A' : isDone ? '#5B5FEE' : '#50537A';
      const iconBg = isClaimed ? 'rgba(57,217,138,.1)' : isDone ? 'var(--accent-dim)' : 'var(--card2)';
      let btnHtml = '';
      if (isClaimed) {
        btnHtml = `<button class="task-btn done-lbl" disabled>${i18n.t('task_done')}</button>`;
      } else if (isDone) {
        btnHtml = `<button class="task-btn claim" onclick="claimTask(${JSON.stringify(task).replace(/"/g,"'")})">${i18n.t('task_claim')}</button>`;
      } else {
        btnHtml = `<button class="task-btn locked-lbl" disabled>${Math.min(prog.current,prog.total)}/${prog.total}</button>`;
      }
      return `<div class="task-card ${isClaimed?'done':''} ${!isDone&&!isClaimed?'':''}">
        <div class="task-icon" style="background:${iconBg}">
          <svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            ${isClaimed?'<polyline points="20 6 9 17 4 12"/>':'<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>'}
          </svg>
        </div>
        <div class="task-body">
          <div class="task-name">${i18n.t(task.key)}</div>
          <div class="task-reward">${i18n.t('task_reward')} ${task.reward} TON</div>
          ${!isClaimed?`<div class="task-prog">${i18n.t('task_progress')} ${Math.min(prog.current,prog.total)}/${prog.total}</div>`:''}
        </div>
        ${btnHtml}
      </div>`;
    }).join('');
  }
  renderGroup(TASKS.referrals, 'tasksRefList');
  renderGroup(TASKS.bots,     'tasksBotsSection');
  renderGroup(TASKS.earn,     'tasksEarnSection');
}


// ═══════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════

const API = 'https://tr-production-d035.up.railway.app';

function getAuthHeader() {
  const initData = window.Telegram?.WebApp?.initData || '';
  if (initData.length > 0) return 'tma ' + initData;
  return 'dev 123456';
}

async function apiGet(path) {
  const r = await fetch(API + path, {
    headers: { 'Authorization': getAuthHeader(), 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error((await r.json()).error || r.statusText);
  return r.json();
}

async function apiPost(path, body = {}) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Authorization': getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(()=>({error:r.statusText}))).error || r.statusText);
  return r.json();
}

// ═══════════════════════════════════════════════════════════════
// STATE  (populated from server)
// ═══════════════════════════════════════════════════════════════

let balance  = 0;
let activeBots = [];
let sel      = null;
let monthly  = 0;
let _pollInterval = null;

// Исправленная функция TON - защита от NaN
const TON = n => {
  const num = Number(n);
  if (isNaN(num)) return '0.00 TON';
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,' ') + ' TON';
};

// ═══════════════════════════════════════════════════════════════
// BOOT — load everything from server on open
// ═══════════════════════════════════════════════════════════════

async function bootApp() {
  try {
    console.log('[boot] auth header:', getAuthHeader().slice(0, 30) + '...');
    const data = await apiGet('/api/me');
    console.log('[boot] got user:', data.user?.firstName, 'balance:', data.user?.balance);

    // User - с защитой от NaN
    const u = data.user;
    balance = isNaN(u.balance) ? 0 : u.balance;
    monthly = isNaN(u.totalEarned) ? 0 : u.totalEarned;
    window._userName  = u.firstName || i18n.t('trader_default'); 
    window._refCount = u.referralCount || 0;
    window._userInit  = (u.firstName || 'T')[0].toUpperCase();

    window._telegramId = u.telegramId;
window._refLink    = u.referralLink || `https://t.me/Tradeetonbot?start=${u.referralCode}`;

    const avatarEl = document.getElementById('avatarEl');
    if (avatarEl) avatarEl.textContent = window._userInit;
    const rAva = document.getElementById('rankAva');
    if (rAva) rAva.textContent = window._userInit;
    const rName = document.getElementById('rankName');
    if (rName) rName.textContent = window._userName;

    // Ref page
    const refCountEl = document.getElementById('refCount');
    if (refCountEl) {
      const count = u.referralCount || 0;
      const referralsText = i18n.t('ref_referrals');
      refCountEl.innerHTML = `${count} <span style="font-size:15px;color:var(--text2)">${referralsText}</span>`;
    }
    const refLinkEl = document.getElementById('refLink');
    if (refLinkEl) refLinkEl.textContent = window._refLink;

    // Load referrals from server
    loadReferrals();

    // Bots
    activeBots = data.bots || [];
    render();

    // Transactions
    if (data.transactions?.length) window._lastTxs=data.transactions; renderTxList(data.transactions);

    // Balance
    updateBal();

    // Start polling active bots every 30s
    startPolling();

    // Load leaderboard
    loadLeaderboard();

  } catch (e) {
    console.error('[boot]', e.message);
    showToast(i18n.t('toast_load_error')+' '+e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// POLLING — refresh bot state every 30s (server ticks hourly)
// ═══════════════════════════════════════════════════════════════

function startPolling() {
  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(async () => {
    if (!activeBots.length) return;
    try {
      const updated = await Promise.all(
        activeBots.map(b => apiGet('/api/bots/' + b.id).then(r => r.bot).catch(() => b))
      );
      activeBots = updated;
      render();
      updateBal();
    } catch (e) {
      console.warn('[poll]', e.message);
    }
  }, 30000);
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD from server
// ═══════════════════════════════════════════════════════════════

async function loadLeaderboard() {
  try {
    const data = await apiGet('/api/leaderboard');

    const myRankEl = document.querySelector('.mr-pos');
    if (myRankEl) myRankEl.textContent = '#' + data.myRank;
    const myEarnEl = document.getElementById('rankEarn');
    if (myEarnEl) myEarnEl.textContent = '+' + data.myEarned.toFixed(4) + ' TON';

    if (data.leaders.length >= 1) {
      const p1Ava = document.querySelector('.p1 .podium-ava');
      const p1Name = document.querySelector('.p1 .podium-name');
      const p1Earn = document.querySelector('.p1 .podium-earn');
      if (p1Ava) p1Ava.textContent = data.leaders[0].initial;
      if (p1Name) p1Name.textContent = data.leaders[0].firstName;
      if (p1Earn) p1Earn.textContent = '+' + data.leaders[0].totalEarned.toFixed(4) + ' TON';
    }
    if (data.leaders.length >= 2) {
      const p2Ava = document.querySelector('.p2 .podium-ava');
      const p2Name = document.querySelector('.p2 .podium-name');
      const p2Earn = document.querySelector('.p2 .podium-earn');
      if (p2Ava) p2Ava.textContent = data.leaders[1].initial;
      if (p2Name) p2Name.textContent = data.leaders[1].firstName;
      if (p2Earn) p2Earn.textContent = '+' + data.leaders[1].totalEarned.toFixed(4) + ' TON';
    }
    if (data.leaders.length >= 3) {
      const p3Ava = document.querySelector('.p3 .podium-ava');
      const p3Name = document.querySelector('.p3 .podium-name');
      const p3Earn = document.querySelector('.p3 .podium-earn');
      if (p3Ava) p3Ava.textContent = data.leaders[2].initial;
      if (p3Name) p3Name.textContent = data.leaders[2].firstName;
      if (p3Earn) p3Earn.textContent = '+' + data.leaders[2].totalEarned.toFixed(4) + ' TON';
    }

    const el = document.getElementById('ratingList');
    if (el && data.leaders.length > 3) {
      el.innerHTML = data.leaders.slice(3).map(u => `
        <div class="rank-item">
          <div class="rank-num">${u.rank}</div>
          <div class="rank-ava" style="background:linear-gradient(135deg,#5B5FEE,#A78BFA)">${u.initial}</div>
          <div class="rank-info">
            <div class="rank-name">${u.firstName}</div>
            <div class="rank-detail">TradeBot</div>
          </div>
          <div class="rank-earn">+${u.totalEarned.toFixed(4)} TON</div>
        </div>`).join('');
    }
  } catch (e) {
    console.warn('[leaderboard]', e.message);
    renderRating();
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER TX LIST
// ═══════════════════════════════════════════════════════════════

function renderTxList(txs) {
  const list = document.getElementById('txList');
  if (!list) return;

  const TYPE_ICON = {
    deposit:   { bg:'rgba(57,217,138,.1)',  stroke:'#39D98A', path:'<path d="M12 2v20M2 12l10 10 10-10"/>' },
    bot_claim: { bg:'rgba(91,95,238,.1)',   stroke:'#7B7FF8', path:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
    referral:  { bg:'rgba(91,95,238,.1)',   stroke:'#7B7FF8', path:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
    withdraw:  { bg:'rgba(246,70,93,.1)',   stroke:'#F6465D', path:'<path d="M12 22V2M2 12l10-10 10 10"/>' },
    bot_start: { bg:'rgba(246,70,93,.1)',   stroke:'#F6465D', path:'<path d="M12 22V2M2 12l10-10 10 10"/>' },
  };

  const TYPE_NAME = {
    deposit:   i18n.t('tx_deposit'),
    bot_claim: i18n.t('tx_bot_claim'),
    referral: i18n.t('tx_referral'),
    withdraw:  i18n.t('tx_withdraw'),
    bot_start: i18n.t('tx_bot_start'),
  };

  if (!txs || !txs.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">' + i18n.t('wallet_no_tx') + '</div>';
    return;
  }

  const STATUS_BADGE = {
    pending:  { label: i18n.t('tx_pending')  || 'В обработке', color:'#F6A600', bg:'rgba(246,166,0,.12)' },
    done:     { label: i18n.t('tx_done')     || 'Выполнено',   color:'#39D98A', bg:'rgba(57,217,138,.12)' },
    rejected: { label: i18n.t('tx_rejected') || 'Отклонено',   color:'#F6465D', bg:'rgba(246,70,93,.12)' },
  };

  const items = txs.slice(0, 20).map(tx => {
    const ic   = TYPE_ICON[tx.type] || TYPE_ICON.deposit;
    const name = TYPE_NAME[tx.type] || tx.type;
    const isIn = tx.amount > 0;
    const dateStr = i18n.formatDate(tx.createdAt, i18n.getLang());
    const timeStr = i18n.formatTime(tx.createdAt);
    const st = tx.status && tx.status !== 'done' ? STATUS_BADGE[tx.status] : null;
    const statusHtml = st
      ? `<span class="tx-status-badge" style="background:${st.bg};color:${st.color}">${st.label}</span>`
      : '';
    return `<div class="tx-item">
      <div class="tx-ico" style="background:${ic.bg}">
        <svg viewBox="0 0 24 24" fill="none" stroke="${ic.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.path}</svg>
      </div>
      <div class="tx-info">
        <div class="tx-name">${name} ${statusHtml}</div>
        <div class="tx-time">${dateStr}, ${timeStr}</div>
      </div>
      <div class="tx-amt ${isIn?'tx-in':'tx-out'}" style="${tx.status==='pending'?'opacity:.55':''}">${isIn?'+':''}${TON(Math.abs(tx.amount))}</div>
    </div>`;
  }).join('');

  list.innerHTML = items;
}

// ═══════════════════════════════════════════════════════════════
// YIELD BADGE (local preview before server confirms)
// ═══════════════════════════════════════════════════════════════

const YIELD_RANGE = { basic:[3.5,5.5], pro:[4.5,7.5], elite:[6.0,10.0] };
function rollPct(tier){ const [lo,hi]=YIELD_RANGE[tier]; return lo+Math.random()*(hi-lo); }

function updateYieldBadge(tier){
  const dw = document.querySelector('#bot-'+tier+' .bot-dur');
  const sd = dw?.querySelector('.dur-btn.sel');
  const days = parseInt(sd?.dataset.days || '7');
  const [lo, hi] = YIELD_RANGE[tier];
  const f = days / 7;
  const yEl = document.getElementById('yld-'+tier);
  const lEl = document.getElementById('ylbl-'+tier);
  if(yEl) yEl.textContent = `+${(lo*f).toFixed(1)}–${(hi*f).toFixed(1)}%`;
  if(lEl) lEl.textContent = i18n.t('per_days') + ' ' + days + ' ' + i18n.t('days_short');
}

// ═══════════════════════════════════════════════════════════════
// UPDATE DURATION BUTTONS TEXT (7/14/30 дней)
// ═══════════════════════════════════════════════════════════════

function updateDurationButtonsText() {
  const tiers = ['basic', 'pro', 'elite'];
  tiers.forEach(tier => {
    const durWrap = document.querySelector(`#bot-${tier} .bot-dur`);
    if (!durWrap) return;
    const btns = durWrap.querySelectorAll('.dur-btn');
    btns.forEach(btn => {
      const days = btn.dataset.days;
      if (days === '7') {
        btn.childNodes[0].textContent = i18n.t('days_7');
      } else if (days === '14') {
        btn.childNodes[0].textContent = i18n.t('days_14');
      } else if (days === '30') {
        btn.childNodes[0].textContent = i18n.t('days_30');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// UPDATE LAUNCH BUTTONS TEXT
// ═══════════════════════════════════════════════════════════════

function updateLaunchButtonsText() {
  const tiers = ['basic', 'pro', 'elite'];
  tiers.forEach(tier => {
    const durWrap = document.querySelector(`#bot-${tier} .bot-dur`);
    const selected = durWrap?.querySelector('.dur-btn.sel');
    const btnSpan = document.querySelector(`#bot-${tier} .buy-btn span`);
    if (btnSpan && selected) {
      const price = selected.dataset.price;
      btnSpan.innerHTML = i18n.t('launch') + ` — ${price} TON`;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════════════

function switchPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  document.getElementById('nav-'+id).classList.add('active');
  if(id==='tasks') renderTasks();
}

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2800);
}
function copyRef(){
  navigator.clipboard?.writeText(window._refLink || '').catch(()=>{});
  showToast(i18n.t('toast_link_copied'));
}

// ═══════════════════════════════════════════════════════════════
// PAIR / DURATION CHIPS
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll('.bot-pairs').forEach(w=>{
  w.addEventListener('click',e=>{
    const c=e.target.closest('.pair-chip'); if(!c)return;
    w.querySelectorAll('.pair-chip').forEach(x=>x.classList.remove('sel'));
    c.classList.add('sel');
  });
});

document.querySelectorAll('.bot-dur').forEach(w=>{
  w.addEventListener('click',e=>{
    const b=e.target.closest('.dur-btn'); if(!b)return;
    w.querySelectorAll('.dur-btn').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    const id=w.dataset.bot;
    const btnSpan = document.querySelector('#bot-'+id+' .buy-btn span');
    if(btnSpan) btnSpan.innerHTML = i18n.t('launch') + ' — ' + b.dataset.price + ' TON';
    updateYieldBadge(id);
  });
});

['basic','pro','elite'].forEach(updateYieldBadge);

// ═══════════════════════════════════════════════════════════════
// BOT MODAL
// ═══════════════════════════════════════════════════════════════

function openModal(name,tier){
  const pw=document.querySelector('#bot-'+tier+' .bot-pairs');
  const pair=pw?.querySelector('.pair-chip.sel')?.textContent||'EUR/USD';
  const dw=document.querySelector('#bot-'+tier+' .bot-dur');
  const sd=dw?.querySelector('.dur-btn.sel');
  const days=parseInt(sd?.dataset.days||'7');
  const price=parseFloat(sd?.dataset.price||'29');
  const [lo,hi]=YIELD_RANGE[tier];
  const f=days/7;
  sel={name,tier,pair,days,price,f,lo,hi};

  document.getElementById('mTitle').textContent=i18n.t('modal_launch_title')+' '+name;
  document.getElementById('mName').textContent=name;
  document.getElementById('mPair').textContent=pair;
  document.getElementById('mDays').textContent=days+' '+i18n.t('days_short');
  document.getElementById('mYield').textContent=`+${(lo*f).toFixed(1)}–${(hi*f).toFixed(1)}% (+${(price*lo*f/100).toFixed(2)}...${(price*hi*f/100).toFixed(2)} TON)`;
  document.getElementById('mPrice').textContent=price+' TON';
  document.getElementById('mAfter').textContent=TON(balance-price);
  document.getElementById('botModal').classList.add('open');
}
function closeModal(){ document.getElementById('botModal').classList.remove('open'); }
document.getElementById('botModal').addEventListener('click',e=>{
  if(e.target===document.getElementById('botModal')) closeModal();
});

// ═══════════════════════════════════════════════════════════════
// BUY BOT → server
// ═══════════════════════════════════════════════════════════════

async function buyBot(){
  if(!sel) return;
  const {name, tier, pair, days, price} = sel;
  if(balance < price){ showToast(i18n.t('toast_insufficient')); return; }

  try {
    const data = await apiPost('/api/bots/start', { tier, pair, days });
    balance = data.balance;
    activeBots.push(data.bot);
    updateBal();
    render();
    closeModal();
    showToast(name + ' ' + i18n.t('toast_bot_started')); 
    window._everLaunched=true;
    startPolling();
  } catch(e) {
    showToast(e.message||i18n.t('toast_error_launch'));
  }
}

// ═══════════════════════════════════════════════════════════════
// CLAIM → server
// ═══════════════════════════════════════════════════════════════

async function claimBot(id){
  try {
    const data = await apiPost('/api/bots/' + id + '/claim');
    balance = data.balance;
    monthly += data.payout;
    activeBots = activeBots.filter(b => b.id !== id);
    updateBal();
    render();
    showToast(TON(data.payout)+' '+i18n.t('toast_claimed'));
    apiGet('/api/transactions').then(d => renderTxList(d.transactions)).catch(()=>{});
  } catch(e) {
    showToast(e.message||i18n.t('toast_error'));
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER ACTIVE BOTS
// ═══════════════════════════════════════════════════════════════

function render(){
  const sec  = document.getElementById('activeSection');
  const list = document.getElementById('activeBotsList');
  if(!activeBots.length){ sec.style.display='none'; return; }
  sec.style.display='block';

  list.innerHTML = activeBots.map(bot => {
    const earned    = (bot.earned >= 0 ? '+' : '') + Number(bot.earned).toFixed(4) + ' TON';
    const earnColor = bot.earned >= 0 ? 'var(--green)' : 'var(--red)';
    const endDate   = new Date(bot.endsAt).toLocaleDateString('ru',{day:'numeric',month:'long'});

    // 🔄 ПЕРЕВОРАЧИВАЕМ СДЕЛКИ: последние (новые) сверху, старые снизу
    const tradesReversed = [...(bot.trades || [])].reverse();
    
    const rows = tradesReversed.map(t => {
      if(t.type === 'open') return `<div class="trade-row">
        <span class="tr-badge tr-buy">BUY</span>
        <span class="tr-instr">${t.pair}</span>
        <span class="tr-detail">${i18n.t('position_open')}</span>
        <span class="tr-pnl open">${i18n.t('in_progress')}</span>
        <span class="tr-t">${new Date(t.openedAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</span>
      </div>`;
      if(t.pnl === 0 || t.pnl == null) return '';
      const loss = t.pnl < 0;
      return `<div class="trade-row">
        <span class="tr-badge ${loss?'tr-sell-loss':'tr-sell'}">${loss?'SELL↓':'SELL'}</span>
        <span class="tr-instr">${t.pair}</span>
        <span class="tr-detail">${loss ? i18n.t('position_reentry') : i18n.t('position_close_plus')}</span>
        <span class="tr-pnl ${loss?'minus':'plus'}">${loss?'':'+'}${Math.abs(t.pnl).toFixed(6)} TON</span>
        <span class="tr-t">${t.closedAt ? new Date(t.closedAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
      </div>`;
    }).join('');

    if(bot.done && !bot.claimed) {
      const fin = Math.max(bot.earned, 0);
      return `<div class="active-bot" style="border-color:rgba(57,217,138,.4)">
        <div class="ab-top">
          <div style="width:7px;height:7px;border-radius:50%;background:#A78BFA;flex-shrink:0"></div>
          <div class="ab-name">${bot.name}</div>
          <div class="ab-tag">${bot.pair}</div>
          <div style="margin-left:auto;text-align:right">
            <div class="ab-profit" style="color:var(--green)">+${fin.toFixed(4)} TON</div>
            <div class="ab-days">${i18n.t('completed')}</div>
          </div>
        </div>
        <div style="height:3px;background:linear-gradient(90deg,#5B5FEE,#39D98A);border-radius:2px;margin-bottom:10px"></div>
        <div style="text-align:center;padding:4px 0 2px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${i18n.t('deposit_label')} ${bot.price} TON + ${i18n.t('income_label')} ${fin.toFixed(4)} TON</div>
          <button onclick="claimBot('${bot.id}')" style="background:linear-gradient(135deg,#28C76F,#39D98A);color:#052010;border:none;border-radius:12px;padding:12px 0;width:100%;font-size:13px;font-weight:700;cursor:pointer">
            ${i18n.t('claim_btn')} ${TON(bot.price+fin)}
          </button>
        </div>
      </div>`;
    }

    return `<div class="active-bot">
      <div class="ab-top">
        <div class="ab-dot"></div>
        <div class="ab-name">${bot.name}</div>
        <div class="ab-tag">${bot.pair}</div>
        <div style="margin-left:auto;text-align:right">
          <div class="ab-profit" style="color:${earnColor}">${earned}</div>
          <div class="ab-days"></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
        <div style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${i18n.t('ends_on')} ${endDate}
        </div>
        <div style="font-size:10px;color:var(--text3)">${i18n.t('last_5_trades')}</div>
      </div>
      <div>${rows}</div>
    </div>`;
  }).join('');

  updateWalletInfo();
}

// ═══════════════════════════════════════════════════════════════
// WALLET MODAL
// ═══════════════════════════════════════════════════════════════

let walletMode = 'deposit';

function openWalletModal(mode){
  walletMode = mode;
  const isDeposit = mode === 'deposit';
  document.getElementById('wModalTitle').textContent = isDeposit ? i18n.t('deposit_title') : i18n.t('withdraw_title');
  document.getElementById('wDepositView').style.display  = isDeposit ? '' : 'none';
  document.getElementById('wWithdrawView').style.display = isDeposit ? 'none' : '';
  if(isDeposit){
    const tgIdEl = document.getElementById('userTelegramId');
    if(tgIdEl) tgIdEl.textContent = window._telegramId || '—';
  } else {
    document.getElementById('wDrawAvail').textContent = TON(balance);
    document.getElementById('wDrawGet').textContent = '—';
  }
  document.getElementById('walletModal').classList.add('open');
}
function closeWalletModal(){ document.getElementById('walletModal').classList.remove('open'); }
document.getElementById('walletModal').addEventListener('click',e=>{
  if(e.target===document.getElementById('walletModal')) closeWalletModal();
});

function copyWalletAddr(){
  const addr = document.getElementById('wDepositAddr')?.textContent || '';
  navigator.clipboard?.writeText(addr).catch(()=>{});
  showToast(i18n.t('toast_addr_copied'));
}

function copyMemoId(){
  const id = String(window._telegramId || '');
  if(!id || id === 'undefined'){ showToast('ID не загружен'); return; }
  const btn = document.getElementById('copyMemoBtn');
  navigator.clipboard?.writeText(id).then(()=>{
    if(btn){ const s=btn.querySelector('span'); const prev=s?.textContent; if(s) s.textContent='✓'; setTimeout(()=>{ if(s&&prev) s.textContent=prev; },1500); }
  }).catch(()=>{});
  showToast(i18n.t('toast_memo_copied') || 'MEMO скопирован');
}

// ИСПРАВЛЕННАЯ функция doDeposit - без автоматического начисления
// ИСПРАВЛЕННАЯ функция doDeposit - с минимальной суммой 10 TON
async function doDeposit(){
  const amt = parseFloat(document.getElementById('depositAmt').value);
  if(!amt || amt < 10){ showToast('Минимальная сумма пополнения 10 TON'); return; }
  try {
    const data = await apiPost('/api/wallet/deposit', { amount: amt });
    // НЕ обновляем баланс здесь! Баланс обновится только после одобрения админом
    closeWalletModal();
    document.getElementById('depositAmt').value = '';
    showToast(i18n.t('toast_request_sent'));
    // Обновляем транзакции чтобы показать pending статус
    apiGet('/api/transactions').then(d => renderTxList(d.transactions)).catch(()=>{});
  } catch(e) {
    showToast(e.message || i18n.t('toast_error'));
  }
}

async function doWithdraw(){
  const amt  = parseFloat(document.getElementById('withdrawAmt').value);
  const addr = document.getElementById('withdrawAddr').value.trim();
  if(!amt || amt < 10){ showToast('Минимальная сумма вывода 10 TON'); return; }
  if(!addr){ showToast(i18n.t('toast_enter_address')); return; }
  try {
    const data = await apiPost('/api/wallet/withdraw', { amount: amt, toAddress: addr });
    balance = data.balance;
    updateBal();
    closeWalletModal();
    document.getElementById('withdrawAmt').value = '';
    document.getElementById('withdrawAddr').value = '';
    showToast(i18n.t('toast_withdraw_sent'));
    apiGet('/api/transactions').then(d => renderTxList(d.transactions)).catch(()=>{});
  } catch(e) {
    showToast(e.message || i18n.t('toast_error'));
  }
}

document.getElementById('withdrawAmt').addEventListener('input',()=>{
  const amt = parseFloat(document.getElementById('withdrawAmt').value)||0;
  document.getElementById('wDrawGet').textContent = amt > 0.05 ? TON(amt - 0.05) : '—';
});

// ═══════════════════════════════════════════════════════════════
// BALANCE & WALLET INFO
// ═══════════════════════════════════════════════════════════════

function updateBal(){
  const safeBalance = isNaN(balance) ? 0 : balance;
  const fmt = n => TON(isNaN(n) ? 0 : n);
  document.getElementById('balanceEl').textContent = fmt(safeBalance);
  const wb = document.getElementById('walletBal'); 
  if(wb) wb.textContent = fmt(safeBalance);
  updateWalletInfo();
}

function updateWalletInfo(){
  const inBots = activeBots.filter(b=>!b.done).reduce((s,b)=>s+b.price,0);
  const wa = document.getElementById('wAvail');   if(wa) wa.textContent = TON(balance);
  const wb = document.getElementById('wInBots');  if(wb) wb.textContent = TON(inBots);
  const wm = document.getElementById('wMonthly'); if(wm) wm.textContent = '+' + TON(monthly);
}

function updateMyRank(){
  const total = activeBots.reduce((s,b)=>s+b.earned,0);
  const el = document.getElementById('rankEarn');
  if(el) el.textContent = (total>=0?'+':'') + total.toFixed(4) + ' TON';
}

// ═══════════════════════════════════════════════════════════════
// STATIC LEADERBOARD FALLBACK
// ═══════════════════════════════════════════════════════════════

const RATING_DATA = [
  {name:'Алекс',    init:'А', earn:18.42, bot:'Quantum Bot', pair:'XAU/USD', color:'linear-gradient(135deg,#5B5FEE,#A78BFA)'},
  {name:'Дмитрий',  init:'Д', earn:12.81, bot:'Alpha Bot',   pair:'TSLA',    color:'linear-gradient(135deg,#848E9C,#606878)'},
  {name:'Марина',   init:'М', earn:9.50,  bot:'Quantum Bot', pair:'GBP/JPY', color:'linear-gradient(135deg,#C77B3A,#E8924E)'},
  {name:'Сергей',   init:'С', earn:7.34,  bot:'Alpha Bot',   pair:'NVDA',    color:'linear-gradient(135deg,#0E7C5A,#39D98A)'},
  {name:'Ольга',    init:'О', earn:5.91,  bot:'Alpha Bot',   pair:'AAPL',    color:'linear-gradient(135deg,#C2185B,#F06292)'},
  {name:'Иван',     init:'И', earn:4.62,  bot:'Scout Bot',   pair:'EUR/USD', color:'linear-gradient(135deg,#1565C0,#42A5F5)'},
  {name:'Наталья',  init:'Н', earn:3.87,  bot:'Quantum Bot', pair:'XAG/USD', color:'linear-gradient(135deg,#4A148C,#9C27B0)'},
  {name:'Тимур',    init:'Т', earn:3.20,  bot:'Alpha Bot',   pair:'AMZN',    color:'linear-gradient(135deg,#E65100,#FF9800)'},
  {name:'Виктор',   init:'В', earn:2.74,  bot:'Scout Bot',   pair:'GBP/USD', color:'linear-gradient(135deg,#006064,#00BCD4)'},
];

function renderRating(){
  const el = document.getElementById('ratingList'); if(!el) return;
  el.innerHTML = RATING_DATA.map((u,i)=>`
    <div class="rank-item">
      <div class="rank-num ${i<3?'top3':''}">${i+1}</div>
      <div class="rank-ava" style="background:${u.color}">${u.init}</div>
      <div class="rank-info">
        <div class="rank-name">${u.name}</div>
        <div class="rank-detail">${u.bot} · ${u.pair}</div>
      </div>
      <div class="rank-earn">+${u.earn.toFixed(4)} TON</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// FAQ
// ═══════════════════════════════════════════════════════════════

function toggleFaq(el){ el.classList.toggle('open'); }

// ─── REFERRALS ────────────────────────────────────────────
async function loadReferrals(){
  try {
    const data = await apiGet('/api/referrals');
    const countEl  = document.getElementById('refCount');
    const earnedEl = document.getElementById('refEarned');
    const listEl   = document.getElementById('refList');
    
    if(countEl) {
      const count = data.referrals.length;
      const referralsText = i18n.t('ref_referrals');
      countEl.innerHTML = `${count} <span style="font-size:15px;color:var(--text2)">${referralsText}</span>`;
    }
    
    if(earnedEl) earnedEl.textContent = Number(data.totalEarned).toFixed(4)+' TON';
if(data.referralCode) {
  window._refLink = `https://t.me/Tradeetonbot?start=${data.referralCode}`;
  const rl = document.getElementById('refLink');
  if(rl) rl.textContent = window._refLink;
}
    if(listEl){
      if (data.referrals.length) {
        listEl.innerHTML = data.referrals.map(r => {
          const init = (r.name || 'T')[0].toUpperCase();
          const date = new Date(r.joinedAt);
          const dateStr = i18n.formatDate(date, i18n.getLang());
          return `<div class="ref-item"><div class="ri-ava">${init}</div><div><div class="ri-name">${r.name}</div><div style="font-size:10px;color:var(--text2)">${dateStr}</div></div></div>`;
        }).join('');
      } else {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">' + i18n.t('ref_empty') + '</div>';
      }
    }
  } catch(e){ console.warn('[referrals]',e.message); }
}

function shareRef(){
  const link = window._refLink||'';
  if(window.Telegram?.WebApp){
    window.Telegram.WebApp.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent((i18n.getLang()==='ru'?'Торговые боты на TON — зарабатывай пока бот работает!':'TON trading bots — earn while the bot works!')));
  } else {
    navigator.clipboard?.writeText(link).catch(()=>{});
    showToast(i18n.t('toast_link_copied'));
  }
}

// ═══════════════════════════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════════════════════════

(function(){
  const bar  = document.getElementById('splashBar');
  const dots = [0,1,2,3].map(i=>document.getElementById('sd'+i));
  let pct=0, si=0;
  const steps=[{target:30,dot:1,delay:300},{target:60,dot:2,delay:600},{target:85,dot:3,delay:900},{target:100,dot:3,delay:1100}];
  function advance(){
    if(si>=steps.length) return;
    const s=steps[si++];
    setTimeout(()=>{
      const iv=setInterval(()=>{
        pct=Math.min(pct+2,s.target);
        bar.style.width=pct+'%';
        if(pct>=s.target){clearInterval(iv);advance();}
      },16);
      if(s.dot<4 && dots[s.dot]) dots[s.dot].classList.add('lit');
    },s.delay);
  }
  advance();
  setTimeout(()=>{
    const splash=document.getElementById('splash');
    if(splash){
      splash.classList.add('hiding');
      setTimeout(()=>{splash.style.display='none';},520);
    }
  },1600);
})();

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

window.addEventListener('load', () => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    // Fullscreen (Bot API 8.0+)
    if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen();
  }
  
  if (!i18n.isSet()) {
    document.getElementById('langWelcome').classList.remove('hidden');
  } else {
    document.getElementById('langWelcome').classList.add('hidden');
    i18n.apply();
    updateDurationButtonsText();
    updateLaunchButtonsText();
    
    const cur = i18n.getLang();
    const optRu = document.getElementById('lang-opt-ru');
    const optEn = document.getElementById('lang-opt-en');
    if(optRu) optRu.classList.toggle('active', cur==='ru');
    if(optEn) optEn.classList.toggle('active', cur==='en');
    const lbl = document.getElementById('langCurrentLabel');
    if(lbl) lbl.textContent = cur==='ru'?'Русский':'English';
  }
  
  renderTasks();
  bootApp();
});

// Обновление при смене языка
window.addEventListener('langChanged', () => {
  i18n.apply();
  updateDurationButtonsText();
  updateLaunchButtonsText();
  render();
  renderTasks();
  updateBal();
  if (window._lastTxs) renderTxList(window._lastTxs);
  ['basic','pro','elite'].forEach(updateYieldBadge);
  loadReferrals();
});

// ── PROMOCODE ────────────────────────────────────────────────
async function activatePromo() {
  const input = document.getElementById('promoInput');
  const code = input?.value?.trim();
  const msgDiv = document.getElementById('promoMessage');
  
  if (!code) {
    if (msgDiv) msgDiv.innerHTML = '<span style="color:var(--red)">Введите промокод</span>';
    return;
  }
  
  if (msgDiv) msgDiv.innerHTML = '<span style="color:var(--text2)">Проверяем...</span>';
  
  try {
    const data = await apiPost('/api/promo/activate', { code });
    
    balance = data.balance;
    updateBal();
    if (msgDiv) {
      msgDiv.innerHTML = `<span style="color:var(--green)">✅ ${data.message || `+${data.reward} TON зачислено!`}</span>`;
    }
    input.value = '';
    
    apiGet('/api/transactions').then(d => renderTxList(d.transactions)).catch(()=>{});
    
    setTimeout(() => {
      if (msgDiv && msgDiv.innerHTML.includes('✅')) {
        msgDiv.innerHTML = '';
      }
    }, 5000);
    
  } catch (e) {
    let errorMsg = e.message || 'Ошибка активации';
    if (errorMsg.includes('404')) errorMsg = 'Промокод не найден';
    if (errorMsg.includes('400') && e.message) errorMsg = e.message;
    if (msgDiv) msgDiv.innerHTML = `<span style="color:var(--red)">❌ ${errorMsg}</span>`;
    
    setTimeout(() => {
      if (msgDiv && msgDiv.innerHTML.includes('❌')) {
        msgDiv.innerHTML = '';
      }
    }, 4000);
  }
}