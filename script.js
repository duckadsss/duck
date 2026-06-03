// ============================================================
// DNA MMO - ПОЛНАЯ КЛИЕНТСКАЯ ЧАСТЬ (С АРЕНОЙ И ВЕБХУКАМИ)
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const API_URL = 'https://serv-production-765e.up.railway.app';

// ============================================================
// ЗАПРЕТ КОНТЕКСТНОГО МЕНЮ И ВЫДЕЛЕНИЯ
// ============================================================
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
});

document.addEventListener('selectstart', (e) => {
    e.preventDefault();
    return false;
});

document.addEventListener('dragstart', (e) => {
    e.preventDefault();
    return false;
});

// ============================================================
// ОТЛАДОЧНАЯ ПАНЕЛЬ ДЛЯ ТЕЛЕФОНА
// ============================================================
let debugPanel = null;

function createDebugPanel() {
    if (debugPanel) return;
    
    const panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.style.cssText = `
        position: fixed;
        bottom: 10px;
        left: 10px;
        right: 10px;
        background: rgba(0,0,0,0.85);
        color: #0f0;
        font-family: monospace;
        font-size: 10px;
        padding: 8px;
        border-radius: 8px;
        z-index: 10000;
        max-height: 150px;
        overflow-y: auto;
        pointer-events: none;
        backdrop-filter: blur(5px);
        border: 1px solid #0f0;
    `;
    panel.innerHTML = '<div style="font-weight:bold;margin-bottom:5px;">🔍 DEBUG:</div><div id="debugLog"></div>';
    document.body.appendChild(panel);
    debugPanel = document.getElementById('debugLog');
}

function debugLog(msg) {
    if (!debugPanel) createDebugPanel();
    const time = new Date().toLocaleTimeString();
    debugPanel.innerHTML = `<div style="border-bottom:1px solid #333;padding:2px 0;">[${time}] ${msg}</div>` + debugPanel.innerHTML;
    while (debugPanel.children.length > 20) {
        debugPanel.removeChild(debugPanel.lastChild);
    }
    console.log(msg);
}

// Скрыть панель по двойному тапу
document.addEventListener('dblclick', () => {
    if (debugPanel) {
        debugPanel.parentElement.style.display = 'none';
    }
});

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
    isLoading: false,
    serverBalance: 0,
    lastServerSync: 0,
    visualTicker: null
};

let intervals = {
    adsTimer: null,
    specialQuests: null,
    leaderboard: null,
    marketplace: null
};

let activeQuestTimers = new Map();
let currentLeaderboardController = null;
let isMarketplaceTabActive = false;

// КЭШИ
let leaderboardCache = { data: null, expiresAt: 0 };
let marketplaceCache = { data: null, hash: null, expiresAt: 0 };

// Переменные для депозита
let currentPaymentMemo = null;
let currentPaymentAmount = null;

// Хранилище статусов квестов
let questStatuses = new Map();
const QUESTS_STORAGE_KEY = 'dna_mmo_quests_status';

// ============================================================
// ARENA STATE
// ============================================================
let arenaState = {
    selectedTeam: [],
    currentBattle: null,
    battlePollingInterval: null,
    isSearching: false,
    battleMoveTimeout: null,
    confirmationShown: false,
    battleActive: false,
    sseConnection: null,
    currentBattleIsPlayer1: false,
    currentBattleId: null
};

let battleTimerInterval = null;

// ============================================================
// GAME DATA
// ============================================================
let CREATURES = [];
let CAPSULE_COSTS = { basic: 500, premium: 2000 };
let RARITY_WEIGHTS = {
    basic: { common: 80, uncommon: 20, rare: 0, epic: 0, legendary: 0 },
    premium: { common: 60, uncommon: 30, rare: 10, epic: 2, legendary: 1 }
};
let AD_REWARD = 20;
let AD_COOLDOWN = 60;
let UPGRADE_BASE_COST = 300;
let UPGRADE_MULTIPLIER = 1.5;
let MAX_INVENTORY_SLOTS = 50;
let SPECIAL_QUESTS = [];

const RARITY_COLORS = {
    common: '#94a3b8', uncommon: '#22c55e', rare: '#3b82f6',
    epic: '#a855f7', legendary: '#f59e0b', mythic: '#ef4444'
};
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const RARITY_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.05,
    rare: 1.10,
    epic: 1.15,
    legendary: 1.25,
    mythic: 1.40
};

// ============================================================
// ВИЗУАЛЬНЫЙ ТИКЕР
// ============================================================
let visualTickerInterval = null;

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

function formatBalance(n) {
    const absN = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    return sign + absN.toFixed(3);
}

function getVisualBalance() {
    if (!state.user) return 0;
    if (!state.lastServerSync) return state.serverBalance || 0;
    const elapsedSeconds = (Date.now() - state.lastServerSync) / 1000;
    const earned = (state.incomePerHour / 3600) * elapsedSeconds;
    return (state.serverBalance || 0) + earned;
}

function updateServerSnapshot(newBalance, newIncomePerHour, newLastPassiveIncome) {
    debugLog(`📊 updateServerSnapshot: баланс ${newBalance}`);
    state.serverBalance = newBalance !== undefined ? newBalance : state.serverBalance;
    state.incomePerHour = newIncomePerHour !== undefined ? newIncomePerHour : state.incomePerHour;
    state.lastServerSync = newLastPassiveIncome ? new Date(newLastPassiveIncome).getTime() : Date.now();
    if (state.user) state.user.balance = state.serverBalance;
}

let collectIncomeTimer = null;
async function startCollectIncomeLoop() {
    if (collectIncomeTimer) clearInterval(collectIncomeTimer);
    collectIncomeTimer = setInterval(async () => {
        if (document.hidden || !state.token) return;
        try {
            const res = await apiRequest('POST', '/api/game/collect-income');
            if (res && res.success) {
                updateServerSnapshot(res.balance, res.incomePerHour, res.lastPassiveIncome);
                if (state.user) state.user.balance = res.balance;
            }
        } catch (e) {}
    }, 5 * 60 * 1000);
}

// ============================================================
// API ЗАПРОСЫ
// ============================================================
let pendingRequests = new Map();

async function apiRequest(method, path, body = null, signal = null) {
    const key = `${method}:${path}:${JSON.stringify(body)}`;
    if (pendingRequests.has(key)) return pendingRequests.get(key);
    
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal
    };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body) opts.body = JSON.stringify(body);
    
    const promise = (async () => {
        try {
            const res = await fetch(API_URL + path, opts);
            const data = await res.json();
            if (!res.ok) {
                console.warn(`API ${path} error:`, data.message);
                if (res.status === 401 || res.status === 403) {
                    localStorage.removeItem('token');
                    state.token = null;
                    showToast('Сессия истекла', '❌');
                }
            }
            return data;
        } catch (e) {
            if (e.name === 'AbortError') return null;
            console.error(`API ${path} fetch error:`, e);
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
// HELPER FUNCTIONS
// ============================================================
function getCreature(id) { return CREATURES.find(c => c.id === id); }
function formatNum(n) {
    const absN = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (absN >= 1000000) return sign + (absN/1000000).toFixed(1) + 'M';
    if (absN >= 1000) return sign + (absN/1000).toFixed(1) + 'K';
    return sign + Math.floor(absN).toString();
}
function getUsedSlots() {
    return state.inventory.reduce((s, i) => s + i.count, 0);
}
function getUpgradeCost() {
    return Math.floor(UPGRADE_BASE_COST * Math.pow(UPGRADE_MULTIPLIER, state.user?.inventoryUpgrades || 0));
}
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
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getIconHtml(creature, addShadow = false, shadowColor = null) {
    if (!creature) return '🧬';
    const icon = creature.icon;
    if (icon && (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('Images/'))) {
        const shadowStyle = addShadow && shadowColor ? `filter:drop-shadow(0 0 16px ${shadowColor});` : '';
        return `<img src="${icon}" alt="${escapeHtml(creature.name)}" loading="lazy" style="object-fit:contain;${shadowStyle}" class="card-icon-img" onerror="this.style.display='none'">`;
    }
    return icon || '🧬';
}

async function loadGameConfig() {
    const res = await apiRequest('GET', '/api/game/config');
    if (res && res.success) {
        const cfg = res.config;
        CAPSULE_COSTS = cfg.capsuleCosts || { basic: 500, premium: 2000 };
        RARITY_WEIGHTS = cfg.capsuleRarities || RARITY_WEIGHTS;
        AD_REWARD = cfg.adReward || 20;
        AD_COOLDOWN = cfg.adCooldown || 60;
        UPGRADE_BASE_COST = cfg.upgradeBaseCost || 300;
        UPGRADE_MULTIPLIER = cfg.upgradeMultiplier || 1.5;
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
        debugLog(`✅ Загружено ${CREATURES.length} существ`);
        return true;
    }
    return false;
}

async function getCurrentIncome() {
    let income = 0;
    for (const item of state.inventory) {
        const c = getCreature(item.creatureId);
        if (c) income += c.incomeBase * item.count;
    }
    return income;
}

// ============================================================
// СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ (КОШЕЛЕК)
// ============================================================
async function loadUserStats() {
    try {
        const res = await apiRequest('GET', '/api/user/stats');
        if (res && res.success) {
            const stats = res.stats;
            
            const withdrawnEl = document.getElementById('walletWithdrawn');
            if (withdrawnEl) withdrawnEl.textContent = formatNum(stats.totalWithdrawn || 0);
            
            const referralEl = document.getElementById('walletReferralEarned');
            if (referralEl) referralEl.textContent = formatNum(stats.referralEarned || 0);
            
            const adsWatchedEl = document.getElementById('walletAdsWatched');
            if (adsWatchedEl) adsWatchedEl.textContent = stats.adsWatched || 0;
            
            const adsEarnedEl = document.getElementById('walletAdsEarned');
            if (adsEarnedEl) adsEarnedEl.textContent = formatNum(stats.adsEarned || 0);
        }
    } catch (e) {
        console.error('loadUserStats error:', e);
    }
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
    intervals.leaderboard = setInterval(() => {
        if (!document.hidden) renderLeaderboard();
    }, 5 * 60 * 1000);
    
    intervals.specialQuests = setInterval(() => {
        if (!document.hidden) {
            loadGameConfig();
            renderSpecialQuests();
        }
    }, 5 * 60 * 1000);
    
    intervals.marketplace = setInterval(() => {
        if (!document.hidden && isMarketplaceTabActive) {
            renderMarketplaceBuy();
        }
    }, 10 * 1000);
    
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
                if (res.earned > 1) {
                    showToast(`+${formatNum(res.earned)} MMO получено`, '💰');
                }
            }
        }).catch(err => {
            console.warn('collect-income error on visibility change:', err);
        });

        if (isMarketplaceTabActive) {
            renderMarketplaceBuy();
            intervals.marketplace = setInterval(() => {
                if (!document.hidden && isMarketplaceTabActive) {
                    renderMarketplaceBuy();
                }
            }, 10 * 1000);
        }
    }
}

async function refreshUserProfile() {
    const res = await apiRequest('GET', '/api/user/profile');
    if (res && res.success) {
        state.user = res.user;
        state.inventory = res.inventory || [];
        state.incomePerHour = res.incomePerHour || 0;
        
        updateServerSnapshot(state.user.balance, state.incomePerHour, res.lastPassiveIncome);
        
        updateHeader();
        renderCards();
        updateFriendRewardButtons();
        await loadUserStats();
        
        const friendCountDisplay = document.getElementById('friendCountDisplay');
        if (friendCountDisplay && state.user) {
            friendCountDisplay.textContent = `${state.user.referralCount || 0} друзей 5+ уровня`;
        }
        
        if (res.offlineEarned > 10) {
            setTimeout(() => showToast(`+${formatNum(res.offlineEarned)} MMO offline!`, '💤'), 1000);
        }
    }
}

async function initTelegramApp() {
    clearAllIntervals();
    showLoadingScreen(true);
    createDebugPanel();
    debugLog('🚀 Инициализация приложения...');

    const tg = window.Telegram?.WebApp;
    
    if (tg) {
        tg.ready();
        tg.expand();
        
        if (tg.enableClosingConfirmation) {
            tg.enableClosingConfirmation();
        }
        
        if (tg.requestFullscreen) {
            try {
                await tg.requestFullscreen();
                debugLog('✅ Fullscreen requested');
            } catch (e) {
                debugLog('Fullscreen request failed: ' + e.message);
            }
        }
        
        setTimeout(() => {
            const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-area-inset-top')) || 55;
            document.querySelector('.header').style.paddingTop = (top + 40) + 'px';
        }, 400);
        
        if (tg.disableVerticalSwipes) {
            tg.disableVerticalSwipes();
        }
        
        setTimeout(() => {
            if (tg && typeof tg.expand === 'function') {
                tg.expand();
            }
        }, 500);
        
        tg.setHeaderColor('#080b14');
        tg.setBackgroundColor('#080b14');
        
        debugLog('✅ Telegram WebApp initialized');
    } else {
        debugLog('⚠️ Telegram WebApp not available');
    }

    let initData = tg?.initData || '';
    let tgUser = tg?.initDataUnsafe?.user;
    
    let referralCode = null;
    
    if (tg?.initDataUnsafe?.start_param) {
        referralCode = tg.initDataUnsafe.start_param;
        debugLog('📎 Реферальный код из start_param: ' + referralCode);
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    if (!referralCode && urlParams.get('startapp')) {
        referralCode = urlParams.get('startapp');
        debugLog('📎 Реферальный код из startapp URL: ' + referralCode);
    }
    
    if (!referralCode && urlParams.get('ref')) {
        referralCode = urlParams.get('ref');
        debugLog('📎 Реферальный код из ref URL: ' + referralCode);
    }

    if (!initData && window.location.hostname === 'localhost') {
        debugLog('⚠️ Dev mode: using mock Telegram user');
        const mockUser = { id: 123456789, first_name: 'Test', username: 'testuser' };
        initData = `user=${encodeURIComponent(JSON.stringify(mockUser))}&hash=devhash`;
        tgUser = mockUser;
    }

    if (!initData) {
        showLoadingScreen(false);
        showToast('Открой игру через Telegram!', '⚠️');
        debugLog('❌ Нет initData');
        return;
    }

    debugLog('📡 Отправка запроса логина...');
    const loginRes = await apiRequest('POST', '/api/auth/login', { initData, referralCode });

    if (!loginRes.success) {
        showLoadingScreen(false);
        showToast(loginRes.message || 'Ошибка авторизации', '❌');
        debugLog('❌ Ошибка логина: ' + loginRes.message);
        return;
    }

    state.token = loginRes.token;
    state.user = loginRes.user;
    state.inventory = loginRes.inventory || [];

    state.serverBalance = state.user.balance;
    state.lastServerSync = Date.now();
    state.incomePerHour = 0;
    
    debugLog(`✅ Логин успешен! Баланс: ${state.user.balance}, Инвентарь: ${state.inventory.length}`);

    const profileRes = await apiRequest('GET', '/api/user/profile');
    if (profileRes && profileRes.success) {
        state.user = profileRes.user;
        state.inventory = profileRes.inventory || [];
        state.incomePerHour = profileRes.incomePerHour || 0;
        state.serverBalance = state.user.balance;
        state.lastServerSync = Date.now();
        debugLog(`✅ Профиль загружен, баланс: ${state.user.balance}`);
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

    if (loginRes.isNewUser && referralCode) {
        setTimeout(() => showToast('🎉 Добро пожаловать! Реферальный бонус: 2% от депозитов друга', '🎁'), 800);
    } else if (loginRes.isNewUser) {
        setTimeout(() => showToast('Open a DNA Capsule to start!', '🧬'), 800);
    }
    
    if (state.user) {
        debugLog(`👥 Referral info: код ${state.user.referralCode}, друзей ${state.user.referralCount}`);
    }
    
    setTimeout(() => {
        checkActiveRequests();
        loadUserStats();
    }, 1000);
    
    updateAdsStatus();
    
    // Инициализация вебхуков арены
    initArenaWebhooks();
    activateArenaMainButton();
    // Подключаем SSE для арены
    startArenaSSE();
    
    document.querySelectorAll('img').forEach(img => {
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
        img.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        });
    });

    window.addEventListener('beforeunload', () => {
        stopArenaSSE();
    });

    window.addEventListener('online', () => {
        if ((arenaState.isSearching || arenaState.battleActive) && !arenaState.sseConnection) {
            startArenaSSE();
        }
    });
}

// ============================================================
// LOADING SCREEN
// ============================================================
function showLoadingScreen(show) {
    let el = document.getElementById('loadingScreen');
    
    if (!el && show) {
        el = document.createElement('div');
        el.id = 'loadingScreen';
        el.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100vh;
            height: 100dvh;
            background: url('load.webp') center/cover no-repeat;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            padding-bottom: 12vh;
        `;
        
        el.innerHTML = `
            <style>
                .loading-bar-container {
                    width: 200px;
                    height: 4px;
                    background: rgba(168,85,247,0.2);
                    border-radius: 4px;
                    overflow: hidden;
                }
                .loading-bar-fill {
                    width: 0%;
                    height: 100%;
                    background: linear-gradient(90deg, #a855f7, #06b6d4);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
                .loading-text {
                    font-family: 'Orbitron', monospace;
                    font-size: 12px;
                    font-weight: 600;
                    color: #a855f7;
                    text-transform: uppercase;
                    letter-spacing: 3px;
                    margin-top: 16px;
                }
                .loading-percent {
                    font-family: 'Orbitron', monospace;
                    font-size: 11px;
                    color: #94a3b8;
                    margin-top: 6px;
                }
            </style>
            
            <div class="loading-bar-container">
                <div class="loading-bar-fill" id="loadingBarFill"></div>
            </div>
            <div class="loading-text">LOADING</div>
            <div class="loading-percent" id="loadingPercent">0%</div>
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
        if (el.dataset.percentInterval) {
            clearInterval(parseInt(el.dataset.percentInterval));
        }
        const fillEl = document.getElementById('loadingBarFill');
        const percentEl = document.getElementById('loadingPercent');
        if (fillEl) fillEl.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        
        setTimeout(() => {
            el.style.transition = 'opacity 0.5s ease';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 500);
        }, 200);
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
// UPDATE UI (ОСТАВЛЯЕМ КАК БЫЛО, ДОБАВЛЯЕМ ТОЛЬКО DEBUG)
// ============================================================
function updatePlayerInfo() {
    if (!state.user) return;
    const name = state.user.username || state.user.firstName || 'GENOME_X';
    const avatarEl = document.getElementById('playerAvatar');
    const nameEl = document.querySelector('.player-name');
    if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
    if (nameEl) nameEl.textContent = name.toUpperCase();
}

function renderAll() {
    updateHeader();
    renderCards();
    updateUpgradeButton();
    renderLeaderboard();
    renderSpecialQuests();
    updateFriendRewardButtons();
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
    document.getElementById('balanceDisplay').textContent = formatBalance(visualBalance);
    
    const incomeInline = document.getElementById('incomeInline');
    if (incomeInline) incomeInline.textContent = `+${formatNum(state.incomePerHour)}/hr`;

    const needed = u.level * 100;
    document.getElementById('xpLabel').textContent = `XP ${u.xp}/${needed}`;
    document.getElementById('xpFill').style.width = `${Math.min(100, (u.xp / needed) * 100)}%`;
    document.getElementById('playerLevelLabel').textContent = `LVL ${u.level} · ${getLevelTitle(u.level)}`;

    document.getElementById('walletCards').textContent = state.inventory.reduce((s, i) => s + i.count, 0);
    document.getElementById('walletMerges').textContent = u.mergeCount || 0;

    updateUpgradeButton();
    renderTransactions();

    const friendCountDisplay = document.getElementById('friendCountDisplay');
    if (friendCountDisplay && state.user) {
        friendCountDisplay.textContent = `${state.user.referralCount || 0} друзей 5+ уровня`;
    }
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

// ============================================================
// CAPSULE
// ============================================================
let lastCapsuleOpen = 0;

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
        <div class="popup-subtitle" style="margin-bottom:16px">
            Cost: <span style="color:${type === 'premium' ? '#f59e0b' : '#a855f7'};font-weight:700">${cost} MMO</span>
        </div>
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:12px;padding:14px;margin-bottom:16px">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Drop Rates</div>
            ${oddsHtml}
        </div>
        <button class="popup-btn" ${!canAfford ? 'disabled' : ''} 
            style="${!canAfford ? 'opacity:0.5;cursor:not-allowed;background:#1a2540' : type === 'premium' ? 'background:linear-gradient(135deg,#b45309,#f59e0b)' : ''}" 
            onclick="closeOverlay();openCapsule('${type}')">
            <i class="fa-solid fa-flask-vial"></i> ${canAfford ? 'OPEN NOW' : 'NOT ENOUGH MMO'}
        </button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function openCapsule(type) {
    if (state.isLoading) return;
    
    if (Date.now() - lastCapsuleOpen < 2000) {
        showToast('Слишком быстро! Подождите 2 секунды.', '⏳');
        return;
    }
    lastCapsuleOpen = Date.now();

    const cost = CAPSULE_COSTS[type];
    if (state.serverBalance < cost) {
        showToast('Not enough MMO!', '❌'); return;
    }
    if (getUsedSlots() >= (state.user?.inventorySlots || 10)) {
        showToast('Inventory full! Upgrade storage', '📦'); return;
    }

    state.isLoading = true;

    const cardEl = document.getElementById(type === 'premium' ? 'premiumCapsuleCard' : 'basicCapsuleCard');
    const iconEl = cardEl?.querySelector('.capsule-icon');
    iconEl?.classList.add('capsule-opening');
    setTimeout(() => iconEl?.classList.remove('capsule-opening'), 600);

    const res = await apiRequest('POST', '/api/game/open-capsule', { type });
    state.isLoading = false;

    if (!res.success) {
        showToast(res.message || 'Error opening capsule', '❌'); return;
    }

    state.user = res.user;
    state.inventory = res.inventory;
    state.incomePerHour = await getCurrentIncome();
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);

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
// CARD CLICK
// ============================================================
function onCardClick(creatureId) {
    const c = getCreature(creatureId);
    if (!c) return;
    const item = state.inventory.find(i => i.creatureId === creatureId);
    const color = RARITY_COLORS[c.rarity];

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-icon">${getIconHtml(c, true, color)}</div>
        <div class="popup-title" style="color:${color}">${escapeHtml(c.name)}</div>
        <div class="popup-subtitle">${escapeHtml(c.desc || '')}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">${c.rarity.toUpperCase()}</div>
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${c.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
            <div class="popup-stat"><div class="popup-stat-val">${item ? item.count : 0}</div><div class="popup-stat-label">Owned</div></div>
        </div>
        ${canMerge(creatureId)
            ? `<button class="popup-btn" style="background:linear-gradient(135deg,#16a34a,#22c55e)" onclick="closeOverlay();showMergePreview('${creatureId}')">
                <i class="fa-solid fa-code-merge"></i> MERGE x3
            </button>`
            : `<button class="popup-btn" onclick="closeOverlay()">CLOSE</button>`
        }
    `;
    document.getElementById('overlay').classList.add('show');
}

// ============================================================
// MERGE
// ============================================================
let lastMergeTime = 0;

function showMergePreview(creatureId) {
    const creature = getCreature(creatureId);
    if (!creature) return;
    if (creature.rarity === 'legendary') { showToast('Legendary is max!', '⭐'); return; }

    const currentRarityIdx = RARITY_ORDER.indexOf(creature.rarity);
    const nextRarity = currentRarityIdx < RARITY_ORDER.length - 2 ? RARITY_ORDER[currentRarityIdx + 1] : creature.rarity;
    const nextCreature = CREATURES.find(c => c.name === creature.name && c.rarity === nextRarity) || creature;
    const color = RARITY_COLORS[creature.rarity];

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title" style="margin-bottom:4px">Предпросмотр Слияния</div>
        <div class="popup-subtitle">3x ${escapeHtml(creature.name)} → ?</div>
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:14px;padding:16px;margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <div style="text-align:center;flex:1">
                    <div style="font-size:24px;margin-bottom:6px">${getIconHtml(creature)}</div>
                    <div style="font-size:10px;color:#94a3b8">Исходные</div>
                    <div style="font-size:11px;font-weight:600;color:#e2e8f0;margin-top:2px">3x ${escapeHtml(creature.name)}</div>
                </div>
                <div style="color:#4a5568;font-size:18px">→</div>
                <div style="text-align:center;flex:1">
                    <div style="font-size:24px;margin-bottom:6px">?</div>
                    <div style="font-size:10px;color:#94a3b8">Результат</div>
                    <div style="font-size:11px;font-weight:600;color:#e2e8f0;margin-top:2px">Unknown</div>
                </div>
            </div>
            <div style="border-top:1px solid #1e2d4a;padding-top:14px">
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Возможные результаты</div>
                <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:10px;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:18px">${getIconHtml(nextCreature)}</span>
                        <div style="flex:1">
                            <div style="font-size:11px;font-weight:600;color:#22c55e">30% Успех</div>
                            <div style="font-size:10px;color:#94a3b8">${escapeHtml(nextCreature.name)} (${nextRarity.toUpperCase()})</div>
                        </div>
                        <div style="font-size:12px;font-weight:700;color:#22c55e">▲ ПОВЫШЕНИЕ</div>
                    </div>
                </div>
                <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:18px">${getIconHtml(creature)}</span>
                        <div style="flex:1">
                            <div style="font-size:11px;font-weight:600;color:#ef4444">70% Провал</div>
                            <div style="font-size:10px;color:#94a3b8">${escapeHtml(creature.name)} (${creature.rarity.toUpperCase()})</div>
                        </div>
                        <div style="font-size:12px;font-weight:700;color:#ef4444">= БЕЗ ИЗМЕНЕНИЙ</div>
                    </div>
                </div>
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#16a34a,#22c55e);margin-bottom:8px" onclick="closeOverlay();executeMerge('${creatureId}')">
            <i class="fa-solid fa-code-merge"></i> СЛИТЬ СЕЙЧАС
        </button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function executeMerge(creatureId) {
    if (state.isLoading) return;
    if (!canMerge(creatureId)) return;
    
    if (Date.now() - lastMergeTime < 1000) {
        showToast('Слишком быстро! Подождите.', '⏳');
        return;
    }
    lastMergeTime = Date.now();

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/merge', { creatureId });
    state.isLoading = false;

    if (!res.success) {
        showToast(res.message || 'Merge failed', '❌'); return;
    }

    state.user = res.user;
    state.inventory = res.inventory;
    if (res.incomePerHour !== undefined) {
        state.incomePerHour = res.incomePerHour;
    } else {
        state.incomePerHour = await getCurrentIncome();
    }
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);

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
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">
            ${toC.rarity.toUpperCase()} ${success ? '▲ UPGRADED' : ''}
        </div>
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
    if (state.serverBalance < cost) {
        showToast(`Need ${cost} MMO to upgrade!`, '❌'); return;
    }

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/upgrade-inventory');
    state.isLoading = false;

    if (!res.success) {
        showToast(res.message || 'Error', '❌'); return;
    }

    state.user = res.user;
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);
    updateHeader();
    renderCards();
    showToast(`+1 slot! Now ${state.user.inventorySlots} total`, '📦');
}

// ============================================================
// ADS
// ============================================================
async function updateAdsStatus() {
    if (window._adsUpdating) return;
    window._adsUpdating = true;
    
    try {
        const res = await apiRequest('GET', '/api/game/ads-status');
        if (res && res.success) {
            const adsRemainingEl = document.getElementById('adsRemaining');
            const adsTimerEl = document.getElementById('adsTimer');
            
            const available = res.adsAvailable !== undefined ? res.adsAvailable : (res.adsRemaining || 0);
            const maxAds = res.maxAdsPerDay || res.maxAdsAvailable || 10;
            
            if (adsRemainingEl) {
                adsRemainingEl.textContent = `${available}/${maxAds}`;
            }
            
            state.adsAvailable = available;
            state.maxAdsPerDay = maxAds;
            state.adsCooldown = res.cooldownSeconds || 0;
            
            if (available === 0 && res.nextRegenMinutes > 0) {
                if (adsTimerEl) {
                    adsTimerEl.textContent = `+1 через ${res.nextRegenMinutes}м`;
                    adsTimerEl.style.color = '#f59e0b';
                }
            } else if (state.adsCooldown > 0) {
                if (adsTimerEl) {
                    adsTimerEl.textContent = `${state.adsCooldown}s`;
                    adsTimerEl.style.color = '#94a3b8';
                }
            } else {
                if (adsTimerEl) {
                    adsTimerEl.textContent = 'Ready';
                    adsTimerEl.style.color = '#22c55e';
                }
            }
            
            const adsBtn = document.getElementById('adsBtn');
            if (adsBtn) {
                const canWatch = available > 0 && state.adsCooldown === 0;
                adsBtn.style.opacity = canWatch ? '1' : '0.5';
                adsBtn.disabled = !canWatch;
            }
            
            window.lastAdsUpdate = Date.now();
        }
    } catch (e) {
        console.error('updateAdsStatus error:', e);
    } finally {
        window._adsUpdating = false;
    }
}

async function watchAd() {
    if (state.isLoading) return;

    if (state.adsCooldown > 0) {
        showToast(`Реклама доступна через ${state.adsCooldown}с`, '⏳');
        return;
    }
    
    if (state.adsAvailable <= 0) {
        showToast(`Нет доступной рекламы. Восстановление через час.`, '📺');
        return;
    }

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

        if (typeof window.showGiga !== 'function') {
            throw new Error('Рекламный SDK не загружен');
        }

        await window.showGiga();
        
        const res = await apiRequest('POST', '/api/game/watch-ad');

        if (!res.success) {
            if (res.adsAvailable === 0 && res.nextRegenMinutes) {
                showToast(`Нет рекламы. Следующая через ${res.nextRegenMinutes} мин.`, '⚠️');
            } else {
                showToast(res.message || 'Ошибка', '❌');
            }
            if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
            if (timer) timer.textContent = 'Ready';
            return;
        }

        state.user = res.user;
        state.adsCooldown = res.cooldownSeconds || AD_COOLDOWN;
        state.adsAvailable = res.adsAvailable;
        
        updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);
        updateHeader();
        await loadUserStats();
        
        const nextRegenText = res.nextRegenMinutes > 0 ? ` (ещё ${res.nextRegenMinutes} мин до +1)` : '';
        showToast(`+${AD_REWARD} MMO! Осталось рекламы: ${res.adsAvailable}/${res.maxAdsPerDay}${nextRegenText}`, '🎉');
        spawnFloatingMMO(AD_REWARD);
        
        updateAdsStatus();
        
        if (btn && res.adsAvailable > 0 && state.adsCooldown === 0) {
            btn.style.opacity = '1';
            btn.disabled = false;
        }
        
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
        if (btn && state.adsCooldown > 0) {
            btn.style.opacity = '0.5';
            btn.disabled = true;
        }
    }
    
    if (state.adsCooldown === 0) {
        if (!window.lastAdsUpdate || Date.now() - window.lastAdsUpdate > 60000) {
            updateAdsStatus();
            window.lastAdsUpdate = Date.now();
        }
        
        const timerEl = document.getElementById('adsTimer');
        if (timerEl) {
            timerEl.textContent = 'Ready';
            timerEl.style.color = '#22c55e';
        }
        
        const btn = document.getElementById('adsBtn');
        if (btn && state.adsAvailable > 0) {
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    }
}

// ============================================================
// TRANSACTIONS
// ============================================================
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

    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="showEncyclopedia()"><i class="fa-solid fa-arrow-left"></i></div>
        <div class="popup-icon">${getIconHtml(c, true, color)}</div>
        <div class="popup-title" style="color:${color}">${escapeHtml(c.name)}</div>
        <div class="popup-subtitle">${escapeHtml(c.desc || '')}</div>
        <div class="popup-rarity" style="background:${color}22;color:${color};border:1px solid ${color}44">
            ${c.rarity.toUpperCase()} ${isFound ? '✓ DISCOVERED' : '🔒 UNDISCOVERED'}
        </div>
        <div class="popup-stats">
            <div class="popup-stat"><div class="popup-stat-val" style="color:${color}">${c.incomeBase}</div><div class="popup-stat-label">MMO/hr</div></div>
            <div class="popup-stat"><div class="popup-stat-val">${c.rarity === 'legendary' ? '★★★★★' : c.rarity === 'epic' ? '★★★★' : c.rarity === 'rare' ? '★★★' : c.rarity === 'uncommon' ? '★★' : '★'}</div><div class="popup-stat-label">Power</div></div>
        </div>
    `;
    document.getElementById('overlay').classList.add('show');
}

// ============================================================
// MARKETPLACE
// ============================================================
function switchMarketplaceTab(tab, event) {
    document.querySelectorAll('.marketplace-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.marketplace-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`marketplace-${tab}`).classList.add('active');
    
    if (event && event.target) {
        const btn = event.target.closest('.marketplace-tab-btn');
        if (btn) btn.classList.add('active');
    }
    
    isMarketplaceTabActive = true;

    if (tab === 'buy') renderMarketplaceBuy();
    if (tab === 'sell') renderMarketplaceSell();
    if (tab === 'mylistings') renderMarketplaceMyListings();
}

function getDataHash(data) {
    return JSON.stringify(data);
}

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
    
    marketplaceCache = {
        data: listings,
        hash: newHash,
        expiresAt: Date.now() + 10000
    };
    
    renderMarketplaceListings(listings);
}

function renderMarketplaceListings(listings) {
    const container = document.getElementById('marketplaceListings');
    if (!container) return;
    
    if (!listings.length) {
        container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">No listings available</div>`;
        return;
    }

    container.innerHTML = listings.map(l => {
        const c = getCreature(l.creatureId);
        if (!c) return '';
        const color = RARITY_COLORS[c.rarity];
        const isOwn = l.sellerTgId === state.user?.telegramId;

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
                    : `<button class="marketplace-buy-btn" onclick="buyFromMarketplace('${l._id}', ${l.price}, '${l.creatureId}')">BUY</button>`
                }
            </div>
        </div>`;
    }).join('');
}

function renderMarketplaceSell() {
    const cards = document.getElementById('marketplaceSellCards');
    if (!cards) return;

    if (!state.inventory.length) {
        cards.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">You have no creatures to sell</div>`;
        return;
    }

    cards.innerHTML = state.inventory.map(item => {
        const c = getCreature(item.creatureId);
        if (!c || !item.count) return '';
        return `<div class="marketplace-sell-card" style="cursor:pointer" onclick="openSellModal('${item.creatureId}', '${c.name}', ${item.count})">
            <div class="marketplace-sell-card-icon">${getIconHtml(c)}</div>
            <div class="marketplace-sell-card-name">${escapeHtml(c.name)}</div>
            <div style="font-size:9px;color:#4a5568">x${item.count}</div>
            <div style="font-size:10px;color:#06b6d4;font-weight:600;margin-top:4px">SET PRICE</div>
        </div>`;
    }).filter(Boolean).join('');
}

function openSellModal(creatureId, creatureName, count) {
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">Sell ${escapeHtml(creatureName)}</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Set your listing price</div>
        <div class="price-input-modal">
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Price (MMO)</div>
                <input type="number" class="price-input-field" id="sellPriceInput" placeholder="Enter price" min="10" max="100000" value="100" oninput="updateFeeCalculator()">
            </div>
            <div class="fee-calculator">
                <div class="fee-row"><span class="fee-label">Your Price</span><span class="fee-value" id="priceDisplay">100</span></div>
                <div class="fee-row" style="color:#ef4444"><span class="fee-label">Platform Fee (10%)</span><span class="fee-value fee" id="feeDisplay">-10</span></div>
                <div class="fee-row total"><span>You Receive</span><span class="fee-value final" id="finalDisplay">90</span></div>
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#22c55e,#16a34a);margin-top:16px" onclick="confirmSellListing('${creatureId}')">
            <i class="fa-solid fa-check"></i> LIST FOR SALE
        </button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">CANCEL</button>
    `;
    document.getElementById('overlay').classList.add('show');
    updateFeeCalculator();
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

    if (!res.success) {
        showToast(res.message || 'Error listing', '❌'); return;
    }

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
    if (!res || !res.success) {
        container.innerHTML = `<div class="empty-listings">Ошибка загрузки</div>`;
        return;
    }

    const listings = Array.isArray(res.listings) ? res.listings : [];
    if (!listings.length) {
        container.innerHTML = `<div class="empty-listings">У вас нет активных лотов</div>`;
        return;
    }

    container.innerHTML = listings.map(l => {
        const c = getCreature(l.creatureId);
        if (!c) return '';
        const color = RARITY_COLORS[c.rarity];
        const date = new Date(l.createdAt).toLocaleDateString();
        
        return `<div class="marketplace-my-listing">
            <div class="marketplace-my-listing-icon" style="background:${color}11;border-color:${color}44">
                ${getIconHtml(c)}
            </div>
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

    if (!res.success) {
        showToast(res.message || 'Error', '❌'); return;
    }

    state.inventory = res.inventory;
    renderCards();
    marketplaceCache.expiresAt = 0;
    renderMarketplaceMyListings();
    showToast('Listing cancelled, card returned', '✅');
}

async function buyFromMarketplace(listingId, price, creatureId) {
    if (state.isLoading) return;
    if (state.serverBalance < price) {
        showToast(`Need ${price} MMO`, '❌'); return;
    }

    state.isLoading = true;
    const res = await apiRequest('POST', '/api/marketplace/buy', { listingId });
    state.isLoading = false;

    if (!res.success) {
        showToast(res.message || 'Error buying', '❌'); return;
    }

    state.user = res.user;
    state.inventory = res.inventory;
    if (res.incomePerHour !== undefined) {
        state.incomePerHour = res.incomePerHour;
    } else {
        state.incomePerHour = await getCurrentIncome();
    }
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);

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

    if (!state.token) {
        list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">Loading...</div>`;
        return;
    }
    
    if (Date.now() < leaderboardCache.expiresAt && leaderboardCache.data) {
        renderLeaderboardData(leaderboardCache.data);
        return;
    }

    if (currentLeaderboardController) {
        currentLeaderboardController.abort();
    }
    currentLeaderboardController = new AbortController();

    const res = await apiRequest('GET', '/api/user/leaderboard', null, currentLeaderboardController.signal);
    if (!res || !res.success) {
        if (res === null) return;
        list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:20px;font-size:12px">Ошибка сервера</div>`;
        return;
    }
    
    if (res.leaders) {
        res.leaders = res.leaders.map(l => ({
            ...l,
            telegramId: l.telegramId
        }));
    }
    
    leaderboardCache = {
        data: res,
        expiresAt: Date.now() + 30 * 1000
    };
    
    renderLeaderboardData(res);
    currentLeaderboardController = null;
}

function renderLeaderboardData(data) {
    const list = document.getElementById('leaderboardList');
    if (!list) return;
    
    const currentUserId = state.user?.telegramId;
    if (!currentUserId) {
        console.warn('No current user telegram ID');
        return;
    }
    
    const leaders = data.leaders || [];
    
    if (!leaders.length) {
        list.innerHTML = `<div class="empty-listings">No players yet</div>`;
        return;
    }
    
    list.innerHTML = leaders.map(l => {
        const rank = l.rank;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        const isMe = l.telegramId === currentUserId;
        
        return `<div class="lb-item ${isMe ? 'me' : ''}">
            <div class="lb-rank ${rankClass}">${rankIcon}</div>
            <div class="lb-avatar" style="background:${isMe ? '#a855f7' : '#4a5568'}33;border:1px solid ${isMe ? '#a855f7' : '#4a5568'}44;color:${isMe ? '#a855f7' : '#fff'}">
                ${l.username[0]?.toUpperCase() || '?'}
            </div>
            <div class="lb-info">
                <div class="lb-name">${escapeHtml(l.username)} ${isMe ? '<span style="font-size:9px;color:#a855f7">(You)</span>' : ''}</div>
                <div class="lb-level">УР ${l.level} · ${getLevelTitle(l.level)}</div>
                <div class="lb-xp" style="font-size:9px;color:#4a5568">ОП: ${l.xp}/${l.level * 100}</div>
            </div>
            <div class="lb-score" style="display:flex;flex-direction:column;align-items:flex-end">
                <span style="font-size:12px;font-weight:700;color:#f59e0b">УР ${l.level}</span>
                <span style="font-size:9px;color:#22c55e">${formatNum(l.balance)} MMO</span>
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
        try {
            await navigator.clipboard.writeText(link);
            showToast('Invite link copied!', '🔗');
        } catch {
            showToast(link, '🔗');
        }
    }
}

async function renderFriendsList() {
    const container = document.getElementById('friendsList');
    if (!container) return;
    
    try {
        const res = await apiRequest('GET', '/api/user/referrals');
        if (!res || !res.success) {
            container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">
                <i class="fa-solid fa-circle-exclamation"></i> Error loading friends
            </div>`;
            return;
        }
        
        const referrals = res.referrals || [];
        const qualifiedCount = res.referralCount || 0;
        
        const friendCountDisplay = document.getElementById('friendCountDisplay');
        if (friendCountDisplay) {
            friendCountDisplay.textContent = `${qualifiedCount} друзей 5+ уровня из ${referrals.length}`;
        }
        
        if (referrals.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:30px 20px;font-size:12px">
                <i class="fa-solid fa-user-plus" style="font-size:24px;margin-bottom:10px;display:block"></i>
                Нет друзей<br>Пригласите друзей и помогите им достичь 5 уровня!
            </div>`;
            return;
        }
        
        container.innerHTML = referrals.map(friend => {
            const date = new Date(friend.joinedAt);
            const formattedDate = date.toLocaleDateString();
            const isQualified = friend.level >= 5;
            
            return `
                <div style="background:#0d1120;border:1px solid ${isQualified ? '#22c55e' : '#1e2d4a'};border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;margin-bottom:8px">
                    <div style="width:40px;height:40px;background:${isQualified ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#1e2d4a,#0d1120)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:1px solid ${isQualified ? '#22c55e' : '#a855f744'}">👤</div>
                    <div style="flex:1">
                        <div style="font-size:13px;font-weight:600;color:#e2e8f0">${escapeHtml(friend.username)}</div>
                        <div style="font-size:10px;color:#4a5568">Уровень ${friend.level} • Присоединился ${formattedDate}</div>
                    </div>
                    <div style="text-align:right">
                        ${isQualified 
                            ? '<div style="font-size:11px;color:#22c55e;font-weight:600">✅ 5+ уровень</div>'
                            : `<div style="font-size:11px;color:#f59e0b">📈 нужно ${5 - friend.level} ур.</div>`
                        }
                        <div style="font-size:12px;font-weight:700;color:#a855f7">${formatNum(friend.balance)} MMO</div>
                    </div>
                </div>
            `;
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
    
    if (currentFriends < requiredFriends) {
        showToast(`Нужно ${requiredFriends} друзей 5+ уровня (у вас ${currentFriends})`, '❌');
        return;
    }
    
    const rewardKey = `friend_reward_${requiredFriends}`;
    if (state.user?.completedSpecialQuests?.includes(rewardKey)) {
        showToast('Вы уже получили эту награду', 'ℹ️');
        return;
    }
    
    state.isLoading = true;
    showToast('🔄 Получение награды...', '');
    
    const res = await apiRequest('POST', '/api/game/claim-friend-reward', { requiredFriends, creatureId });
    
    state.isLoading = false;
    
    if (!res.success) {
        showToast(res.message || 'Ошибка', '❌');
        return;
    }
    
    state.user = res.user;
    state.inventory = res.inventory;
    if (res.incomePerHour !== undefined) {
        state.incomePerHour = res.incomePerHour;
    } else {
        state.incomePerHour = await getCurrentIncome();
    }
    
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);
    updateHeader();
    renderCards();
    await loadUserStats();
    updateFriendRewardButtons();
    renderSpecialQuests();
    
    showFriendRewardPopup(creatureName, creatureIcon);
}

function showFriendRewardPopup(creatureName, creatureIcon) {
    const colorMap = {
        'Rare Wolf': '#3b82f6',
        'Epic Wolf': '#a855f7',
        'Legendary Wolf': '#f59e0b'
    };
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
// SPECIAL QUESTS (С СОХРАНЕНИЕМ В localStorage)
// ============================================================

function loadQuestStatusesFromStorage() {
    const saved = localStorage.getItem(QUESTS_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            for (const [questId, data] of Object.entries(parsed)) {
                if (data.expiresAt && data.expiresAt > Date.now()) {
                    const remainingSeconds = Math.ceil((data.expiresAt - Date.now()) / 1000);
                    questStatuses.set(questId, {
                        status: data.status,
                        expiresAt: data.expiresAt,
                        timerId: null
                    });
                    restartQuestTimer(questId, remainingSeconds);
                } else if (data.status === 'pending' && data.expiresAt && data.expiresAt <= Date.now()) {
                    questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
                    saveQuestStatusesToStorage();
                    if (document.getElementById(`tab-special`).classList.contains('active')) {
                        updateQuestButton(questId, 'available');
                    }
                } else if (data.status === 'available') {
                    questStatuses.set(questId, { status: 'available', expiresAt: null, timerId: null });
                }
            }
        } catch (e) {
            console.error('Ошибка загрузки статусов квестов:', e);
        }
    }
}

function saveQuestStatusesToStorage() {
    const toSave = {};
    for (const [questId, data] of questStatuses.entries()) {
        toSave[questId] = {
            status: data.status,
            expiresAt: data.expiresAt || null
        };
    }
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
            if (quest) {
                showToast(`✅ Квест "${quest.title}" выполнен! Нажмите "ЗАБРАТЬ" для получения награды.`, '🎁');
            }
        }
    }, remainingSeconds * 1000);
    
    const questData = questStatuses.get(questId);
    if (questData) {
        questData.timerId = timerId;
        questStatuses.set(questId, questData);
    }
}

function clearAllQuestTimers() {
    for (const [questId, data] of questStatuses.entries()) {
        if (data.timerId) {
            clearTimeout(data.timerId);
        }
    }
    questStatuses.clear();
    localStorage.removeItem(QUESTS_STORAGE_KEY);
}

function getQuestTitle(questId) {
    const quest = SPECIAL_QUESTS.find(q => q.id === questId);
    return quest ? quest.title : 'квест';
}

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
            footer.innerHTML = `<button class="special-quest-btn pending" disabled style="background: #f59e0b; animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ...
            </button>`;
            break;
        case 'available':
            footer.innerHTML = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${questId}')" style="background: linear-gradient(135deg, #eab308, #ca8a04); animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-gift"></i> 🎁 ЗАБРАТЬ НАГРАДУ
            </button>`;
            break;
        default:
            if (quest.type === 'telegram_channel') {
                footer.innerHTML = `<button class="special-quest-btn" onclick="openChannelAndStartTimer('${quest.id}', '${quest.link}')">
                    <i class="fa-brands fa-telegram"></i> ВЫПОЛНИТЬ
                </button>`;
            } else if (quest.type === 'custom_link') {
                footer.innerHTML = `<button class="special-quest-btn" onclick="openCustomLinkAndComplete('${quest.id}', '${quest.link}')">
                    <i class="fa-solid fa-globe"></i> ВЫПОЛНИТЬ
                </button>`;
            } else if (quest.type === 'referral_count') {
                const currentFriends = state.user?.referralCount || 0;
                const required = quest.required_count || 1;
                if (currentFriends >= required) {
                    footer.innerHTML = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${quest.id}')">
                        <i class="fa-solid fa-gift"></i> ЗАБРАТЬ (${currentFriends}/${required})
                    </button>`;
                } else {
                    footer.innerHTML = `<button class="special-quest-btn locked" disabled>
                        <i class="fa-solid fa-lock"></i> НУЖНО ${required} ДРУЗЕЙ 5+ (${currentFriends})
                    </button>`;
                }
            }
            break;
    }
}

function openChannelAndStartTimer(questId, channelLink) {
    if (channelLink) {
        if (window.Telegram?.WebApp && channelLink.includes('t.me')) {
            window.Telegram.WebApp.openTelegramLink(channelLink);
        } else {
            window.open(channelLink, '_blank');
        }
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) {
        showToast('Вы уже получили награду за этот квест', 'ℹ️');
        return;
    }
    
    const existingStatus = questStatuses.get(questId);
    if (existingStatus && existingStatus.status === 'pending') {
        const remainingTime = existingStatus.expiresAt ? Math.ceil((existingStatus.expiresAt - Date.now()) / 1000) : 0;
        if (remainingTime > 0) {
            showToast(`Квест уже на проверке! Осталось ${remainingTime} секунд.`, '⏳');
            return;
        }
    }
    
    if (existingStatus && existingStatus.status === 'available') {
        showToast('Квест уже выполнен! Нажмите "ЗАБРАТЬ НАГРАДУ".', '🎁');
        updateQuestButton(questId, 'available');
        return;
    }
    
    const expiresAt = Date.now() + 60000;
    questStatuses.set(questId, { 
        status: 'pending', 
        expiresAt: expiresAt,
        timerId: null 
    });
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
    if (link) {
        window.open(link, '_blank');
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) {
        showToast('Вы уже получили награду за этот квест', 'ℹ️');
        return;
    }
    
    const existingStatus = questStatuses.get(questId);
    if (existingStatus && existingStatus.status === 'pending') {
        const remainingTime = existingStatus.expiresAt ? Math.ceil((existingStatus.expiresAt - Date.now()) / 1000) : 0;
        if (remainingTime > 0) {
            showToast(`Квест уже на проверке! Осталось ${remainingTime} секунд.`, '⏳');
            return;
        }
    }
    
    if (existingStatus && existingStatus.status === 'available') {
        showToast('Квест уже выполнен! Нажмите "ЗАБРАТЬ НАГРАДУ".', '🎁');
        updateQuestButton(questId, 'available');
        return;
    }
    
    const expiresAt = Date.now() + 60000;
    questStatuses.set(questId, { 
        status: 'pending', 
        expiresAt: expiresAt,
        timerId: null 
    });
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
            if (remainingTime > 0) {
                showToast(`Квест ещё на проверке! Осталось ${remainingTime} секунд.`, '⏳');
            } else {
                showToast('Квест ещё на проверке! Подождите немного.', '⏳');
            }
        } else {
            showToast('Сначала выполните квест!', '⚠️');
        }
        return;
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) {
        showToast('Вы уже получили награду за этот квест', 'ℹ️');
        return;
    }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/complete-special-quest', { questId });
    state.isLoading = false;
    
    if (!res.success) {
        showToast(res.message || 'Ошибка', '❌');
        return;
    }
    
    state.user = res.user;
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);
    updateHeader();
    await loadUserStats();
    
    const existing = questStatuses.get(questId);
    if (existing && existing.timerId) {
        clearTimeout(existing.timerId);
    }
    questStatuses.delete(questId);
    saveQuestStatusesToStorage();
    
    await renderSpecialQuests();
    showToast(`+${res.reward} MMO получено!`, '✅');
    spawnFloatingMMO(res.reward);
}

async function claimSpecialQuestSilent(questId) {
    if (state.isLoading) return;
    
    const questStatus = questStatuses.get(questId);
    if (questStatus && questStatus.status !== 'available') {
        return;
    }
    
    if (state.user?.completedSpecialQuests?.includes(questId)) {
        return;
    }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/game/complete-special-quest', { questId });
    state.isLoading = false;
    
    if (!res.success) {
        console.log('Ошибка получения награды:', res.message);
        return;
    }
    
    state.user = res.user;
    updateServerSnapshot(state.user.balance, state.incomePerHour, state.user.lastPassiveIncome || null);
    updateHeader();
    await loadUserStats();
    
    const existing = questStatuses.get(questId);
    if (existing && existing.timerId) {
        clearTimeout(existing.timerId);
    }
    questStatuses.delete(questId);
    saveQuestStatusesToStorage();
    
    await renderSpecialQuests();
    showToast(`+${res.reward} MMO получено за квест!`, '✅');
}

async function renderSpecialQuests() {
    const container = document.getElementById('specialQuestsList');
    if (!container) return;

    if (!SPECIAL_QUESTS.length) {
        container.innerHTML = `<div class="empty-grid" style="padding:40px;text-align:center">📢 Нет активных спец-квестов</div>`;
        return;
    }

    const completedQuests = new Set(state.user?.completedSpecialQuests || []);
    
    const filteredQuests = SPECIAL_QUESTS.filter(q => 
        q.type === 'telegram_channel' || q.type === 'referral_count' || q.type === 'custom_link'
    );
    
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
            actionHtml = `<button class="special-quest-btn pending" disabled style="background: #f59e0b; animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ${remainingText}
            </button>`;
        } else if (questStatus && questStatus.status === 'available') {
            actionHtml = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${quest.id}')" style="background: linear-gradient(135deg, #eab308, #ca8a04); animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-gift"></i> 🎁 ЗАБРАТЬ НАГРАДУ
            </button>`;
        } else {
            switch (quest.type) {
                case 'telegram_channel':
                    actionHtml = `<button class="special-quest-btn" onclick="openChannelAndStartTimer('${quest.id}', '${quest.link}')">
                        <i class="fa-brands fa-telegram"></i> ВЫПОЛНИТЬ
                    </button>`;
                    break;
                case 'custom_link':
                    actionHtml = `<button class="special-quest-btn" onclick="openCustomLinkAndComplete('${quest.id}', '${quest.link}')">
                        <i class="fa-solid fa-globe"></i> ВЫПОЛНИТЬ
                    </button>`;
                    break;
                case 'referral_count':
                    const currentFriends = state.user?.referralCount || 0;
                    const required = quest.required_count || 1;
                    if (currentFriends >= required) {
                        actionHtml = `<button class="special-quest-btn claim" onclick="claimSpecialQuest('${quest.id}')">
                            <i class="fa-solid fa-gift"></i> ЗАБРАТЬ (${currentFriends}/${required})
                        </button>`;
                    } else {
                        actionHtml = `<button class="special-quest-btn locked" disabled>
                            <i class="fa-solid fa-lock"></i> НУЖНО ${required} ДРУЗЕЙ 5+ (${currentFriends})
                        </button>`;
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
        if (pendingButtons.length === 0) {
            if (window.questTimerInterval) clearInterval(window.questTimerInterval);
            return;
        }
        
        for (const btn of pendingButtons) {
            const card = btn.closest('.special-quest-card');
            if (card) {
                const questId = card.dataset.questId;
                const questStatus = questStatuses.get(questId);
                if (questStatus && questStatus.expiresAt) {
                    const remaining = Math.ceil((questStatus.expiresAt - Date.now()) / 1000);
                    if (remaining > 0) {
                        btn.innerHTML = `<i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ (${remaining}с)`;
                    } else {
                        btn.innerHTML = `<i class="fa-solid fa-clock"></i> ⏳ НА ПРОВЕРКЕ...`;
                    }
                }
            }
        }
    }, 1000);
}

async function updateSpecialQuests() {
    await loadGameConfig();
    renderSpecialQuests();
}

// ============================================================
// ДЕПОЗИТЫ И ВЫВОДЫ
// ============================================================

const MIN_TRANSACTION_AMOUNT = 5000;
const MAX_ACTIVE_REQUESTS = 2;

async function showDepositModal() {
    if (state.isLoading) return;
    
    const activeCount = await checkActiveRequests();
    if (activeCount >= MAX_ACTIVE_REQUESTS) {
        showToast(`У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок. Дождитесь обработки.`, '⚠️');
        return;
    }
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💎 Пополнение баланса</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Минимальная сумма: ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO</div>
        <div class="price-input-modal">
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Сумма (MMO)</div>
                <input type="number" class="price-input-field" id="depositAmount" placeholder="Введите сумму" min="${MIN_TRANSACTION_AMOUNT}">
            </div>
        </div>
        <button class="popup-btn" style="background:linear-gradient(135deg,#06b6d4,#0891b2);margin-top:16px" onclick="getPaymentDetails()">
            <i class="fa-solid fa-arrow-down"></i> ПРОДОЛЖИТЬ
        </button>
        <button class="popup-btn" style="background:#1a2540;color:#e2e8f0;margin-top:8px" onclick="closeOverlay()">ОТМЕНА</button>
    `;
    document.getElementById('overlay').classList.add('show');
}

async function getPaymentDetails() {
    const amountInput = document.getElementById('depositAmount');
    const amount = parseInt(amountInput?.value);
    
    if (!amount || amount < MIN_TRANSACTION_AMOUNT) {
        showToast(`Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO`, '❌');
        return;
    }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/wallet/get-payment-details', { amount });
    state.isLoading = false;
    
    if (!res.success) {
        showToast(res.message || 'Ошибка', '❌');
        return;
    }
    
    currentPaymentMemo = res.memo;
    currentPaymentAmount = res.amount;
    
    showPaymentDetails(res.wallet, res.memo, res.amount);
}

function showPaymentDetails(wallet, memo, amount) {
    const amountInTON = (amount / 1000).toFixed(2);
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💎 Оплатите депозит</div>
        <div class="popup-subtitle">Сумма: ${amount.toLocaleString()} MMO</div>
        
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:16px;padding:16px;margin-bottom:16px">
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">💰 Сумма в TON (примерно)</div>
                <div style="font-family:'Orbitron',monospace;font-size:18px;font-weight:700;color:#f59e0b">≈ ${amountInTON} TON</div>
            </div>
            
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">🏦 Кошелек TON</div>
                <div style="background:#080b14;padding:10px;border-radius:10px;font-family:monospace;font-size:11px;word-break:break-all;border:1px solid #1e2d4a">
                    ${wallet}
                </div>
                <button onclick="copyToClipboard('${wallet}')" style="margin-top:6px;padding:4px 10px;background:#1a2540;border:none;border-radius:6px;color:#94a3b8;font-size:10px;cursor:pointer">
                    <i class="fa-regular fa-copy"></i> Копировать кошелек
                </button>
            </div>
            
            <div style="margin-bottom:12px">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:4px">📝 Мемо (ОБЯЗАТЕЛЬНО!)</div>
                <div style="background:#080b14;padding:10px;border-radius:10px;font-family:monospace;font-size:11px;font-weight:700;color:#06b6d4;border:1px solid #1e2d4a">
                    ${memo}
                </div>
                <button onclick="copyToClipboard('${memo}')" style="margin-top:6px;padding:4px 10px;background:#1a2540;border:none;border-radius:6px;color:#94a3b8;font-size:10px;cursor:pointer">
                    <i class="fa-regular fa-copy"></i> Копировать мемо
                </button>
            </div>
            
            <div style="font-size:10px;color:#ef4444;background:rgba(239,68,68,0.1);padding:8px;border-radius:8px;margin-top:8px">
                ⚠️ <b>Важно!</b> Укажите мемо в комментарии к переводу!\nПосле оплаты нажмите "Я ОПЛАТИЛ".
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

async function showWithdrawModal() {
    if (state.isLoading) return;
    
    const activeCount = await checkActiveRequests();
    if (activeCount >= MAX_ACTIVE_REQUESTS) {
        showToast(`У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок. Дождитесь обработки.`, '⚠️');
        return;
    }
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">💸 Вывод средств</div>
        <div class="popup-subtitle" style="margin-bottom:16px">Минимальная сумма: ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO</div>
        <div class="price-input-modal">
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Сумма (MMO)</div>
                <input type="number" class="price-input-field" id="withdrawAmount" placeholder="Введите сумму" min="${MIN_TRANSACTION_AMOUNT}">
            </div>
            <div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">TON Кошелек</div>
                <input type="text" class="price-input-field" id="withdrawWallet" placeholder="Введите TON адрес кошелька">
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
    
    if (!amount || amount < MIN_TRANSACTION_AMOUNT) {
        showToast(`Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO`, '❌');
        return;
    }
    
    if (!wallet || wallet.length < 20) {
        showToast('Введите корректный TON адрес кошелька (минимум 20 символов)', '❌');
        return;
    }
    
    if (state.user?.balance < amount) {
        showToast(`Недостаточно средств. Ваш баланс: ${state.user.balance.toLocaleString()} MMO`, '❌');
        return;
    }
    
    state.isLoading = true;
    const res = await apiRequest('POST', '/api/wallet/withdraw-request', { amount, wallet });
    state.isLoading = false;
    
    if (!res.success) {
        showToast(res.message || 'Ошибка создания заявки', '❌');
        return;
    }
    
    closeOverlay();
    showToast(`Заявка на вывод ${amount.toLocaleString()} MMO создана! Ожидайте подтверждения администратора.`, '✅');
    
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
    navigator.clipboard.writeText(text).then(() => {
        showToast('Скопировано!', '📋');
    }).catch(() => {
        showToast('Не удалось скопировать', '❌');
    });
}

// ============================================================
// ARENA MODULE С SSE (ОСНОВНЫЕ ИСПРАВЛЕНИЯ)
// ============================================================

// Инициализация вебхуков арены
function initArenaWebhooks() {
    if (!window.Telegram?.WebApp) return;
    
    const tg = window.Telegram.WebApp;
    
    tg.onEvent('popupClosed', (event) => {
        debugLog('📱 Popup closed: ' + event.button_id);
        if (event.button_id === 'accept') {
            acceptBattleWebhook();
        } else if (event.button_id === 'reject') {
            rejectBattleWebhook();
        }
    });
    
    tg.MainButton.setText('⚔️ НАЙТИ БОЯ');
    tg.MainButton.onClick(() => {
        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'tab-arena') {
            findMatch();
        } else {
            switchTab('arena');
            setTimeout(() => findMatch(), 500);
        }
    });
    tg.MainButton.hide();
}

function activateArenaMainButton() {
    if (!window.Telegram?.WebApp) return;
    
    const tg = window.Telegram.WebApp;
    
    const observer = new MutationObserver(() => {
        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'tab-arena') {
            tg.MainButton.setText('⚔️ НАЙТИ БОЯ');
            tg.MainButton.show();
            tg.MainButton.enable();
        } else {
            tg.MainButton.hide();
        }
    });
    
    observer.observe(document.getElementById('mainContent'), {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
    });
}

function showNativeBattleConfirmation(battleData) {
    if (!window.Telegram?.WebApp) {
        showBattleConfirmationHTML(battleData);
        return;
    }
    
    const tg = window.Telegram.WebApp;
    
    tg.showPopup({
        title: '⚔️ БОЙ НАЙДЕН!',
        message: `Противник: ${battleData.opponent?.name || 'Игрок'} (УР ${battleData.opponent?.level || '?'})\n` +
                 `🏆 Приз: ${battleData.prizePool} MMO\n` +
                 `💰 Ваша ставка: ${battleData.entryFee} MMO\n\n` +
                 `Принять бой?`,
        buttons: [
            { id: 'accept', type: 'default', text: '✅ ПРИНЯТЬ', color: '#22c55e' },
            { id: 'reject', type: 'destructive', text: '❌ ОТКЛОНИТЬ' }
        ]
    });
}

function showBattleConfirmationHTML(battleData) {
    const overlay = document.getElementById('overlay');
    const popup = document.getElementById('popup');
    
    popup.innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title" style="color:var(--accent3)">⚔️ Бой найден!</div>
        <div class="popup-subtitle">Противник: ${escapeHtml(battleData.opponent?.name || 'Игрок')} (УР ${battleData.opponent?.level || '?'})</div>
        <div style="background:#0d1120;border-radius:12px;padding:12px;margin:12px 0;">
            <div style="font-size:10px;color:#94a3b8;">Призовой фонд</div>
            <div style="font-size:20px;font-weight:700;color:var(--legendary)">${battleData.prizePool} MMO</div>
        </div>
        <div class="modal-buttons" style="display:flex;gap:10px;">
            <button class="popup-btn" style="flex:1;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="acceptBattleWebhook()">
                <i class="fa-solid fa-check"></i> Принять
            </button>
            <button class="popup-btn" style="flex:1;background:#1a2540;color:#e2e8f0" onclick="rejectBattleWebhook()">
                <i class="fa-solid fa-times"></i> Отклонить
            </button>
        </div>
        <div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:12px;">⏱ У вас 15 секунд на решение</div>
    `;
    
    overlay.classList.add('show');
    
    setTimeout(() => {
        if (overlay.classList.contains('show') && popup.innerHTML.includes('Бой найден')) {
            rejectBattleWebhook();
        }
    }, 15000);
}

function showNativeBattleResult(isWin, prizePool) {
    if (!window.Telegram?.WebApp) {
        const overlay = document.getElementById('overlay');
        const popup = document.getElementById('popup');
        popup.innerHTML = `
            <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
            <div class="popup-icon">${isWin ? '🏆' : '💀'}</div>
            <div class="popup-title" style="color:${isWin ? 'var(--legendary)' : 'var(--mythic)'}">
                ${isWin ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}
            </div>
            <div class="popup-subtitle">
                ${isWin ? `Вы выиграли ${prizePool} MMO!` : 'В следующий раз повезёт!'}
            </div>
            <button class="popup-btn" onclick="closeOverlay(); renderArenaFightTab();">
                Закрыть
            </button>
        `;
        overlay.classList.add('show');
        return;
    }
    const tg = window.Telegram.WebApp;
    const title = isWin ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ';
    const message = isWin 
        ? `Вы выиграли ${prizePool} MMO! 🎉\nВаш рейтинг повышается!`
        : `Вы проиграли бой.\nВ следующий раз повезёт!`;
    
    tg.showPopup({
        title: title,
        message: message,
        buttons: [{ id: 'ok', type: 'default', text: 'ОК' }]
    });
}

// Поиск боя
async function findMatch() {
    if (arenaState.isSearching) {
        showToast('Поиск уже идёт...', '⏳');
        return;
    }
    
    const teamRes = await apiRequest('GET', '/api/arena/team');
    if (!teamRes?.success || teamRes.teamIds?.length !== 3) {
        showToast('Сначала сохраните команду из 3 питомцев', '⚠️');
        return;
    }
    
    arenaState.isSearching = true;
    const findBtn = document.getElementById('findMatchBtn');
    const searchStatus = document.getElementById('arenaSearchStatus');
    
    if (findBtn) {
        findBtn.disabled = true;
        findBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Поиск...';
    }
    if (searchStatus) searchStatus.innerHTML = '🔍 Поиск соперника...';
    
    startArenaSSE();
    const res = await apiRequest('POST', '/api/arena/find-match');
    
    if (res?.success) {
        if (res.battle?.player2Id) {
            if (searchStatus) searchStatus.innerHTML = '⚔️ Соперник найден! Ожидание подтверждения...';
            const statusRes = await apiRequest('GET', '/api/arena/battle/status');
            if (statusRes?.hasBattle && statusRes.status === 'pending_confirmation') {
                arenaState.confirmationShown = true;
                showNativeBattleConfirmation(statusRes);
            }
        } else {
            if (searchStatus) searchStatus.innerHTML = '⏳ В очереди поиска...';
        }
    } else {
        stopArenaSSE();
        showToast(res?.message || 'Ошибка поиска', '❌');
        arenaState.isSearching = false;
        if (findBtn) {
            findBtn.disabled = false;
            findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой';
        }
        if (searchStatus) searchStatus.innerHTML = '';
    }
}

async function acceptBattleWebhook() {
    const battleRes = await apiRequest('GET', '/api/arena/battle/status');
    if (battleRes?.battleId) {
        await apiRequest('POST', '/api/arena/accept-match', { battleId: battleRes.battleId });
        closeOverlay();
        arenaState.confirmationShown = false;
    }
}

async function rejectBattleWebhook() {
    const battleRes = await apiRequest('GET', '/api/arena/battle/status');
    if (battleRes?.battleId) {
        await apiRequest('POST', '/api/arena/reject-match', { battleId: battleRes.battleId });
        arenaState.confirmationShown = false;
        closeOverlay();
        showToast('Бой отклонён', '⚠️');
        stopArenaSSE();
        renderArenaFightTab();
    }
}

function cancelBattleSearch() {
    stopArenaSSE();
    arenaState.isSearching = false;
    arenaState.confirmationShown = false;
    const findBtn = document.getElementById('findMatchBtn');
    if (findBtn) {
        findBtn.disabled = false;
        findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой';
    }
    const searchStatus = document.getElementById('arenaSearchStatus');
    if (searchStatus) searchStatus.innerHTML = '';
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.MainButton.setText('⚔️ НАЙТИ БОЯ');
        window.Telegram.WebApp.MainButton.enable();
    }
    showToast('Поиск отменён', '⚠️');
}

function switchArenaTab(tab) {
    document.querySelectorAll('.arena-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.arena-tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`arena-${tab}-tab`).classList.add('active');
    document.querySelector(`.arena-tab-btn[data-arena-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'team') renderArenaTeamInventory();
    if (tab === 'fight') renderArenaFightTab();
    if (tab === 'ranking') renderArenaRanking();
}

async function renderArenaTeamInventory() {
    const container = document.getElementById('arenaTeamInventory');
    if (!container) return;
    
    if (arenaState.selectedTeam.length === 0) {
        const teamRes = await apiRequest('GET', '/api/arena/team');
        if (teamRes?.success && teamRes.teamIds) {
            arenaState.selectedTeam = teamRes.teamIds;
            renderSelectedTeam();
        }
    }
    
    container.innerHTML = state.inventory.map(item => {
        const c = getCreature(item.creatureId);
        if (!c) return '';
        const isSelected = arenaState.selectedTeam.includes(c.id);
        const isDisabled = !isSelected && arenaState.selectedTeam.length >= 3;
        
        return `<div class="arena-team-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" 
                    onclick="toggleArenaCreature('${c.id}')">
                    <div class="arena-team-icon">${getIconHtml(c)}</div>
                    <div class="arena-team-name">${escapeHtml(c.name)}</div>
                    <div class="arena-team-stats">
                        <span>💰 ${c.incomeBase}/hr</span>
                    </div>
                    ${isSelected ? '<div class="arena-team-check"><i class="fa-solid fa-check"></i></div>' : ''}
                </div>`;
    }).join('');
}

function toggleArenaCreature(creatureId) {
    const index = arenaState.selectedTeam.indexOf(creatureId);
    
    if (index !== -1) {
        arenaState.selectedTeam.splice(index, 1);
    } else if (arenaState.selectedTeam.length < 3) {
        arenaState.selectedTeam.push(creatureId);
    } else {
        showToast('Нельзя выбрать больше 3 питомцев', '⚠️');
        return;
    }
    
    renderArenaTeamInventory();
    renderSelectedTeam();
}

async function renderSelectedTeam() {
    const container = document.getElementById('arenaSelectedTeam');
    if (!container) return;
    
    if (arenaState.selectedTeam.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;">Выберите 3 питомца для команды</div>';
        return;
    }
    
    const teamData = [];
    for (const creatureId of arenaState.selectedTeam) {
        const creature = getCreature(creatureId);
        if (creature) {
            const multiplier = RARITY_MULTIPLIERS[creature.rarity] || 1;
            const level = state.user?.level || 1;
            const hp = Math.ceil((50 + (creature.incomeBase * 2) + (level * 5)) * multiplier);
            const atk = Math.ceil((10 + (creature.incomeBase / 2) + (level * 2)) * multiplier);
            const def = Math.ceil((5 + (creature.incomeBase / 3) + (level * 1)) * multiplier);
            const crit = Math.round(0.10 * 100);
            teamData.push({ creature, hp, atk, def, crit });
        }
    }
    
    container.innerHTML = `<div class="arena-team-cards">
        ${teamData.map(data => `
            <div class="arena-selected-card">
                <div class="arena-selected-icon">${getIconHtml(data.creature)}</div>
                <div class="arena-selected-name">${escapeHtml(data.creature.name)}</div>
                <div class="arena-selected-stats">
                    <span>❤️ ${data.hp}</span>
                    <span>⚔️ ${data.atk}</span>
                    <span>🛡️ ${data.def}</span>
                    <span>✨ ${data.crit}%</span>
                </div>
            </div>
        `).join('')}
    </div>`;
}

async function saveArenaTeam() {
    if (arenaState.selectedTeam.length !== 3) {
        showToast('Нужно выбрать ровно 3 питомца', '⚠️');
        return;
    }
    
    const res = await apiRequest('POST', '/api/arena/team', { team: arenaState.selectedTeam });
    
    if (res?.success) {
        showToast('Команда сохранена!', '✅');
    } else {
        showToast(res?.message || 'Ошибка сохранения', '❌');
    }
}

// ============================================================
// SSE — подключение к серверным событиям арены (ИСПРАВЛЕННАЯ)
// ============================================================
function startArenaSSE() {
    stopArenaSSE();
    
    if (!state.token) {
        debugLog('❌ Нет токена, SSE не подключён');
        return;
    }
    
    debugLog('📡 Подключаем SSE...');
    
    const url = `${API_URL}/api/arena/events?token=${encodeURIComponent(state.token)}`;
    const sse = new EventSource(url);
    arenaState.sseConnection = sse;
    
    sse.onopen = () => {
        debugLog('✅ SSE соединение открыто!');
    };
    
    sse.onerror = (e) => {
        debugLog('⚠️ SSE ошибка, переподключение...');
        if (arenaState.isSearching || arenaState.battleActive) {
            setTimeout(startArenaSSE, 3000);
        }
    };
    
    sse.addEventListener('match_found', (e) => {
        debugLog('⚔️ ПОЛУЧЕНО match_found!');
        try {
            const data = JSON.parse(e.data);
            debugLog(`Бой ${data.battleId}, я игрок ${data.isPlayer1 ? '1' : '2'}`);
            arenaState.isSearching = true;
            arenaState.currentBattleIsPlayer1 = data.isPlayer1;
            arenaState.currentBattleId = data.battleId;
            
            const searchStatus = document.getElementById('arenaSearchStatus');
            if (searchStatus) searchStatus.innerHTML = '⚔️ Соперник найден! Подтвердите бой...';
            
            if (!arenaState.confirmationShown) {
                arenaState.confirmationShown = true;
                showNativeBattleConfirmation(data);
            }
        } catch (err) {
            debugLog('❌ Ошибка match_found: ' + err.message);
        }
    });
    
    sse.addEventListener('battle_start', (e) => {
        debugLog('🚀 ПОЛУЧЕНО battle_start!');
        try {
            const data = JSON.parse(e.data);
            debugLog(`Бой начался! Ход: ${data.currentTurn}`);
            arenaState.confirmationShown = false;
            arenaState.battleActive = true;
            arenaState.isSearching = false;
            arenaState.currentBattleIsPlayer1 = data.isPlayer1;
            arenaState.currentBattleId = data.battleId;
            
            const overlay = document.getElementById('overlay');
            if (overlay && overlay.classList.contains('show')) closeOverlay();
            
            renderBattleInterface(data);
            debugLog('✅ Интерфейс боя отображён');
            
            const searchStatus = document.getElementById('arenaSearchStatus');
            if (searchStatus) searchStatus.innerHTML = '';
        } catch (err) {
            debugLog('❌ Ошибка battle_start: ' + err.message);
        }
    });
    
    sse.addEventListener('move_update', (e) => {
        debugLog('🗡️ ПОЛУЧЕНО move_update!');
        try {
            const data = JSON.parse(e.data);
            if (!arenaState.battleActive) {
                debugLog('⚠️ Бой не активен, пропускаем');
                return;
            }
            updateBattleUI(data);
            debugLog('✅ UI обновлён после хода');
        } catch (err) {
            debugLog('❌ Ошибка move_update: ' + err.message);
        }
    });
    
    sse.addEventListener('battle_end', (e) => {
        debugLog('🏁 ПОЛУЧЕНО battle_end!');
        try {
            const data = JSON.parse(e.data);
            arenaState.battleActive = false;
            arenaState.isSearching = false;
            
            const isWin = data.winnerId === state.user?._id?.toString();
            debugLog(isWin ? '🎉 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ');
            showNativeBattleResult(isWin, data.prizePool || 0);
            
            if (battleTimerInterval) clearInterval(battleTimerInterval);
            renderArenaFightTab();
            refreshUserProfile();
        } catch (err) {
            debugLog('❌ Ошибка battle_end: ' + err.message);
        }
    });
    
    debugLog('📡 SSE настроен, ожидаем события...');
}

function stopArenaSSE() {
    if (arenaState.sseConnection) {
        arenaState.sseConnection.close();
        arenaState.sseConnection = null;
        debugLog('📡 SSE закрыт');
    }
}

function renderBattleInterface(battleData) {
    const container = document.getElementById('arenaBattleContainer');
    if (!container) {
        debugLog('❌ arenaBattleContainer не найден!');
        return;
    }
    
    debugLog('🎨 Рендерим интерфейс боя...');
    debugLog(`myTeam: ${battleData.myTeam?.length} существ, opponentTeam: ${battleData.opponentTeam?.length} существ`);
    
    arenaState.battleActive = true;
    arenaState.currentBattleIsPlayer1 = battleData.isPlayer1;
    arenaState.currentBattleId = battleData.battleId;
    
    const isMyTurn = (battleData.currentTurn === 'player1' && battleData.isPlayer1) ||
                     (battleData.currentTurn === 'player2' && !battleData.isPlayer1);
    
    const myTeam = battleData.myTeam;
    const enemyTeam = battleData.opponentTeam;
    
    container.innerHTML = `
        <div class="arena-battle-container">
            <div class="arena-team-side">
                <div class="arena-side-title">⚔️ ВАША КОМАНДА</div>
                <div class="arena-creatures-row" id="arenaMyCreatures">
                    ${myTeam.map((creature, idx) => `
                        <div class="arena-battle-creature ${!creature.isAlive ? 'dead' : ''}" data-creature-index="${idx}">
                            <div class="creature-icon">${getIconHtml(creature)}</div>
                            <div class="creature-name">${escapeHtml(creature.name)}</div>
                            <div class="creature-hp">❤️ ${creature.currentHp}/${creature.maxHp}</div>
                            <div class="arena-hp-bar"><div class="arena-hp-fill" style="width: ${(creature.currentHp / creature.maxHp) * 100}%"></div></div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="arena-battle-vs">VS</div>
            
            <div class="arena-team-side">
                <div class="arena-side-title">🛡️ КОМАНДА СОПЕРНИКА</div>
                <div class="arena-creatures-row" id="arenaEnemyCreatures">
                    ${enemyTeam.map((creature, idx) => `
                        <div class="arena-battle-creature ${!creature.isAlive ? 'dead' : ''}" data-enemy-index="${idx}">
                            <div class="creature-icon">${getIconHtml(creature)}</div>
                            <div class="creature-name">${escapeHtml(creature.name)}</div>
                            <div class="creature-hp">❤️ ${creature.currentHp}/${creature.maxHp}</div>
                            <div class="arena-hp-bar"><div class="arena-hp-fill" style="width: ${(creature.currentHp / creature.maxHp) * 100}%"></div></div>
                            ${isMyTurn && creature.isAlive ? `<button class="arena-attack-btn" onclick="makeAttack(${idx})">⚔️ Атаковать</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="arena-battle-log" id="arenaBattleLog">
                ${battleData.battleLog && battleData.battleLog.length ? 
                    battleData.battleLog.map(log => `
                        <div class="arena-log-entry ${log.isCrit ? 'crit' : ''}">
                            Ход ${log.turn}: ${log.attackerName} → ${log.targetName}: ${log.damage} урона ${log.isCrit ? '💥 КРИТ!' : ''}
                        </div>
                    `).join('') : 
                    '<div class="arena-log-entry">Бой начинается...</div>'
                }
            </div>
            
            <div class="arena-battle-timer" id="arenaBattleTimer">⏱ 30</div>
            
            <button class="arena-surrender-btn" onclick="surrenderBattle()">
                <i class="fa-solid fa-flag"></i> Сдаться
            </button>
        </div>
    `;
    
    debugLog(`✅ Рендер завершён. Моих: ${myTeam.length}, Врагов: ${enemyTeam.length}`);
    startBattleTimer();
}

async function makeAttack(targetIndex) {
    if (!arenaState.battleActive) {
        showToast('Бой не активен', '⚠️');
        return;
    }
    
    if (!arenaState.currentBattleId) {
        showToast('ID боя не найден', '⚠️');
        return;
    }
    
    debugLog(`⚔️ Атака цели ${targetIndex} в бою ${arenaState.currentBattleId}`);
    
    const res = await apiRequest('POST', '/api/arena/move', { 
        battleId: arenaState.currentBattleId, 
        targetIndex: targetIndex 
    });
    
    debugLog(`Результат атаки: ${res?.success ? 'успех' : 'ошибка'}`);
    
    if (res?.success) {
        if (res.finished) {
            arenaState.battleActive = false;
            showNativeBattleResult(true, res.prizePool || 0);
            if (battleTimerInterval) clearInterval(battleTimerInterval);
            renderArenaFightTab();
            refreshUserProfile();
        } else {
            if (res.lastMove) {
                showDamageAnimation(targetIndex, res.lastMove.damage, res.lastMove.isCrit);
                const freshStatus = await apiRequest('GET', '/api/arena/battle/status');
                if (freshStatus?.hasBattle && freshStatus.status === 'active') {
                    arenaState.currentBattleIsPlayer1 = freshStatus.isPlayer1;
                    updateBattleUI(freshStatus);
                }
            }
        }
    } else {
        showToast(res?.message || 'Ошибка атаки', '❌');
    }
}

async function refreshBattleStatus() {
    const battleRes = await apiRequest('GET', '/api/arena/battle/status');
    if (battleRes?.hasBattle && battleRes.status === 'active') {
        arenaState.currentBattleIsPlayer1 = battleRes.isPlayer1;
        updateBattleUI(battleRes);
    }
}

function showDamageAnimation(targetIndex, damage, isCrit) {
    const enemyCreature = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${targetIndex}"]`);
    if (enemyCreature) {
        const damageDiv = document.createElement('div');
        damageDiv.className = `arena-damage-number ${isCrit ? 'crit' : ''}`;
        damageDiv.textContent = `-${damage}`;
        enemyCreature.style.position = 'relative';
        enemyCreature.appendChild(damageDiv);
        
        setTimeout(() => damageDiv.remove(), 1000);
        
        if (isCrit) {
            enemyCreature.style.animation = 'damageShake 0.3s ease';
            setTimeout(() => enemyCreature.style.animation = '', 300);
        }
    }
}

function showIncomingDamageAnimation(lastMove) {
    if (!lastMove) return;
    const myCreatures = document.querySelectorAll('#arenaMyCreatures .arena-battle-creature');
    if (!myCreatures.length) return;
    const target = myCreatures[lastMove.targetIndex] || myCreatures[0];
    if (!target) return;
    const damageDiv = document.createElement('div');
    damageDiv.className = `arena-damage-number ${lastMove.isCrit ? 'crit' : ''}`;
    damageDiv.textContent = `-${lastMove.damage}`;
    target.style.position = 'relative';
    target.appendChild(damageDiv);
    setTimeout(() => damageDiv.remove(), 1000);
    if (lastMove.isCrit) {
        target.style.animation = 'damageShake 0.3s ease';
        setTimeout(() => target.style.animation = '', 300);
    }
}

function startBattleTimer() {
    if (battleTimerInterval) clearInterval(battleTimerInterval);
    
    let timeLeft = 30;
    const timerEl = document.getElementById('arenaBattleTimer');
    
    battleTimerInterval = setInterval(() => {
        timeLeft--;
        if (timerEl) {
            timerEl.textContent = `⏱ ${timeLeft}`;
            if (timeLeft <= 5) timerEl.classList.add('warning');
            else timerEl.classList.remove('warning');
        }
        
        if (timeLeft <= 0) {
            clearInterval(battleTimerInterval);
            battleTimerInterval = null;
        }
    }, 1000);
}

async function surrenderBattle() {
    if (!confirm('Вы уверены, что хотите сдаться? Вы потеряете MMO за вход.')) return;
    
    const battleRes = await apiRequest('GET', '/api/arena/battle/status');
    if (battleRes?.battleId) {
        const res = await apiRequest('POST', '/api/arena/surrender', { battleId: battleRes.battleId });
        if (res?.success) {
            arenaState.battleActive = false;
            showToast('Вы сдались', '⚠️');
            renderArenaFightTab();
        }
    }
}

function updateBattleUI(data) {
    debugLog('🔄 updateBattleUI вызвана');
    
    if (!arenaState.battleActive) {
        debugLog('❌ Бой не активен');
        return;
    }
    
    const isPlayer1 = arenaState.currentBattleIsPlayer1;
    debugLog(`isPlayer1: ${isPlayer1}`);
    
    // Получаем команды
    let myTeam = null;
    let enemyTeam = null;
    
    if (data.player1Team && data.player2Team) {
        if (isPlayer1) {
            myTeam = data.player1Team;
            enemyTeam = data.player2Team;
        } else {
            myTeam = data.player2Team;
            enemyTeam = data.player1Team;
        }
    } else if (data.myTeam && data.opponentTeam) {
        myTeam = data.myTeam;
        enemyTeam = data.opponentTeam;
    }
    
    if (!myTeam || !enemyTeam) {
        debugLog('❌ Нет данных о командах');
        return;
    }
    
    // Обновляем моих существ
    for (let i = 0; i < myTeam.length; i++) {
        const creature = myTeam[i];
        const creatureEl = document.querySelector(`#arenaMyCreatures .arena-battle-creature[data-creature-index="${i}"]`);
        if (creatureEl) {
            const hpEl = creatureEl.querySelector('.creature-hp');
            const fillEl = creatureEl.querySelector('.arena-hp-fill');
            if (hpEl) hpEl.textContent = `❤️ ${Math.max(0, creature.currentHp)}/${creature.maxHp}`;
            if (fillEl) fillEl.style.width = `${(creature.currentHp / creature.maxHp) * 100}%`;
            if (!creature.isAlive) creatureEl.classList.add('dead');
            debugLog(`Мой ${i}: HP ${creature.currentHp}/${creature.maxHp}`);
        } else {
            debugLog(`⚠️ Элемент моего ${i} не найден!`);
        }
    }
    
    // Обновляем врагов
    for (let i = 0; i < enemyTeam.length; i++) {
        const creature = enemyTeam[i];
        const creatureEl = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${i}"]`);
        if (creatureEl) {
            const hpEl = creatureEl.querySelector('.creature-hp');
            const fillEl = creatureEl.querySelector('.arena-hp-fill');
            if (hpEl) hpEl.textContent = `❤️ ${Math.max(0, creature.currentHp)}/${creature.maxHp}`;
            if (fillEl) fillEl.style.width = `${(creature.currentHp / creature.maxHp) * 100}%`;
            if (!creature.isAlive) creatureEl.classList.add('dead');
            debugLog(`Враг ${i}: HP ${creature.currentHp}/${creature.maxHp}`);
        } else {
            debugLog(`⚠️ Элемент врага ${i} не найден!`);
        }
    }
    
    // Добавляем запись в лог
    if (data.lastMove && data.lastMove.damage !== undefined) {
        const logEl = document.getElementById('arenaBattleLog');
        if (logEl) {
            const logEntry = document.createElement('div');
            logEntry.className = `arena-log-entry ${data.lastMove.isCrit ? 'crit' : ''}`;
            const targetName = data.lastMove.targetName || `питомец ${(data.lastMove.targetIndex || 0) + 1}`;
            logEntry.textContent = `⚔️ Ход ${data.turnCount || '?'}: ${data.lastMove.damage} урона${data.lastMove.isCrit ? ' 💥 КРИТ!' : ''}`;
            logEl.appendChild(logEntry);
            logEl.scrollTop = logEl.scrollHeight;
            while (logEl.children.length > 20) logEl.removeChild(logEl.firstChild);
        }
    }
    
    // Обновляем кнопки атаки
    if (data.currentTurn) {
        const isMyTurn = (data.currentTurn === 'player1' && isPlayer1) ||
                         (data.currentTurn === 'player2' && !isPlayer1);
        
        for (let i = 0; i < enemyTeam.length; i++) {
            const creature = enemyTeam[i];
            const creatureEl = document.querySelector(`#arenaEnemyCreatures .arena-battle-creature[data-enemy-index="${i}"]`);
            if (!creatureEl) continue;
            
            const existingBtn = creatureEl.querySelector('.arena-attack-btn');
            
            if (isMyTurn && creature.isAlive) {
                if (!existingBtn) {
                    const btn = document.createElement('button');
                    btn.className = 'arena-attack-btn';
                    btn.textContent = '⚔️ Атаковать';
                    btn.onclick = () => makeAttack(i);
                    creatureEl.appendChild(btn);
                }
            } else if (existingBtn) {
                existingBtn.remove();
            }
        }
    }
    
    startBattleTimer();
}

function updateBattleStatusDisplay(data) {
    const searchStatus = document.getElementById('arenaSearchStatus');
    const findBtn = document.getElementById('findMatchBtn');
    const battleContainer = document.getElementById('arenaBattleContainer');
    const statusContainer = document.getElementById('arenaFightStatus');
    
    if (data.status === 'pending_confirmation') {
        if (searchStatus) searchStatus.innerHTML = '⚔️ Соперник найден! Ожидание подтверждения...';
        if (statusContainer) statusContainer.style.display = 'block';
        if (battleContainer) battleContainer.style.display = 'none';
        if (findBtn) {
            findBtn.disabled = false;
            findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Найти бой';
        }
    } else if (data.status === 'active') {
        if (searchStatus) searchStatus.innerHTML = '';
        if (statusContainer) statusContainer.style.display = 'none';
        if (battleContainer) battleContainer.style.display = 'block';
    }
}

async function renderArenaFightTab() {
    debugLog('🎮 renderArenaFightTab вызвана');
    
    const statusContainer = document.getElementById('arenaFightStatus');
    const battleContainer = document.getElementById('arenaBattleContainer');
    
    if (arenaState.battleActive) {
        debugLog('Бой активен, пропускаем перерисовку');
        if (battleContainer) battleContainer.style.display = 'block';
        if (statusContainer) statusContainer.style.display = 'none';
        return;
    }
    
    try {
        const battleRes = await apiRequest('GET', '/api/arena/battle/status');
        debugLog('📡 Статус боя: ' + (battleRes?.status || 'нет боя'));
        
        if (battleRes?.hasBattle && battleRes.status !== 'finished' && battleRes.status !== 'expired') {
            if (statusContainer) statusContainer.style.display = 'none';
            if (battleContainer) battleContainer.style.display = 'block';
            
            if (battleRes.status === 'waiting') {
                arenaState.isSearching = true;
                battleContainer.innerHTML = `
                    <div class="arena-battle-container" style="text-align:center;padding:40px;">
                        <div class="popup-icon" style="font-size:48px;">⏳</div>
                        <div class="popup-title" style="font-size:18px;margin-top:10px;">Поиск соперника...</div>
                        <div class="popup-subtitle" style="margin-bottom:20px;">Ожидание игрока</div>
                        <div style="background:#0d1120;border-radius:12px;padding:12px;margin-bottom:20px;">
                            <div>💰 Ставка: ${battleRes.entryFee} MMO</div>
                            <div>🏆 Приз: ${battleRes.prizePool} MMO</div>
                        </div>
                        <button class="arena-surrender-btn" onclick="cancelBattleSearch()" style="background:#ef4444;color:#fff;">
                            <i class="fa-solid fa-times"></i> Отменить поиск
                        </button>
                    </div>
                `;
            } else if (battleRes.status === 'active') {
                arenaState.battleActive = true;
                arenaState.currentBattleIsPlayer1 = battleRes.isPlayer1;
                arenaState.currentBattleId = battleRes.battleId;
                renderBattleInterface(battleRes);
            } else if (battleRes.status === 'pending_confirmation') {
                const myConfirmed = battleRes.isPlayer1 ? battleRes.player1Confirmed : battleRes.player2Confirmed;
                if (!myConfirmed && !arenaState.confirmationShown) {
                    arenaState.confirmationShown = true;
                    arenaState.currentBattleIsPlayer1 = battleRes.isPlayer1;
                    arenaState.currentBattleId = battleRes.battleId;
                    showNativeBattleConfirmation(battleRes);
                }
            }
        } else {
            if (statusContainer) statusContainer.style.display = 'block';
            if (battleContainer) battleContainer.style.display = 'none';
            arenaState.battleActive = false;
            arenaState.isSearching = false;
            
            const level = state.user?.level || 1;
            let league = 'bronze';
            let entryFee = 500;
            let prizePool = 800;
            
            if (level >= 50) { league = 'diamond'; entryFee = 5000; prizePool = 8000; }
            else if (level >= 30) { league = 'platinum'; entryFee = 2000; prizePool = 3200; }
            else if (level >= 20) { league = 'gold'; entryFee = 1000; prizePool = 1600; }
            else if (level >= 10) { league = 'silver'; entryFee = 500; prizePool = 800; }
            
            const entryFeeEl = document.getElementById('arenaEntryFee');
            const prizePoolEl = document.getElementById('arenaPrizePool');
            const leagueEl = document.getElementById('arenaLeague');
            if (entryFeeEl) entryFeeEl.textContent = entryFee;
            if (prizePoolEl) prizePoolEl.textContent = prizePool;
            if (leagueEl) leagueEl.textContent = league === 'diamond' ? 'Алмазная' : 
                                                  league === 'platinum' ? 'Платиновая' : 
                                                  league === 'gold' ? 'Золотая' : 
                                                  league === 'silver' ? 'Серебряная' : 'Бронзовая';
            
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
                if (teamRes.teamIds) {
                    arenaState.selectedTeam = teamRes.teamIds;
                    renderSelectedTeam();
                }
            }
        }
    } catch (err) {
        debugLog('❌ renderArenaFightTab error: ' + err.message);
    }
}

async function renderArenaRanking() {
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
    
    const container = document.getElementById('arenaLeaderboardList');
    if (container) {
        container.innerHTML = res.leaders.map((player, idx) => `
            <div class="lb-item ${player.rating === res.myStats?.rating ? 'me' : ''}">
                <div class="lb-rank ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}">
                    ${idx + 1}
                </div>
                <div class="lb-avatar" style="background: linear-gradient(135deg, var(--accent), var(--accent3));">
                    ${player.name[0]?.toUpperCase() || '?'}
                </div>
                <div class="lb-info">
                    <div class="lb-name">${escapeHtml(player.name)}</div>
                    <div class="lb-level">УР ${player.level}</div>
                </div>
                <div class="lb-score">
                    <span>${player.rating}</span>
                    <span style="font-size:9px;">${player.wins}/${player.losses}</span>
                </div>
            </div>
        `).join('');
    }
}

// ============================================================
// NAVIGATION
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
    document.getElementById('mainContent').scrollTop = 0;
    
    isMarketplaceTabActive = (tab === 'shop');

    if (tab === 'leaderboard') {
        leaderboardCache = { data: null, expiresAt: 0 };
        renderLeaderboard();
    }
    if (tab === 'special') renderSpecialQuests();
    if (tab === 'wallet') {
        updateHeader();
        checkActiveRequests();
        loadUserStats();
    }
    if (tab === 'shop') renderMarketplaceBuy();
    if (tab === 'friends') renderFriendsList();
    if (tab === 'arena') {
        renderArenaTeamInventory();
        renderArenaFightTab();
        renderArenaRanking();
        
        if (!arenaState.sseConnection && state.token) {
            debugLog('🔄 Переподключаем SSE при входе в арену');
            startArenaSSE();
        }
    }
}

// ============================================================
// OVERLAY
// ============================================================
function closeOverlay(e) {
    if (e && e.target !== document.getElementById('overlay')) return;
    document.getElementById('overlay').classList.remove('show');
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, icon = '') {
    const t = document.getElementById('toast');
    t.textContent = (icon ? icon + ' ' : '') + msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

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
document.addEventListener('DOMContentLoaded', () => {
    initTelegramApp();
    
    window.checkSSE = () => {
        debugLog('🔍 Проверка SSE:');
        debugLog(`   connection exists: ${!!arenaState.sseConnection}`);
        debugLog(`   readyState: ${arenaState.sseConnection?.readyState}`);
        debugLog(`   isSearching: ${arenaState.isSearching}`);
        debugLog(`   battleActive: ${arenaState.battleActive}`);
    };
    
    window.testSSE = () => {
        debugLog('=== ДИАГНОСТИКА SSE ===');
        debugLog(`sseConnection exists: ${!!arenaState.sseConnection}`);
        debugLog(`readyState: ${arenaState.sseConnection?.readyState}`);
        debugLog(`isSearching: ${arenaState.isSearching}`);
        debugLog(`battleActive: ${arenaState.battleActive}`);
        debugLog(`token exists: ${!!state.token}`);
        debugLog(`API_URL: ${API_URL}`);
    };
    
    window.reconnectSSE = () => {
        debugLog('🔄 Принудительное переподключение SSE...');
        stopArenaSSE();
        startArenaSSE();
    };
    
    window.listenSSE = () => {
        if (!arenaState.sseConnection) {
            debugLog('❌ SSE не подключен');
            return;
        }
        debugLog('👂 Начинаю слушать SSE события...');
        arenaState.sseConnection.addEventListener('test', (e) => {
            debugLog('🧪 TEST событие: ' + e.data);
        });
        debugLog('✅ Слушатель добавлен. Ждите событий...');
    };
});

// ============================================================
// ЭКСПОРТ ФУНКЦИЙ ДЛЯ ГЛОБАЛЬНОГО ДОСТУПА
// ============================================================

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
window.createWithdrawRequest = createWithdrawRequest;
window.copyToClipboard = copyToClipboard;
window.checkActiveRequests = checkActiveRequests;
window.loadUserStats = loadUserStats;
window.refreshUserProfile = refreshUserProfile;
// ARENA exports
window.switchArenaTab = switchArenaTab;
window.toggleArenaCreature = toggleArenaCreature;
window.saveArenaTeam = saveArenaTeam;
window.findMatch = findMatch;
window.acceptBattleWebhook = acceptBattleWebhook;
window.rejectBattleWebhook = rejectBattleWebhook;
window.makeAttack = makeAttack;
window.surrenderBattle = surrenderBattle;
window.cancelBattleSearch = cancelBattleSearch;
window.debugLog = debugLog;