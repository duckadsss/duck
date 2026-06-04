// ============================================
// ARENA BATTLE SYSTEM v2.0
// ============================================

let currentBattle = null;
let battleTimerInterval = null;
let selectedTarget = null;

// ============================================
// ИНИЦИАЛИЗАЦИЯ БОЯ
// ============================================
function initBattle(battleData) {
    currentBattle = {
        battleId: battleData.battleId,
        currentTurn: battleData.currentTurn,
        player: {
            id: battleData.player.id,
            name: battleData.player.name,
            rating: battleData.player.rating,
            monsters: battleData.player.monsters.map(m => ({
                ...m,
                hp: m.maxHp,
                originalHp: m.maxHp
            }))
        },
        opponent: {
            id: battleData.opponent.id,
            name: battleData.opponent.name,
            rating: battleData.opponent.rating,
            monsters: battleData.opponent.monsters.map(m => ({
                ...m,
                hp: m.maxHp,
                originalHp: m.maxHp
            }))
        },
        battleLog: [],
        turnStartTime: Date.now()
    };

    buildBattleScreen();
    renderBothTeams();
    addLog('⚔️ БОЙ НАЧАЛСЯ! ⚔️', 'system');
    startTurnTimer();

    if (currentBattle.currentTurn === 'opponent') {
        setBattleState('waiting');
        addLog(`🔴 Ход ${escapeHtml(currentBattle.opponent.name)}...`, 'info');
    } else {
        setBattleState('action');
        addLog('🔵 ВАШ ХОД! Выберите цель для атаки', 'info');
        activateTargets();
    }
}

// ============================================
// ПОСТРОЕНИЕ ЭКРАНА БОЯ
// ============================================
function buildBattleScreen() {
    // Скрыть основной UI
    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    if (mainContent) mainContent.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    if (header) header.style.display = 'none';

    let container = document.getElementById('battleArenaContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'battleArenaContainer';
        document.body.appendChild(container);
    }

    container.innerHTML = `
        <div class="ba-screen">
            <!-- Фон с частицами -->
            <div class="ba-bg">
                <div class="ba-bg-orb ba-bg-orb--1"></div>
                <div class="ba-bg-orb ba-bg-orb--2"></div>
                <div class="ba-bg-grid"></div>
            </div>

            <!-- Хедер -->
            <div class="ba-header">
                <button class="ba-exit" onclick="exitBattle()">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    ВЫЙТИ
                </button>
                <div class="ba-vs-badge">
                    <span class="ba-vs-player">${escapeHtml(currentBattle.player.name)}</span>
                    <span class="ba-vs-text">VS</span>
                    <span class="ba-vs-enemy">${escapeHtml(currentBattle.opponent.name)}</span>
                </div>
                <div class="ba-timer-wrap">
                    <div class="ba-timer" id="baTimer">
                        <svg class="ba-timer-ring" viewBox="0 0 36 36">
                            <circle class="ba-timer-track" cx="18" cy="18" r="15"/>
                            <circle class="ba-timer-progress" id="baTimerRing" cx="18" cy="18" r="15"/>
                        </svg>
                        <span class="ba-timer-num" id="baTimerNum">30</span>
                    </div>
                </div>
            </div>

            <!-- Команда противника -->
            <div class="ba-side ba-side--enemy">
                <div class="ba-side-label">
                    <div class="ba-side-dot ba-side-dot--enemy"></div>
                    <span>${escapeHtml(currentBattle.opponent.name)}</span>
                    <span class="ba-side-rating">${currentBattle.opponent.rating} ★</span>
                </div>
                <div class="ba-monsters" id="baEnemyMonsters"></div>
            </div>

            <!-- Боевой лог -->
            <div class="ba-log">
                <div class="ba-log-header">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M1 3h10M1 6h7M1 9h4" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    БОЕВОЙ ЛОГ
                </div>
                <div class="ba-log-body" id="baLogBody"></div>
            </div>

            <!-- Статус хода -->
            <div class="ba-turn-status" id="baTurnStatus">
                <div class="ba-turn-pulse"></div>
                <span id="baTurnText">Ожидание...</span>
            </div>

            <!-- Команда игрока -->
            <div class="ba-side ba-side--player">
                <div class="ba-side-label">
                    <div class="ba-side-dot ba-side-dot--player"></div>
                    <span>ВЫ</span>
                    <span class="ba-side-rating">${currentBattle.player.rating} ★</span>
                </div>
                <div class="ba-monsters" id="baPlayerMonsters"></div>
            </div>
        </div>
    `;

    container.style.display = 'block';
}

// ============================================
// РЕНДЕР МОНСТРОВ
// ============================================
function renderBothTeams() {
    renderMonsters('enemy', currentBattle.opponent.monsters);
    renderMonsters('player', currentBattle.player.monsters);
}

function renderMonsters(side, monsters) {
    const container = document.getElementById(side === 'enemy' ? 'baEnemyMonsters' : 'baPlayerMonsters');
    if (!container) return;

    const isEnemy = side === 'enemy';
    const isPlayerTurn = currentBattle.currentTurn === 'player';

    container.innerHTML = monsters.map((monster, idx) => {
        const hpPct = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
        const isDead = monster.hp <= 0;
        const isTargetable = isEnemy && isPlayerTurn && !isDead;

        let hpColor = '#22c55e';
        if (hpPct < 30) hpColor = '#ef4444';
        else if (hpPct < 60) hpColor = '#f59e0b';

        return `
            <div class="ba-card ba-card--${side} ${isDead ? 'ba-card--dead' : ''} ${isTargetable ? 'ba-card--target' : ''}"
                 data-idx="${idx}"
                 ${isTargetable ? `onclick="attackTarget(${idx})"` : ''}>
                
                <!-- Рарность полоска сверху -->
                <div class="ba-card-top-bar ba-rarity--${monster.rarity || 'common'}"></div>
                
                <!-- Портрет -->
                <div class="ba-card-portrait">
                    <img src="${monster.icon || ''}" 
                         alt="${escapeHtml(monster.name)}"
                         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                    <div class="ba-card-fallback" style="display:none">🧬</div>
                    ${isDead ? '<div class="ba-card-dead-veil">💀</div>' : ''}
                    ${isTargetable ? '<div class="ba-card-target-ring"></div>' : ''}
                </div>

                <!-- Имя и рарность -->
                <div class="ba-card-name">${escapeHtml(monster.name)}</div>
                <div class="ba-card-badge ba-rarity-text--${monster.rarity || 'common'}">${(monster.rarity || 'common').toUpperCase()}</div>

                <!-- HP бар -->
                <div class="ba-hp-track">
                    <div class="ba-hp-fill" style="width:${hpPct}%;background:${hpColor}">
                        <div class="ba-hp-glow" style="background:${hpColor}"></div>
                    </div>
                </div>
                <div class="ba-hp-text">${Math.max(0, monster.hp)}/${monster.maxHp}</div>

                ${isTargetable ? '<div class="ba-card-attack-hint">АТАКОВАТЬ ⚔️</div>' : ''}
                ${isDead ? '<div class="ba-card-dead-label">☠ ПОВЕРЖЕН</div>' : ''}
            </div>
        `;
    }).join('');
}

// ============================================
// АТАКА
// ============================================
function attackTarget(targetIdx) {
    if (!currentBattle || currentBattle.currentTurn !== 'player') {
        addLog('❌ Сейчас не ваш ход!', 'error');
        return;
    }

    const target = currentBattle.opponent.monsters[targetIdx];
    if (!target || target.hp <= 0) {
        addLog('❌ Цель уже уничтожена!', 'error');
        return;
    }

    const attackerIdx = currentBattle.player.monsters.findIndex(m => m.hp > 0);
    if (attackerIdx === -1) {
        addLog('❌ Нет живых монстров!', 'error');
        return;
    }

    // Анимация
    playAttackAnim('player', attackerIdx, 'enemy', targetIdx);

    // Отправить на сервер
    const socket = window.arenaSocket || window.socket;
    if (socket) {
        socket.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: attackerIdx,
            targetIndex: targetIdx
        });
    }

    setBattleState('waiting');
}

// ============================================
// АНИМАЦИЯ АТАКИ
// ============================================
function playAttackAnim(attackerSide, attackerIdx, defenderSide, defenderIdx) {
    const attackerSel = attackerSide === 'player' ? '#baPlayerMonsters' : '#baEnemyMonsters';
    const defenderSel = defenderSide === 'player' ? '#baPlayerMonsters' : '#baEnemyMonsters';

    const atCards = document.querySelectorAll(`${attackerSel} .ba-card`);
    const defCards = document.querySelectorAll(`${defenderSel} .ba-card`);

    const atCard = atCards[attackerIdx];
    const defCard = defCards[defenderIdx];

    if (atCard) {
        atCard.classList.add('ba-card--attacking');
        setTimeout(() => atCard.classList.remove('ba-card--attacking'), 400);
    }
    if (defCard) {
        defCard.classList.add('ba-card--hit');
        setTimeout(() => defCard.classList.remove('ba-card--hit'), 400);
        // Спавн урона
        spawnDamageNum(defCard);
    }
}

function spawnDamageNum(card) {
    const el = document.createElement('div');
    el.className = 'ba-damage-num';
    el.textContent = '⚔️';
    card.appendChild(el);
    setTimeout(() => el.remove(), 600);
}

// ============================================
// ОБРАБОТКА ХОДА ПРОТИВНИКА
// ============================================
function handleOpponentMove(data) {
    if (data.playerHealth?.monsters) {
        currentBattle.player.monsters = data.playerHealth.monsters;
    }
    if (data.opponentHealth?.monsters) {
        currentBattle.opponent.monsters = data.opponentHealth.monsters;
    }

    // Анимация атаки врага
    if (data.attackerIndex !== undefined && data.targetIndex !== undefined) {
        playAttackAnim('enemy', data.attackerIndex, 'player', data.targetIndex);
    }

    setTimeout(() => {
        renderBothTeams();

        if (data.logMessage) addLog(data.logMessage, 'combat');

        if (data.nextTurn) {
            currentBattle.currentTurn = data.nextTurn;
            currentBattle.turnStartTime = Date.now();
            resetTimer();

            if (data.nextTurn === 'player') {
                setBattleState('action');
                addLog('🔵 ВАШ ХОД! Выберите цель!', 'info');
                activateTargets();
            } else {
                setBattleState('waiting');
                addLog(`🔴 Ход ${escapeHtml(currentBattle.opponent.name)}...`, 'info');
            }
        }
    }, 350);
}

// ============================================
// ЗАВЕРШЕНИЕ БОЯ
// ============================================
function endBattle(result) {
    stopTimer();

    const isWin = result.winner === 'player';
    const isDraw = result.winner === 'draw';

    if (isWin) {
        addLog(`🏆 ПОБЕДА! +${result.reward || 0} MMO / +${result.ratingGain || 0} рейтинга`, 'victory');
        showBattleResult('victory');
        spawnConfetti();
    } else if (isDraw) {
        addLog('🤝 НИЧЬЯ!', 'info');
        showBattleResult('draw');
    } else {
        addLog(`💀 ПОРАЖЕНИЕ! -${result.ratingLoss || 0} рейтинга`, 'defeat');
        showBattleResult('defeat');
    }

    if (result.newStats) updateArenaStats(result.newStats);

    setTimeout(() => {
        exitBattle();
        if (typeof showToast === 'function') {
            const msg = isWin ? `🏆 ПОБЕДА! +${result.reward || 0} MMO` : isDraw ? '🤝 Ничья' : '💀 Поражение';
            showToast(msg, isWin ? '🏆' : isDraw ? '🤝' : '💀');
        }
    }, 4000);
}

function showBattleResult(type) {
    const screen = document.querySelector('.ba-screen');
    if (!screen) return;

    const overlay = document.createElement('div');
    overlay.className = `ba-result ba-result--${type}`;

    const configs = {
        victory: { icon: '🏆', text: 'ПОБЕДА!', sub: 'Отличный бой!', color: '#f59e0b' },
        defeat:  { icon: '💀', text: 'ПОРАЖЕНИЕ', sub: 'В следующий раз повезёт', color: '#ef4444' },
        draw:    { icon: '🤝', text: 'НИЧЬЯ', sub: 'Равный противник!', color: '#06b6d4' }
    };

    const cfg = configs[type];
    overlay.innerHTML = `
        <div class="ba-result-inner">
            <div class="ba-result-icon">${cfg.icon}</div>
            <div class="ba-result-text" style="color:${cfg.color}">${cfg.text}</div>
            <div class="ba-result-sub">${cfg.sub}</div>
        </div>
    `;

    screen.appendChild(overlay);
}

// ============================================
// ВЫХОД ИЗ БОЯ
// ============================================
function exitBattle() {
    stopTimer();

    const container = document.getElementById('battleArenaContainer');
    if (container) container.style.display = 'none';

    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    if (mainContent) mainContent.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (header) header.style.display = 'block';

    currentBattle = null;
    selectedTarget = null;
}

// ============================================
// СОСТОЯНИЕ ХОДА
// ============================================
function setBattleState(state) {
    const statusEl = document.getElementById('baTurnStatus');
    const textEl = document.getElementById('baTurnText');
    if (!statusEl || !textEl) return;

    statusEl.className = 'ba-turn-status ba-turn-status--' + state;

    if (state === 'action') {
        textEl.textContent = '⚔️ ВАШ ХОД — нажмите на врага!';
    } else if (state === 'waiting') {
        textEl.textContent = '⏳ Ожидание хода противника...';
    }
}

function activateTargets() {
    renderMonsters('enemy', currentBattle.opponent.monsters);
    renderMonsters('player', currentBattle.player.monsters);
}

// ============================================
// ТАЙМЕР ХОДА
// ============================================
function startTurnTimer() {
    stopTimer();
    const TURN_SEC = 30;

    battleTimerInterval = setInterval(() => {
        if (!currentBattle) { stopTimer(); return; }
        const elapsed = Math.floor((Date.now() - currentBattle.turnStartTime) / 1000);
        const left = Math.max(0, TURN_SEC - elapsed);

        const numEl = document.getElementById('baTimerNum');
        const ringEl = document.getElementById('baTimerRing');

        if (numEl) {
            numEl.textContent = left;
            numEl.style.color = left <= 5 ? '#ef4444' : left <= 10 ? '#f59e0b' : '#e2e8f0';
        }

        // Анимация кольца SVG
        if (ringEl) {
            const circ = 2 * Math.PI * 15; // r=15
            const pct = left / TURN_SEC;
            ringEl.style.strokeDasharray = circ;
            ringEl.style.strokeDashoffset = circ * (1 - pct);
            ringEl.style.stroke = left <= 5 ? '#ef4444' : left <= 10 ? '#f59e0b' : '#a855f7';
        }

        if (left <= 0 && currentBattle.currentTurn === 'player') {
            stopTimer();
            addLog('⏰ Время вышло! Ход переходит противнику', 'error');
            const socket = window.arenaSocket || window.socket;
            if (socket) socket.emit('skip-turn', { battleId: currentBattle.battleId });
            setBattleState('waiting');
        }
    }, 1000);
}

function resetTimer() {
    currentBattle.turnStartTime = Date.now();
    startTurnTimer();
}

function stopTimer() {
    if (battleTimerInterval) {
        clearInterval(battleTimerInterval);
        battleTimerInterval = null;
    }
}

// ============================================
// БОЙ — ЛОГ
// ============================================
function addLog(message, type = 'normal') {
    const body = document.getElementById('baLogBody');
    if (!body) return;

    const div = document.createElement('div');
    div.className = `ba-log-entry ba-log-entry--${type}`;

    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span class="ba-log-time">${time}</span> ${message}`;

    body.appendChild(div);
    body.scrollTop = body.scrollHeight;

    // Лимит записей
    while (body.children.length > 60) body.removeChild(body.firstChild);
}

// ============================================
// КОНФЕТТИ
// ============================================
function spawnConfetti() {
    const colors = ['#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444', '#fff'];
    for (let i = 0; i < 60; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'ba-confetti';
            const size = 5 + Math.random() * 8;
            el.style.cssText = `
                left: ${Math.random() * 100}%;
                width: ${size}px;
                height: ${size}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                animation-duration: ${1 + Math.random() * 1.5}s;
                animation-delay: ${Math.random() * 0.5}s;
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            `;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 2500);
        }, i * 30);
    }
}

console.log('✅ Arena Battle System v2.0 loaded');
