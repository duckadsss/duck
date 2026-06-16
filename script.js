// ============================================================
// script.js - DNA MMO Клиент (Арена + Экономика как в первой версии)
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const API_URL = 'https://serv-production-765e.up.railway.app';

// STAKING PLANS (вверху файла — доступен сразу при любом onclick)
// script.js
var STAKING_PLANS_CLIENT = {
    // старые
    10: { days: 10, rate: 0.10, minAmount: 300000, label: '+10%', rewardText: '+10% MMO + 🦫 Capybara Rare' },
    30: { days: 30, rate: 0.20, minAmount: 50000,  label: '+20%', rewardText: '+20% MMO' },
    
    // НОВЫЕ (14 дней, 10%)
    14: { 
        days: 14, rate: 0.10, minAmount: 200000, label: '+10%',
        rewardText: '+10% MMO + 👕 Кросс (1 месяц)'
    },
    28: { 
        days: 14, rate: 0.10, minAmount: 500000, label: '+10%',
        rewardText: '+10% MMO + 🥷 Ниндзя (3 месяца)'
    },
    56: { 
        days: 14, rate: 0.10, minAmount: 1000000, label: '+10%',
        rewardText: '+10% MMO + 👘 Любой (12 месяцев)'
    }
};
window.STAKING_PLANS_CLIENT = STAKING_PLANS_CLIENT;
var stakingTimerInterval = null;
var currentStakingPlan = null;

// ============================================================
// ЗАПРЕТ КОНТЕКСТНОГО МЕНЮ И ВЫДЕЛЕНИЯ
// ============================================================
document.addEventListener('contextmenu', (e) => { e.preventDefault(); return false; });
document.addEventListener('selectstart', (e) => { e.preventDefault(); return false; });
document.addEventListener('dragstart', (e) => { e.preventDefault(); return false; });

// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================
let state = {
    token: null,
    user: null,
    inventory: [],
    incomePerHour: 0,
    adsCooldown: 0,
    adsAvailable: 10,
    maxAdsPerDay: 10,
    arenaBattlesLeft: 10,
    maxArenaBattles: 10,
    isLoading: false,
    serverBalance: 0,
    lastServerSync: 0,
    visualTicker: null
};

let intervals = { adsTimer: null, specialQuests: null, leaderboard: null, marketplace: null };
let activeQuestTimers = new Map();
let currentLeaderboardController = null;
let isMarketplaceTabActive = false;

let leaderboardCache = { data: null, expiresAt: 0 };
let marketplaceCache = { data: null, hash: null, expiresAt: 0 };
let questStatuses = new Map();

const QUESTS_STORAGE_KEY = 'dna_mmo_quests_status';

let CREATURES = [];
let CAPSULE_COSTS = { basic: 1000, premium: 6000 };
let RARITY_WEIGHTS = {
    basic: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    premium: { common: 70, uncommon: 20, rare: 10, epic: 0, legendary: 0 }
};
let AD_REWARD = 5;
let AD_COOLDOWN = 60;
let UPGRADE_BASE_COST = 300;
let UPGRADE_MULTIPLIER = 1.4;
let MAX_INVENTORY_SLOTS = 50;
let SPECIAL_QUESTS = [];
let findingMatch = false;

const RARITY_COLORS = {
    common: '#94a3b8', uncommon: '#22c55e', rare: '#3b82f6',
    epic: '#a855f7', legendary: '#f59e0b', mythic: '#ef4444'
};
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const RARITY_MULTIPLIERS = {
    common: 1.0, uncommon: 1.05, rare: 1.10, epic: 1.15, legendary: 1.25, mythic: 1.40
};

let lastOpenTimes = new Map();
let lastMergeTimes = new Map();
let collectIncomeTimer = null;
let visualTickerInterval = null;

let arenaClient = null;
let currentPaymentMemo = null;
let currentPaymentAmount = null;
const MIN_TRANSACTION_AMOUNT = 10000;
const MAX_ACTIVE_REQUESTS = 2;

let currentMarketplaceFilter = 'all';
let allMarketplaceListings = [];

// Raid Boss
let currentRaid = null;
let raidUpdateInterval = null;
let raidTurnTimerInterval = null;

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getCreature(id) { return CREATURES.find(c => c.id === id); }
function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function formatNum(n) {
    const absN = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (absN >= 1000000) return sign + (absN/1000000).toFixed(1) + 'M';
    if (absN >= 1000) return sign + (absN/1000).toFixed(1) + 'K';
    return sign + Math.floor(absN).toString();
}
function formatBalance(n) {
    const absN = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    return sign + absN.toFixed(3);
}
function getUsedSlots() { return state.inventory.reduce((s, i) => s + i.count, 0); }
function getUpgradeCost() { return Math.floor(UPGRADE_BASE_COST * Math.pow(UPGRADE_MULTIPLIER, state.user?.inventoryUpgrades || 0)); }
function canMerge(creatureId) {
    const item = state.inventory.find(i => i.creatureId === creatureId);
    const c = getCreature(creatureId);
    return item && item.count >= 3 && c && c.rarity !== 'legendary' && c.rarity !== 'mythic';
}
function getLevelTitle(lvl) {
    const level = lvl || 1;
    if (level >= 20) return 'God Scientist';
    if (level >= 15) return 'DNA Master';
    if (level >= 10) return 'Geneticist';
    if (level >= 5) return 'Lab Expert';
    if (level >= 3) return 'Biologist';
    return 'Researcher';
}
function getIconHtml(creature, addShadow = false, shadowColor = null) {
    if (!creature) return '🧬';
    const icon = creature.icon;
    if (icon && (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('Images/'))) {
        const shadowStyle = addShadow && shadowColor ? `filter:drop-shadow(0 0 16px ${shadowColor});` : '';
        return `<img src="${icon}" alt="${escapeHtml(creature.name)}" loading="lazy" style="object-fit:contain;${shadowStyle}" class="card-icon-img" onerror="this.style.display=\'none\'">`;
    }
    return icon || '🧬';
}

function getVisualBalance() {
    if (!state.user) return 0;
    if (!state.lastServerSync) return state.serverBalance || 0;
    const elapsedSeconds = (Date.now() - state.lastServerSync) / 1000;
    const earned = (state.incomePerHour / 3600) * elapsedSeconds;
    return (state.serverBalance || 0) + earned;
}

function updateServerSnapshot(newBalance, newIncomePerHour, newLastPassiveIncome) {
    console.log('📊 updateServerSnapshot:', { newBalance, newIncomePerHour, newLastPassiveIncome });
    
    state.serverBalance = newBalance !== undefined ? newBalance : state.serverBalance;
    state.incomePerHour = newIncomePerHour !== undefined ? newIncomePerHour : state.incomePerHour;
    state.lastServerSync = newLastPassiveIncome ? new Date(newLastPassiveIncome).getTime() : Date.now();
    if (state.user) state.user.balance = state.serverBalance;
}

// ============================================================
// API ЗАПРОСЫ
// ============================================================
let pendingRequests = new Map();

async function apiRequest(method, path, body = null, signal = null) {
    const key = `${method}:${path}:${JSON.stringify(body)}`;
    if (pendingRequests.has(key)) return pendingRequests.get(key);
    
    const opts = { method, headers: { 'Content-Type': 'application/json' }, signal };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body) opts.body = JSON.stringify(body);
    
    const promise = (async () => {
        try {
            const res = await fetch(API_URL + path, opts);
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    localStorage.removeItem('token');
                    state.token = null;
                    showToast('Сессия истекла', '❌');
                }
            }
            return data;
        } catch (e) {
            if (e.name === 'AbortError') return null;
            showToast('Ошибка соединения', '❌');
            return { success: false, message: 'Нет соединения' };
        } finally {
            setTimeout(() => pendingRequests.delete(key), 100);
        }
    })();
    
    pendingRequests.set(key, promise);
    return promise;
}

// ============================================================
// ВИЗУАЛЬНЫЙ ТИКЕР
// ============================================================
function startVisualTicker() {
    if (visualTickerInterval) clearInterval(visualTickerInterval);
    visualTickerInterval = setInterval(() => {
        if (document.hidden || !state.user) return;
        const visualBalance = getVisualBalance();
        const balanceEl = document.getElementById('balanceDisplay');
        if (balanceEl) balanceEl.textContent = formatBalance(visualBalance);
        const walletBalanceEl = document.getElementById('walletBalance');
        if (walletBalanceEl) walletBalanceEl.textContent = formatBalance(visualBalance);
    }, 1000);
    state.visualTicker = { cancel: () => clearInterval(visualTickerInterval) };
}

async function startCollectIncomeLoop() {
    if (collectIncomeTimer) clearInterval(collectIncomeTimer);
    collectIncomeTimer = setInterval(async () => {
        if (document.hidden || !state.token) return;
        try {
            const res = await apiRequest('POST', '/api/game/collect-income');
            if (res && res.success) {
                const serverBal = res.balance;
                const visualBal = getVisualBalance();
                const effectiveBal = Math.max(serverBal, Math.floor(visualBal));
                updateServerSnapshot(effectiveBal, res.incomePerHour, null);
                if (state.user) state.user.balance = effectiveBal;
            }
        } catch (e) {}
    }, 5 * 60 * 1000);
}

// ============================================================
// ЗАГРУЗКА КОНФИГА И СУЩЕСТВ
// ============================================================
async function loadGameConfig() {
    const res = await apiRequest('GET', '/api/game/config');
    if (res && res.success) {
        const cfg = res.config;
        CAPSULE_COSTS = cfg.capsuleCosts || { basic: 1000, premium: 6000 };
        RARITY_WEIGHTS = cfg.capsuleRarities || RARITY_WEIGHTS;
        AD_REWARD = cfg.adReward || 5;
        AD_COOLDOWN = cfg.adCooldown || 60;
        UPGRADE_BASE_COST = cfg.upgradeBaseCost || 300;
        UPGRADE_MULTIPLIER = cfg.upgradeMultiplier || 1.4;
        MAX_INVENTORY_SLOTS = cfg.limits?.maxInventorySlots || 50;
        SPECIAL_QUESTS = cfg.specialQuests || [];
        return true;
    }
    return false;
}

async function loadCreaturesFromServer() {
    const res = await apiRequest('GET', '/api/game/creatures');
    if (res && res.success && res.creatures) {
        CREATURES = res.creatures;
        return true;
    }
    return false;
}

// ============================================================
// СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ
// ============================================================
async function loadUserStats() {
    try {
        const res = await apiRequest('GET', '/api/user/stats');
        if (res && res.success) {
            const stats = res.stats;
            const walletCards = document.getElementById('walletCards');
            const walletMerges = document.getElementById('walletMerges');
            const walletAdsWatched = document.getElementById('walletAdsWatched');
            const walletReferralEarned = document.getElementById('walletReferralEarned');
            
            if (walletCards) walletCards.textContent = state.inventory.reduce((s, i) => s + i.count, 0);
            if (walletMerges) walletMerges.textContent = state.user?.mergeCount || 0;
            if (walletAdsWatched) walletAdsWatched.textContent = stats.adsWatched || 0;
            if (walletReferralEarned) walletReferralEarned.textContent = formatNum(stats.referralEarned || 0);
        }
    } catch (e) { console.error('loadUserStats error:', e); }
}

// ============================================================
// TELEGRAM WEBAPP INIT
// ============================================================
function clearAllIntervals() {
    if (intervals.adsTimer) clearInterval(intervals.adsTimer);
    if (intervals.specialQuests) clearInterval(intervals.specialQuests);
    if (intervals.leaderboard) clearInterval(intervals.leaderboard);
    if (intervals.marketplace) clearInterval(intervals.marketplace);
    if (state.visualTicker) state.visualTicker.cancel();
    if (collectIncomeTimer) clearInterval(collectIncomeTimer);
    collectIncomeTimer = null;
    for (const timer of activeQuestTimers.values()) clearTimeout(timer);
    activeQuestTimers.clear();
    clearAllQuestTimers();
    if (window.questTimerInterval) clearInterval(window.questTimerInterval);
}

function startOptimizedIntervals() {
    intervals.leaderboard = setInterval(() => { if (!document.hidden) renderLeaderboard(); }, 5 * 60 * 1000);
    intervals.specialQuests = setInterval(() => { if (!document.hidden) { loadGameConfig(); renderSpecialQuests(); } }, 5 * 60 * 1000);
    intervals.marketplace = setInterval(() => { if (!document.hidden && isMarketplaceTabActive) renderMarketplaceBuy(); }, 10 * 1000);
    intervals.adsTimer = setInterval(updateAdsTimer, 1000);
}

function handleVisibilityChange() {
    if (document.hidden) {
        if (intervals.marketplace) clearInterval(intervals.marketplace);
        intervals.marketplace = null;
    } else {
        apiRequest('POST', '/api/game/collect-income').then(res => {
    if (res && res.success) {
        updateServerSnapshot(res.balance, res.incomePerHour, res.lastPassiveIncome);
        if (state.user) { 
            state.user.balance = res.balance; 
            updateHeader(); 
        }
        if (res.earned > 1) showToast(`+${formatNum(res.earned)} MMO получено`, '💰');
    }
}).catch(err => console.warn('collect-income error:', err));

        if (arenaClient && state.token && !arenaClient.isConnected()) {
            arenaClient.connectSocket(state.token, API_URL);
        }
        
        if (isMarketplaceTabActive) {
            renderMarketplaceBuy();
            intervals.marketplace = setInterval(() => { 
                if (!document.hidden && isMarketplaceTabActive) renderMarketplaceBuy(); 
            }, 10 * 1000);
        }
    }
}

async function refreshUserProfile() {
    const res = await apiRequest('GET', '/api/user/profile');
    if (res && res.success) {
        const currentVisualBalance = getVisualBalance();
        
        state.user = res.user;
        state.inventory = res.inventory || [];
        state.incomePerHour = res.incomePerHour || 0;
        
        const serverBal = state.user.balance;
        const effectiveBal = Math.max(serverBal, Math.floor(currentVisualBalance));
        
        state.serverBalance = effectiveBal;
        state.lastServerSync = Date.now();
        if (state.user) state.user.balance = effectiveBal;
        
        updateHeader();
        renderCards();
        updateFriendRewardButtons();
        await loadUserStats();
        
        if (res.offlineEarned > 10) {
            setTimeout(() => showToast(`+${formatNum(res.offlineEarned)} MMO offline!`, '💤'), 1000);
        }
    }
}

// ============================================================
// LOADING SCREEN
// ============================================================
function showLoadingScreen(show) {
    let el = document.getElementById('loadingScreen');
    
    if (!el && show) {
        el = document.createElement('div');
        el.id = 'loadingScreen';
        el.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100vh; height: 100dvh; background: url('load.webp') center/cover no-repeat; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 12vh;`;
        el.innerHTML = `
            <style>.loading-bar-container { width: 200px; height: 4px; background: rgba(168,85,247,0.2); border-radius: 4px; overflow: hidden; }
            .loading-bar-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #a855f7, #06b6d4); border-radius: 4px; transition: width 0.3s ease; }
            .loading-text { font-family: 'Orbitron', monospace; font-size: 12px; font-weight: 600; color: #a855f7; text-transform: uppercase; letter-spacing: 3px; margin-top: 16px; }
            .loading-percent { font-family: 'Orbitron', monospace; font-size: 11px; color: #94a3b8; margin-top: 6px; }</style>
            <div class="loading-bar-container"><div class="loading-bar-fill" id="loadingBarFill"></div></div>
            <div class="loading-text">LOADING</div><div class="loading-percent" id="loadingPercent">0%</div>
        `;
        document.body.appendChild(el);
        
        let percent = 0;
        const fillEl = document.getElementById('loadingBarFill');
        const percentEl = document.getElementById('loadingPercent');
        const interval = setInterval(() => {
            if (percent < 90) {
                percent += Math.random() * 10;
                percent = Math.min(percent, 90);
                if (fillEl) fillEl.style.width = percent + '%';
                if (percentEl) percentEl.textContent = Math.floor(percent) + '%';
            }
        }, 200);
        el.dataset.percentInterval = interval;
    } 
    else if (el && !show) {
        if (el.dataset.percentInterval) clearInterval(parseInt(el.dataset.percentInterval));
        const fillEl = document.getElementById('loadingBarFill');
        const percentEl = document.getElementById('loadingPercent');
        if (fillEl) fillEl.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        setTimeout(() => { el.style.transition = 'opacity 0.5s ease'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 200);
    }
}

// ============================================================
// PARTICLES
// ============================================================
(function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];
    function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < 40; i++) {
        particles.push({
            x: Math.random() * 1000, y: Math.random() * 1000,
            r: Math.random() * 1.5 + 0.3,
            vx: (Math.random() - 0.5) * 0.3, vy: -Math.random() * 0.4 - 0.1,
            alpha: Math.random() * 0.4 + 0.1,
            color: Math.random() > 0.5 ? '124,58,237' : '6,182,212'
        });
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
            if (p.x < -5) p.x = W + 5;
            if (p.x > W + 5) p.x = -5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
            ctx.fill();
        });
        requestAnimationFrame(draw);
    }
    draw();
})();

// ============================================================
// UPDATE UI
// ============================================================
function updatePlayerInfo() {
    if (!state.user) return;
    const name = state.user.username || state.user.firstName || 'GENOME_X';
    const avatarEl = document.getElementById('playerAvatar');
    const nameEl = document.querySelector('.player-name');
    if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
    if (nameEl) nameEl.textContent = name.toUpperCase();
}

// ============================================================
// ARENA LOCK
// ============================================================
function showArenaClosedModal() {
    const overlay = document.getElementById('overlay');
    const popup = document.getElementById('popup');
    if (!overlay || !popup) return;
    popup.innerHTML = `
        <div style="text-align:center;padding:8px">
            <div style="font-size:48px;margin-bottom:12px">⏰</div>
            <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:8px">Арена закрыта</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:16px;line-height:1.5">
                Арена работает по расписанию<br>
                <span style="color:#a78bfa;font-weight:600">10:00 – 12:00</span> и <span style="color:#a78bfa;font-weight:600">20:00 – 22:00</span><br>(UTC+3)
            </div>
            <div style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.3);border-radius:12px;padding:12px;margin-bottom:20px">
                <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">До открытия</div>
                <div style="font-size:24px;font-weight:700;color:#a78bfa">${arenaNextOpenText()}</div>
            </div>
            <button onclick="closeOverlay()" style="width:100%;padding:14px;background:linear-gradient(135deg,#7c3aed,#a78bfa);border:none;border-radius:12px;color:#fff;font-size:16px;font-weight:600;cursor:pointer">Понятно</button>
        </div>
    `;
    document.getElementById('overlay').classList.add('show');
}

// Расписание арены (UTC+3)
const ARENA_SCHEDULE_CLIENT = [[10, 12], [20, 22]];

function isArenaOpenClient() {
    const nowUTC = new Date();
    const hourUTC3 = (nowUTC.getUTCHours() + 3) % 24;
    return ARENA_SCHEDULE_CLIENT.some(([s, e]) => hourUTC3 >= s && hourUTC3 < e);
}

function arenaNextOpenText() {
    const nowUTC = new Date();
    const hourUTC3 = (nowUTC.getUTCHours() + 3) % 24;
    const minUTC3 = nowUTC.getUTCMinutes();
    const mins = Math.min(...ARENA_SCHEDULE_CLIENT.map(([s]) => {
        let d = (s - hourUTC3) * 60 - minUTC3;
        if (d <= 0) d += 24 * 60;
        return d;
    }));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}ч ${m}мин` : `${m}мин`;
}

function updateArenaLock() {
    const lock = document.getElementById('arenaNavLock');
    if (!lock) return;
    const level = state.user?.level || 1;
    if (level < 3) {
        lock.style.display = 'inline';
        lock.textContent = '🔒';
        lock.title = `Доступно с 3 уровня (ваш: ${level})`;
    } else if (!isArenaOpenClient()) {
        lock.style.display = 'inline';
        lock.textContent = '⏰';
        lock.title = `Арена закрыта. Открыта в 10:00–12:00 и 20:00–22:00 (UTC+3)`;
    } else {
        lock.style.display = 'none';
    }
}

function updateHeader() {
    if (!state.user) return;
    const u = state.user;

    if (!state.incomePerHour) {
        let income = 0;
        state.inventory.forEach(item => { 
            const c = getCreature(item.creatureId); 
            if (c) income += c.incomeBase * item.count; 
        });
        state.incomePerHour = income;
    }

    const visualBalance = getVisualBalance();
    
    // Обновляем MMO баланс
    const balanceEl = document.getElementById('balanceDisplay');
    if (balanceEl) balanceEl.textContent = formatBalance(visualBalance);
    
    // Обновляем пыль
    const dustEl = document.getElementById('dustDisplay');
    if (dustEl) dustEl.textContent = formatNum(u.dust || 0);
    
    // Обновляем инлайн доход
    const incomeInline = document.getElementById('incomeInline');
    if (incomeInline) incomeInline.textContent = formatNum(state.incomePerHour);
    
    // Обновляем компактный XP индикатор
    const needed = u.level * 100;
    const xpPercent = Math.min(100, (u.xp / needed) * 100);
    const xpFill = document.getElementById('xpFillCompact');
    const xpText = document.getElementById('xpTextCompact');
    
    if (xpFill) xpFill.style.width = `${xpPercent}%`;
    if (xpText) xpText.textContent = `${u.xp}/${needed}`;
    
    // Обновляем уровень
    const levelLabel = document.getElementById('playerLevelLabel');
    if (levelLabel) levelLabel.textContent = `LVL ${u.level} · ${getLevelTitle(u.level)}`;
    
    // Остальные обновления...
    const walletBalanceEl = document.getElementById('walletBalance');
    if (walletBalanceEl) walletBalanceEl.textContent = formatBalance(visualBalance);
    
    const walletDustEl = document.getElementById('walletDust');
    if (walletDustEl) walletDustEl.textContent = formatNum(u.dust || 0);
    
    const inventorySlots = document.getElementById('inventorySlots');
    if (inventorySlots) inventorySlots.textContent = `${getUsedSlots()}/${u.inventorySlots || 10}`;
    
    const upgradeCostEl = document.getElementById('upgradeSlotCost');
    if (upgradeCostEl) upgradeCostEl.textContent = getUpgradeCost();
    
    const friendCountDisplay = document.getElementById('friendCountDisplay');
    if (friendCountDisplay) friendCountDisplay.textContent = `${u.referralCount || 0} друзей 5+ уровня`;
}

function updateUpgradeButton() {
    if (!state.user) return;
    const cost = getUpgradeCost();
    const btn = document.getElementById('quickUpgradeBtn');
    const costEl = document.getElementById('upgradeSlotCost');
    if (btn && costEl) {
        costEl.textContent = cost;
        const canAfford = state.serverBalance >= cost;
        btn.style.opacity = canAfford ? '1' : '0.5';
        btn.disabled = !canAfford;
    }
}

function renderCards() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return;

    if (!state.inventory.length) {
        grid.innerHTML = `<div class="empty-grid"><i class="fa-solid fa-dna"></i>Open a capsule to get your first creature!</div>`;
        document.getElementById('inventorySlots').textContent = `0/${state.user?.inventorySlots || 10}`;
        document.getElementById('encyclopediaProgress').textContent = `${state.user?.discovered?.length || 0}/${CREATURES.length}`;
        return;
    }

    const sorted = [...state.inventory].sort((a, b) => {
        const ai = RARITY_ORDER.indexOf(getCreature(a.creatureId)?.rarity || 'common');
        const bi = RARITY_ORDER.indexOf(getCreature(b.creatureId)?.rarity || 'common');
        return bi - ai;
    });

    grid.innerHTML = sorted.map(item => {
        const c = getCreature(item.creatureId);
        if (!c) return '';
        const merge = canMerge(item.creatureId);
        return `<div class="creature-card ${c.rarity}" onclick="onCardClick('${item.creatureId}')">
            ${merge ? `<div class="merge-ready-badge">MERGE!</div>` : ''}
            ${item.count > 1 ? `<div class="card-count">${item.count}</div>` : ''}
            <div class="card-icon">${getIconHtml(c)}</div>
            <div class="card-name">${escapeHtml(c.name)}</div>
            <div class="card-rarity-badge badge-${c.rarity}">${c.rarity}</div>
            <div class="card-income"><i class="fa-solid fa-bolt"></i>${c.incomeBase}/hr</div>
        </div>`;
    }).join('');

    document.getElementById('inventorySlots').textContent = `${getUsedSlots()}/${state.user?.inventorySlots || 10}`;
    document.getElementById('encyclopediaProgress').textContent = `${state.user?.discovered?.length || 0}/${CREATURES.length}`;
}

function renderTransactions() {
    const list = document.getElementById('txList');
    if (!list) return;
    const txs = state.user?.transactions || [];
    if (!txs.length) {
        list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">No transactions yet</div>`;
        return;
    }
    list.innerHTML = txs.slice(0, 10).map(tx => {
        const isPos = tx.amount > 0;
        const isNeg = tx.amount < 0;
        const icon = isPos ? '⬆️' : isNeg ? '⬇️' : '🔀';
        const color = isPos ? 'rgba(34,197,94,0.15)' : isNeg ? 'rgba(239,68,68,0.15)' : 'rgba(124,58,237,0.15)';
        const timeAgo = Math.floor((Date.now() - new Date(tx.time).getTime()) / 60000);
        const timeStr = timeAgo < 1 ? 'just now' : `${timeAgo}m ago`;
        return `<div class="tx-item">
            <div class="tx-icon" style="background:${color}"><span style="font-size:16px">${icon}</span></div>
            <div class="tx-info">
                <div class="tx-name">${escapeHtml(tx.name)}</div>
                <div class="tx-time">${timeStr}</div>
            </div>
            <div class="tx-amount ${isPos ? 'positive' : isNeg ? 'negative' : ''}" style="${!isPos && !isNeg ? 'color:#a855f7' : ''}">
                ${isPos ? '+' : ''}${tx.amount !== 0 ? formatNum(tx.amount) + ' MMO' : 'MERGE'}
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// CAPSULE
// ============================================================
function showCapsuleModal(type) {
    const odds = RARITY_WEIGHTS[type];
    const cost = CAPSULE_COSTS[type];
    const title = type === 'premium' ? 'Premium DNA Capsule' : 'DNA Capsule';
    const canAfford = state.serverBalance >= cost;
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

    const oddsHtml = rarities.map(r => {
        const pct = odds[r] || 0;
        if (!pct) return '';
        const color = RARITY_COLORS[r];
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="flex:1;font-size:12px;font-weight:600;color:${color};text-transform:uppercase">${r}</div>
            <div style="width:100px;height:6px;background:#1e2d4a;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
            </div>
            <div style="width:35px;text-align:right;font-family:'Orbitron',monospace;font-size:12px;font-weight:700;color:${color}">${pct}%</div>
        </div>`;
    }).join('');

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <span class="popup-icon" style="filter:drop-shadow(0 0 16px ${type === 'premium' ? 'rgba(245,158,11,0.8)' : 'rgba(124,58,237,0.8)'})">${type === 'premium' ? '💎' : '🧬'}</span>
        <div class="popup-title">${title}</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Cost: <span style="color:${type === 'premium' ? '#f59e0b' : '#a855f7'};font-weight:700">${cost} MMO</span></div>
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:12px;padding:14px;margin-bottom:16px">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Drop Rates</div>
            ${oddsHtml}
        </div>
        <button class="popup-btn" ${!canAfford ? 'disabled' : ''} style="${!canAfford ? 'opacity:0.5;cursor:not-allowed;background:#1a2540' : type === 'premium' ? 'background:linear-gradient(135deg,#b45309,#f59e0b)' : ''}" onclick="closeOverlay();openCapsule('${type}')">
            <i class="fa-solid fa-flask-vial"></i> ${canAfford ? 'OPEN NOW' : 'NOT ENOUGH MMO'}
        </button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function openCapsule(type) {
    if (state.isLoading) return;
    
    if (Date.now() - (lastOpenTimes.get(state.user?.telegramId) || 0) < 2000) {
        showToast('Слишком быстро! Подождите 2 секунды.', '⏳');
        return;
    }
    lastOpenTimes.set(state.user?.telegramId, Date.now());

    const cost = CAPSULE_COSTS[type];
    if (state.serverBalance < cost) { showToast('Not enough MMO!', '❌'); return; }
    if (getUsedSlots() >= (state.user?.inventorySlots || 10)) { showToast('Inventory full! Upgrade storage', '📦'); return; }

    state.isLoading = true;

    const cardEl = document.getElementById(type === 'premium' ? 'premiumCapsuleCard' : 'basicCapsuleCard');
    const iconEl = cardEl?.querySelector('.capsule-icon');
    iconEl?.classList.add('capsule-opening');
    setTimeout(() => iconEl?.classList.remove('capsule-opening'), 600);

    const res = await apiRequest('POST', '/api/game/open-capsule', { type });
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Error opening capsule', '❌'); return; }

    state.user = res.user;
    state.inventory = res.inventory;
    state.incomePerHour = res.incomePerHour;
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, null);
    updateHeader();
    renderCards();
    await loadUserStats();
    setTimeout(() => showCapsulePopup(res.creature), 300);
}

function showCapsulePopup(creature) {
    const c = getCreature(creature.id) || creature;
    const color = RARITY_COLORS[c.rarity];

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-icon">${getIconHtml(c, true, color)}</div>
        <div class="popup-title" style="color:${color}">${escapeHtml(c.name)}</div>
        <div class="popup-subtitle">${escapeHtml(c.desc || '')}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">${c.rarity.toUpperCase()}</div>
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${c.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
        </div>
        <button class="popup-btn" onclick="closeOverlay()">AWESOME!</button>
    `;
    document.getElementById('overlay').classList.add('show');
    spawnStars(c.rarity);
}

// ============================================================
// CARD CLICK & MERGE
// ============================================================
function onCardClick(creatureId) {
    const c = getCreature(creatureId);
    if (!c) return;
    const item = state.inventory.find(i => i.creatureId === creatureId);
    const color = RARITY_COLORS[c.rarity];
    const skill = window.ARENA_SKILLS_MAP?.[c.id] || null;
    const premiumBadge = c.premiumOnly
        ? `<div style="display:inline-block;background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed55;border-radius:8px;padding:3px 10px;font-size:10px;font-weight:700;margin-bottom:8px">💎 PREMIUM CAPSULE ONLY</div>`
        : '';
    const skillBlock = skill
        ? `<div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:10px;padding:10px;margin-top:8px;text-align:left">
               <div style="font-size:10px;color:#64748b;margin-bottom:4px">ARENA SKILL</div>
               <div style="font-size:13px;font-weight:700;color:#e2e8f0">${skill.name} <span style="color:#64748b;font-size:11px;font-weight:400">${Math.round(skill.chance * 100)}% chance</span></div>
               <div style="font-size:11px;color:#94a3b8;margin-top:3px">${skill.description}</div>
           </div>`
        : '';

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-icon">${getIconHtml(c, true, color)}</div>
        <div class="popup-title" style="color:${color}">${escapeHtml(c.name)}</div>
        <div class="popup-subtitle">${escapeHtml(c.desc || '')}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">${c.rarity.toUpperCase()}</div>
        ${premiumBadge}
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${c.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
            <div class="popup-stat"><div class="popup-stat-val">${item ? item.count : 0}</div><div class="popup-stat-label">Owned</div></div>
        </div>
        ${skillBlock}
        ${canMerge(creatureId)
            ? `<button class="popup-btn" style="background:linear-gradient(135deg,#16a34a,#22c55e)" onclick="showMergePreview('${creatureId}')">
                <i class="fa-solid fa-code-merge"></i> MERGE x3
            </button>`
            : `<button class="popup-btn" onclick="closeOverlay()">CLOSE</button>`
        }
    `;
    document.getElementById('overlay').classList.add('show');
}

// Таблица стоимости пыли — синхронизирована с сервером
const MERGE_DUST_TABLE = {
    common:   { 10: 600,  20: 950,   30: 1200,  40: 1350,  50: 1500,  60: 1600,  70: 3200  },
    uncommon: { 10: 3000, 20: 5200,  30: 6600,  40: 7500,  50: 8000,  60: 8400,  70: 16800 },
    rare:     { 10: 132000, 20: 180000, 30: 205000, 40: 223000, 50: 237000, 60: 248000, 70: 257000, 80: 266000 }
};

function showMergePreview(creatureId) {
    const creature = getCreature(creatureId);
    if (!creature) return;
    if (creature.rarity === 'legendary') { showToast('Legendary is max!', '⭐'); return; }

    const currentRarityIdx = RARITY_ORDER.indexOf(creature.rarity);
    const nextRarity = currentRarityIdx < RARITY_ORDER.length - 2 ? RARITY_ORDER[currentRarityIdx + 1] : creature.rarity;
    const nextCreature = CREATURES.find(c => c.name === creature.name && c.rarity === nextRarity) || creature;

    const BASE_CHANCE = { common: 30, uncommon: 30, rare: 10, epic: 10, legendary: 5 };
    const baseChance = BASE_CHANCE[creature.rarity] || 30;
    const userDust = state.user?.dust || 0;
    const rarityTable = MERGE_DUST_TABLE[creature.rarity];
    const hasDustBoost = !!rarityTable;
    const steps = rarityTable ? Object.keys(rarityTable).map(Number).sort((a,b)=>a-b) : [];

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title" style="margin-bottom:4px">Слияние</div>
        <div class="popup-subtitle">3x ${escapeHtml(creature.name)} → ?</div>

        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:14px;padding:14px;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                <div style="text-align:center;flex:1">
                    <div style="font-size:28px;margin-bottom:4px">${getIconHtml(creature)}</div>
                    <div style="font-size:10px;color:#94a3b8">3x ${escapeHtml(creature.name)}</div>
                </div>
                <div style="color:#4a5568;font-size:22px;padding:0 8px">→</div>
                <div style="text-align:center;flex:1">
                    <div style="font-size:28px;margin-bottom:4px">?</div>
                    <div style="font-size:10px;color:#94a3b8">${escapeHtml(nextCreature.name)} (${nextRarity})</div>
                </div>
            </div>
            <div style="display:flex;gap:8px">
                <div style="flex:1;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:8px;text-align:center">
                    <div style="font-size:20px;font-weight:800;color:#22c55e" id="mergeChanceDisplay">${baseChance}%</div>
                    <div style="font-size:10px;color:#86efac">Шанс успеха</div>
                </div>
                <div style="flex:1;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:8px;text-align:center">
                    <div style="font-size:20px;font-weight:800;color:#ef4444" id="mergeFailDisplay">${100-baseChance}%</div>
                    <div style="font-size:10px;color:#fca5a5">Провал</div>
                </div>
            </div>
        </div>

        ${hasDustBoost ? `
        <div style="background:#0d1120;border:1px solid #2e1b4a;border-radius:14px;padding:14px;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="font-size:12px;font-weight:700;color:#a78bfa;display:flex;align-items:center;gap:5px">
                    <img src="https://ndammo.github.io/Mmodna/dust.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain"> Бонус пыли
                </div>
                <div style="font-size:11px;color:#7c3aed">У вас: ${userDust.toLocaleString()} 🌫️</div>
            </div>
            <input type="range" id="mergeDustSlider" min="0" max="${steps.length}" value="0"
                style="width:100%;accent-color:#7c3aed;cursor:pointer;height:6px;margin-bottom:10px"
                oninput="updateMergeSlider('${creatureId}', ${baseChance})">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <div style="font-size:11px;color:#c4b5fd">Бонус: <span id="mergeBonusLabel" style="font-weight:700;color:#a78bfa">Без пыли</span></div>
                <div style="font-size:11px;color:#c4b5fd">Стоимость: <span id="mergeCostLabel" style="font-weight:700">0 🌫️</span></div>
            </div>
            <div id="mergeDustAffordability" style="font-size:10px;color:#64748b;text-align:center">Двигайте ползунок для выбора бонуса</div>
        </div>
        <button class="popup-btn" id="mergeDustBtn" style="background:linear-gradient(135deg,#5b21b6,#7c3aed);margin-bottom:8px;opacity:0.4;pointer-events:none" onclick="executeMergeWithDust('${creatureId}')">
            <img src="https://ndammo.github.io/Mmodna/dust.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain">
            <span id="mergeDustBtnLabel">Выберите бонус пыли</span>
        </button>` : ''}

        <button class="popup-btn" style="background:linear-gradient(135deg,#16a34a,#22c55e);margin-bottom:8px"
            onclick="closeOverlay();executeMerge('${creatureId}', 0)">
            <i class="fa-solid fa-code-merge"></i> СЛИТЬ БЕЗ ПЫЛИ — ${baseChance}%
        </button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
}

function updateMergeSlider(creatureId, baseChance) {
    const creature = getCreature(creatureId);
    const rarityTable = MERGE_DUST_TABLE[creature?.rarity];
    if (!rarityTable) return;
    const steps = Object.keys(rarityTable).map(Number).sort((a,b)=>a-b);
    const slider = document.getElementById('mergeDustSlider');
    const idx = parseInt(slider.value);
    const userDust = state.user?.dust || 0;

    const bonusLabel = document.getElementById('mergeBonusLabel');
    const costLabel = document.getElementById('mergeCostLabel');
    const afford = document.getElementById('mergeDustAffordability');
    const btn = document.getElementById('mergeDustBtn');
    const btnLabel = document.getElementById('mergeDustBtnLabel');
    const chanceEl = document.getElementById('mergeChanceDisplay');
    const failEl = document.getElementById('mergeFailDisplay');

    if (idx === 0) {
        if (bonusLabel) bonusLabel.textContent = 'Без пыли';
        if (costLabel) costLabel.innerHTML = '0 🌫️';
        if (afford) afford.innerHTML = 'Двигайте ползунок для выбора бонуса';
        if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
        if (btnLabel) btnLabel.textContent = 'Выберите бонус пыли';
        if (chanceEl) chanceEl.textContent = baseChance + '%';
        if (failEl) failEl.textContent = (100 - baseChance) + '%';
        return;
    }

    const bonusPct = steps[idx - 1];
    const cost = rarityTable[bonusPct];
    const totalChance = Math.min(100, baseChance + bonusPct);
    const canAfford = userDust >= cost;

    if (bonusLabel) bonusLabel.innerHTML = `<span style="color:#a78bfa">+${bonusPct}%</span>`;
    if (costLabel) costLabel.innerHTML = `<span style="color:${canAfford ? '#a78bfa' : '#ef4444'}">${cost.toLocaleString()} 🌫️</span>`;
    if (chanceEl) chanceEl.textContent = totalChance + '%';
    if (failEl) failEl.textContent = (100 - totalChance) + '%';

    if (canAfford) {
        if (afford) afford.innerHTML = `<span style="color:#22c55e">✓ Достаточно пыли</span>`;
        if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
        if (btnLabel) btnLabel.innerHTML = `Слить +${bonusPct}% за ${cost.toLocaleString()} 🌫️ — <b>${totalChance}%</b>`;
    } else {
        const need = cost - userDust;
        if (afford) afford.innerHTML = `<span style="color:#ef4444">✗ Не хватает ${need.toLocaleString()} 🌫️</span>`;
        if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
        if (btnLabel) btnLabel.textContent = 'Не хватает пыли';
    }
}

function executeMergeWithDust(creatureId) {
    const creature = getCreature(creatureId);
    const rarityTable = MERGE_DUST_TABLE[creature?.rarity];
    if (!rarityTable) return;
    const steps = Object.keys(rarityTable).map(Number).sort((a,b)=>a-b);
    const slider = document.getElementById('mergeDustSlider');
    const idx = parseInt(slider?.value || '0');
    if (idx === 0) return;
    const bonusPct = steps[idx - 1];
    closeOverlay();
    executeMerge(creatureId, bonusPct);
}


async function executeMerge(creatureId, dustBonusPercent = 0) {
    if (state.isLoading) return;
    if (!canMerge(creatureId)) return;
    
    if (Date.now() - (lastMergeTimes.get(state.user?.telegramId) || 0) < 1000) {
        showToast('Слишком быстро! Подождите.', '⏳');
        return;
    }
    lastMergeTimes.set(state.user?.telegramId, Date.now());

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/merge', { creatureId, dustBonusPercent: Number(dustBonusPercent) || 0 });
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Merge failed', '❌'); return; }

    state.user = res.user;
    state.inventory = res.inventory;
    state.incomePerHour = res.incomePerHour;
    
    if (res.dustUsed > 0) showToast(`-${res.dustUsed.toLocaleString()} 🌫️ Пыль использована`, '✨');
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, null);
    updateHeader();
    renderCards();
    await loadUserStats();
    showMergeResultPopup(res.fromCreature, res.resultCreature, res.upgraded);
}

function showMergeResultPopup(from, to, success) {
    const fromC = getCreature(from.id) || from;
    const toC = getCreature(to.id) || to;
    const color = RARITY_COLORS[toC.rarity];

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="merge-popup-cards">
            <div class="merge-card-mini">${getIconHtml(fromC)}</div>
            <div class="merge-card-mini">${getIconHtml(fromC)}</div>
            <div class="merge-card-mini">${getIconHtml(fromC)}</div>
            <div class="merge-arrow"><i class="fa-solid fa-arrow-right"></i></div>
            <div class="merge-card-mini" style="border-color:${color};box-shadow:0 0 12px ${color}44;">${getIconHtml(toC)}</div>
        </div>
        <div class="popup-title" style="color:${color}">${escapeHtml(toC.name)}</div>
        <div class="popup-subtitle">${success ? '🎉 Эволюция успешна!' : '❌ Провал! Существо не изменилось'}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">${toC.rarity.toUpperCase()} ${success ? '▲ UPGRADED' : ''}</div>
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${toC.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
            <div class="popup-stat"><div class="popup-stat-val" style="color:${success ? '#22c55e' : '#94a3b8'}">${success ? '+РЕДКОСТЬ' : '=РЕДКОСТЬ'}</div><div class="popup-stat-label">Result</div></div>
        </div>
        <button class="popup-btn" onclick="closeOverlay()" style="${success ? 'background:linear-gradient(135deg,#16a34a,#22c55e)' : ''}">
            ${success ? 'ЭВОЛЮЦИЯ!' : 'ЗАКРЫТЬ'}
        </button>
    `;
    document.getElementById('overlay').classList.add('show');
    if (success) spawnStars(toC.rarity);
}

// ============================================================
// UPGRADE INVENTORY
// ============================================================
async function upgradeInventory() {
    if (state.isLoading) return;
    
    const cost = getUpgradeCost();
    if (state.serverBalance < cost) { showToast(`Need ${cost} MMO to upgrade!`, '❌'); return; }

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/upgrade-inventory');
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Error', '❌'); return; }

    state.user = res.user;
    updateServerSnapshot(state.user.balance, state.incomePerHour, null);
    updateHeader();
    renderCards();
    showToast(`+1 slot! Now ${state.user.inventorySlots} total`, '📦');
}

// ============================================================
// ADS
// ============================================================
let lastAdsUpdate = 0;
let adsUpdating = false;

async function updateAdsStatus() {
    if (adsUpdating) return;
    adsUpdating = true;
    
    try {
        const res = await apiRequest('GET', '/api/game/ads-status');
        if (res && res.success) {
            const adsRemainingEl = document.getElementById('adsRemaining');
            const adsTimerEl = document.getElementById('adsTimer');
            
            const available = res.adsAvailable !== undefined ? res.adsAvailable : (res.adsRemaining || 0);
            const maxAds = res.maxAdsPerDay || res.maxAdsAvailable || 10;
            
            if (adsRemainingEl) adsRemainingEl.textContent = `${available}/${maxAds}`;
            
            state.adsAvailable = available;
            state.maxAdsPerDay = maxAds;
            state.adsCooldown = res.cooldownSeconds || 0;
            
            if (available === 0 && res.nextRegenMinutes > 0) {
                if (adsTimerEl) { adsTimerEl.textContent = `+1 через ${res.nextRegenMinutes}м`; adsTimerEl.style.color = '#f59e0b'; }
            } else if (state.adsCooldown > 0) {
                if (adsTimerEl) { adsTimerEl.textContent = `${state.adsCooldown}s`; adsTimerEl.style.color = '#94a3b8'; }
            } else {
                if (adsTimerEl) { adsTimerEl.textContent = 'Ready'; adsTimerEl.style.color = '#22c55e'; }
            }
            
            const adsBtn = document.getElementById('adsBtn');
            if (adsBtn) {
                const canWatch = available > 0 && state.adsCooldown === 0;
                adsBtn.style.opacity = canWatch ? '1' : '0.5';
                adsBtn.disabled = !canWatch;
            }
            
            lastAdsUpdate = Date.now();
        }
    } catch (e) { console.error('updateAdsStatus error:', e); }
    finally { adsUpdating = false; }
}

async function watchAd() {
    if (state.isLoading) return;

    if (state.adsCooldown > 0) { showToast(`Реклама доступна через ${state.adsCooldown}с`, '⏳'); return; }
    if (state.adsAvailable <= 0) { showToast(`Нет доступной рекламы. Восстановление через час.`, '📺'); return; }

    const btn = document.getElementById('adsBtn');
    const timer = document.getElementById('adsTimer');
    
    if (btn) { btn.style.opacity = '0.5'; btn.disabled = true; }
    if (timer) timer.textContent = '...';

    showToast('Загрузка рекламы...', '📺');

    try {
        let waited = 0;
        while (typeof window.showGiga !== 'function' && waited < 3000) {
            await new Promise(r => setTimeout(r, 100));
            waited += 100;
        }

        if (typeof window.showGiga !== 'function') throw new Error('Рекламный SDK не загружен');

        await window.showGiga();
        
        const res = await apiRequest('POST', '/api/game/watch-ad');

        if (!res.success) {
            if (res.adsAvailable === 0 && res.nextRegenMinutes) showToast(`Нет рекламы. Следующая через ${res.nextRegenMinutes} мин.`, '⚠️');
            else showToast(res.message || 'Ошибка', '❌');
            if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
            if (timer) timer.textContent = 'Ready';
            return;
        }

        state.user = res.user;
        state.adsCooldown = res.cooldownSeconds || AD_COOLDOWN;
        state.adsAvailable = res.adsAvailable;
        
        updateServerSnapshot(state.user.balance, state.incomePerHour, null);
        updateHeader();
        await loadUserStats();
        
        const nextRegenText = res.nextRegenMinutes > 0 ? ` (ещё ${res.nextRegenMinutes} мин до +1)` : '';
        showToast(`+${AD_REWARD} MMO! Осталось рекламы: ${res.adsAvailable}/${res.maxAdsPerDay}${nextRegenText}`, '🎉');
        spawnFloatingMMO(AD_REWARD);
        
        if (res.kangarooUnlocked) {
            setTimeout(() => showToast('🦘 Получен Kangaroo Uncommon за 200 просмотров рекламы!', '🎉'), 1500);
        }
        
        updateAdsStatus(); 
        
        if (btn && res.adsAvailable > 0 && state.adsCooldown === 0) { btn.style.opacity = '1'; btn.disabled = false; }
        
    } catch (e) {
        console.error('Ad error:', e);
        showToast('Реклама не загрузилась, попробуйте ещё раз', '❌');
        if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
        if (timer) timer.textContent = 'Ready';
    }

    state.isLoading = false;
}

function updateAdsTimer() {
    if (!state.user) return;
    
    if (state.adsCooldown > 0) {
        state.adsCooldown--;
        const timerEl = document.getElementById('adsTimer');
        if (timerEl) timerEl.textContent = `${state.adsCooldown}s`;
        
        const btn = document.getElementById('adsBtn');
        if (btn && state.adsCooldown > 0) { btn.style.opacity = '0.5'; btn.disabled = true; }
    }
    
    if (state.adsCooldown === 0) {
        if (!lastAdsUpdate || Date.now() - lastAdsUpdate > 60000) { updateAdsStatus(); lastAdsUpdate = Date.now(); }
        
        const timerEl = document.getElementById('adsTimer');
        if (timerEl) { timerEl.textContent = 'Ready'; timerEl.style.color = '#22c55e'; }
        
        const btn = document.getElementById('adsBtn');
        if (btn && state.adsAvailable > 0) { btn.style.opacity = '1'; btn.disabled = false; }
    }
}

// ============================================================
// ENCYCLOPEDIA
// ============================================================
function showEncyclopedia() {
    const discovered = new Set(state.user?.discovered || []);
    const total = CREATURES.length;
    const found = discovered.size;

    const grouped = {};
    RARITY_ORDER.forEach(r => grouped[r] = []);
    CREATURES.forEach(c => { if (grouped[c.rarity]) grouped[c.rarity].push(c); });

    const sections = RARITY_ORDER.map(rarity => {
        if (!grouped[rarity].length) return '';
        const color = RARITY_COLORS[rarity];
        const items = grouped[rarity].map(c => {
            const isFound = discovered.has(c.id);
            return `<div class="coll-item ${isFound ? 'found' : 'not-found'}" style="${isFound ? `border-color:${color}44` : ''};cursor:pointer" onclick="showCreatureInfo('${c.id}')">
                <span style="font-size:22px;${isFound ? `filter:drop-shadow(0 0 6px ${color})` : ''}">${getIconHtml(c)}</span>
                <div class="coll-item-name">${isFound ? escapeHtml(c.name) : '???'}</div>
            </div>`;
        }).join('');
        return `<div style="margin-bottom:16px">
            <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">${rarity}</div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${items}</div>
        </div>`;
    }).join('');

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title" style="margin-bottom:4px">Encyclopedia</div>
        <div class="popup-subtitle">${found}/${total} creatures discovered</div>
        <div style="height:6px;background:#1e2d4a;border-radius:3px;margin-bottom:16px;overflow:hidden">
            <div style="height:100%;width:${(found/total*100).toFixed(0)}%;background:linear-gradient(90deg,#7c3aed,#06b6d4);border-radius:3px;transition:width 0.5s"></div>
        </div>
        <div style="max-height:50vh;overflow-y:auto;padding:4px">${sections}</div>
    `;
    document.getElementById('overlay').classList.add('show');
}

function showCreatureInfo(creatureId) {
    const c = getCreature(creatureId);
    if (!c) return;
    const discovered = new Set(state.user?.discovered || []);
    const isFound = discovered.has(creatureId);
    const color = RARITY_COLORS[c.rarity];
    const skill = window.ARENA_SKILLS_MAP?.[c.id] || null;
    const premiumBadge = c.premiumOnly
        ? `<div style="display:inline-block;background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed55;border-radius:8px;padding:3px 10px;font-size:10px;font-weight:700;margin-bottom:8px">💎 PREMIUM CAPSULE ONLY</div>`
        : '';
    const skillBlock = skill
        ? `<div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:10px;padding:10px;margin-top:8px;text-align:left">
               <div style="font-size:10px;color:#64748b;margin-bottom:4px">ARENA SKILL</div>
               <div style="font-size:13px;font-weight:700;color:#e2e8f0">${skill.name} <span style="color:#64748b;font-size:11px;font-weight:400">${Math.round(skill.chance * 100)}% chance</span></div>
               <div style="font-size:11px;color:#94a3b8;margin-top:3px">${skill.description}</div>
           </div>`
        : '';

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="showEncyclopedia()"><i class="fa-solid fa-arrow-left"></i></div>
        <div class="popup-icon">${getIconHtml(c, true, color)}</div>
        <div class="popup-title" style="color:${color}">${escapeHtml(c.name)}</div>
        <div class="popup-subtitle">${escapeHtml(c.desc || '')}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">${c.rarity.toUpperCase()} ${isFound ? '✓ DISCOVERED' : '🔒 UNDISCOVERED'}</div>
        ${premiumBadge}
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${c.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
            <div class="popup-stat"><div class="popup-stat-val">${c.rarity === 'legendary' ? '★★★★★' : c.rarity === 'epic' ? '★★★★' : c.rarity === 'rare' ? '★★★' : c.rarity === 'uncommon' ? '★★' : '★'}</div><div class="popup-stat-label">Power</div></div>
        </div>
        ${skillBlock}
    `;
    document.getElementById('overlay').classList.add('show');
}

// ============================================================
// MARKETPLACE
// ============================================================
function switchMarketplaceTab(tab) {
    document.querySelectorAll('.marketplace-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.marketplace-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`marketplace-${tab}`).classList.add('active');
    document.querySelector(`.marketplace-tab-btn[data-tab="${tab}"]`)?.classList.add('active');
    
    isMarketplaceTabActive = true;

    if (tab === 'buy') renderMarketplaceBuy();
    if (tab === 'sell') renderMarketplaceSell();
    if (tab === 'mylistings') renderMarketplaceMyListings();
}

function getDataHash(data) { return JSON.stringify(data); }

async function renderMarketplaceBuy() {
    const container = document.getElementById('marketplaceListings');
    if (!container) return;
    
    if (Date.now() < marketplaceCache.expiresAt && marketplaceCache.data) {
        renderMarketplaceListings(marketplaceCache.data);
        return;
    }
    
    container.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:12px">Loading...</div>`;

    const res = await apiRequest('GET', '/api/marketplace/listings');
    if (!res || !res.success) {
        container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px;font-size:12px">Error loading listings</div>`;
        return;
    }

    const listings = Array.isArray(res.listings) ? res.listings : [];
    const newHash = getDataHash(listings);
    
    if (marketplaceCache.hash === newHash && marketplaceCache.data) {
        marketplaceCache.expiresAt = Date.now() + 10000;
        renderMarketplaceListings(marketplaceCache.data);
        return;
    }
    
    marketplaceCache = { data: listings, hash: newHash, expiresAt: Date.now() + 10000 };
    renderMarketplaceListings(listings);
}

function renderMarketplaceListings(listings) {
    const container = document.getElementById('marketplaceListings');
    if (!container) return;
    
    // Сохраняем все листинги для фильтрации
    allMarketplaceListings = listings;
    
    // Применяем фильтр
    let filteredListings = [...listings];
    
    if (currentMarketplaceFilter === 'dust') {
        filteredListings = listings.filter(l => l.isDust === true);
    } else if (currentMarketplaceFilter !== 'all') {
        // Фильтр по редкости (только для существ, не для пыли)
        filteredListings = listings.filter(l => {
            if (l.isDust) return false;
            const c = getCreature(l.creatureId);
            return c && c.rarity === currentMarketplaceFilter;
        });
    }
    
    if (filteredListings.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">Нет лотов с выбранным фильтром</div>`;
        return;
    }

    const userLevel = state.user?.level || 1;
    container.innerHTML = filteredListings.map(l => {
        const isOwn = l.sellerTgId === state.user?.telegramId;
        const locked = !isOwn && userLevel < 5;

        if (l.isDust) {
            return `<div class="marketplace-listing">
                <div class="marketplace-listing-icon" style="background:#a78bfa11;border-color:#a78bfa44">
                    <img src="https://ndammo.github.io/Mmodna/dust.png" style="width:36px;height:36px;object-fit:contain" onerror="this.replaceWith(document.createTextNode('🌫️'))">
                </div>
                <div class="marketplace-listing-info">
                    <div class="marketplace-listing-name" style="color:#a78bfa">Пыль ×${l.dustAmount}</div>
                    <div class="marketplace-listing-seller">by ${escapeHtml(l.sellerName)}${isOwn ? ' (Вы)' : ''}</div>
                    <div class="marketplace-listing-rarity" style="color:#7c3aed;font-size:9px">${Math.round(l.price/l.dustAmount)} MMO/шт</div>
                </div>
                <div class="marketplace-listing-price">
                    <div class="marketplace-listing-amount">${l.price} MMO</div>
                    ${isOwn
                        ? `<button class="marketplace-cancel-btn" onclick="cancelMarketplaceListing('${l._id}')">ОТМЕНИТЬ</button>`
                        : locked
                            ? `<button class="marketplace-buy-btn" style="opacity:0.5;cursor:not-allowed" onclick="showToast('Маркет доступен с 5 уровня','🔒')">🔒 LVL 5</button>`
                            : `<button class="marketplace-buy-btn" style="background:linear-gradient(135deg,#7c3aed,#a855f7)" onclick="buyFromMarketplace('${l._id}', ${l.price}, null)">КУПИТЬ</button>`
                    }
                </div>
            </div>`;
        }

        const c = getCreature(l.creatureId);
        if (!c) return '';
        const color = RARITY_COLORS[c.rarity];

        return `<div class="marketplace-listing">
            <div class="marketplace-listing-icon" style="background:${color}11;border-color:${color}44">${getIconHtml(c)}</div>
            <div class="marketplace-listing-info">
                <div class="marketplace-listing-name">${escapeHtml(c.name)}</div>
                <div class="marketplace-listing-seller">by ${escapeHtml(l.sellerName)}${isOwn ? ' (You)' : ''}</div>
                <div class="marketplace-listing-rarity badge-${c.rarity}">${c.rarity}</div>
            </div>
            <div class="marketplace-listing-price">
                <div class="marketplace-listing-amount">${l.price}</div>
                ${isOwn
                    ? `<button class="marketplace-cancel-btn" onclick="cancelMarketplaceListing('${l._id}')">CANCEL</button>`
                    : locked
                        ? `<button class="marketplace-buy-btn" style="opacity:0.5;cursor:not-allowed" onclick="showToast('Маркет доступен с 5 уровня','🔒')">🔒 LVL 5</button>`
                        : `<button class="marketplace-buy-btn" onclick="buyFromMarketplace('${l._id}', ${l.price}, '${l.creatureId}')">BUY</button>`
                }
            </div>
        </div>`;
    }).join('');
}

async function renderMarketplaceSell() {
    const cards = document.getElementById('marketplaceSellCards');
    if (!cards) return;

    const userLevel = state.user?.level || 1;
    if (userLevel < 5) {
        cards.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px 20px">
            <div style="font-size:32px;margin-bottom:12px">🔒</div>
            <div style="color:#e2e8f0;font-weight:700;font-size:15px;margin-bottom:6px">Маркет доступен с 5 уровня</div>
            <div style="color:#64748b;font-size:12px">Ваш уровень: ${userLevel}</div>
        </div>`;
        return;
    }

    const dust = state.user?.dust || 0;
    const dustCard = `<div class="marketplace-sell-card" style="cursor:pointer;border-color:#a78bfa44;background:#a78bfa11" onclick="openDustSellModal(${dust})">
        <div class="marketplace-sell-card-icon"><img src="https://ndammo.github.io/Mmodna/dust.png" style="width:36px;height:36px;object-fit:contain" onerror="this.replaceWith(document.createTextNode('🌫️'))"></div>
        <div class="marketplace-sell-card-name" style="color:#a78bfa">Пыль</div>
        <div style="font-size:9px;color:#7c3aed">x${dust}</div>
        <div style="font-size:10px;color:#a78bfa;font-weight:600;margin-top:4px">ПРОДАТЬ</div>
    </div>`;

    const creatureCards = state.inventory.map(item => {
        const c = getCreature(item.creatureId);
        if (!c || !item.count) return '';
        
        // --- ДОБАВЛЯЕМ ПЕРЕМЕННЫЕ ДЛЯ РЕДКОСТИ ---
        const rarityText = c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1);
        const rarityColor = RARITY_COLORS[c.rarity] || '#94a3b8';
        // ---------------------------------------
        
        return `<div class="marketplace-sell-card" style="cursor:pointer" onclick="openSellModal('${item.creatureId}', '${c.name}', ${item.count})">
            <div class="marketplace-sell-card-icon">${getIconHtml(c)}</div>
            <div class="marketplace-sell-card-name">${escapeHtml(c.name)}</div>
            <!-- --- НОВЫЙ БЛОК С РЕДКОСТЬЮ --- -->
            <div style="font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${rarityColor}; background: ${rarityColor}22; padding: 2px 6px; border-radius: 10px; margin: 4px 0;">
                ${rarityText}
            </div>
            <!-- ---------------------------- -->
            <div style="font-size:9px; color:#4a5568">x${item.count}</div>
            <div style="font-size:10px; color:#06b6d4; font-weight:600; margin-top:4px">SET PRICE</div>
        </div>`;
    }).filter(Boolean).join('');

    cards.innerHTML = dustCard + (creatureCards || `<div style="grid-column:1/-1;text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">Нет существ для продажи</div>`);
}

function openSellModal(creatureId, creatureName, count) {
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">Sell ${escapeHtml(creatureName)}</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Set your listing price</div>
        <div class="price-input-modal">
            <div><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Price (MMO)</div>
            <input type="number" class="price-input-field" id="sellPriceInput" placeholder="Enter price" min="10" max="100000" value="100" oninput="updateFeeCalculator()"></div>
            <div class="fee-calculator">
                <div class="fee-row"><span class="fee-label">Your Price</span><span class="fee-value" id="priceDisplay">100</span></div>
                <div class="fee-row" style="color:#ef4444"><span class="fee-label">Platform Fee (10%)</span><span class="fee-value fee" id="feeDisplay">-10</span></div>
                <div class="fee-row total"><span>You Receive</span><span class="fee-value final" id="finalDisplay">90</span></div>
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#22c55e,#16a34a);margin-top:16px" onclick="confirmSellListing('${creatureId}')"><i class="fa-solid fa-check"></i> LIST FOR SALE</button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">CANCEL</button>
    `;
    document.getElementById('overlay').classList.add('show');
    updateFeeCalculator();
}

function openDustSellModal(maxDust) {
    if (maxDust < 1) { showToast('У вас нет пыли для продажи', '🌫️'); return; }
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">Продать пыль</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Доступно: <b>${maxDust}</b> <img src="https://ndammo.github.io/Mmodna/dust.png" style="width:14px;height:14px;vertical-align:middle" onerror="this.replaceWith(document.createTextNode('🌫️'))"></div>
        <div class="price-input-modal">
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Количество пыли</div>
                <input type="number" class="price-input-field" id="dustAmountInput" placeholder="Кол-во" min="1" max="${maxDust}" value="1" oninput="updateDustFeeCalculator(${maxDust})">
            </div>
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Цена за 1 пыль (MMO)</div>
                <input type="number" class="price-input-field" id="dustPriceInput" placeholder="Цена за 1 шт" min="3" value="3" oninput="updateDustFeeCalculator(${maxDust})">
            </div>
            <div class="fee-calculator" style="margin-top:12px">
                <div class="fee-row"><span class="fee-label">Итого</span><span class="fee-value" id="dustTotalDisplay">15</span></div>
                <div class="fee-row" style="color:#ef4444"><span class="fee-label">Комиссия (10%)</span><span class="fee-value fee" id="dustFeeDisplay">-2</span></div>
                <div class="fee-row total"><span>Получите</span><span class="fee-value final" id="dustFinalDisplay">13</span></div>
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#7c3aed,#a855f7);margin-top:16px" onclick="confirmDustSellListing()"><i class="fa-solid fa-check"></i> ВЫСТАВИТЬ ПЫЛЬ</button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
    updateDustFeeCalculator(maxDust);
}

function updateDustFeeCalculator(maxDust) {
    const amount = Math.max(1, Math.min(maxDust, parseInt(document.getElementById('dustAmountInput')?.value) || 1));
    const priceEach = Math.max(3, parseInt(document.getElementById('dustPriceInput')?.value) || 15);
    const total = amount * priceEach;
    const fee = Math.floor(total * 0.1);
    const el = (id) => document.getElementById(id);
    if (el('dustTotalDisplay')) el('dustTotalDisplay').textContent = total;
    if (el('dustFeeDisplay')) el('dustFeeDisplay').textContent = `-${fee}`;
    if (el('dustFinalDisplay')) el('dustFinalDisplay').textContent = total - fee;
}

async function confirmDustSellListing() {
    const amount = parseInt(document.getElementById('dustAmountInput')?.value) || 0;
    const priceEach = parseInt(document.getElementById('dustPriceInput')?.value) || 0;
    if (amount < 1) { showToast('Укажите количество пыли', '❌'); return; }
    if (priceEach < 3) { showToast('Минимальная цена 15 MMO за 1 пыль', '❌'); return; }
    const total = amount * priceEach;
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/marketplace/list', { isDust: true, dustAmount: amount, price: total });
    state.isLoading = false;
    if (!res?.success) { showToast(res?.message || 'Ошибка', '❌'); return; }
    if (state.user) state.user.dust = res.dust;
    closeOverlay();
    showToast(`Выставлено ${amount} пыли за ${total} MMO`, '✅');
    updateHeader();
    renderMarketplaceSell();
    marketplaceCache.expiresAt = 0;
    switchMarketplaceTab('mylistings');
}

function updateFeeCalculator() {
    const input = document.getElementById('sellPriceInput');
    if (!input) return;
    const price = Math.max(10, Math.min(100000, parseInt(input.value) || 0));
    const fee = Math.floor(price * 0.1);
    document.getElementById('priceDisplay').textContent = price;
    document.getElementById('feeDisplay').textContent = `-${fee}`;
    document.getElementById('finalDisplay').textContent = price - fee;
}

async function confirmSellListing(creatureId) {
    const input = document.getElementById('sellPriceInput');
    const price = Math.max(10, Math.min(100000, parseInt(input?.value) || 0));

    if (price < 10) { showToast('Price must be at least 10 MMO', '❌'); return; }

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/marketplace/list', { creatureId, price });
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Error listing', '❌'); return; }

    state.inventory = res.inventory;
    closeOverlay();
    const c = getCreature(creatureId);
    showToast(`${c?.name || 'Creature'} listed for ${price} MMO!`, '✅');
    renderCards();
    renderMarketplaceSell();
    marketplaceCache.expiresAt = 0;
    switchMarketplaceTab('mylistings');
}

async function renderMarketplaceMyListings() {
    const container = document.getElementById('marketplaceMyListings');
    if (!container) return;
    
    container.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:12px">Загрузка...</div>`;

    const res = await apiRequest('GET', '/api/marketplace/my-listings');
    if (!res || !res.success) { container.innerHTML = `<div class="empty-listings">Ошибка загрузки</div>`; return; }

    const listings = Array.isArray(res.listings) ? res.listings : [];
    if (!listings.length) { container.innerHTML = `<div class="empty-listings">У вас нет активных лотов</div>`; return; }

    container.innerHTML = listings.map(l => {
        const date = new Date(l.createdAt).toLocaleDateString();
        if (l.isDust) {
            return `<div class="marketplace-my-listing">
                <div class="marketplace-my-listing-icon" style="background:#a78bfa11;border-color:#a78bfa44">
                    <img src="https://ndammo.github.io/Mmodna/dust.png" style="width:36px;height:36px;object-fit:contain" onerror="this.replaceWith(document.createTextNode('🌫️'))">
                </div>
                <div class="marketplace-my-listing-info">
                    <div class="marketplace-my-listing-name" style="color:#a78bfa">Пыль ×${l.dustAmount}</div>
                    <div class="marketplace-my-listing-status">Выставлено ${date}</div>
                    <div style="font-size:9px;color:#7c3aed">${Math.round(l.price/l.dustAmount)} MMO/шт</div>
                </div>
                <div class="marketplace-my-listing-price">
                    <div class="marketplace-my-listing-amount">${l.price} MMO</div>
                    <button class="marketplace-cancel-btn" onclick="cancelMarketplaceListing('${l._id}')">ОТМЕНИТЬ</button>
                </div>
            </div>`;
        }
        const c = getCreature(l.creatureId);
        if (!c) return '';
        const color = RARITY_COLORS[c.rarity];
        return `<div class="marketplace-my-listing">
            <div class="marketplace-my-listing-icon" style="background:${color}11;border-color:${color}44">${getIconHtml(c)}</div>
            <div class="marketplace-my-listing-info">
                <div class="marketplace-my-listing-name">${escapeHtml(c.name)}</div>
                <div class="marketplace-my-listing-status">Listed ${date}</div>
                <div class="marketplace-listing-rarity badge-${c.rarity}">${c.rarity}</div>
            </div>
            <div class="marketplace-my-listing-price">
                <div class="marketplace-my-listing-amount">${l.price} MMO</div>
                <button class="marketplace-cancel-btn" onclick="cancelMarketplaceListing('${l._id}')">ОТМЕНИТЬ</button>
            </div>
        </div>`;
    }).join('');
}

async function cancelMarketplaceListing(listingId) {
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/marketplace/cancel', { listingId });
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Error', '❌'); return; }

    if (res.dust !== undefined && state.user) {
        state.user.dust = res.dust;
        updateHeader();
        showToast('Лот отменён, пыль возвращена', '✅');
    } else {
        state.inventory = res.inventory;
        renderCards();
        showToast('Listing cancelled, card returned', '✅');
    }
    marketplaceCache.expiresAt = 0;
    renderMarketplaceMyListings();
}

async function buyFromMarketplace(listingId, price, creatureId) {
    if (state.isLoading) return;
    if (state.serverBalance < price) { showToast(`Need ${price} MMO`, '❌'); return; }

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/marketplace/buy', { listingId });
    state.isLoading = false;

    if (!res.success) { showToast(res.message || 'Error buying', '❌'); return; }

    if (res.isDust) {
        if (state.user) state.user.dust = res.user?.dust ?? (state.user.dust || 0) + res.dustAmount;
        state.user = res.user;
        state.inventory = res.inventory || state.inventory;
        updateHeader();
        marketplaceCache.expiresAt = 0;
        renderMarketplaceBuy();
        showToast(`Куплено ${res.dustAmount} пыли за ${price} MMO!`, '✅');
        spawnFloatingMMO(-price);
        return;
    }

    state.user = res.user;
    state.inventory = res.inventory;
    state.incomePerHour = res.incomePerHour;

    updateServerSnapshot(state.user.balance, state.incomePerHour, null);

    const c = getCreature(creatureId);
    updateHeader();
    renderCards();
    await loadUserStats();
    marketplaceCache.expiresAt = 0;
    renderMarketplaceBuy();
    showToast(`Bought ${c?.name || 'creature'} for ${price} MMO!`, '✅');
    spawnFloatingMMO(-price);
}

// ============================================================
// LEADERBOARD
// ============================================================
async function renderLeaderboard() {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    if (!state.token) { list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">Loading...</div>`; return; }
    
    if (Date.now() < leaderboardCache.expiresAt && leaderboardCache.data) {
        renderLeaderboardData(leaderboardCache.data);
        return;
    }

    if (currentLeaderboardController) currentLeaderboardController.abort();
    currentLeaderboardController = new AbortController();

    const res = await apiRequest('GET', '/api/user/leaderboard', null, currentLeaderboardController.signal);
    if (!res || !res.success) { if (res !== null) list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">Ошибка сервера</div>`; return; }
    
    if (res.leaders) res.leaders = res.leaders.map(l => ({ ...l, telegramId: l.telegramId }));
    
    leaderboardCache = { data: res, expiresAt: Date.now() + 30 * 1000 };
    renderLeaderboardData(res);
    currentLeaderboardController = null;
}

function renderLeaderboardData(data) {
    const list = document.getElementById('leaderboardList');
    if (!list) return;
    
    const currentUserId = state.user?.telegramId;
    if (!currentUserId) return;
    
    const leaders = data.leaders || [];
    
    if (!leaders.length) { list.innerHTML = `<div class="empty-listings">No players yet</div>`; return; }
    
    list.innerHTML = leaders.map(l => {
        const rank = l.rank;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        const isMe = l.telegramId === currentUserId;
        
        return `<div class="lb-item ${isMe ? 'me' : ''}">
            <div class="lb-rank ${rankClass}">${rankIcon}</div>
            <div class="lb-avatar" style="background:${isMe ? '#a855f7' : '#4a5568'}33;border:1px solid ${isMe ? '#a855f7' : '#4a5568'}44;color:${isMe ? '#a855f7' : '#fff'}">${l.username[0]?.toUpperCase() || '?'}</div>
            <div class="lb-info">
                <div class="lb-name">${escapeHtml(l.username)} ${isMe ? '<span style="font-size:9px;color:#a855f7">(You)</span>' : ''}</div>
                <div class="lb-level" style="color:#22c55e">УР ${l.level} · ${getLevelTitle(l.level)}</div>
                <div class="lb-xp" style="font-size:9px;color:#22c55e">ОП: ${l.xp}/${l.level * 100}</div>
            </div>
            <div class="lb-score" style="display:flex;flex-direction:column;align-items:flex-end">
                <span style="font-size:14px;font-weight:700;color:#f59e0b">УР ${l.level}</span>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// FRIENDS
// ============================================================
async function inviteFriend() {
    const res = await apiRequest('GET', '/api/user/referrals');
    const link = res.referralLink || `https://t.me/your_bot?start=${state.user?.referralCode}`;

    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join DNA MMO and get bonus MMO!')}`);
    } else {
        try { await navigator.clipboard.writeText(link); showToast('Invite link copied!', '🔗'); } 
        catch { showToast(link, '🔗'); }
    }
}

async function renderFriendsList() {
    const container = document.getElementById('friendsList');
    if (!container) return;
    
    try {
        const res = await apiRequest('GET', '/api/user/referrals');
        if (!res || !res.success) {
            container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px"><i class="fa-solid fa-circle-exclamation"></i> Error loading friends</div>`;
            return;
        }
        
        const referrals = res.referrals || [];
        const qualifiedCount = res.referralCount || 0;
        
        const friendCountDisplay = document.getElementById('friendCountDisplay');
        if (friendCountDisplay) friendCountDisplay.textContent = `${qualifiedCount} друзей 5+ уровня из ${referrals.length}`;
        
        if (referrals.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px"><i class="fa-solid fa-user-plus" style="font-size:24px;margin-bottom:10px;display:block"></i>Нет друзей<br>Пригласите друзей и помогите им достичь 5 уровня!</div>`;
            return;
        }
        
        container.innerHTML = referrals.map(friend => {
            const date = new Date(friend.joinedAt);
            const formattedDate = date.toLocaleDateString();
            const isQualified = friend.level >= 5;
            
            return `<div style="background:#0d1120;border:1px solid ${isQualified ? '#22c55e' : '#1e2d4a'};border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <div style="width:40px;height:40px;background:${isQualified ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#1e2d4a,#0d1120)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:1px solid ${isQualified ? '#22c55e' : '#a855f744'}">👤</div>
                <div style="flex:1">
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0">${escapeHtml(friend.username)}</div>
                    <div style="font-size:10px;color:#4a5568">Уровень ${friend.level} • Присоединился ${formattedDate}</div>
                </div>
                <div style="text-align:right">
                    ${isQualified ? '<div style="font-size:11px;color:#22c55e;font-weight:600">✅ 5+ уровень</div>' : `<div style="font-size:11px;color:#f59e0b">📈 нужно ${5 - friend.level} ур.</div>`}
                    <div style="font-size:12px;font-weight:700;color:#a855f7">${formatNum(friend.balance)} MMO</div>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('renderFriendsList error:', e);
        container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">Ошибка загрузки друзей</div>`;
    }
}

// ============================================================
// РЕФЕРАЛЬНЫЕ НАГРАДЫ
// ============================================================
async function claimFriendReward(requiredFriends, creatureId, creatureName, creatureIcon) {
    if (state.isLoading) return;
    
    const currentFriends = state.user?.referralCount || 0;
    if (currentFriends < requiredFriends) { showToast(`Нужно ${requiredFriends} друзей 5+ уровня (у вас ${currentFriends})`, '❌'); return; }
    
    const rewardKey = `friend_reward_${requiredFriends}`;
    if (state.user?.completedSpecialQuests?.includes(rewardKey)) { showToast('Вы уже получили эту награду', 'ℹ️'); return; }
    
    state.isLoading = true;
    showToast('🔄 Получение награды...', '');
    
    const res = await apiRequest('POST', '/api/game/claim-friend-reward', { requiredFriends, creatureId });
    state.isLoading = false;
    
    if (!res.success) { showToast(res.message || 'Ошибка', '❌'); return; }
    
    state.user = res.user;
    state.inventory = res.inventory;
    state.incomePerHour = res.incomePerHour;
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, null);
    updateHeader();
    renderCards();
    await loadUserStats();
    updateFriendRewardButtons();
    renderSpecialQuests();
    
    showFriendRewardPopup(creatureName, creatureIcon);
}

function showFriendRewardPopup(creatureName, creatureIcon) {
    const colorMap = { 'Rare Wolf': '#3b82f6', 'Epic Wolf': '#a855f7', 'Legendary Wolf': '#f59e0b' };
    const color = colorMap[creatureName] || '#a855f7';
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <span class="popup-icon" style="filter:drop-shadow(0 0 16px ${color})">${creatureIcon || '🐺'}</span>
        <div class="popup-title" style="color:${color}">${escapeHtml(creatureName)}</div>
        <div class="popup-subtitle">Получен за ${creatureName === 'Legendary Wolf' ? '150' : creatureName === 'Epic Wolf' ? '50' : '10'} друзей 5+ уровня!</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">🎁 НАГРАДА</div>
        <button class="popup-btn" onclick="closeOverlay()">ОТЛИЧНО!</button>
    `;
    document.getElementById('overlay').classList.add('show');
    spawnStars('epic');
}

function updateFriendRewardButtons() {
    const currentQualified = state.user?.referralCount || 0;
    const completedQuests = new Set(state.user?.completedSpecialQuests || []);
    
    const rewards = [
        { friends: 10, creatureId: 'wolf_r', creatureName: 'Rare Wolf', creatureIcon: '🐺', rarity: 'rare', btnId: 'reward-10-btn', cardId: 'reward-10' },
        { friends: 50, creatureId: 'wolf_e', creatureName: 'Epic Wolf', creatureIcon: '🐺', rarity: 'epic', btnId: 'reward-50-btn', cardId: 'reward-50' },
        { friends: 150, creatureId: 'wolf_l', creatureName: 'Legendary Wolf', creatureIcon: '🐺', rarity: 'legendary', btnId: 'reward-150-btn', cardId: 'reward-150' }
    ];
    
    rewards.forEach(reward => {
        const btn = document.getElementById(reward.btnId);
        const card = document.getElementById(reward.cardId);
        if (!btn) return;
        
        const alreadyClaimed = completedQuests.has(`friend_reward_${reward.friends}`);
        
        if (alreadyClaimed) {
            btn.textContent = '✅ ПОЛУЧЕНО';
            btn.style.background = 'rgba(34,197,94,0.2)';
            btn.style.color = '#22c55e';
            btn.style.cursor = 'default';
            btn.disabled = true;
            if (card) card.style.opacity = '0.6';
        } else if (currentQualified >= reward.friends) {
            btn.textContent = '🎁 ЗАБРАТЬ';
            btn.style.background = `linear-gradient(135deg, #f59e0b, #d97706)`;
            btn.style.color = '#fff';
            btn.style.cursor = 'pointer';
            btn.disabled = false;
            btn.onclick = () => claimFriendReward(reward.friends, reward.creatureId, reward.creatureName, reward.creatureIcon);
            if (card) card.style.borderColor = `var(--${reward.rarity})`;
        } else {
            btn.textContent = `🔒 ${reward.friends} ДРУЗЕЙ 5+ УРОВНЯ`;
            btn.style.background = '#1a2540';
            btn.style.color = '#94a3b8';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
        }
    });
    
    renderFriendsList();
}

// ============================================================
// SPECIAL QUESTS
// ============================================================
function loadQuestStatusesFromStorage() {
    const saved = localStorage.getItem(QUESTS_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            for (const [questId, data] of Object.entries(parsed)) {
                if (data.expiresAt && data.expiresAt > Date.now()) {
                    const remainingSeconds = Math.ceil((data.expiresAt - Date.now()) / 1000);
                    questStatuses.set(questId, { status: data.status, expiresAt: data.expiresAt, timerId: null });
                    restartQuestTimer(questId, remainingSeconds);
                } else if (data.status === 'pending' && data.expiresAt && data.expiresAt <= Date.now()) {
                    questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
                    saveQuestStatusesToStorage();
                    if (document.getElementById('tab-special').classList.contains('active')) updateQuestButton(questId, 'available');
                } else if (data.status === 'available') {
                    questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
                }
            }
        } catch (e) { console.error('Ошибка загрузки статусов квестов:', e); }
    }
}

function saveQuestStatusesToStorage() {
    const toSave = {};
    for (const [questId, data] of questStatuses.entries()) toSave[questId] = { status: data.status, expiresAt: data.expiresAt || null };
    localStorage.setItem(QUESTS_STORAGE_KEY, JSON.stringify(toSave));
}

function restartQuestTimer(questId, remainingSeconds) {
    if (remainingSeconds <= 0) return;
    
    const timerId = setTimeout(async () => {
        const questData = questStatuses.get(questId);
        if (questData && questData.status === 'pending') {
            questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
            saveQuestStatusesToStorage();
            updateQuestButton(questId, 'available');
            const quest = SPECIAL_QUESTS.find(q => q.id === questId);
            if (quest) showToast(`✅ Квест "${quest.title}" выполнен! Нажмите "ЗАБРАТЬ" для получения награды.`, '🎁');
        }
    }, remainingSeconds * 1000);
    
    const questData = questStatuses.get(questId);
    if (questData) { questData.timerId = timerId; questStatuses.set(questId, questData); }
}

function clearAllQuestTimers() {
    for (const [questId, data] of questStatuses.entries()) { if (data.timerId) clearTimeout(data.timerId); }
    questStatuses.clear();
    localStorage.removeItem(QUESTS_STORAGE_KEY);
}

function getQuestTitle(questId) { const quest = SPECIAL_QUESTS.find(q => q.id === questId); return quest ? quest.title : 'квест'; }

function updateQuestButton(questId, status) {
    const questCard = document.querySelector(`.special-quest-card[data-quest-id="${questId}"]`);
    if (!questCard) return;
    const footer = questCard.querySelector('.special-quest-footer');
    if (!footer) return;
    const quest = SPECIAL_QUESTS.find(q => q.id === questId);
    if (!quest) return;
    
    const isCompleted = state.user?.completedSpecialQuests?.includes(questId);
    
    if (isCompleted) {
        footer.innerHTML = `<button class="special-quest-btn completed" disabled><i class="fa-solid fa-check"></i> ВЫПОЛНЕНО</button>`;
        return;
    }
    
    switch (status) {
        case 'pending':
            footer.innerHTML = `<button class="special-quest-btn pending" disabled style="background: #f59e0b; animation: pulse 1.5s infinite;"><i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ...</button>`;
            break;
        case 'available':
            footer.innerHTML = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${questId}')" style="background: linear-gradient(135deg, #eab308, #ca8a04); animation: pulse 1.5s infinite;"><i class="fa-solid fa-gift"></i> 🎁 ЗАБРАТЬ НАГРАДУ</button>`;
            break;
        default:
            if (quest.type === 'telegram_channel') {
                footer.innerHTML = `<button class="special-quest-btn" onclick="openChannelAndStartTimer('${quest.id}', '${quest.link}')"><i class="fa-brands fa-telegram"></i> ВЫПОЛНИТЬ</button>`;
            } else if (quest.type === 'custom_link') {
                footer.innerHTML = `<button class="special-quest-btn" onclick="openCustomLinkAndComplete('${quest.id}', '${quest.link}')"><i class="fa-solid fa-globe"></i> ВЫПОЛНИТЬ</button>`;
            } else if (quest.type === 'referral_count') {
                const currentFriends = state.user?.referralCount || 0;
                const required = quest.required_count || 1;
                if (currentFriends >= required) {
                    footer.innerHTML = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${questId}')"><i class="fa-solid fa-gift"></i> ЗАБРАТЬ (${currentFriends}/${required})</button>`;
                } else {
                    footer.innerHTML = `<button class="special-quest-btn locked" disabled><i class="fa-solid fa-lock"></i> НУЖНО ${required} ДРУЗЕЙ 5+ (${currentFriends})</button>`;
                }
            }
            break;
    }
}

function openChannelAndStartTimer(questId, channelLink) {
    if (channelLink) {
        if (window.Telegram?.WebApp && channelLink.includes('t.me')) window.Telegram.WebApp.openTelegramLink(channelLink);
        else window.open(channelLink, '_blank');
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) { showToast('Вы уже получили награду за этот квест', 'ℹ️'); return; }
    
    const existingStatus = questStatuses.get(questId);
    if (existingStatus && existingStatus.status === 'pending') {
        const remainingTime = existingStatus.expiresAt ? Math.ceil((existingStatus.expiresAt - Date.now()) / 1000) : 0;
        if (remainingTime > 0) { showToast(`Квест уже на проверке! Осталось ${remainingTime} секунд.`, '⏳'); return; }
    }
    
    if (existingStatus && existingStatus.status === 'available') { showToast('Квест уже выполнен! Нажмите "ЗАБРАТЬ НАГРАДУ".', '🎁'); updateQuestButton(questId, 'available'); return; }
    
    const expiresAt = Date.now() + 60000;
    questStatuses.set(questId, { status: 'pending', expiresAt: expiresAt, timerId: null });
    saveQuestStatusesToStorage();
    updateQuestButton(questId, 'pending');
    
    const timerId = setTimeout(async () => {
        const questData = questStatuses.get(questId);
        if (questData && questData.status === 'pending') {
            questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
            saveQuestStatusesToStorage();
            updateQuestButton(questId, 'available');
            showToast(`✅ Квест "${getQuestTitle(questId)}" выполнен! Нажмите "ЗАБРАТЬ" для получения награды.`, '🎁');
        }
    }, 60000);
    
    const questData = questStatuses.get(questId);
    questData.timerId = timerId;
    questStatuses.set(questId, questData);
    showToast('🔍 Проверка выполнения квеста... Подождите 60 секунд.', '⏳');
}

function openCustomLinkAndComplete(questId, link) {
    if (link) window.open(link, '_blank');
    
    if (state.user?.completedSpecialQuests?.includes(questId)) { showToast('Вы уже получили награду за этот квест', 'ℹ️'); return; }
    
    const existingStatus = questStatuses.get(questId);
    if (existingStatus && existingStatus.status === 'pending') {
        const remainingTime = existingStatus.expiresAt ? Math.ceil((existingStatus.expiresAt - Date.now()) / 1000) : 0;
        if (remainingTime > 0) { showToast(`Квест уже на проверке! Осталось ${remainingTime} секунд.`, '⏳'); return; }
    }
    
    if (existingStatus && existingStatus.status === 'available') { showToast('Квест уже выполнен! Нажмите "ЗАБРАТЬ НАГРАДУ".', '🎁'); updateQuestButton(questId, 'available'); return; }
    
    const expiresAt = Date.now() + 60000;
    questStatuses.set(questId, { status: 'pending', expiresAt: expiresAt, timerId: null });
    saveQuestStatusesToStorage();
    updateQuestButton(questId, 'pending');
    
    const timerId = setTimeout(async () => {
        const questData = questStatuses.get(questId);
        if (questData && questData.status === 'pending') {
            questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
            saveQuestStatusesToStorage();
            updateQuestButton(questId, 'available');
            showToast(`✅ Квест "${getQuestTitle(questId)}" выполнен! Нажмите "ЗАБРАТЬ" для получения награды.`, '🎁');
        }
    }, 60000);
    
    const questData = questStatuses.get(questId);
    questData.timerId = timerId;
    questStatuses.set(questId, questData);
    showToast('🔍 Проверка выполнения квеста... Подождите 60 секунд.', '⏳');
}

async function claimSpecialQuest(questId) {
    if (state.isLoading) return;
    
    const questStatus = questStatuses.get(questId);
    if (questStatus && questStatus.status !== 'available') {
        if (questStatus && questStatus.status === 'pending') {
            const remainingTime = questStatus.expiresAt ? Math.ceil((questStatus.expiresAt - Date.now()) / 1000) : 0;
            if (remainingTime > 0) showToast(`Квест ещё на проверке! Осталось ${remainingTime} секунд.`, '⏳');
            else showToast('Квест ещё на проверке! Подождите немного.', '⏳');
        } else showToast('Сначала выполните квест!', '⚠️');
        return;
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) { showToast('Вы уже получили награду за этот квест', 'ℹ️'); return; }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/complete-special-quest', { questId });
    state.isLoading = false;
    
    if (!res.success) { showToast(res.message || 'Ошибка', '❌'); return; }
    
    state.user = res.user;
    updateServerSnapshot(state.user.balance, state.incomePerHour, null);
    updateHeader();
    await loadUserStats();
    
    const existing = questStatuses.get(questId);
    if (existing && existing.timerId) clearTimeout(existing.timerId);
    questStatuses.delete(questId);
    saveQuestStatusesToStorage();
    
    await renderSpecialQuests();
    showToast(`+${res.reward} MMO получено!`, '✅');
    spawnFloatingMMO(res.reward);
}

async function renderSpecialQuests() {
    const container = document.getElementById('specialQuestsList');
    if (!container) return;

    if (!SPECIAL_QUESTS.length) {
        container.innerHTML = `<div class="empty-grid" style="padding:40px;text-align:center">📢 Нет активных спец-квестов</div>`;
        return;
    }

    const completedQuests = new Set(state.user?.completedSpecialQuests || []);
    const filteredQuests = SPECIAL_QUESTS.filter(q => q.type === 'telegram_channel' || q.type === 'referral_count' || q.type === 'custom_link');
    
    if (filteredQuests.length === 0) {
        container.innerHTML = `<div class="empty-grid" style="padding:40px;text-align:center">📢 Скоро появятся новые квесты!</div>`;
        return;
    }
    
    for (const [questId, data] of questStatuses.entries()) {
        if (data.status === 'pending' && data.expiresAt && data.expiresAt <= Date.now()) {
            questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
            saveQuestStatusesToStorage();
        }
    }
    
    container.innerHTML = filteredQuests.map(quest => {
        const isCompleted = completedQuests.has(quest.id);
        const questStatus = questStatuses.get(quest.id);
        
        let actionHtml = '';
        
        if (isCompleted) {
            actionHtml = `<button class="special-quest-btn completed" disabled><i class="fa-solid fa-check"></i> ВЫПОЛНЕНО</button>`;
        } else if (questStatus && questStatus.status === 'pending') {
            const remainingTime = questStatus.expiresAt ? Math.ceil((questStatus.expiresAt - Date.now()) / 1000) : 60;
            const remainingText = remainingTime > 0 ? ` (${remainingTime}с)` : '';
            actionHtml = `<button class="special-quest-btn pending" disabled style="background: #f59e0b; animation: pulse 1.5s infinite;"><i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ${remainingText}</button>`;
        } else if (questStatus && questStatus.status === 'available') {
            actionHtml = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${quest.id}')" style="background: linear-gradient(135deg, #eab308, #ca8a04); animation: pulse 1.5s infinite;"><i class="fa-solid fa-gift"></i> 🎁 ЗАБРАТЬ НАГРАДУ</button>`;
        } else {
            switch (quest.type) {
                case 'telegram_channel':
                    actionHtml = `<button class="special-quest-btn" onclick="openChannelAndStartTimer('${quest.id}', '${quest.link}')"><i class="fa-brands fa-telegram"></i> ВЫПОЛНИТЬ</button>`;
                    break;
                case 'custom_link':
                    actionHtml = `<button class="special-quest-btn" onclick="openCustomLinkAndComplete('${quest.id}', '${quest.link}')"><i class="fa-solid fa-globe"></i> ВЫПОЛНИТЬ</button>`;
                    break;
                case 'referral_count':
                    const currentFriends = state.user?.referralCount || 0;
                    const required = quest.required_count || 1;
                    if (currentFriends >= required) {
                        actionHtml = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${quest.id}')"><i class="fa-solid fa-gift"></i> ЗАБРАТЬ (${currentFriends}/${required})</button>`;
                    } else {
                        actionHtml = `<button class="special-quest-btn locked" disabled><i class="fa-solid fa-lock"></i> НУЖНО ${required} ДРУЗЕЙ 5+ (${currentFriends})</button>`;
                    }
                    break;
            }
        }
        
        return `<div class="special-quest-card" data-quest-id="${quest.id}">
            <div class="special-quest-header">
                <div class="special-quest-icon">${quest.icon || '🎯'}</div>
                <div class="special-quest-info">
                    <div class="special-quest-title">${escapeHtml(quest.title)}</div>
                    <div class="special-quest-desc">${escapeHtml(quest.description || '')}</div>
                </div>
                <div class="special-quest-reward">+${quest.reward} MMO</div>
            </div>
            <div class="special-quest-footer">${actionHtml}</div>
        </div>`;
    }).join('');
    
    if (window.questTimerInterval) clearInterval(window.questTimerInterval);
    window.questTimerInterval = setInterval(() => {
        const pendingButtons = document.querySelectorAll('.special-quest-btn.pending');
        if (pendingButtons.length === 0) { if (window.questTimerInterval) clearInterval(window.questTimerInterval); return; }
        
        for (const btn of pendingButtons) {
            const card = btn.closest('.special-quest-card');
            if (card) {
                const questId = card.dataset.questId;
                const questStatus = questStatuses.get(questId);
                if (questStatus && questStatus.expiresAt) {
                    const remaining = Math.ceil((questStatus.expiresAt - Date.now()) / 1000);
                    if (remaining > 0) btn.innerHTML = `<i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ (${remaining}с)`;
                    else btn.innerHTML = `<i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ...`;
                }
            }
        }
    }, 1000);
}

// ============================================================
// DEPOSIT & WITHDRAW
// ============================================================

async function showDepositModal() {
    if (state.isLoading) return;
    
    const activeCount = await checkActiveRequests();
    if (activeCount >= MAX_ACTIVE_REQUESTS) { showToast(`У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок. Дождитесь обработки.`, '⚠️'); return; }
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💎 Пополнение баланса</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Минимальная сумма: ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO</div>
        <div class="price-input-modal">
            <div><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Сумма (MMO)</div><input type="number" class="price-input-field" id="depositAmount" placeholder="Введите сумму" min="${MIN_TRANSACTION_AMOUNT}"></div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#06b6d4,#0891b2);margin-top:16px" onclick="getPaymentDetails()"><i class="fa-solid fa-arrow-down"></i> ПРОДОЛЖИТЬ</button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function getPaymentDetails() {
    const amountInput = document.getElementById('depositAmount');
    const amount = parseInt(amountInput?.value);
    
    if (!amount || amount < MIN_TRANSACTION_AMOUNT) { showToast(`Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO`, '❌'); return; }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/wallet/get-payment-details', { amount });
    state.isLoading = false;
    
    if (!res.success) { showToast(res.message || 'Ошибка', '❌'); return; }
    
    currentPaymentMemo = res.memo;
    currentPaymentAmount = res.amount;
    showPaymentDetails(res.wallet, res.memo, res.amount);
}

function showPaymentDetails(wallet, memo, amount) {
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💎 Оплатите депозит</div>
        <div class="popup-subtitle">Сумма: ${amount.toLocaleString()} MMO</div>
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:16px;padding:16px;margin-bottom:16px">
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">💰 Сумма в MMO</div>
                <div style="font-family:'Orbitron',monospace;font-size:18px;font-weight:700;color:#f59e0b">${amount.toLocaleString()} MMO</div>
            </div>
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">🏦 Кошелек</div>
                <div style="background:#080b14;padding:10px;border-radius:10px;font-family:monospace;font-size:11px;word-break:break-all;border:1px solid #1e2d4a">${wallet}</div>
                <button onclick="copyToClipboard('${wallet}')" style="margin-top:6px;padding:4px 10px;background:#1a2540;border:none;border-radius:6px;color:#94a3b8;font-size:10px;cursor:pointer"><i class="fa-regular fa-copy"></i> Копировать кошелек</button>
            </div>
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">📝 Мемо (ОБЯЗАТЕЛЬНО!)</div>
                <div style="background:#080b14;padding:10px;border-radius:10px;font-family:monospace;font-size:11px;font-weight:700;color:#06b6d4;border:1px solid #1e2d4a">${memo}</div>
                <button onclick="copyToClipboard('${memo}')" style="margin-top:6px;padding:4px 10px;background:#1a2540;border:none;border-radius:6px;color:#94a3b8;font-size:10px;cursor:pointer"><i class="fa-regular fa-copy"></i> Копировать мемо</button>
            </div>
            <div style="font-size:10px;color:#ef4444;background:rgba(239,68,68,0.1);padding:8px;border-radius:8px;margin-top:8px">
                ⚠️ <b>Важно!</b> Укажите мемо в комментарии к переводу!<br>
                После оплаты нажмите "Я ОПЛАТИЛ".
            </div>
        </div>
        <div style="display:flex;gap:10px">
            <button class="popup-btn" style="flex:1;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="createDepositRequestAfterPayment()">
                <i class="fa-solid fa-check"></i> Я ОПЛАТИЛ
            </button>
            <button class="popup-btn" style="flex:1;background:#1a2540;color:#e2e8f0" onclick="closeOverlay()">
                <i class="fa-solid fa-times"></i> ОТМЕНИТЬ
            </button>
        </div>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function createDepositRequestAfterPayment() {
    if (!currentPaymentMemo) {
        showToast('Ошибка: данные оплаты утеряны. Начните заново.', '❌');
        closeOverlay();
        return;
    }
    
    state.isLoading = true;
    showToast('Создание заявки...', '⏳');
    
    const res = await apiRequest('POST', '/api/wallet/create-deposit-request', { 
        memo: currentPaymentMemo
    });
    state.isLoading = false;
    
    if (!res.success) {
        showToast(res.message || 'Ошибка создания заявки', '❌');
        return;
    }
    
    closeOverlay();
    showToast('✅ Заявка создана! Администратор проверит платеж и начислит средства.', '✅');
    await checkActiveRequests();
    
    currentPaymentMemo = null;
    currentPaymentAmount = null;
}

function updateWithdrawSummary() {
    const COMMISSION = 2000;
    const input = document.getElementById('withdrawAmount');
    const summary = document.getElementById('withdrawSummary');
    const summaryAmount = document.getElementById('summaryAmount');
    const summaryTotal = document.getElementById('summaryTotal');
    if (!input || !summary) return;
    const amount = parseInt(input.value);
    if (!amount || amount < 1) { summary.style.display = 'none'; return; }
    summary.style.display = 'block';
    summaryAmount.textContent = amount.toLocaleString() + ' MMO';
    summaryTotal.textContent = (amount + COMMISSION).toLocaleString() + ' MMO';
}

async function showWithdrawModal() {
    if (state.isLoading) return;
    
    const activeCount = await checkActiveRequests();
    if (activeCount >= MAX_ACTIVE_REQUESTS) {
        showToast(`У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок. Дождитесь обработки.`, '⚠️');
        return;
    }
    
    const COMMISSION = 2000;
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💸 Вывод средств</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Минимальная сумма: ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO · Комиссия: 2,000 MMO</div>
        <div class="price-input-modal">
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Сумма вывода (MMO)</div>
                <input type="number" class="price-input-field" id="withdrawAmount" placeholder="Введите сумму" min="${MIN_TRANSACTION_AMOUNT}" oninput="updateWithdrawSummary()">
            </div>
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">TON Кошелек</div>
                <input type="text" class="price-input-field" id="withdrawWallet" placeholder="Введите TON адрес кошелька">
            </div>
        </div>
        <div id="withdrawSummary" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;margin-top:12px;font-size:13px;display:none;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="color:#94a3b8">Сумма вывода</span>
                <span id="summaryAmount" style="color:#e2e8f0">—</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="color:#94a3b8">Комиссия</span>
                <span style="color:#ef4444">-2,000 MMO</span>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;">
                <span style="color:#94a3b8;font-weight:700">Спишется с баланса</span>
                <span id="summaryTotal" style="color:#f87171;font-weight:700">—</span>
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#16a34a,#22c55e);margin-top:16px" onclick="createWithdrawRequest()">
            <i class="fa-solid fa-arrow-up"></i> ОТПРАВИТЬ ЗАЯВКУ
        </button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function createWithdrawRequest() {
    const amountInput = document.getElementById('withdrawAmount');
    const walletInput = document.getElementById('withdrawWallet');
    
    const amount = parseInt(amountInput?.value);
    const wallet = walletInput?.value.trim();
    
    const WITHDRAW_COMMISSION = 2000;
    if (!amount || amount < MIN_TRANSACTION_AMOUNT) { showToast(`Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO`, '❌'); return; }
    if (!wallet || wallet.length < 20) { showToast('Введите корректный TON адрес кошелька (минимум 20 символов)', '❌'); return; }
    const totalNeeded = amount + WITHDRAW_COMMISSION;
    if (state.user?.balance < totalNeeded) { showToast(`Недостаточно средств. Нужно ${totalNeeded.toLocaleString()} MMO (${amount.toLocaleString()} + ${WITHDRAW_COMMISSION.toLocaleString()} комиссия). Ваш баланс: ${state.user.balance.toLocaleString()} MMO`, '❌'); return; }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/wallet/withdraw-request', { amount, wallet });
    state.isLoading = false;
    
    if (!res.success) { showToast(res.message || 'Ошибка создания заявки', '❌'); return; }
    
    closeOverlay();
    showToast(`Заявка на вывод ${amount.toLocaleString()} MMO создана! Комиссия 2,000 MMO списана. Ожидайте подтверждения.`, '✅');
    
    await refreshUserProfile();
    await checkActiveRequests();
}

async function checkActiveRequests() {
    try {
        const res = await apiRequest('GET', '/api/wallet/requests');
        if (res?.success) {
            const count = res.requests.length;
            const pendingDiv = document.getElementById('pendingRequests');
            if (pendingDiv) {
                if (count > 0) {
                    const requestsHtml = res.requests.map(req => `
                        <div style="background:#f59e0b22;border:1px solid #f59e0b44;border-radius:12px;padding:12px;margin-top:8px">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                    <div style="font-size:12px;font-weight:600;color:#f59e0b">
                                        ${req.type === 'deposit' ? '📥 Депозит' : '📤 Вывод'}
                                    </div>
                                    <div style="font-size:11px;color:#94a3b8">${req.amount.toLocaleString()} MMO</div>
                                    <div style="font-size:9px;color:#4a5568">${new Date(req.createdAt).toLocaleString()}</div>
                                </div>
                                <div style="background:#f59e0b;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700">⏳ ОЖИДАНИЕ</div>
                            </div>
                        </div>
                    `).join('');
                    
                    pendingDiv.innerHTML = `
                        <div style="background:#f59e0b22;border:1px solid #f59e0b44;border-radius:12px;padding:10px;margin-top:10px">
                            <div style="font-size:11px;font-weight:600;color:#f59e0b;margin-bottom:8px">
                                <i class="fa-solid fa-clock"></i> Активных заявок: ${count}/${MAX_ACTIVE_REQUESTS}
                            </div>
                            ${requestsHtml}
                        </div>
                    `;
                } else {
                    pendingDiv.innerHTML = '';
                }
            }
            return count;
        }
    } catch (e) {
        console.error('checkActiveRequests error:', e);
    }
    return 0;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Скопировано!', '📋')).catch(() => showToast('Не удалось скопировать', '❌'));
}

// ============================================================
// ARENA - ИНИЦИАЛИЗАЦИЯ И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function initArenaWebhooks() {
    if (!window.Telegram?.WebApp) return;
    const tg = window.Telegram.WebApp;
    
    tg.onEvent('popupClosed', (event) => {
        if (event.button_id === 'accept') acceptBattleWebhook();
        else if (event.button_id === 'reject') rejectBattleWebhook();
    });
}

function showNativeBattleConfirmation(battleData) {
    const existingModal = document.getElementById('matchFoundModal');
    if (existingModal) {
        console.log('⚠️ Модалка уже открыта, не создаём новую');
        updateConfirmationModal({
            player1Confirmed: battleData.player1Confirmed,
            player2Confirmed: battleData.player2Confirmed
        });
        return;
    }
    
    console.log('🎯 Создаём новую модалку подтверждения', battleData);
    showBattleConfirmationModal(battleData);
}

function showBattleConfirmationModal(battleData) {
    const existingModal = document.getElementById('matchFoundModal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'matchFoundModal';
    modal.className = 'match-found-modal';
    
    // Соперник скрыт до начала боя
    const leagueIcons = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', diamond: '🏆' };

    const isPlayer1 = battleData.isPlayer1;
    const myConfirmed = isPlayer1 ? battleData.player1Confirmed : battleData.player2Confirmed;
    const opponentConfirmed = isPlayer1 ? battleData.player2Confirmed : battleData.player1Confirmed;
    
    modal.innerHTML = `
        <div class="match-found-card">
            <div class="match-found-header">
                <div class="match-found-icon">⚔️</div>
                <div class="match-found-title">БОЙ НАЙДЕН!</div>
            </div>
            <div class="match-found-content">
                <div class="opponent-info">
                    <div class="opponent-avatar" style="letter-spacing:2px;font-size:14px;">???</div>
                    <div class="opponent-details">
                        <div class="opponent-name">?????</div>
                        <div class="opponent-level">
                            <span>Уровень ???</span>
                            <span>⚔️ Соперник найден</span>
                        </div>
                    </div>
                </div>
                
                <div class="confirmation-status" id="confirmationStatus">
                    <div class="confirm-row">
                        <span>Вы:</span>
                        <span id="myConfirmStatus" class="${myConfirmed ? 'confirm-yes' : 'confirm-wait'}">${myConfirmed ? '✅ Принял' : '⏳ Ожидание'}</span>
                    </div>
                    <div class="confirm-row">
                        <span>Соперник:</span>
                        <span id="opponentConfirmStatus" class="${opponentConfirmed ? 'confirm-yes' : 'confirm-wait'}">${opponentConfirmed ? '✅ Принял' : '⏳ Ожидание'}</span>
                    </div>
                </div>
                
                <div class="prize-info">
                    <div class="prize-label"><i class="fa-solid fa-gift"></i> Призовой фонд</div>
                    <div class="prize-value">${battleData.prizePool.toLocaleString()} <small>MMO</small></div>
                </div>
                
                <div class="prize-info" style="border-color: rgba(124,58,237,0.3);">
                    <div class="prize-label"><i class="fa-solid fa-coins"></i> Ваша ставка</div>
                    <div class="prize-value" style="color: var(--accent3);">${battleData.entryFee.toLocaleString()} <small>MMO</small></div>
                </div>
                
                <div class="timer-badge">
                    <span><i class="fa-regular fa-clock"></i> Принять за 15 секунд</span>
                    <div class="timer-progress"><div class="timer-progress-fill"></div></div>
                </div>
                
                <div class="match-buttons" id="matchBtns">
                    <button class="match-btn-accept" onclick="acceptBattleFromModal('${battleData.battleId}')">
                        <i class="fa-solid fa-check"></i> ПРИНЯТЬ
                    </button>
                    <button class="match-btn-reject" onclick="rejectBattleFromModal('${battleData.battleId}')">
                        <i class="fa-solid fa-times"></i> ОТКЛОНИТЬ
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.timeoutId = setTimeout(() => {
        if (document.getElementById('matchFoundModal')) {
            rejectBattleFromModal(battleData.battleId);
        }
    }, 15000);
}

function updateConfirmationModal(data) {
    console.log('🔄 updateConfirmationModal вызван с данными:', data);
    
    const modal = document.getElementById('matchFoundModal');
    if (!modal) {
        console.log('❌ Модалка не найдена, возможно уже закрыта');
        return;
    }
    
    const isPlayer1 = arenaClient?.state.currentBattleIsPlayer1;
    const myConfirmed = isPlayer1 ? data.player1Confirmed : data.player2Confirmed;
    const opponentConfirmed = isPlayer1 ? data.player2Confirmed : data.player1Confirmed;
    
    const myEl = document.getElementById('myConfirmStatus');
    const oppEl = document.getElementById('opponentConfirmStatus');
    
    if (myEl) {
        myEl.textContent = myConfirmed ? '✅ Принял' : '⏳ Ожидание';
        myEl.className = myConfirmed ? 'confirm-yes' : 'confirm-wait';
    }
    if (oppEl) {
        oppEl.textContent = opponentConfirmed ? '✅ Принял' : '⏳ Ожидание';
        oppEl.className = opponentConfirmed ? 'confirm-yes' : 'confirm-wait';
    }
    
    if (myConfirmed && !opponentConfirmed) {
        const btns = document.getElementById('matchBtns');
        if (btns) {
            btns.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:8px;">⏳ Ожидаем соперника...</div>';
        }
    }
    
    if (myConfirmed && opponentConfirmed) {
        console.log('✅ Оба игрока подтвердили бой, закрываем модалку');
        if (modal.timeoutId) {
            clearTimeout(modal.timeoutId);
            modal.timeoutId = null;
        }
        
        modal.style.transition = 'opacity 0.3s ease';
        modal.style.opacity = '0';
        
        setTimeout(() => {
            if (modal && modal.remove) {
                modal.remove();
            }
        }, 500);
    }
}

function getLeagueName(league) {
    const leagueNames = {
        bronze: 'Бронзовой',
        silver: 'Серебряной',
        gold: 'Золотой',
        platinum: 'Платиновой',
        diamond: 'Алмазной'
    };
    return leagueNames[league] || 'Бронзовой';
}

async function acceptBattleFromModal(battleId) {
    const res = await apiRequest('POST', '/api/arena/accept-match', { battleId });
    if (res?.success) {
        const statusRes = await apiRequest('GET', '/api/arena/battle/status');
        if (statusRes?.success && statusRes.hasBattle) {
            updateConfirmationModal({
                player1Confirmed: statusRes.player1Confirmed,
                player2Confirmed: statusRes.player2Confirmed
            });
        }
        if (res.bothConfirmed) {
            const modal = document.getElementById('matchFoundModal');
            if (modal) modal.remove();
            if (arenaClient && statusRes?.timeLeft !== undefined) {
                arenaClient.startBattleTimer(statusRes.timeLeft);
            }
        }
    } else {
        showToast(res?.message || 'Ошибка при принятии боя', '❌');
    }
}

async function rejectBattleFromModal(battleId) {
    const modal = document.getElementById('matchFoundModal');
    if (modal) {
        if (modal.timeoutId) clearTimeout(modal.timeoutId);
        modal.remove();
    }
    
    const res = await apiRequest('POST', '/api/arena/reject-match', { battleId });
    if (res?.success) {
        arenaClient?.stopSearch();
        showToast('Бой отклонён', '⚠️');
        renderArenaFightTab();
    } else {
        showToast(res?.message || 'Ошибка', '❌');
    }
}

function showNativeBattleResult(isWin, prizePool, dustWin = 0, xpGained = 0, ratingChange = 0, entryFee = 0) {
    const overlay = document.getElementById('overlay');
    const popup = document.getElementById('popup');
    if (!overlay || !popup) return;

    const D = 'https://ndammo.github.io/Mmodna/dust.png';
    let html = '';
    html += '<div class="popup-close" onclick="closeOverlay(); renderArenaFightTab();"><i class="fa-solid fa-xmark"></i></div>';
    html += '<div style="text-align:center;padding:8px 0 4px;">';
    html += '<div style="font-size:64px;line-height:1;margin-bottom:10px;filter:drop-shadow(0 0 20px ' + (isWin ? '#fbbf24' : '#ef4444') + ');">' + (isWin ? '\uD83C\uDFC6' : '\uD83D\uDC80') + '</div>';
    html += '<div style="font-size:28px;font-weight:900;letter-spacing:2px;font-family:Orbitron,monospace;background:' + (isWin ? 'linear-gradient(135deg,#fbbf24,#f59e0b,#fde68a)' : 'linear-gradient(135deg,#ef4444,#dc2626,#fca5a5)') + ';-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:6px;">' + (isWin ? '\u041f\u041e\u0411\u0415\u0414\u0410!' : '\u041f\u041e\u0420\u0410\u0416\u0415\u041d\u0418\u0415') + '</div>';
    html += '<div style="font-size:13px;color:var(--text3);margin-bottom:4px;">' + (isWin ? '\uD83C\uDF89 \u041e\u0442\u043b\u0438\u0447\u043d\u0430\u044f \u0431\u0438\u0442\u0432\u0430!' : '\uD83D\uDCAA \u0412 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0440\u0430\u0437 \u043f\u043e\u0432\u0435\u0437\u0435\u0442!') + '</div>';
    html += '</div>';

    if (isWin) {
        html += '<div style="display:flex;flex-direction:column;gap:10px;margin:18px 0;">';
        html += '<div style="background:linear-gradient(135deg,#1a2e1a,#0d1f0d);border:1px solid #22c55e44;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div style="display:flex;align-items:center;gap:8px;color:#86efac;font-size:13px;"><i class="fa-solid fa-coins" style="color:#fbbf24"></i><span>\u0412\u044b\u0438\u0433\u0440\u044b\u0448</span></div>';
        html += '<span style="font-size:18px;font-weight:800;color:#4ade80;">+' + (prizePool || 0).toLocaleString() + ' MMO</span>';
        html += '</div>';
        if (dustWin > 0) {
            html += '<div style="background:linear-gradient(135deg,#1e1a2e,#130d1f);border:1px solid #a78bfa44;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
            html += '<div style="display:flex;align-items:center;gap:8px;color:#c4b5fd;font-size:13px;"><img src="' + D + '" style="width:16px;height:16px;vertical-align:middle" onerror="this.style.display=\'none\'"><span>\u041f\u044b\u043b\u044c</span></div>';
            html += '<span style="font-size:18px;font-weight:800;color:#a78bfa;">+' + dustWin + ' \uD83C\uDF2B\uFE0F</span>';
            html += '</div>';
        }
        if (xpGained > 0) {
            html += '<div style="background:linear-gradient(135deg,#1a2414,#0d1f18);border:1px solid #fbbf2444;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
            html += '<div style="display:flex;align-items:center;gap:8px;color:#fde68a;font-size:13px;"><i class="fa-solid fa-star" style="color:#fbbf24"></i><span>\u041e\u043f\u044b\u0442</span></div>';
            html += '<span style="font-size:18px;font-weight:800;color:#fde68a;">+' + xpGained + ' XP</span>';
            html += '</div>';
        }
        html += '<div style="background:linear-gradient(135deg,#1a1f2e,#0d1220);border:1px solid #60a5fa44;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div style="display:flex;align-items:center;gap:8px;color:#93c5fd;font-size:13px;"><i class="fa-solid fa-chart-line" style="color:#60a5fa"></i><span>\u0420\u0435\u0439\u0442\u0438\u043d\u0433</span></div>';
        html += '<span style="font-size:15px;font-weight:700;color:#60a5fa;">\u2191 +' + (ratingChange || 0) + '</span>';
        html += '</div>';
        html += '</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:10px;margin:18px 0;">';
        if (entryFee > 0) {
            html += '<div style="background:linear-gradient(135deg,#2e1a1a,#1f0d0d);border:1px solid #ef444444;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
            html += '<div style="display:flex;align-items:center;gap:8px;color:#fca5a5;font-size:13px;"><i class="fa-solid fa-coins" style="color:#ef4444"></i><span>\u041f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e</span></div>';
            html += '<span style="font-size:18px;font-weight:800;color:#f87171;">-' + (entryFee || 0).toLocaleString() + ' MMO</span>';
            html += '</div>';
        }
        if (xpGained > 0) {
            html += '<div style="background:linear-gradient(135deg,#1a2414,#0d1f18);border:1px solid #fbbf2444;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
            html += '<div style="display:flex;align-items:center;gap:8px;color:#fde68a;font-size:13px;"><i class="fa-solid fa-star" style="color:#fbbf24"></i><span>\u041e\u043f\u044b\u0442</span></div>';
            html += '<span style="font-size:18px;font-weight:800;color:#fde68a;">+' + xpGained + ' XP</span>';
            html += '</div>';
        }
        html += '<div style="background:linear-gradient(135deg,#2e1a1a,#1f0d0d);border:1px solid #ef444444;border-radius:14px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div style="display:flex;align-items:center;gap:8px;color:#fca5a5;font-size:13px;"><i class="fa-solid fa-arrow-trend-down" style="color:#ef4444"></i><span>\u0420\u0435\u0439\u0442\u0438\u043d\u0433</span></div>';
        html += '<span style="font-size:15px;font-weight:700;color:#f87171;">\u2193 -' + (ratingChange || 0) + '</span>';
        html += '</div>';
        html += '</div>';
    }

    html += '<button class="popup-btn" style="background:' + (isWin ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#1d4ed8,#1e40af)') + ';margin-top:4px;font-size:15px;font-weight:700;padding:14px;" onclick="closeOverlay(); renderArenaFightTab();">' + (isWin ? '\uD83C\uDFC6 \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c' : '\uD83D\uDD04 \u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430') + '</button>';

    popup.innerHTML = html;
    overlay.classList.add('show');
}


// ============================================================
// ARENA - UI ФУНКЦИИ
// ============================================================
function switchArenaTab(tab) {
    document.querySelectorAll('.arena-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.arena-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`arena-${tab}-tab`).classList.add('active');
    document.querySelector(`.arena-tab-btn[data-arena-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'team') renderArenaTeamInventory();
    if (tab === 'fight') renderArenaFightTab();
    if (tab === 'ranks') updateArenaRanksInfo();
    if (tab === 'history') renderArenaHistory();
}

async function renderArenaTeamInventory() {
    const container = document.getElementById('arenaTeamInventory');
    if (!container) return;

    const selectedTeam = arenaClient?.getSelectedTeam() || [];
    if (selectedTeam.length === 0 && !arenaClient?.state._teamLoaded && !arenaClient?.state._teamResetPending) {
        const teamRes = await apiRequest('GET', '/api/arena/team');
        if (teamRes?.success && teamRes.teamIds) {
            arenaClient.setSelectedTeam(teamRes.teamIds);
        }
        if (arenaClient) arenaClient.state._teamLoaded = true;
    }
    if (arenaClient?.state._teamResetPending) {
        arenaClient.state._teamResetPending = false;
        if (arenaClient) arenaClient.state._teamLoaded = false;
    }

    const currentSelected = arenaClient?.getSelectedTeam() || [];
    const level = state.user?.level || 1;

    container.innerHTML = state.inventory.map(item => {
        const c = getCreature(item.creatureId);
        if (!c) return '';

        const isSelected = currentSelected.includes(c.id);
        const isDisabled = !isSelected && currentSelected.length >= 3;
        const skill = window.ARENA_SKILLS_MAP?.[c.id] || null;
        const multiplier = RARITY_MULTIPLIERS[c.rarity] || 1;
        const hp  = Math.ceil((50 + (c.incomeBase * 2) + (level * 5)) * multiplier);
        const atk = Math.ceil((10 + (c.incomeBase / 2) + (level * 2)) * multiplier);
        const def = Math.ceil((5  + (c.incomeBase / 3) + (level * 1)) * multiplier);
        const selectedNum = isSelected ? currentSelected.indexOf(c.id) + 1 : 0;

        return `
        <div class="arena-list-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
             onclick="toggleArenaCreature('${c.id}')">
            <div class="arena-list-left">
                <div class="arena-list-icon">${getIconHtml(c)}</div>
                ${isSelected ? `<div class="arena-list-num">${selectedNum}</div>` : ''}
            </div>
            <div class="arena-list-info">
                <div class="arena-list-name">${escapeHtml(c.name)}
                    <span class="arena-list-rarity rarity-${c.rarity}">${c.rarity}</span>
                </div>
                <div class="arena-list-stats">
                    <span>❤️ ${hp}</span>
                    <span>⚔️ ${atk}</span>
                    <span>🛡️ ${def}</span>
                </div>
                ${skill ? `
                <div class="arena-list-skill">
                    <span class="arena-list-skill-name">${skill.name}</span>
                    <span class="arena-list-skill-chance">${Math.round(skill.chance * 100)}%</span>
                    <div class="arena-list-skill-desc">${skill.description}</div>
                </div>` : ''}
            </div>
            <div class="arena-list-check">
                ${isSelected ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-regular fa-circle"></i>'}
            </div>
        </div>`;
    }).join('');
}

function toggleArenaCreature(creatureId) {
    const team = arenaClient?.getSelectedTeam() || [];
    const index = team.indexOf(creatureId);
    if (index !== -1) team.splice(index, 1);
    else if (team.length < 3) team.push(creatureId);
    else { showToast('Нельзя выбрать больше 3 питомцев', '⚠️'); return; }
    arenaClient.setSelectedTeam(team);
    renderArenaTeamInventory();
}

async function saveArenaTeam() {
    const team = arenaClient?.getSelectedTeam() || [];
    if (team.length !== 3) { showToast('Нужно выбрать ровно 3 питомца', '⚠️'); return; }
    const res = await apiRequest('POST', '/api/arena/team', { team });
    if (res?.success) showToast('Команда сохранена!', '✅');
    else showToast(res?.message || 'Ошибка сохранения', '❌');
}

function resetArenaTeam() {
    if (arenaClient) {
        arenaClient.setSelectedTeam([]);
        arenaClient.state._teamResetPending = true;
        renderArenaTeamInventory();
        showToast('Команда сброшена', '🗑️');
    }
}

async function findMatch() {
    if (findingMatch) { 
        showToast('Поиск уже запущен...', '⏳'); 
        return; 
    }
    if (arenaClient?.isSearching()) { 
        showToast('Поиск уже идёт...', '⏳'); 
        return; 
    }
    
    const teamRes = await apiRequest('GET', '/api/arena/team');
    if (!teamRes?.success || teamRes.teamIds?.length !== 3) { 
        showToast('Сначала сохраните команду из 3 питомцев', '⚠️'); 
        return; 
    }

    if ((state.user?.level || 1) < 3) {
        showToast('Арена доступна с 3 уровня', '🔒');
        return;
    }

    if (!isArenaOpenClient()) {
        showArenaClosedModal();
        return;
    }

    if (state.arenaBattlesLeft <= 0) {
        showToast('Нет доступных боёв. Восстановление через час.', '⚔️');
        return;
    }
    
    findingMatch = true;
    try {
        arenaClient?.startSearch();
        const findBtn = document.getElementById('findMatchBtn');
        const searchStatus = document.getElementById('arenaSearchStatus');
        if (findBtn) { 
            findBtn.disabled = true; 
            findBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Поиск...'; 
        }
        if (searchStatus) searchStatus.innerHTML = '🔍 Поиск соперника...';
        
        const res = await apiRequest('POST', '/api/arena/find-match');
        if (!res?.success) {
            arenaClient?.stopSearch();
            showToast(res?.message || 'Ошибка поиска', '❌');
            if (findBtn) { 
                findBtn.disabled = false; 
                findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой'; 
            }
            if (searchStatus) searchStatus.innerHTML = '';
            // Если команда сброшена — переключаем на вкладку команды
            if (res?.teamReset) {
                setTimeout(() => switchArenaTab('team'), 500);
            }
        } else {
            // Обновляем счётчик боёв из ответа сервера
            if (res.battlesLeft !== undefined) {
                state.arenaBattlesLeft = res.battlesLeft;
                state.maxArenaBattles = res.maxArenaBattles || 10;
                const battlesEl = document.getElementById('arenaBattlesLeft');
                if (battlesEl) battlesEl.textContent = `${state.arenaBattlesLeft}/${state.maxArenaBattles}`;
            }
            if (res.isNew && searchStatus) {
                searchStatus.innerHTML = '⏳ В очереди поиска... <button onclick="cancelBattleSearch()" style="margin-left:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;">✕ Отменить</button>';
            }
        }
    } finally {
        findingMatch = false;
    }
}

async function cancelBattleSearch() {
    arenaClient?.stopSearch();
    const findBtn = document.getElementById('findMatchBtn');
    const searchStatus = document.getElementById('arenaSearchStatus');
    if (findBtn) { 
        findBtn.disabled = false; 
        findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой'; 
    }
    if (searchStatus) searchStatus.innerHTML = '';
    try { await apiRequest('POST', '/api/arena/cancel-search'); } catch(e) {}
    showToast('Поиск отменён', '⚠️');
}

async function surrenderBattle() {
    const battleId = arenaClient?.getBattleId();
    if (!battleId) {
        showToast('Нет активного боя', '⚠️');
        return;
    }
    if (!confirm('Сдаться? Противник получит победу и приз.')) return;
    try {
        const res = await apiRequest('POST', '/api/arena/surrender', { battleId });
        if (res?.success) {
            showToast('Вы сдались 🏳️', '⚠️');
        } else {
            showToast(res?.message || 'Ошибка при сдаче', '❌');
        }
    } catch(e) {
        showToast('Ошибка соединения', '❌');
    }
}

async function acceptBattleWebhook() {
    const battleId = arenaClient?.getBattleId();
    if (!battleId) return;
    const res = await apiRequest('POST', '/api/arena/accept-match', { battleId });
    if (res?.success) {
        closeOverlay();
        arenaClient?.setConfirmationShown(false);
        const modal = document.getElementById('matchFoundModal');
        if (modal) {
            if (modal.timeoutId) clearTimeout(modal.timeoutId);
            modal.remove();
        }
    }
}

async function rejectBattleWebhook() {
    const battleId = arenaClient?.getBattleId();
    if (!battleId) return;
    
    const modal = document.getElementById('matchFoundModal');
    if (modal) {
        if (modal.timeoutId) clearTimeout(modal.timeoutId);
        modal.remove();
    }
    
    const res = await apiRequest('POST', '/api/arena/reject-match', { battleId });
    
    if (res?.success) {
        arenaClient?.stopSearch();
        arenaClient?.setConfirmationShown(false);
        showToast(res.message || 'Бой отклонён, ставка возвращена', '⚠️');
        renderArenaFightTab();
    } else {
        showToast(res?.message || 'Ошибка при отклонении боя', '❌');
    }
}

function showSkillBanner(name, description) {
    const existing = document.getElementById('skillBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'skillBanner';
    banner.style.cssText = 'position:fixed;top:30%;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:12px 24px;border-radius:16px;font-weight:700;font-size:15px;z-index:9999;text-align:center;box-shadow:0 4px 20px rgba(124,58,237,0.5);animation:fadeInOut 2.5s ease forwards;pointer-events:none;';
    banner.innerHTML = `<div>${name}</div><div style="font-size:11px;opacity:0.85;margin-top:4px;">${description}</div>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2500);
}

// ============================================================
// MAKE ATTACK
// ============================================================
async function makeAttack(targetIndex) {
    if (!arenaClient?.isBattleActive()) { 
        showToast('Бой не активен', '⚠️'); 
        return; 
    }
    
    const battleId = arenaClient?.getBattleId();
    if (!battleId) { 
        showToast('ID боя не найден', '⚠️'); 
        return; 
    }

    if (makeAttack._inProgress) return;
    makeAttack._inProgress = true;
    
    const attackBtn = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${targetIndex}"] .arena-attack-btn`);
    
    try {
        if (attackBtn) {
            attackBtn.disabled = true;
            attackBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
        
        const res = await apiRequest('POST', '/api/arena/move', { battleId, targetIndex });
        
        if (!res?.success) {
            showToast(res?.message || 'Ошибка атаки', '❌');
            return;
        }

        if (res.stunSkipped) {
            showToast('😵 Питомец оглушён и пропускает ход!', '⚡');
            const isPlayer1 = arenaClient?.state.currentBattleIsPlayer1;
            updateBattleUIFromClient({
                myTeam: res.myTeam,
                opponentTeam: res.enemyTeam,
                currentTurn: res.currentTurn
            }, isPlayer1);
            return;
        }

        if (res.finished) {
            arenaClient?.endBattle(res.winnerId || null, res.prizePool || 0, res.dustWin || 0, res.xpGained || 0, res.ratingChange || 0, res.entryFee || 0);
            const isWin = !!res.winnerId && res.winnerId === arenaClient?.getCurrentUserId();
            showNativeBattleResult(isWin, res.prizePool || 0, res.dustWin || 0, res.xpGained || 0, res.ratingChange || 0, res.entryFee || 0);
            renderArenaFightTab();
        } else {
            const isPlayer1 = arenaClient?.state.currentBattleIsPlayer1;
            if (res.skillResult) {
                showSkillBanner(res.skillResult.skillName, res.skillResult.description);
                if (res.skillResult.poisoned) showToast('☠️ Противник отравлен на 3 хода!', '☠️');
            }
            if (res.poisonLog && res.poisonLog.length > 0) {
                const totalDmg = res.poisonLog.reduce((s, p) => s + p.dmg, 0);
                showToast(`☠️ Яд: -${totalDmg} HP у врагов`, '💀');
            }
            updateBattleUIFromClient({
                myTeam: res.myTeam,
                opponentTeam: res.enemyTeam,
                lastMove: res.lastMove,
                currentTurn: res.currentTurn,
                turnCount: res.turnCount
            }, isPlayer1);
            
            if (res.lastMove && res.lastMove.targetIndex !== undefined) {
                showDamageAnimation(res.lastMove.targetIndex, res.lastMove.damage, res.lastMove.isCrit, false);
            }
        }
    } catch(e) {
        showToast('Ошибка соединения', '❌');
    } finally {
        makeAttack._inProgress = false;
        if (attackBtn) {
            attackBtn.disabled = false;
            attackBtn.innerHTML = '⚔️ Атаковать';
        }
    }
}
makeAttack._inProgress = false;

// ============================================================
// RENDER ARENA FIGHT TAB
// ============================================================
async function renderArenaFightTab() {
    const statusContainer = document.getElementById('arenaFightStatus');
    const battleContainer = document.getElementById('arenaBattleContainer');
    
    if (arenaClient && state.token && !arenaClient.isConnected()) {
        arenaClient.connectSocket(state.token, API_URL);
        // Не ждём подключения — сокет поднимется асинхронно.
        // Данные для рендера берём через HTTP ниже, сокет нужен только для push-событий.
    }
    
    if (arenaClient?.isBattleActive()) {
        if (battleContainer) battleContainer.style.display = 'block';
        if (statusContainer) statusContainer.style.display = 'none';
        return;
    }
    
    try {
        const battleRes = await apiRequest('GET', '/api/arena/battle/status');
        
        if (!battleRes) {
            if (statusContainer) statusContainer.style.display = 'block';
            if (battleContainer) battleContainer.style.display = 'none';
            return;
        }
        
        if (battleRes.hasBattle === true && battleRes.status !== 'finished' && battleRes.status !== 'expired') {
            if (statusContainer) statusContainer.style.display = 'none';
            if (battleContainer) battleContainer.style.display = 'block';
            
            if (battleRes.status === 'waiting') {
                if (statusContainer) statusContainer.style.display = 'block';
                if (battleContainer) battleContainer.style.display = 'none';
                const findBtn = document.getElementById('findMatchBtn');
                if (findBtn) { findBtn.disabled = true; findBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Поиск...'; }
                const searchStatus = document.getElementById('arenaSearchStatus');
                if (searchStatus) searchStatus.innerHTML = '⏳ В очереди поиска... <button onclick="cancelBattleSearch()" style="margin-left:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;">✕ Отменить</button>';
            } else if (battleRes.status === 'active') {
                const justEnded = arenaClient?.state.battleEndedAt && (Date.now() - arenaClient.state.battleEndedAt < 8000);
                if (!arenaClient?.isBattleActive() && !justEnded) {
    arenaClient?.startBattle(
        battleRes.battleId, 
        battleRes.isPlayer1, 
        battleRes.myTeam, 
        battleRes.opponentTeam,
        battleRes.timeLeft
    );
    renderBattleInterface(battleRes);
}
            } else if (battleRes.status === 'pending_confirmation') {
                const myConfirmed = battleRes.isPlayer1 ? battleRes.player1Confirmed : battleRes.player2Confirmed;
                const modalAlreadyOpen = !!document.getElementById('matchFoundModal');
                if (!myConfirmed && !modalAlreadyOpen) {
                    arenaClient?.setConfirmationShown(true);
                    showNativeBattleConfirmation(battleRes);
                }
            }
        } else {
            if (statusContainer) statusContainer.style.display = 'block';
            if (battleContainer) battleContainer.style.display = 'none';
            
            arenaClient?.stopSearch();
            const findBtn = document.getElementById('findMatchBtn');
            if (findBtn) { findBtn.disabled = false; findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой'; }
            const searchStatus = document.getElementById('arenaSearchStatus');
            if (searchStatus) searchStatus.innerHTML = '';
            
            try {
                const leaderboardRes = await apiRequest('GET', '/api/arena/leaderboard');
                if (leaderboardRes?.success && leaderboardRes.myStats) {
                    const myLeague = leaderboardRes.myStats.league || 'bronze';
                    const leagueConfigs = {
    bronze: { entryFee: 10, prizePool: 15, dustWin: 1, name: '🥉 Бронзовая' },
    silver: { entryFee: 50, prizePool: 80, dustWin: 5, name: '🥈 Серебряная' },
    gold: { entryFee: 500, prizePool: 800, dustWin: 50, name: '🥇 Золотая' },
    platinum: { entryFee: 2000, prizePool: 3200, dustWin: 100, name: '💎 Платиновая' },
    diamond: { entryFee: 5000, prizePool: 8000, dustWin: 200, name: '🏆 Алмазная' }
};
                    const config = leagueConfigs[myLeague] || leagueConfigs.bronze;
                    
                    const entryFeeEl = document.getElementById('arenaEntryFee');
                    const prizePoolEl = document.getElementById('arenaPrizePool');
                    const leagueEl = document.getElementById('arenaLeague');

                    const entryRow = document.getElementById('arenaEntryFeeRow');
                    if (entryRow) entryRow.style.display = config.entryFee === 0 ? 'none' : '';
                    if (entryFeeEl) entryFeeEl.textContent = config.entryFee;
                    if (prizePoolEl) {
                        const dustImg = '<img src="https://ndammo.github.io/Mmodna/dust.png" style="width:13px;height:13px;vertical-align:middle;margin:0 2px" onerror="this.style.display=\'none\'">';
                        prizePoolEl.innerHTML = config.prizePool + ' <span style="font-size:11px;color:var(--text3)">+ ' + config.dustWin + dustImg + '</span>';
                    }
                    if (leagueEl) {
                        leagueEl.innerHTML = `<span class="arena-league-badge league-${myLeague}">${config.name}</span>`;
                    }
                }
            } catch (err) {
                console.error('Ошибка получения лиги:', err);
            }

            // Счётчик боёв арены
            try {
                const battlesRes = await apiRequest('GET', '/api/arena/battles-status');
                if (battlesRes?.success) {
                    state.arenaBattlesLeft = battlesRes.battlesLeft;
                    state.maxArenaBattles = battlesRes.maxArenaBattles || 10;
                }
            } catch (err) { /* тихо, некритично */ }
            const battlesEl = document.getElementById('arenaBattlesLeft');
            if (battlesEl) battlesEl.textContent = `${state.arenaBattlesLeft}/${state.maxArenaBattles}`;
            
            const teamRes = await apiRequest('GET', '/api/arena/team');
            if (teamRes?.success && teamRes.team) {
                const teamContainer = document.getElementById('arenaCurrentTeam');
                if (teamContainer) {
                    teamContainer.innerHTML = teamRes.team.map(creature => `
                        <div class="arena-current-creature">
                            <div class="arena-current-icon">${getIconHtml(creature)}</div>
                            <div class="arena-current-name">${escapeHtml(creature.name)}</div>
                        </div>
                    `).join('');
                }
                if (teamRes.teamIds && teamRes.teamIds.length === 3) {
                    arenaClient?.setSelectedTeam(teamRes.teamIds);
                }
            }
        }
    } catch (err) {
        console.error('renderArenaFightTab error:', err);
        if (statusContainer) statusContainer.style.display = 'block';
        if (battleContainer) battleContainer.style.display = 'none';
    }
}

// ============================================================
// RENDER BATTLE INTERFACE
// ============================================================
function renderBattleInterface(battleData) {
    const container = document.getElementById('arenaBattleContainer');
    if (!container) return;
    
    const statusContainer = document.getElementById('arenaFightStatus');
    if (statusContainer) statusContainer.style.display = 'none';
    container.style.display = 'block';
    
    const isPlayer1 = battleData.isPlayer1;
    const actualMyTeam = battleData.myTeam || (isPlayer1 ? battleData.player1Team : battleData.player2Team);
    const actualEnemyTeam = battleData.opponentTeam || (isPlayer1 ? battleData.player2Team : battleData.player1Team);
    
    if (!actualMyTeam || !actualEnemyTeam) {
        container.innerHTML = '<div class="arena-battle-container" style="text-align:center;padding:40px;color:red;">Ошибка загрузки боя</div>';
        return;
    }
    
    const isMyTurn = (battleData.currentTurn === 'player1' && isPlayer1) || 
                     (battleData.currentTurn === 'player2' && !isPlayer1);
    
    container.innerHTML = `
        <div class="arena-battle-container">
            <div class="arena-team-side">
                <div class="arena-side-title">⚔️ ВАША КОМАНДА</div>
                <div class="arena-creatures-row" id="arenaMyCreatures">
                    ${actualMyTeam.map((creature, idx) => `
                        <div class="arena-battle-creature ${!creature.isAlive ? 'dead' : ''}" data-creature-index="${idx}">
                            <div class="creature-icon">${getIconHtml(creature)}</div>
                            <div class="creature-name">${escapeHtml(creature.name)}</div>
                            <div class="creature-hp">❤️ ${creature.currentHp}/${creature.maxHp}</div>
                            <div class="arena-hp-bar"><div class="arena-hp-fill" style="width: ${(creature.currentHp / creature.maxHp) * 100}%"></div></div>
                            ${creature.skill ? `<div class="creature-skill-badge" title="${creature.skill.description}">${creature.skill.name}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="arena-battle-vs">VS</div>
            <div class="arena-team-side">
                <div class="arena-side-title">🛡️ КОМАНДА СОПЕРНИКА</div>
                <div class="arena-creatures-row" id="arenaEnemyCreatures">
                    ${actualEnemyTeam.map((creature, idx) => `
                        <div class="arena-battle-creature ${!creature.isAlive ? 'dead' : ''}" data-enemy-index="${idx}">
                            <div class="creature-icon">${getIconHtml(creature)}</div>
                            <div class="creature-name">${escapeHtml(creature.name)}</div>
                            <div class="creature-hp">❤️ ${creature.currentHp}/${creature.maxHp}</div>
                            <div class="arena-hp-bar"><div class="arena-hp-fill" style="width: ${(creature.currentHp / creature.maxHp) * 100}%"></div></div>
                            ${creature.skill ? `<div class="creature-skill-badge" title="${creature.skill.description}">${creature.skill.name}</div>` : ''}
                            ${isMyTurn && creature.isAlive ? `<button class="arena-attack-btn" data-enemy-idx="${idx}" onclick="makeAttack(${idx})">⚔️ Атаковать</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
     <div class="arena-battle-log" id="arenaBattleLog">
    ${battleData.battleLog && battleData.battleLog.length ? 
        battleData.battleLog.slice(-10).map(log => {
            const isMyTurn = (log.player === 'player1' && battleData.isPlayer1) || (log.player === 'player2' && !battleData.isPlayer1);
            const turnLabel = isMyTurn ? '⚔️ Мой ход' : '🛡️ Ход соперника';
            return `<div class="arena-log-entry ${log.isCrit ? 'crit' : ''}">${turnLabel}: ${log.attackerName || 'Питомец'} → ${log.targetName || 'Враг'}: ${log.damage} урона ${log.isCrit ? '💥 КРИТ!' : ''}</div>`;
        }).join('') : 
        '<div class="arena-log-entry">Бой начинается...</div>'}
</div>
            <div class="arena-battle-timer" id="arenaBattleTimer">⏱ ${battleData.timeLeft !== undefined ? battleData.timeLeft : 30}</div>
            <button class="arena-surrender-btn" onclick="surrenderBattle()"><i class="fa-solid fa-flag"></i> Сдаться</button>
        </div>
    `;
}

// ============================================================
// UPDATE BATTLE UI FROM CLIENT
// ============================================================
function updateBattleUIFromClient(data, isPlayer1) {
    if (!data) return;
    
    let myTeam, enemyTeam;
    
    if (data.player1Team && data.player2Team) {
        myTeam = isPlayer1 ? data.player1Team : data.player2Team;
        enemyTeam = isPlayer1 ? data.player2Team : data.player1Team;
    } else if (data.myTeam && data.opponentTeam) {
        myTeam = data.myTeam;
        enemyTeam = data.opponentTeam;
    } else {
        return;
    }
    
    if (!myTeam || !enemyTeam) return;
    
    // Обновляем ТОЛЬКО свою команду (без анимации урона)
    for (let i = 0; i < myTeam.length; i++) {
        const creature = myTeam[i];
        const creatureEl = document.querySelector(`#arenaMyCreatures .arena-battle-creature[data-creature-index="${i}"]`);
        if (creatureEl && creature) {
            const hpEl = creatureEl.querySelector('.creature-hp');
            const fillEl = creatureEl.querySelector('.arena-hp-fill');
            if (hpEl) hpEl.textContent = `❤️ ${Math.max(0, creature.currentHp)}/${creature.maxHp}`;
            if (fillEl) fillEl.style.width = `${(creature.currentHp / creature.maxHp) * 100}%`;
            if (!creature.isAlive) creatureEl.classList.add('dead');
            else creatureEl.classList.remove('dead');
        }
    }
    
    const isMyTurn = data.currentTurn && ((data.currentTurn === 'player1' && isPlayer1) || (data.currentTurn === 'player2' && !isPlayer1));
    
    // Обновляем команду соперника (обычно без кнопки атаки)
    for (let i = 0; i < enemyTeam.length; i++) {
        const creature = enemyTeam[i];
        const creatureEl = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${i}"]`);
        if (!creatureEl || !creature) continue;
        
        const oldHp = parseInt(creatureEl.querySelector('.creature-hp')?.textContent?.match(/[\d.]+/)?.[0] || creature.currentHp);
        const newHp = creature.currentHp;
        
        const hpEl = creatureEl.querySelector('.creature-hp');
        const fillEl = creatureEl.querySelector('.arena-hp-fill');
        if (hpEl) hpEl.textContent = `❤️ ${Math.max(0, creature.currentHp)}/${creature.maxHp}`;
        if (fillEl) fillEl.style.width = `${(creature.currentHp / creature.maxHp) * 100}%`;
        
        if (!creature.isAlive) {
            creatureEl.classList.add('dead');
        } else {
            creatureEl.classList.remove('dead');
        }
        
        // Если у врага уменьшилось HP — показываем анимацию урона
        if (oldHp > newHp && data.lastMove && data.lastMove.targetIndex === i) {
            const damage = oldHp - newHp;
            showDamageAnimation(i, damage, data.lastMove.isCrit || false, false);
        }
        
        const existingBtn = creatureEl.querySelector('.arena-attack-btn');
        const canAttack = isMyTurn && creature.isAlive && arenaClient?.isBattleActive();
        
        if (canAttack && !existingBtn) {
            const btn = document.createElement('button');
            btn.className = 'arena-attack-btn';
            btn.setAttribute('data-enemy-idx', i);
            btn.innerHTML = '⚔️ Атаковать';
            btn.onclick = (function(index) {
                return function() { makeAttack(index); };
            })(i);
            creatureEl.appendChild(btn);
        } else if (!canAttack && existingBtn) {
            existingBtn.remove();
        } else if (canAttack && existingBtn) {
            existingBtn.disabled = false;
            existingBtn.style.opacity = '1';
            existingBtn.innerHTML = '⚔️ Атаковать';
        }
    }
    
    // Обновляем лог боя
if (data.lastMove) {
    const logContainer = document.getElementById('arenaBattleLog');
    if (logContainer) {
        const logEntry = document.createElement('div');
        logEntry.className = `arena-log-entry ${data.lastMove.isCrit ? 'crit' : ''}`;
        const isMyTurn = (data.currentTurn === 'player1' && data.isPlayer1) || (data.currentTurn === 'player2' && !data.isPlayer1);
        const turnLabel = isMyTurn ? '⚔️ Мой ход' : '🛡️ Ход соперника';
        logEntry.innerHTML = `${turnLabel}: Нанесено ${data.lastMove.damage} урона ${data.lastMove.isCrit ? '💥 КРИТ!' : ''}`;
        logContainer.insertBefore(logEntry, logContainer.firstChild);
        if (logContainer.children.length > 10) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }
}
}

// ============================================================
// SHOW DAMAGE ANIMATION
// ============================================================
function showDamageAnimation(targetIndex, damage, isCrit, hitMy = false) {
    let el;
    if (hitMy) {
        el = document.querySelector(`#arenaMyCreatures .arena-battle-creature[data-creature-index="${targetIndex}"]`);
    } else {
        el = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${targetIndex}"]`);
    }

    if (!el) return;

    const damageDiv = document.createElement('div');
    damageDiv.className = `arena-damage-number ${isCrit ? 'crit' : ''}`;
    damageDiv.textContent = `-${damage}`;
    el.style.position = 'relative';
    el.appendChild(damageDiv);

    if (isCrit) {
        el.style.animation = 'damageShake 0.3s ease';
        setTimeout(() => { el.style.animation = ''; }, 300);
    }

    setTimeout(() => { if (damageDiv && damageDiv.remove) damageDiv.remove(); }, 1000);

    el.style.transition = 'background 0.1s ease';
    el.style.background = 'rgba(239, 68, 68, 0.3)';
    setTimeout(() => { if (el) el.style.background = ''; }, 150);
}

// ============================================================
// RENDER ARENA RANKING
// ============================================================
async function renderArenaRanking() {
    try {
        const res = await apiRequest('GET', '/api/arena/leaderboard');
        if (!res?.success) return;
        
        const myRatingEl = document.getElementById('arenaMyRating');
        const myWinsEl = document.getElementById('arenaMyWins');
        const myLossesEl = document.getElementById('arenaMyLosses');
        const myStreakEl = document.getElementById('arenaMyStreak');
        
        if (myRatingEl) myRatingEl.textContent = res.myStats?.rating || 1000;
        if (myWinsEl) myWinsEl.textContent = res.myStats?.wins || 0;
        if (myLossesEl) myLossesEl.textContent = res.myStats?.losses || 0;
        if (myStreakEl) myStreakEl.textContent = res.myStats?.streak || 0;
        
        const currentRating = res.myStats?.rating || 1000;
        const nextRatingRequired = res.nextRatingRequired;
        const currentLeagueRating = res.currentLeagueRating || 0;
        const nextLeague = res.nextLeague;
        
        const progressContainer = document.getElementById('arenaProgressContainer');
        const nextLeagueInfo = document.getElementById('arenaNextLeagueInfo');
        const progressFill = document.getElementById('arenaProgressFill');
        const currentRatingSpan = document.getElementById('arenaCurrentRating');
        const nextRatingSpan = document.getElementById('arenaNextRating');
        
        if (nextRatingRequired && nextLeague && progressContainer) {
            const leagueNamesRu = { silver: 'Серебряную', gold: 'Золотую', platinum: 'Платиновую', diamond: 'Алмазную' };
            const leagueName = leagueNamesRu[nextLeague] || nextLeague;
            if (nextLeagueInfo) nextLeagueInfo.innerHTML = `<span style="color: var(--legendary);">✨ ${leagueName} лига</span>`;
            
            const range = nextRatingRequired - currentLeagueRating;
            const progress = currentRating - currentLeagueRating;
            let percent = (progress / range) * 100;
            percent = Math.min(100, Math.max(0, percent));
            
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (currentRatingSpan) currentRatingSpan.textContent = `${currentRating}`;
            if (nextRatingSpan) nextRatingSpan.textContent = `${nextRatingRequired}`;
        } else if (progressContainer && res.myStats?.league === 'diamond') {
            if (nextLeagueInfo) nextLeagueInfo.innerHTML = '<span style="color: var(--mythic);">🏆 ВЫ В АЛМАЗНОЙ ЛИГЕ! 🏆</span>';
            if (progressFill) progressFill.style.width = '100%';
            if (currentRatingSpan) currentRatingSpan.textContent = `${currentRating}`;
            if (nextRatingSpan) nextRatingSpan.textContent = 'МАКСИМУМ';
        }
        
        const container = document.getElementById('arenaLeaderboardList');
        if (container && res.leaders) {
            const leagueDisplay = {
                bronze: { name: '🥉 Бронза', class: 'league-badge-bronze' },
                silver: { name: '🥈 Серебро', class: 'league-badge-silver' },
                gold: { name: '🥇 Золото', class: 'league-badge-gold' },
                platinum: { name: '💎 Платина', class: 'league-badge-platinum' },
                diamond: { name: '🏆 Алмаз', class: 'league-badge-diamond' }
            };
            
            container.innerHTML = res.leaders.map((player, idx) => {
                const rank = idx + 1;
                const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
                const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                const isMe = player.rating === res.myStats?.rating && player.name === (state.user?.username || state.user?.firstName);
                const league = player.league || 'bronze';
                const leagueInfo = leagueDisplay[league] || leagueDisplay.bronze;
                
                return `<div class="lb-item ${isMe ? 'me' : ''}">
                    <div class="lb-rank ${rankClass}">${rankIcon}</div>
                    <div class="lb-avatar" style="background: linear-gradient(135deg, var(--accent), var(--accent3));">
                        ${(player.name || '?')[0]?.toUpperCase() || '?'}
                    </div>
                    <div class="lb-info">
                        <div class="lb-name">
                            ${escapeHtml(player.name)} ${isMe ? '<span style="font-size:9px;color:var(--accent3)">(Вы)</span>' : ''}
                        </div>
                        <div class="lb-level">
                            УР ${player.level}
                            <span class="arena-league-badge-small ${leagueInfo.class}">${leagueInfo.name}</span>
                        </div>
                    </div>
                    <div class="lb-score">
                        <span>${player.rating}</span>
                        <span style="font-size:9px;">${player.wins}/${player.losses}</span>
                    </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        console.error('renderArenaRanking error:', err);
    }
}

// ============================================================
// ARENA RANKS TAB FUNCTIONS
// ============================================================
async function toggleRankDetailsCompact(rankId) {
    const details = document.getElementById(`rankCompactDetails-${rankId}`);
    const item = details?.closest('.rank-item-compact');
    
    if (details) {
        if (details.style.display === 'none') {
            details.style.display = 'block';
            item?.classList.add('expanded');
            await loadCompactRankPlayers(rankId);
        } else {
            details.style.display = 'none';
            item?.classList.remove('expanded');
        }
    }
}

async function loadCompactRankPlayers(league) {
    const container = document.getElementById(`${league}CompactList`);
    if (!container) return;
    
    container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text3); font-size: 10px;">Загрузка...</div>';
    
    try {
        const res = await apiRequest('GET', '/api/arena/leaderboard');
        if (res?.success && res.leaders) {
            const leaguePlayers = res.leaders.filter(p => (p.league || 'bronze') === league);
            
            if (leaguePlayers.length === 0) {
                container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text3); font-size: 10px;">Нет игроков в этой лиге</div>';
                return;
            }
            
            container.innerHTML = leaguePlayers.slice(0, 5).map(player => `
                <div class="compact-player-item">
                    <div class="compact-player-name">
                        <div class="compact-player-avatar">${(player.name || '?')[0].toUpperCase()}</div>
                        <span>${escapeHtml(player.name)}</span>
                    </div>
                    <div class="compact-player-rating">${player.rating}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text3); font-size: 10px;">Ошибка загрузки</div>';
        }
    } catch (err) {
        console.error(`Ошибка загрузки игроков лиги ${league}:`, err);
        container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text3); font-size: 10px;">Ошибка загрузки</div>';
    }
}

async function updateArenaRanksInfo() {
    try {
        const res = await apiRequest('GET', '/api/arena/leaderboard');
        if (!res?.success) return;
        
        const myStats = res.myStats;
        const myRating = myStats?.rating || 1000;
        const myLeague = myStats?.league || 'bronze';
        
        const leagueIcons = {
            bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', diamond: '🏆'
        };
        const leagueNames = {
            bronze: 'Бронзовая лига', silver: 'Серебряная лига', gold: 'Золотая лига',
            platinum: 'Платиновая лига', diamond: 'Алмазная лига'
        };
        
        const iconEl = document.getElementById('arenaCurrentRankIcon');
        const nameEl = document.getElementById('arenaCurrentRankName');
        const ratingEl = document.getElementById('arenaCurrentRankRating');
        const winsEl = document.getElementById('arenaRankWins');
        const lossesEl = document.getElementById('arenaRankLosses');
        const streakEl = document.getElementById('arenaRankStreak');
        
        if (iconEl) iconEl.textContent = leagueIcons[myLeague] || '🥉';
        if (nameEl) nameEl.textContent = leagueNames[myLeague] || 'Бронзовая лига';
        if (ratingEl) ratingEl.textContent = myRating;
        if (winsEl) winsEl.textContent = myStats?.wins || 0;
        if (lossesEl) lossesEl.textContent = myStats?.losses || 0;
        if (streakEl) streakEl.textContent = myStats?.streak || 0;
        
        const nextRatingRequired = res.nextRatingRequired;
        const currentLeagueRating = res.currentLeagueRating || 0;
        const nextLeague = res.nextLeague;
        
        const nextRankEl = document.getElementById('arenaNextRankName');
        const progressFill = document.getElementById('arenaRankProgressFill');
        const currentSpan = document.getElementById('arenaCurrentRankValue');
        const nextSpan = document.getElementById('arenaNextRankValue');
        
        if (nextRatingRequired && nextLeague) {
            const nextLeagueNames = {
                silver: 'Серебряная лига', gold: 'Золотая лига',
                platinum: 'Платиновая лига', diamond: 'Алмазная лига'
            };
            if (nextRankEl) nextRankEl.textContent = nextLeagueNames[nextLeague] || 'Следующая лига';
            
            const range = nextRatingRequired - currentLeagueRating;
            const progress = myRating - currentLeagueRating;
            let percent = (progress / range) * 100;
            percent = Math.min(100, Math.max(0, percent));
            
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (currentSpan) currentSpan.textContent = myRating;
            if (nextSpan) nextSpan.textContent = nextRatingRequired;
        } else if (myLeague === 'diamond') {
            if (nextRankEl) nextRankEl.innerHTML = '<span style="color: var(--mythic);">🏆 ВЫ В АЛМАЗНОЙ ЛИГЕ!</span>';
            if (progressFill) progressFill.style.width = '100%';
            if (currentSpan) currentSpan.textContent = myRating;
            if (nextSpan) nextSpan.textContent = 'МАКСИМУМ';
        }
    } catch (err) {
        console.error('updateArenaRanksInfo error:', err);
    }
}

// ============================================================
// ARENA HISTORY
// ============================================================
async function renderArenaHistory() {
    const container = document.getElementById('arenaHistoryList');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">⏳ Загрузка...</div>';
    
    try {
        const res = await apiRequest('GET', '/api/arena/history');
        if (!res?.success || !res.history?.length) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">📭 Нет завершённых боёв</div>';
            return;
        }
        
        const leagueIcons = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', diamond: '🏆' };
        
        container.innerHTML = res.history.map(b => {
            const date = new Date(b.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const icon = leagueIcons[b.league] || '⚔️';
            return `
            <div class="arena-history-item ${b.isWin ? 'win' : 'loss'}">
                <div class="history-result">${b.isWin ? '🏆' : '💀'}</div>
                <div class="history-info">
                    <div class="history-opponent">vs ${escapeHtml(b.opponent)}</div>
                    <div class="history-meta">${icon} ${date}</div>
                </div>
                <div class="history-prize ${b.isWin ? 'prize-win' : 'prize-loss'}">
                    ${b.isWin ? '+' : '-'}${b.isWin ? b.prizePool : (b.entryFee ?? b.prizePool ?? '?')} MMO
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${e.message}</div>`;
    }
}

// ============================================================
// NAVIGATION
// ============================================================
function switchTab(tab) {
    // Проверки ПЕРЕД переключением DOM
    if (tab === 'arena') {
        const userLevel = state.user?.level || 1;
        if (userLevel < 3) {
            showToast(`Арена доступна с 3 уровня (ваш: ${userLevel})`, '🔒');
            return;
        }
        if (!isArenaOpenClient()) {
            showArenaClosedModal();
            return;
        }
    }

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
    document.getElementById('mainContent').scrollTop = 0;
    isMarketplaceTabActive = (tab === 'shop');
    if (tab === 'leaderboard') { leaderboardCache = { data: null, expiresAt: 0 }; renderLeaderboard(); }
    if (tab === 'special') renderSpecialQuests();
    if (tab === 'wallet') { updateHeader(); checkActiveRequests(); loadUserStats(); loadStakingStatus(); }
    if (tab === 'shop') renderMarketplaceBuy();
    if (tab === 'friends') renderFriendsList();
    if (tab === 'arena') {
        if (arenaClient && state.token && !arenaClient.isConnected()) {
            arenaClient.connectSocket(state.token, API_URL);
        }
        renderArenaTeamInventory();
        renderArenaFightTab();
        renderArenaRanking();
    }
}

// ============================================================
// OVERLAY & TOAST
// ============================================================
function closeOverlay(e) { if (e && e.target !== document.getElementById('overlay')) return; document.getElementById('overlay').classList.remove('show'); }
function showToast(msg, icon = '') { const t = document.getElementById('toast'); t.textContent = (icon ? icon + ' ' : '') + msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

// ============================================================
// EFFECTS
// ============================================================
function spawnStars(rarity) {
    const count = rarity === 'legendary' || rarity === 'mythic' ? 8 : rarity === 'epic' ? 5 : 3;
    const icons = ['✨', '⭐', '🌟', '💫', '✦'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'star-burst';
            el.textContent = icons[Math.floor(Math.random() * icons.length)];
            el.style.left = (30 + Math.random() * 40) + '%';
            el.style.top = (20 + Math.random() * 40) + '%';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 900);
        }, i * 80);
    }
}

function spawnFloatingMMO(amount) {
    const el = document.createElement('div');
    el.className = 'float-mmo';
    el.textContent = `${amount > 0 ? '+' : ''}${amount} MMO`;
    el.style.left = '50%';
    el.style.top = '40%';
    el.style.transform = 'translateX(-50%)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
}

// ============================================================
// INIT
// ============================================================
async function initTelegramApp() {
    clearAllIntervals();
    showLoadingScreen(true);

    const tg = window.Telegram?.WebApp;
    if (tg) {
        tg.ready();
        tg.expand();
        if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
        if (tg.requestFullscreen) { try { await tg.requestFullscreen(); } catch (e) {} }
        setTimeout(() => { const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-area-inset-top')) || 55; document.querySelector('.header').style.paddingTop = (top + 40) + 'px'; }, 400);
        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
        setTimeout(() => { if (tg && typeof tg.expand === 'function') tg.expand(); }, 500);
        tg.setHeaderColor('#080b14');
        tg.setBackgroundColor('#080b14');
    }

    let initData = tg?.initData || '';
    let tgUser = tg?.initDataUnsafe?.user;
    let referralCode = null;
    if (tg?.initDataUnsafe?.start_param) referralCode = tg.initDataUnsafe.start_param;
    const urlParams = new URLSearchParams(window.location.search);
    if (!referralCode && urlParams.get('startapp')) referralCode = urlParams.get('startapp');
    if (!referralCode && urlParams.get('ref')) referralCode = urlParams.get('ref');

    if (!initData && window.location.hostname === 'localhost') {
        const mockUser = { id: 123456789, first_name: 'Test', username: 'testuser' };
        initData = `user=${encodeURIComponent(JSON.stringify(mockUser))}&hash=devhash`;
        tgUser = mockUser;
    }

    if (!initData) { showLoadingScreen(false); showToast('Открой игру через Telegram!', '⚠️'); return; }

    const loginRes = await apiRequest('POST', '/api/auth/login', { initData, referralCode });
    if (!loginRes.success) { showLoadingScreen(false); showToast(loginRes.message || 'Ошибка авторизации', '❌'); return; }

    state.token = loginRes.token;
state.user = loginRes.user;
state.inventory = loginRes.inventory || [];
state.incomePerHour = 0;

console.log('📦 Логин успешен:');

const profileRes = await apiRequest('GET', '/api/user/profile');
if (profileRes && profileRes.success) {
    state.user = profileRes.user;
    state.inventory = profileRes.inventory || [];
    state.incomePerHour = profileRes.incomePerHour || 0;
    state.serverBalance = state.user.balance;
    state.lastServerSync = Date.now();
    console.log('   - Баланс после профиля:', state.user.balance);
} else {
    state.serverBalance = state.user.balance;
    state.lastServerSync = Date.now();
}

await loadGameConfig();
await loadCreaturesFromServer();
    loadQuestStatusesFromStorage();
    updatePlayerInfo();
    showLoadingScreen(false);
    renderAll();
    startVisualTicker();
    startCollectIncomeLoop();
    startOptimizedIntervals();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (loginRes.isNewUser && referralCode) setTimeout(() => showToast('🎉 Добро пожаловать! Реферальный бонус: 2% от депозитов друга', '🎁'), 800);
    else if (loginRes.isNewUser) setTimeout(() => showToast('Open a DNA Capsule to start!', '🧬'), 800);
    setTimeout(() => { checkActiveRequests(); loadUserStats(); }, 1000);
    updateAdsStatus();
    
    arenaClient = window.arenaClient;
    if (arenaClient) {
        arenaClient.stopSearch();
        arenaClient.loadTeamFromStorage();
        // Устанавливаем userId явно, чтобы endBattle корректно определял победителя
        if (state.user) arenaClient.setCurrentUserId(state.user.id || state.user._id);
        arenaClient.connectSocket(state.token, API_URL);
        arenaClient.on('onMatchFound', (data) => showNativeBattleConfirmation(data));
        arenaClient.on('onBattleStartUI', (data) => {
            const confirmModal = document.getElementById('matchFoundModal');
            if (confirmModal) {
                if (confirmModal.timeoutId) clearTimeout(confirmModal.timeoutId);
                confirmModal.remove();
            }
            if (document.getElementById('overlay')?.classList.contains('show')) closeOverlay(); 
            renderBattleInterface(data);
        });
        arenaClient.on('onBattleUpdate', (data, isPlayer1) => {
            if (data.skillResult) {
                showSkillBanner(data.skillResult.skillName, data.skillResult.description);
            }
            updateBattleUIFromClient(data, isPlayer1);
        });
        arenaClient.on('onBattleEnd', (isWin, prizePool, dustWin = 0, xpGained = 0, ratingChange = 0, entryFee = 0) => { 
            showNativeBattleResult(isWin, prizePool, dustWin, xpGained, ratingChange, entryFee); 
            refreshUserProfile();
            setTimeout(() => {
                renderArenaFightTab();
                renderArenaRanking();
                renderArenaHistory();
            }, 1000);
        });
        arenaClient.on('onTimerTick', (timeLeft) => { 
            const timerEl = document.getElementById('arenaBattleTimer'); 
            if (timerEl) { 
                timerEl.textContent = `⏱ ${timeLeft}`; 
                if (timeLeft <= 5) timerEl.classList.add('warning'); 
                else timerEl.classList.remove('warning'); 
            } 
        });
        arenaClient.on('onSearchTimeout', () => { 
            const findBtn = document.getElementById('findMatchBtn'); 
            const searchStatus = document.getElementById('arenaSearchStatus'); 
            if (findBtn) { findBtn.disabled = false; findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой'; } 
            if (searchStatus) searchStatus.innerHTML = '⏱ Поиск отменён (таймаут)'; 
            showToast('Поиск занял слишком много времени, попробуйте снова', '⚠️'); 
        });
        arenaClient.on('onSearchTick', (secondsLeft) => { 
            const searchStatus = document.getElementById('arenaSearchStatus'); 
            if (searchStatus && arenaClient.isSearching()) { 
                searchStatus.innerHTML = `⏳ В очереди поиска... <span style="color:var(--text2);font-size:11px;">${secondsLeft}с</span> <button onclick="cancelBattleSearch()" style="margin-left:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;">✕ Отменить</button>`; 
            } 
        });
        arenaClient.on('onConnected', () => console.log('✅ WebSocket соединение установлено'));
        arenaClient.on('onDisconnected', (reason) => {
            console.log(`❌ WebSocket отключён: ${reason}`);
            if (reason === 'reconnect_failed' && (arenaClient?.isBattleActive() || arenaClient?.isSearching())) {
                showToast('Потеряно соединение с сервером. Обновите страницу.', '⚠️');
            }
        });
        arenaClient.on('onConfirmationUpdate', (data) => { updateConfirmationModal(data); });
        arenaClient.on('onMatchRejected', (data) => {
            const modal = document.getElementById('matchFoundModal');
            if (modal) {
                if (modal.timeoutId) clearTimeout(modal.timeoutId);
                const card = modal.querySelector('.match-found-card');
                if (card) card.innerHTML = `
                    <div style="text-align:center;padding:24px;">
                        <div style="font-size:36px;margin-bottom:12px;">❌</div>
                        <div style="font-size:16px;font-weight:700;color:#ef4444;margin-bottom:8px;">БОЙ ОТМЕНЁН</div>
                        <div style="color:#94a3b8;font-size:13px;">${data.message || 'Соперник отклонил бой. Ставка возвращена.'}</div>
                    </div>`;
                setTimeout(() => {
                    modal.remove();
                    arenaClient?.stopSearch();
                    arenaClient?.setConfirmationShown(false);
                    renderArenaFightTab();
                }, 2500);
            } else {
                showToast(data.message || 'Соперник отклонил бой', '❌');
                arenaClient?.stopSearch();
                arenaClient?.setConfirmationShown(false);
                renderArenaFightTab();
            }
        });
    }
    
    initArenaWebhooks();
    
    document.querySelectorAll('img').forEach(img => {
        img.addEventListener('contextmenu', (e) => { e.preventDefault(); return false; });
        img.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); });
    });
    window.addEventListener('beforeunload', () => { if (arenaClient) arenaClient.disconnectSocket(); });
    window.addEventListener('online', () => { if ((arenaClient?.isSearching() || arenaClient?.isBattleActive()) && !arenaClient?.isConnected()) arenaClient?.connectSocket(state.token, API_URL); });
    if (state.user) initRaid();
}

function renderAll() {
    updateHeader();
    renderCards();
    updateUpgradeButton();
    renderLeaderboard();
    renderSpecialQuests();
    updateFriendRewardButtons();
}

document.addEventListener('DOMContentLoaded', () => {
    initTelegramApp();
});

// ЭКСПОРТ ГЛОБАЛЬНЫХ ФУНКЦИЙ
window.updateHeader = updateHeader;
window.renderCards = renderCards;
window.renderLeaderboard = renderLeaderboard;
window.renderSpecialQuests = renderSpecialQuests;
window.renderFriendsList = renderFriendsList;
window.updateFriendRewardButtons = updateFriendRewardButtons;
window.renderMarketplaceBuy = renderMarketplaceBuy;
window.renderMarketplaceSell = renderMarketplaceSell;
window.renderMarketplaceMyListings = renderMarketplaceMyListings;
window.showToast = showToast;
window.state = state;
window.formatNum = formatNum;
window.getVisualBalance = getVisualBalance;
window.updateAdsStatus = updateAdsStatus;
window.switchTab = switchTab;
window.closeOverlay = closeOverlay;
window.showCapsuleModal = showCapsuleModal;
window.openCapsule = openCapsule;
window.onCardClick = onCardClick;
window.showMergePreview = showMergePreview;
window.executeMerge = executeMerge;
window.updateMergeSlider = updateMergeSlider;
window.executeMergeWithDust = executeMergeWithDust;
window.upgradeInventory = upgradeInventory;
window.watchAd = watchAd;
window.showEncyclopedia = showEncyclopedia;
window.showCreatureInfo = showCreatureInfo;
window.switchMarketplaceTab = switchMarketplaceTab;
window.openSellModal = openSellModal;
window.updateFeeCalculator = updateFeeCalculator;
window.confirmSellListing = confirmSellListing;
window.cancelMarketplaceListing = cancelMarketplaceListing;
window.buyFromMarketplace = buyFromMarketplace;
window.inviteFriend = inviteFriend;
window.claimFriendReward = claimFriendReward;
window.openChannelAndStartTimer = openChannelAndStartTimer;
window.claimSpecialQuest = claimSpecialQuest;
window.openCustomLinkAndComplete = openCustomLinkAndComplete;
window.showDepositModal = showDepositModal;
window.getPaymentDetails = getPaymentDetails;
window.createDepositRequestAfterPayment = createDepositRequestAfterPayment;
window.showWithdrawModal = showWithdrawModal;
window.forgeAttempt = forgeAttempt;
window.renderForgeTab = renderForgeTab;
window.createWithdrawRequest = createWithdrawRequest;
window.copyToClipboard = copyToClipboard;
window.checkActiveRequests = checkActiveRequests;
window.loadUserStats = loadUserStats;
window.refreshUserProfile = refreshUserProfile;
window.switchArenaTab = switchArenaTab;
window.toggleArenaCreature = toggleArenaCreature;
window.saveArenaTeam = saveArenaTeam;
window.findMatch = findMatch;
window.acceptBattleWebhook = acceptBattleWebhook;
window.rejectBattleWebhook = rejectBattleWebhook;
window.makeAttack = makeAttack;
window.surrenderBattle = surrenderBattle;
window.cancelBattleSearch = cancelBattleSearch;
window.renderBattleInterface = renderBattleInterface;
window.updateBattleUIFromClient = updateBattleUIFromClient;
window.showDamageAnimation = showDamageAnimation;
window.renderArenaRanking = renderArenaRanking;
window.toggleRankDetailsCompact = toggleRankDetailsCompact;
window.loadCompactRankPlayers = loadCompactRankPlayers;
window.updateArenaRanksInfo = updateArenaRanksInfo;
window.renderArenaHistory = renderArenaHistory;
window.acceptBattleFromModal = acceptBattleFromModal;
window.rejectBattleFromModal = rejectBattleFromModal;
window.resetArenaTeam = resetArenaTeam;
window.renderArenaFightTab = renderArenaFightTab;
// ============================================================
// STAKING
// ============================================================
// ============================================================
// STAKING
// ============================================================



async function loadStakingStatus() {
    try {
        const data = await apiRequest('GET', '/api/staking/status');
        if (data && data.success && data.stakings && data.stakings.length > 0) {
            renderActiveStakings(data.stakings);
        } else {
            const block = document.getElementById('activeStakingBlock');
            if (block) block.style.display = 'none';
        }
        // ПЛАНЫ ВСЕГДА ПОКАЗЫВАЕМ, НЕ СКРЫВАЕМ!
        const plansEl = document.querySelector('.staking-plans');
        if (plansEl) plansEl.style.display = 'grid';
    } catch (e) {}
}

function renderActiveStakings(stakings) {
    const block = document.getElementById('activeStakingBlock');
    if (!block) return;
    block.style.display = 'block';
    
    // Очищаем и показываем список
    const container = document.getElementById('activeStakingsList');
    if (!container) {
        // Если контейнера нет — создаём
        const card = document.querySelector('.staking-active-card');
        if (card) {
            card.innerHTML = '<div id="activeStakingsList"></div>';
        }
    }
    
    const listContainer = document.getElementById('activeStakingsList') || block.querySelector('.staking-active-card');
    if (listContainer) {
        listContainer.innerHTML = stakings.map(s => `
            <div class="staking-active-item" data-staking-id="${s._id}" style="border-bottom:1px solid rgba(255,255,255,0.1); padding:12px 0;">
                <div class="staking-active-row">
                    <span class="staking-active-label">Сумма</span>
                    <span class="staking-active-val">${formatNum(s.amount)} MMO</span>
                </div>
                <div class="staking-active-row">
                    <span class="staking-active-label">Доход</span>
                    <span class="staking-active-val green" id="stakeReward_${s._id}">+${formatNum(s.reward)} MMO${s.days === 10 ? ' + 🦫 Capybara' : (s.days === 14 && s.amount >= 1000000 ? ' + 👘 Любо (12 мес)' : (s.days === 14 && s.amount >= 500000 ? ' + 🥷 Ниндзя (3 мес)' : (s.days === 14 && s.amount >= 200000 ? ' + 👕 CroSS (1 мес)' : '')))}</span>
                </div>
                <div class="staking-active-row">
                    <span class="staking-active-label">Осталось</span>
                    <span class="staking-active-val" id="stakeTimer_${s._id}">—</span>
                </div>
                <button class="staking-claim-btn" id="stakeClaimBtn_${s._id}" onclick="claimStakingById('${s._id}')" style="display:none; margin-top:8px;">
                    <i class="fa-solid fa-coins"></i> Забрать награду
                </button>
            </div>
        `).join('');
        
        // Запускаем таймеры для каждого стейкинга
        stakings.forEach(s => startStakingTimer(s._id, s.endsAt, s.days, s.amount));
    }
}

function startStakingTimer(stakingId, endsAt, days, amount) {
    function tick() {
        const diff = new Date(endsAt).getTime() - Date.now();
        const claimBtn = document.getElementById(`stakeClaimBtn_${stakingId}`);
        const timerEl = document.getElementById(`stakeTimer_${stakingId}`);
        if (!timerEl) return;
        if (diff <= 0) {
            timerEl.textContent = 'Готово! ✅';
            if (claimBtn) claimBtn.style.display = 'flex';
        } else {
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const sec = Math.floor((diff % 60000) / 1000);
            timerEl.textContent = (d > 0 ? d + 'д ' : '') +
                String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
            if (claimBtn) claimBtn.style.display = 'none';
        }
    }
    tick();
    const interval = setInterval(tick, 1000);
    // сохраняем interval для очистки при необходимости
}

function selectStakingPlan(days) {
    document.querySelectorAll('.staking-plan').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById('stakingPlan' + days);
    if (el) el.classList.add('selected');
    openStakingModal(days);
}

function openStakingModal(days) {
    const plan = STAKING_PLANS_CLIENT[days];
    if (!plan) return;
    currentStakingPlan = plan;
    document.getElementById('stakingModalDays').textContent = plan.days;  // ← plan.days, а не days!
    document.getElementById('stakingModalRate').textContent = plan.label;
    document.getElementById('stakingModalMin').textContent = 'Минимум: ' + formatNum(plan.minAmount) + ' MMO';
    document.getElementById('stakingAmountInput').value = '';
    document.getElementById('stakingModalPreview').textContent = '';
    document.getElementById('stakingModal').style.display = 'flex';
    
    document.getElementById('stakingAmountInput').oninput = function() {
        const val     = Math.floor(Number(this.value));
        const preview = document.getElementById('stakingModalPreview');
        if (val >= plan.minAmount) {
            const reward = Math.floor(val * plan.rate);
            preview.textContent = 'Получите: ' + formatNum(val + reward) + ' MMO'
                + (plan.capybara ? ' + 🦫 Capybara Rare' : '');
        } else {
            preview.textContent = val > 0 ? 'Минимум ' + formatNum(plan.minAmount) + ' MMO' : '';
        }
    };
}

function closeStakingModal(e) {
    if (e && e.target !== document.getElementById('stakingModal')) return;
    document.getElementById('stakingModal').style.display = 'none';
    currentStakingPlan = null;
}

async function confirmStaking() {
    if (!currentStakingPlan) return;
    const plan   = currentStakingPlan;
    const amount = Math.floor(Number(document.getElementById('stakingAmountInput').value));

    if (!amount || amount < plan.minAmount) {
        showToast('Минимум ' + formatNum(plan.minAmount) + ' MMO', '⚠️'); return;
    }
    if (amount > (state.user?.balance || 0)) {
        showToast('Недостаточно MMO', '❌'); return;
    }

    const data = await apiRequest('POST', '/api/staking/start', { days: plan.days, amount });
    if (data && data.success) {
        document.getElementById('stakingModal').style.display = 'none';
        currentStakingPlan = null;
        document.querySelectorAll('.staking-plan').forEach(el => el.classList.remove('selected'));
        if (data.user) { state.user = data.user; updateHeader(); }
        renderActiveStaking(data.staking);
        showToast('Стейкинг на ' + plan.days + ' дней запущен!', '🔒');
    } else {
        showToast((data && data.message) || 'Ошибка', '❌');
    }
}

async function claimStakingById(stakingId) {
    const data = await apiRequest('POST', '/api/staking/claim', { stakingId });
    if (data && data.success) {
        showToast('+' + formatNum(data.reward) + ' MMO получено!', '🎉');
        if (data.capybara) showToast('Получен Capybara Rare!', '🦫');
        loadStakingStatus(); // обновляем список
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}


// ============================================================
// ВОССТАНОВЛЕНИЕ WEBSOCKET ПОСЛЕ СВОРАЧИВАНИЯ/РАЗВОРАЧИВАНИЯ
// ============================================================

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && arenaClient && state.token) {
        console.log('👁️ Вкладка активна, проверяем WebSocket...');
        if (!arenaClient.isConnected()) {
            console.log('🔄 WebSocket отключён, переподключаемся...');
            arenaClient.connectSocket(state.token, API_URL);
        }
        
        if (arenaClient.getBattleId()) {
            setTimeout(() => {
                arenaClient.checkBattleStatus(arenaClient.getBattleId());
            }, 500);
        } else if (arenaClient.isSearching()) {
            setTimeout(() => {
                arenaClient.checkBattleStatus();
            }, 500);
        }
    }
});

window.addEventListener('online', () => {
    console.log('🌐 Интернет восстановлен');
    if (arenaClient && state.token && !arenaClient.isConnected()) {
        arenaClient.connectSocket(state.token, API_URL);
        if (arenaClient.getBattleId()) {
            setTimeout(() => {
                arenaClient.checkBattleStatus(arenaClient.getBattleId());
            }, 1000);
        }
    }
});

window.addEventListener('offline', () => {
    console.log('📡 Интернет потерян');
    if (typeof showToast === 'function') {
        showToast('Потеряно соединение с интернетом', '⚠️');
    }
});

// ============================================================
// ФИЛЬТРЫ МАРКЕТПЛЕЙСА
// ============================================================
function setMarketplaceFilter(filter) {
    currentMarketplaceFilter = filter;
    
    // Обновляем активный класс на кнопках
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const btnFilter = btn.getAttribute('data-filter');
        if (btnFilter === filter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Перерисовываем листинги с новым фильтром
    if (allMarketplaceListings.length > 0) {
        renderMarketplaceListings(allMarketplaceListings);
    } else {
        renderMarketplaceBuy();
    }
}

// ============================================
// RAID BOSS FUNCTIONS
// ============================================

let raidBattleOpen = false;

async function loadRaidData() {
    try {
        const res = await apiRequest('GET', '/api/raid/current');
        if (res?.success) {
            currentRaid = res.raid;
            updateRaidUI();
            if (raidBattleOpen) updateRaidBattleScreen();
        }
    } catch (e) {
        console.error('loadRaidData error:', e);
    }
}

function updateRaidUI() {
    if (!currentRaid) return;

    document.getElementById('raidBossIcon').textContent = '🐉';
    document.getElementById('raidBossName').textContent = 'Ежедневный Рейд';
    document.getElementById('raidParticipantsCount').textContent = currentRaid.participantsCount || 0;
    document.getElementById('raidPrizePool').textContent = (currentRaid.totalPrizePool || 0).toLocaleString();
    document.getElementById('raidCurrentTurn').textContent = currentRaid.currentTurn || 0;

    const hasJoined = currentRaid.isRegistered;
    document.getElementById('raidNotJoined').style.display = hasJoined ? 'none' : 'block';
    document.getElementById('raidJoined').style.display = hasJoined ? 'block' : 'none';

    if (hasJoined) {
        const petName = getPetDisplayName(currentRaid.myPetId);
        document.getElementById('raidMyPetName').textContent = petName;
        // Показываем кнопку "Открыть бой" только во время боя
        const openBtn = document.getElementById('raidOpenBattleBtn');
        if (openBtn) {
            openBtn.style.display = currentRaid.phase === 'fighting' ? 'flex' : 'none';
        }
    } else {
        renderPetSelector();
    }

    updateRaidTimer();
    updateHomeBossStatus();

    // Топ участников в лобби
    const topList = document.getElementById('raidTopList');
    if (topList) {
        if (currentRaid.topParticipants?.length) {
            topList.innerHTML = currentRaid.topParticipants.map((p, i) => `
                <div class="raid-top-item">
                    <div class="raid-top-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</div>
                    <div class="raid-top-name">${escapeHtml(p.username)}</div>
                    <div class="raid-top-damage">${p.damage.toLocaleString()}</div>
                </div>
            `).join('');
        } else {
            topList.innerHTML = '<div class="empty-listings">Нет участников</div>';
        }
    }
    // Обновляем лидерборд в экране боя (из API при открытии)
    if (raidBattleOpen && currentRaid.topParticipants?.length) {
        renderRaidLeaderboard(currentRaid.topParticipants);
    }

    loadRaidHistory();
}

function getPetDisplayName(petId) {
    if (!petId) return '?';
    const c = getCreature(petId);
    return c ? c.name : petId;
}

function updateRaidTimer() {
    const timerLabel = document.getElementById('raidTimerLabel');
    const timerValue = document.getElementById('raidTimerValue');
    if (!timerValue || !currentRaid) return;

    const now = new Date();
    let targetTime = null;
    let label = '';

    if (currentRaid.phase === 'registration') {
        targetTime = new Date(currentRaid.raidStartTime);
        label = '⏳ До начала рейда';
    } else if (currentRaid.phase === 'fighting') {
        // Считаем от первого хода если есть, иначе от raidEndTime
        if (currentRaid.firstTurnAt) {
            targetTime = new Date(new Date(currentRaid.firstTurnAt).getTime() + 15 * 20 * 1000 + 5000);
        } else {
            targetTime = new Date(currentRaid.raidEndTime);
        }
        label = '⚔️ До завершения';
    } else if (currentRaid.phase === 'finished') {
        timerValue.textContent = '✅ Рейд завершён';
        if (timerLabel) timerLabel.textContent = '🏆 Итоги';
        return;
    } else {
        timerValue.textContent = '📅 Ожидание';
        if (timerLabel) timerLabel.textContent = 'Следующий рейд';
        return;
    }

    if (timerLabel) timerLabel.textContent = label;
    const diff = targetTime.getTime() - now.getTime();

    if (diff <= 0) {
        timerValue.textContent = currentRaid.phase === 'registration' ? '🔥 НАЧИНАЕТСЯ!' : '⚔️ БОЙ ИДЁТ!';
        return;
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    timerValue.textContent = h > 0 ? `${h}ч ${m}м ${s}с` : m > 0 ? `${m}м ${s}с` : `${s}с`;
}

function renderPetSelector() {
    const container = document.getElementById('raidPetSelector');
    if (!container) return;

    const availablePets = state.inventory.filter(item => {
        const c = getCreature(item.creatureId);
        return c && item.count >= 1;
    });

    if (availablePets.length === 0) {
        container.innerHTML = `
            <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:16px;text-align:center;">
                <i class="fa-solid fa-circle-exclamation" style="font-size:24px;color:#ef4444;margin-bottom:8px;display:block;"></i>
                <div style="font-size:13px;color:#ef4444;margin-bottom:4px;">Нет существ для участия!</div>
                <div style="font-size:11px;color:#94a3b8;">Откройте капсулу, чтобы получить питомца</div>
            </div>`;
        return;
    }

    const selectedPetId = localStorage.getItem('raid_selected_pet');
    if (selectedPetId && !availablePets.some(p => p.creatureId === selectedPetId)) {
        localStorage.removeItem('raid_selected_pet');
    }
    const currentSelected = localStorage.getItem('raid_selected_pet');

    container.innerHTML = availablePets.map(item => {
        const c = getCreature(item.creatureId);
        const isSelected = currentSelected === c.id;
        const skill = window.ARENA_SKILLS_MAP?.[c.id];
        const upgradeLevel = item.upgradeLevel || 0;
        const raidAttack = (c.incomeBase + upgradeLevel) * 2;
        const upgradeBadge = upgradeLevel > 0 ? ` <span style="color:#f59e0b;font-size:10px">LVL ${upgradeLevel}</span>` : '';
        return `
            <div class="pet-option-card ${isSelected ? 'selected' : ''}" onclick="selectRaidPet('${c.id}')">
                <div class="pet-option-icon">${getIconHtml(c)}</div>
                <div class="pet-option-info">
                    <div class="pet-option-name">${escapeHtml(c.name)}${upgradeBadge}</div>
                    <div class="pet-option-stats">
                        <span class="pet-stat">⚔️ ${raidAttack} атк</span>
                        <span class="pet-stat rarity-${c.rarity}">${c.rarity}</span>
                    </div>
                    ${skill ? `<div class="pet-option-skill">✨ ${skill.name} (${Math.round(skill.chance * 100)}%)</div>` : ''}
                </div>
                ${isSelected ? '<div class="pet-option-check"><i class="fa-solid fa-circle-check"></i></div>' : ''}
            </div>`;
    }).join('');
}

function selectRaidPet(petId) {
    localStorage.setItem('raid_selected_pet', petId);
    renderPetSelector();
}

async function joinRaid() {
    if (joinRaid._pending) return;
    joinRaid._pending = true;
    const selectedPetId = localStorage.getItem('raid_selected_pet');
    if (!selectedPetId) {
        joinRaid._pending = false;
        showToast('Сначала выберите питомца для рейда!', '⚠️');
        return;
    }
    try {
        const res = await apiRequest('POST', '/api/raid/join', { petId: selectedPetId });
        if (!res) { showToast('Нет ответа от сервера', 'error'); return; }
        if (res.success) {
            showToast(res.message, 'success');
            loadRaidData();
            updateHeader();
        } else {
            showToast(res.message || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('catch: ' + e.message, 'error');
    } finally {
        joinRaid._pending = false;
    }
}

// ============================================
// RAID BATTLE SCREEN
// ============================================

function openRaidBattle() {
    if (!currentRaid || currentRaid.phase !== 'fighting') {
        showToast('Рейд ещё не начался', '⚠️');
        return;
    }
    raidBattleOpen = true;
    const screen = document.getElementById('raidBattleScreen');
    screen.style.display = 'flex';
    screen.style.flexDirection = 'column';
    // Динамически берём высоту хедера приложения
    const appHeader = document.querySelector('.header');
    const topOffset = appHeader ? appHeader.getBoundingClientRect().bottom : 60;
    screen.style.top = topOffset + 'px';
    screen.style.paddingTop = '0';
    updateRaidBattleScreen();
    addRaidLogEntry('⚔️ Вы вошли в бой!', 'system');
}

function closeRaidBattle() {
    raidBattleOpen = false;
    document.getElementById('raidBattleScreen').style.display = 'none';
}

function updateRaidBattleScreen() {
    if (!currentRaid || !raidBattleOpen) return;

    // Turn info
    const rbsTurn = document.getElementById('rbsTurn');
    if (rbsTurn) rbsTurn.textContent = currentRaid.currentTurn || 1;

    // Participants & prize
    const rbsP = document.getElementById('rbsParticipants');
    const rbsPP = document.getElementById('rbsPrizePool');
    if (rbsP) rbsP.textContent = currentRaid.participantsCount || 0;
    if (rbsPP) rbsPP.textContent = (currentRaid.totalPrizePool || 0).toLocaleString();

    // Pet card
    const petId = currentRaid.myPetId;
    const creature = petId ? getCreature(petId) : null;
    const rbsPetIcon = document.getElementById('rbsPetIcon');
    const rbsPetName = document.getElementById('rbsPetName');
    if (rbsPetIcon && creature) {
        const iconHtml = getIconHtml(creature);
        // If image, wrap in correct size; if emoji, set as text
        rbsPetIcon.innerHTML = iconHtml;
    }
    if (rbsPetName && creature) rbsPetName.textContent = creature.name;

    // My stats
    const rbsMyDamage = document.getElementById('rbsMyDamage');
    const rbsMyAttacks = document.getElementById('rbsMyAttacks');
    if (rbsMyDamage) rbsMyDamage.textContent = (currentRaid.myDamage || 0).toLocaleString();
    if (rbsMyAttacks) rbsMyAttacks.textContent = currentRaid.myAttacks || 0;

    // Attack button
    updateRaidAttackBtn();

    // Turn timer bar
    updateRaidTurnBar();
}

function updateRaidAttackBtn() {
    const btn = document.getElementById('raidAttackBtn');
    if (!btn) return;

    if (currentRaid.phase !== 'fighting') {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Рейд не активен';
        return;
    }

    if (currentRaid.turnEndsAt) {
        const timeLeft = Math.max(0, Math.floor((currentRaid.turnEndsAt - Date.now()) / 1000));
        if (timeLeft <= 0) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-hourglass-end"></i> Ход закончился';
            return;
        }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-sword"></i> Атаковать!';
}

function updateRaidTurnBar() {
    const wrap = document.getElementById('rbsTurnBarWrap');
    const bar = document.getElementById('rbsTurnBar');
    const sec = document.getElementById('raidTurnSeconds');
    const timerEl = document.getElementById('rbsTurnTimer');

    if (!currentRaid?.turnEndsAt) {
        if (wrap) wrap.style.display = 'none';
        if (timerEl) timerEl.textContent = '';
        return;
    }

    const timeLeft = Math.max(0, Math.floor((currentRaid.turnEndsAt - Date.now()) / 1000));
    const pct = Math.min(100, (timeLeft / 20) * 100);

    if (timeLeft <= 0) {
        if (wrap) wrap.style.display = 'none';
        if (timerEl) timerEl.textContent = '';
        return;
    }

    if (wrap) wrap.style.display = 'block';
    if (bar) {
        bar.style.width = pct + '%';
        bar.style.background = timeLeft <= 5 ? '#ef4444' : '#f59e0b';
    }
    if (sec) sec.textContent = timeLeft;
    if (timerEl) timerEl.textContent = `⏱ ${timeLeft}с`;
}

function startRaidTurnTimer() {
    if (raidTurnTimerInterval) clearInterval(raidTurnTimerInterval);
    raidTurnTimerInterval = setInterval(() => {
        if (!currentRaid?.turnEndsAt) return;
        const timeLeft = Math.max(0, Math.floor((currentRaid.turnEndsAt - Date.now()) / 1000));
        if (raidBattleOpen) {
            updateRaidTurnBar();
            updateRaidAttackBtn();
        }
        if (timeLeft <= 0) {
            clearInterval(raidTurnTimerInterval);
            raidTurnTimerInterval = null;
        }
    }, 500);
}

function renderRaidLeaderboard(leaderboard) {
    const lb = document.getElementById('rbsLeaderboard');
    if (!lb || !leaderboard?.length) return;

    const myId = String(state.user?.telegramId || state.user?.id || '');
    const maxDmg = leaderboard[0]?.damage || 1;

    lb.innerHTML = leaderboard.map((p, i) => {
        const isMe = String(p.telegramId) === myId;
        const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
        const pct = Math.round((p.damage / maxDmg) * 100);
        return `<div class="rbs-lb-item rank-${i+1}${isMe ? ' is-me' : ''}" style="position:relative;overflow:hidden;">
            <div class="rbs-lb-damage-bar" style="width:${pct}%"></div>
            <div class="rbs-lb-rank">${rankIcon}</div>
            <div class="rbs-lb-name">${escapeHtml(p.username)}${isMe ? ' 👤' : ''}</div>
            <div class="rbs-lb-damage">⚡ ${p.damage.toLocaleString()}</div>
        </div>`;
    }).join('');
}

function addRaidLogEntry(text, type = '') {
    // оставляем для системных сообщений через toast
    if (type === 'system') showToast(text, '⚔️');
}

async function attackRaidBoss() {
    if (!currentRaid || currentRaid.phase !== 'fighting') {
        showToast('Рейд не активен', '⚠️');
        return;
    }
    const btn = document.getElementById('raidAttackBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Атака...';
    }
    try {
        const res = await apiRequest('POST', '/api/raid/attack', {});
        if (res.success) {
            // Shake boss card
            const bossCard = document.getElementById('rbsBossCard');
            if (bossCard) {
                bossCard.classList.add('rbs-boss-shake');
                setTimeout(() => bossCard.classList.remove('rbs-boss-shake'), 300);
            }
            // Log entry
            const isCrit = res.isCrit;
            const skillTriggered = res.skillTriggered;
            let logText = `⚔️ Вы нанесли ${res.damage} урона!`;
            if (isCrit) logText += ' 💥 КРИТ!';
            if (skillTriggered) logText += ` ✨ ${res.skillName}!`;
            addRaidLogEntry(logText, isCrit ? 'crit' : skillTriggered ? 'skill' : 'mine');
            loadRaidData();
        } else {
            showToast(res.message, 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-sword"></i> Атаковать!';
            }
        }
    } catch (e) {
        showToast('Ошибка при атаке', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-sword"></i> Атаковать!';
        }
    }
}

async function loadRaidHistory() {
    const container = document.getElementById('raidHistoryList');
    if (!container) return;
    try {
        const res = await apiRequest('GET', '/api/raid/history');
        if (res?.success && res.history?.length) {
            container.innerHTML = res.history.map(h => `
                <div class="raid-history-item">
                    <div class="raid-history-name">${escapeHtml(h.raidId || 'Рейд')}</div>
                    <div class="raid-history-details">
                        👥 ${h.totalParticipants} участников | 💰 ${h.totalPrizePool.toLocaleString()} MMO пул
                    </div>
                    <div class="raid-history-details" style="font-size:9px;color:#64748b">
                        🏆 Топ: ${h.topDamage?.slice(0, 3).map(t => `${t.username}: ${t.damage}`).join(', ') || '—'}
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-listings">История рейдов пуста</div>';
        }
    } catch (e) {
        container.innerHTML = '<div class="empty-listings">Ошибка загрузки истории</div>';
    }
}

function showRaidResults(data) {
    const modal = document.getElementById('raidResultsModal');
    if (!modal) return;

    const ranks = data.topDamage || [];
    const myId = String(state.user?.telegramId || state.user?.id || '');
    const myEntry = ranks.find(p => String(p.telegramId) === myId);
    const maxDmg = ranks[0]?.damage || 1;

    // Subtitle
    const subtitle = document.getElementById('raidResultsSubtitle');
    if (subtitle) {
        subtitle.textContent = `${data.totalParticipants || 0} участников · Пул: ${(data.totalPrizePool || 0).toLocaleString()} MMO`;
    }

    // My reward block
    const myRewardEl = document.getElementById('raidResultsMyReward');
    const myAmountEl = document.getElementById('raidResultsMyAmount');
    const myStatsEl = document.getElementById('raidResultsMyStats');
    if (myEntry && myRewardEl) {
        myRewardEl.style.display = 'block';
        if (myAmountEl) myAmountEl.textContent = `+${myEntry.reward.toLocaleString()} MMO`;
        if (myStatsEl) {
            const myRank = ranks.indexOf(myEntry) + 1;
            myStatsEl.textContent = `#${myRank} место · ${myEntry.damage.toLocaleString()} урона нанесено`;
        }
    } else if (myRewardEl) {
        myRewardEl.style.display = 'none';
    }

    // Table
    const list = document.getElementById('raidResultsList');
    if (list) {
        list.innerHTML = ranks.map((p, i) => {
            const isMe = String(p.telegramId) === myId;
            const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
            const pct = Math.round((p.damage / maxDmg) * 100);
            return `<div class="rrm-item rank-${i+1}${isMe ? ' is-me' : ''}">
                <div class="rrm-dmg-bar" style="width:${pct}%"></div>
                <div class="rrm-rank">${rankIcon}</div>
                <div class="rrm-name">${escapeHtml(p.username)}${isMe ? '<span class="rrm-me-badge">ВЫ</span>' : ''}</div>
                <div class="rrm-stats">
                    <span class="rrm-damage">⚡ ${p.damage.toLocaleString()}</span>
                    <span class="rrm-reward">+${p.reward.toLocaleString()} MMO</span>
                </div>
            </div>`;
        }).join('');
    }

    modal.style.display = 'flex';
    closeRaidBattle();

    // Обновляем баланс после получения наград
    setTimeout(() => refreshUserProfile(), 1000);
}

function closeRaidResults() {
    document.getElementById('raidResultsModal').style.display = 'none';
    loadRaidData();
    updateHeader();
}


// Открыть рейд с главной страницы
function openRaidFromHome() {
    switchTab('raid');
    // Если бой идёт и игрок записан — сразу открываем экран боя
    if (currentRaid?.phase === 'fighting' && currentRaid?.isRegistered) {
        setTimeout(() => openRaidBattle(), 300);
    }
}

// Обновить статус рейда на главной
function updateHomeBossStatus() {
    const el = document.getElementById('homeBossStatus');
    if (!el || !currentRaid) return;
    if (currentRaid.phase === 'registration') {
        const diff = new Date(currentRaid.raidStartTime) - Date.now();
        if (diff > 0) {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            el.textContent = m > 0 ? `Старт через ~${m}м` : 'Скоро начнётся';
        } else {
            el.textContent = 'Скоро начнётся';
        }
    } else if (currentRaid.phase === 'fighting') {
        el.textContent = `⚔️ БОЙ! Ход ${currentRaid.currentTurn}/15`;
        // Пульсирующий эффект
        const card = document.querySelector('.raid-mode-card');
        if (card) card.style.borderColor = 'rgba(239,68,68,0.5)';
    } else {
        el.textContent = 'Ожидание рейда';
    }
}

function getRaidSocket() {
    return arenaClient?.state?.socket || null;
}

let raidSocketInitialized = false;

function initRaidWebSocket() {
    const tryInit = () => {
        const socket = getRaidSocket();
        if (!socket || !socket.connected) {
            setTimeout(tryInit, 1500);
            return;
        }
        if (raidSocketInitialized) return;
        raidSocketInitialized = true;

        socket.off('raid_phase_update');
        socket.off('raid_turn_start');
        socket.off('raid_attack');
        socket.off('raid_end');

        socket.on('raid_phase_update', (data) => {
            loadRaidData();
            if (data.message) showToast(data.message, '⚔️');
        });

        socket.on('raid_turn_start', (data) => {
            if (!currentRaid) return;
            if (String(data.raidId) !== String(currentRaid._id)) return;
            currentRaid.currentTurn = data.turn;
            currentRaid.turnEndsAt = Number(data.turnEndsAt);
            if (data.leaderboard) renderRaidLeaderboard(data.leaderboard);
            if (raidBattleOpen) {
                updateRaidBattleScreen();
                updateRaidAttackBtn();
            }
            showToast(`⚔️ Ход ${data.turn}/15 начался!`, '⚔️');
            startRaidTurnTimer();
        });

        socket.on('raid_attack', (data) => {
            if (!currentRaid) return;
            if (String(data.raidId) !== String(currentRaid._id)) return;
            if (data.leaderboard) renderRaidLeaderboard(data.leaderboard);
            if (data.isCrit) showToast(`💥 ${data.attackerName}: ${data.damage} КРИТ!`, '💥');
            loadRaidData();
        });

        socket.on('raid_end', (data) => {
            showToast('🏆 Рейд завершён! Награды распределены!', '🏆');
            raidSocketInitialized = false;
            if (data.results) {
                showRaidResults(data.results);
            } else {
                loadRaidData();
            }
        });

        console.log('✅ Raid WebSocket handlers registered');
    };
    tryInit();
}


// ============================================
// FORGE — КУЗНИЦА УЛУЧШЕНИЙ
// ============================================

function renderForgeTab() {
    const container = document.getElementById('forgeCreatureList');
    if (!container) return;

    if (!state.inventory.length) {
        container.innerHTML = '<div class="empty-listings">Нет существ в инвентаре</div>';
        return;
    }

    const sorted = [...state.inventory].sort((a, b) => {
        const ai = RARITY_ORDER.indexOf(getCreature(a.creatureId)?.rarity || 'common');
        const bi = RARITY_ORDER.indexOf(getCreature(b.creatureId)?.rarity || 'common');
        return bi - ai;
    });

    container.innerHTML = sorted.map(item => {
        const c = getCreature(item.creatureId);
        if (!c) return '';
        const level = item.upgradeLevel || 0;
        const successes = item.upgradeSuccesses || 0;
        const maxLevel = 10;
        const baseAtk = (c.incomeBase + level) * 2;
        const nextAtk = (c.incomeBase + level + 1) * 2;
        const attemptCost = 30 * Math.pow(2, level);
        const pct = Math.round((successes / 10) * 100);
        const isMaxed = level >= maxLevel;
        const canAfford = state.user?.balance >= attemptCost;

        return `<div class="forge-card" id="forge-card-${c.id}">
            <div class="forge-card-top">
                <div class="forge-card-icon">${getIconHtml(c)}</div>
                <div class="forge-card-info">
                    <div class="forge-card-name">${escapeHtml(c.name)}</div>
                    <div class="forge-card-stats">
                        <span>⚡ ${baseAtk} ATK${level > 0 ? ` <span style="color:#f59e0b">(+${level*2})</span>` : ''}</span>
                        <span style="color:#94a3b8">${c.rarity}</span>
                    </div>
                </div>
                <div class="forge-card-level">${isMaxed ? '✨ MAX' : `LVL ${level}`}</div>
            </div>
            ${!isMaxed ? `
            <div class="forge-progress-wrap">
                <div class="forge-progress-label">
                    <span>Успехов: ${successes}/10</span>
                    <span style="color:#f59e0b">→ LVL ${level+1} (+${(level+1)*2} ATK)</span>
                </div>
                <div class="forge-progress-bar-bg">
                    <div class="forge-progress-bar" style="width:${pct}%"></div>
                </div>
            </div>
            <button class="forge-attempt-btn" ${!canAfford ? 'disabled' : ''} onclick="forgeAttempt('${c.id}')">
                <i class="fa-solid fa-hammer"></i>
                Улучшить — ${attemptCost.toLocaleString()} MMO
                <span style="font-size:11px;opacity:0.7">(30%)</span>
            </button>
            ` : `<div class="forge-maxed-badge">✨ Максимальный уровень достигнут!</div>`}
        </div>`;
    }).join('');
}

async function forgeAttempt(creatureId) {
    const btn = document.querySelector(`#forge-card-${creatureId} .forge-attempt-btn`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Попытка...'; }

    try {
        const res = await apiRequest('POST', '/api/game/forge', { creatureId });

        const card = document.getElementById(`forge-card-${creatureId}`);

        if (res.success) {
            showToast(res.message, res.attemptSuccess ? '✅' : '❌');

            // Обновляем данные в state.inventory
            const item = state.inventory.find(i => i.creatureId === creatureId);
            if (item) {
                item.upgradeLevel = res.newLevel;
                item.upgradeSuccesses = res.newSuccesses;
            }

            // Анимация карточки
            if (card) {
                card.classList.add(res.attemptSuccess ? 'forge-result-success' : 'forge-result-fail');
                setTimeout(() => {
                    card.classList.remove('forge-result-success', 'forge-result-fail');
                }, 400);
            }

            // Обновляем баланс
            if (state.user) state.user.balance = res.balance;
            updateHeader();

            // Перерисовываем вкладку
            renderForgeTab();
        } else {
            showToast(res.message, '❌');
            if (btn) {
                btn.disabled = false;
                const item = state.inventory.find(i => i.creatureId === creatureId);
                const level = item?.upgradeLevel || 0;
                const cost = 30 * Math.pow(2, level);
                btn.innerHTML = `<i class="fa-solid fa-hammer"></i> Улучшить — ${cost.toLocaleString()} MMO <span style="font-size:11px;opacity:0.7">(30%)</span>`;
            }
        }
    } catch (e) {
        showToast('Ошибка попытки', '❌');
        if (btn) btn.disabled = false;
    }
}


// Переключатель вкладок с поддержкой рейда
const originalSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    originalSwitchTab(tab);
    if (tab === 'forge') {
        renderForgeTab();
    } else if (tab === 'raid') {
        loadRaidData();
        if (raidUpdateInterval) clearInterval(raidUpdateInterval);
        // Во время боя данные идут через сокет — поллим редко
        const pollInterval = (currentRaid?.phase === 'fighting') ? 15000 : 5000;
        raidUpdateInterval = setInterval(loadRaidData, pollInterval);
    } else if (raidUpdateInterval) {
        clearInterval(raidUpdateInterval);
        raidUpdateInterval = null;
    }
};

function initRaid() {
    raidSocketInitialized = false;
    loadRaidData();
    initRaidWebSocket();
    setInterval(updateRaidTimer, 1000);
    setInterval(updateHomeBossStatus, 10000);
    // Обновляем кнопку и таймер хода каждые 500мс
    setInterval(() => {
        if (raidBattleOpen) {
            updateRaidTurnBar();
            updateRaidAttackBtn();
        }
    }, 500);
}

// Вызываем после загрузки пользователя


// ========== ЭТИ СТРОКИ УЖЕ БЫЛИ, НИЧЕГО НЕ МЕНЯЙТЕ ==========
window.selectStakingPlan = selectStakingPlan;
window.openStakingModal   = openStakingModal;
window.closeStakingModal  = closeStakingModal;
window.confirmStaking     = confirmStaking;
window.claimStaking       = claimStaking;
window.loadStakingStatus  = loadStakingStatus;