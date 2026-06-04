// ============================================================
// PVP ARENA - КЛИЕНТСКАЯ ЧАСТЬ
// ============================================================

let arenaWS = null;
let isInQueue = false;
let currentBattle = null;
let selectedCreaturesForBattle = [];
let turnTimerInterval = null;
let battleEnded = false;

// Подключение к WebSocket
function connectArena() {
    if (arenaWS && arenaWS.readyState === WebSocket.OPEN) return;
    
    const wsUrl = API_URL.replace('https', 'wss').replace('http', 'ws');
    arenaWS = new WebSocket(`${wsUrl}`);
    
    arenaWS.onopen = () => {
        console.log('✅ Арена WebSocket подключен');
        if (state.token) {
            arenaWS.send(JSON.stringify({
                type: 'auth',
                token: state.token
            }));
        }
    };
    
    arenaWS.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleArenaMessage(data);
    };
    
    arenaWS.onclose = () => {
        console.log('❌ Арена WebSocket отключен');
        if (isInQueue) {
            isInQueue = false;
            showToast('Соединение потеряно, вы вышли из очереди', '⚠️');
            updateQueueUI(false);
        }
        setTimeout(() => connectArena(), 5000);
    };
    
    arenaWS.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

// Обработка сообщений от сервера
function handleArenaMessage(data) {
    switch (data.type) {
        case 'auth_success':
            console.log('Арена авторизована', data.stats);
            updateArenaStatsUI(data.stats);
            break;
            
        case 'queue_joined':
            isInQueue = true;
            updateQueueUI(true);
            showToast('Вы в очереди на поиск соперника...', '⚔️');
            break;
            
        case 'queue_left':
            isInQueue = false;
            updateQueueUI(false);
            showToast('Вы вышли из очереди', '👋');
            break;
            
        case 'battle_request':
            showBattleRequest(data.battleId, data.opponent);
            break;
            
        case 'battle_rejected':
            showToast(data.message || 'Противник не принял бой', '❌');
            break;
            
        case 'battle_start':
            startBattleUI(data);
            break;
            
        case 'attack_executed':
            handleAttackAnimation(data);
            break;
            
        case 'turn_change':
            handleTurnChange(data.turn);
            break;
            
        case 'turn_timeout':
            handleTurnTimeout(data.oldTurn, data.newTurn);
            break;
            
        case 'battle_end':
            handleBattleEnd(data);
            break;
            
        case 'error':
            showToast(data.message, '❌');
            break;
    }
}

// Обновление UI статистики арены
function updateArenaStatsUI(stats) {
    const arenaRating = document.getElementById('arenaRating');
    const arenaWins = document.getElementById('arenaWins');
    const arenaLosses = document.getElementById('arenaLosses');
    const arenaLeague = document.getElementById('arenaLeague');
    
    if (arenaRating) arenaRating.textContent = stats.rating;
    if (arenaWins) arenaWins.textContent = stats.wins;
    if (arenaLosses) arenaLosses.textContent = stats.losses;
    if (arenaLeague) arenaLeague.innerHTML = `${stats.leagueIcon || '🏆'} ${stats.currentLeague}`;
}

// Обновление статуса очереди
function updateQueueUI(inQueue) {
    const joinBtn = document.getElementById('arenaJoinBtn');
    const leaveBtn = document.getElementById('arenaLeaveBtn');
    const queueStatus = document.getElementById('arenaQueueStatus');
    const arenaBattleSelect = document.getElementById('arenaBattleSelect');
    
    if (inQueue) {
        if (joinBtn) joinBtn.style.display = 'none';
        if (leaveBtn) leaveBtn.style.display = 'flex';
        if (queueStatus) queueStatus.style.display = 'flex';
        if (arenaBattleSelect) arenaBattleSelect.style.opacity = '0.5';
    } else {
        if (joinBtn) joinBtn.style.display = 'flex';
        if (leaveBtn) leaveBtn.style.display = 'none';
        if (queueStatus) queueStatus.style.display = 'none';
        if (arenaBattleSelect) arenaBattleSelect.style.opacity = '1';
    }
}

// Показать запрос на бой
function showBattleRequest(battleId, opponent) {
    const creaturesHtml = opponent.creatures.map(c => `
        <div class="arena-mini-creature">
            <img src="${c.icon}" alt="${c.name}" style="width:32px;height:32px;object-fit:contain">
            <span class="arena-mini-creature-name">${escapeHtml(c.name)}</span>
            <span class="arena-mini-creature-rarity ${c.rarity}">${c.rarity}</span>
        </div>
    `).join('');
    
    document.getElementById('popup').innerHTML = `
        <div class="popup-close" onclick="closeOverlay()"><i class="fa-solid fa-xmark"></i></div>
        <div class="popup-title">⚔️ БОЙ НА АРЕНЕ!</div>
        <div class="popup-subtitle">Противник: ${escapeHtml(opponent.name)}</div>
        <div style="background:#0d1120;border:1px solid #1e2d4a;border-radius:16px;padding:16px;margin:16px 0">
            <div style="font-size:10px;color:#94a3b8;margin-bottom:10px">Существа противника:</div>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                ${creaturesHtml}
            </div>
        </div>
        <div style="display:flex;gap:10px">
            <button class="popup-btn" style="flex:1;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="acceptBattle('${battleId}')">
                <i class="fa-solid fa-check"></i> ПРИНЯТЬ БОЙ
            </button>
            <button class="popup-btn" style="flex:1;background:#1a2540" onclick="closeOverlay()">
                <i class="fa-solid fa-times"></i> ОТКАЗАТЬСЯ
            </button>
        </div>
    `;
    document.getElementById('overlay').classList.add('show');
    
    window.pendingBattleId = battleId;
}

function acceptBattle(battleId) {
    closeOverlay();
    if (arenaWS && arenaWS.readyState === WebSocket.OPEN) {
        arenaWS.send(JSON.stringify({
            type: 'accept_battle',
            battleId
        }));
    }
}

// Запуск UI боя
function startBattleUI(data) {
    currentBattle = data;
    battleEnded = false;
    
    const isPlayer1 = data.player1.telegramId === state.user?.telegramId;
    const myTeam = isPlayer1 ? data.player1.creatures : data.player2.creatures;
    const enemyTeam = isPlayer1 ? data.player2.creatures : data.player1.creatures;
    const isMyTurn = data.turn === state.user?.telegramId;
    
    renderBattleField(myTeam, enemyTeam, isMyTurn);
    
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    startTurnTimerUI(isMyTurn);
}

// Рендер поля боя
function renderBattleField(myTeam, enemyTeam, isMyTurn) {
    const myCreaturesHtml = myTeam.map((c, index) => `
        <div class="arena-creature-card ${!c.isAlive ? 'dead' : ''}" data-creature-index="${index}" data-side="my">
            <div class="arena-creature-icon">${getIconHtml({ icon: c.icon, name: c.name })}</div>
            <div class="arena-creature-name">${escapeHtml(c.name)}</div>
            <div class="arena-creature-rarity ${c.rarity}">${c.rarity}</div>
            <div class="arena-creature-hp">
                <div class="arena-hp-bar" style="width: ${(c.health / c.maxHealth) * 100}%"></div>
                <span>❤️ ${c.health}/${c.maxHealth}</span>
            </div>
            <div class="arena-creature-attack">⚔️ ${c.attack}</div>
        </div>
    `).join('');
    
    const enemyCreaturesHtml = enemyTeam.map((c, index) => `
        <div class="arena-creature-card enemy ${!c.isAlive ? 'dead' : ''}" data-creature-index="${index}" data-side="enemy" ${c.isAlive && isMyTurn ? 'onclick="selectEnemyTarget(' + index + ')"' : ''}>
            <div class="arena-creature-icon">${getIconHtml({ icon: c.icon, name: c.name })}</div>
            <div class="arena-creature-name">${escapeHtml(c.name)}</div>
            <div class="arena-creature-rarity ${c.rarity}">${c.rarity}</div>
            <div class="arena-creature-hp">
                <div class="arena-hp-bar" style="width: ${(c.health / c.maxHealth) * 100}%"></div>
                <span>❤️ ${c.health}/${c.maxHealth}</span>
            </div>
            <div class="arena-creature-attack">⚔️ ${c.attack}</div>
        </div>
    `).join('');
    
    document.getElementById('popup').innerHTML = `
        <div class="arena-battle-container">
            <div class="arena-header">
                <div class="arena-turn-indicator ${isMyTurn ? 'my-turn' : 'enemy-turn'}">
                    ${isMyTurn ? '⭐ ВАШ ХОД ⭐' : '⏳ ХОД ПРОТИВНИКА...'}
                </div>
                <div class="arena-timer" id="arenaTimer">30s</div>
                <button class="arena-surrender-btn" onclick="surrenderBattle()">СДАЧА</button>
            </div>
            
            <div class="arena-enemy-field">
                <div class="arena-field-label">👤 ${escapeHtml(currentBattle.player1.telegramId === state.user?.telegramId ? currentBattle.player2.name : currentBattle.player1.name)}</div>
                <div class="arena-creatures-row" id="arenaEnemyCreatures">
                    ${enemyCreaturesHtml}
                </div>
            </div>
            
            <div class="arena-vs">VS</div>
            
            <div class="arena-my-field">
                <div class="arena-field-label">👤 ${escapeHtml(currentBattle.player1.telegramId === state.user?.telegramId ? currentBattle.player1.name : currentBattle.player2.name)} (ВЫ)</div>
                <div class="arena-creatures-row" id="arenaMyCreatures">
                    ${myCreaturesHtml}
                </div>
            </div>
            
            <div class="arena-action-log" id="arenaActionLog">
                <div>⚔️ Бой начался!</div>
            </div>
        </div>
    `;
    document.getElementById('overlay').classList.add('show');
    
    window.selectedTarget = null;
    window.battleMyTeam = myTeam;
    window.battleEnemyTeam = enemyTeam;
}

// Выбор цели для атаки
function selectEnemyTarget(index) {
    if (battleEnded) return;
    if (!window.battleEnemyTeam[index] || !window.battleEnemyTeam[index].isAlive) {
        showToast('Это существо уже побеждено!', '⚠️');
        return;
    }
    
    window.selectedTarget = index;
    
    // Подсветка выбранной цели
    document.querySelectorAll('.arena-creature-card.enemy').forEach((el, i) => {
        if (i === index) {
            el.classList.add('selected-target');
        } else {
            el.classList.remove('selected-target');
        }
    });
    
    // Подтверждение атаки
    showToast(`Цель выбрана: ${window.battleEnemyTeam[index].name}. Нажмите "АТАКОВАТЬ"`, '🎯');
}

// Выполнение атаки
function executeAttack() {
    if (battleEnded) return;
    if (window.selectedTarget === undefined) {
        showToast('Выберите цель для атаки!', '⚠️');
        return;
    }
    
    if (arenaWS && arenaWS.readyState === WebSocket.OPEN) {
        arenaWS.send(JSON.stringify({
            type: 'attack',
            battleId: currentBattle.battleId || window.currentBattleId,
            targetPlayer: 'enemy',
            targetCreatureIndex: window.selectedTarget
        }));
    }
    
    window.selectedTarget = undefined;
    document.querySelectorAll('.arena-creature-card.enemy').forEach(el => {
        el.classList.remove('selected-target');
    });
}

// Анимация атаки
function handleAttackAnimation(data) {
    const isAttackerMe = data.attackerId === state.user?.telegramId;
    
    addToActionLog(`${isAttackerMe ? 'Вы' : 'Противник'} наносит ${data.damage} урона!`);
    
    // Анимация урона
    const targetCard = document.querySelector(`.arena-creature-card.${isAttackerMe ? 'enemy' : ''}[data-creature-index="${data.targetCreatureIndex}"]`);
    if (targetCard) {
        targetCard.classList.add('taking-damage');
        setTimeout(() => targetCard.classList.remove('taking-damage'), 300);
        
        // Обновляем HP
        const hpBar = targetCard.querySelector('.arena-hp-bar');
        const hpText = targetCard.querySelector('.arena-creature-hp span');
        if (hpBar) hpBar.style.width = `${(data.targetNewHealth / 100) * 100}%`;
        if (hpText) hpText.textContent = `❤️ ${data.targetNewHealth}/100`;
        
        if (data.isDead) {
            targetCard.classList.add('dead');
            addToActionLog(`Существо повержено!`);
        }
    }
    
    // Обновляем состояние существ в памяти
    if (isAttackerMe) {
        if (window.battleEnemyTeam[data.targetCreatureIndex]) {
            window.battleEnemyTeam[data.targetCreatureIndex].health = data.targetNewHealth;
            window.battleEnemyTeam[data.targetCreatureIndex].isAlive = !data.isDead;
        }
    } else {
        if (window.battleMyTeam[data.targetCreatureIndex]) {
            window.battleMyTeam[data.targetCreatureIndex].health = data.targetNewHealth;
            window.battleMyTeam[data.targetCreatureIndex].isAlive = !data.isDead;
        }
    }
}

// Смена хода
function handleTurnChange(turnPlayerId) {
    const isMyTurn = turnPlayerId === state.user?.telegramId;
    
    const turnIndicator = document.querySelector('.arena-turn-indicator');
    if (turnIndicator) {
        turnIndicator.className = `arena-turn-indicator ${isMyTurn ? 'my-turn' : 'enemy-turn'}`;
        turnIndicator.textContent = isMyTurn ? '⭐ ВАШ ХОД ⭐' : '⏳ ХОД ПРОТИВНИКА...';
    }
    
    startTurnTimerUI(isMyTurn);
    
    // Активируем/деактивируем клики по врагам
    document.querySelectorAll('.arena-creature-card.enemy').forEach(el => {
        if (isMyTurn && !battleEnded) {
            el.style.cursor = 'pointer';
        } else {
            el.style.cursor = 'default';
        }
    });
    
    if (!isMyTurn) {
        window.selectedTarget = undefined;
        document.querySelectorAll('.arena-creature-card.enemy').forEach(el => {
            el.classList.remove('selected-target');
        });
    }
    
    addToActionLog(isMyTurn ? 'Ваш ход! Выберите цель и атакуйте.' : 'Ход противника...');
}

// Таймер хода
function startTurnTimerUI(isMyTurn) {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    
    let timeLeft = 30;
    const timerEl = document.getElementById('arenaTimer');
    
    if (!isMyTurn) {
        if (timerEl) timerEl.textContent = '--s';
        return;
    }
    
    turnTimerInterval = setInterval(() => {
        if (battleEnded) {
            clearInterval(turnTimerInterval);
            return;
        }
        
        timeLeft--;
        if (timerEl) timerEl.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(turnTimerInterval);
            addToActionLog('⚠️ Время вышло! Ход переходит противнику.');
        }
    }, 1000);
}

// Таймаут хода от сервера
function handleTurnTimeout(oldTurn, newTurn) {
    const wasMyTurn = oldTurn === state.user?.telegramId;
    addToActionLog(wasMyTurn ? '⏰ Время вышло! Ход переходит противнику.' : 'Противник долго думал, ход ваш!');
    handleTurnChange(newTurn);
}

// Добавление сообщения в лог
function addToActionLog(message) {
    const logContainer = document.getElementById('arenaActionLog');
    if (logContainer) {
        const logEntry = document.createElement('div');
        logEntry.textContent = message;
        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        logContainer.appendChild(logEntry);
        
        setTimeout(() => {
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        }, 10);
        
        logContainer.scrollTop = logContainer.scrollHeight;
        
        setTimeout(() => {
            if (logContainer.children.length > 20) {
                logContainer.removeChild(logContainer.children[0]);
            }
        }, 100);
    }
}

// Завершение боя
function handleBattleEnd(data) {
    battleEnded = true;
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    
    const isWinner = data.winner === state.user?.telegramId;
    const isSurrender = data.surrender;
    
    let message = '';
    if (isSurrender && !isWinner) {
        message = '😔 Вы сдались. Бой окончен.';
    } else if (isWinner) {
        message = `🏆 ПОБЕДА! +${data.winnerReward || 500} MMO\nРейтинг: ${data.winnerNewRating || '↑'}`;
    } else {
        message = `😔 Поражение...\nРейтинг: ${data.loserNewRating || '↓'}`;
    }
    
    addToActionLog(message);
    
    setTimeout(() => {
        showToast(isWinner ? 'ПОБЕДА НА АРЕНЕ!' : 'Поражение на арене...', isWinner ? '🏆' : '😔');
        closeOverlay();
        
        // Обновляем статистику
        if (arenaWS && arenaWS.readyState === WebSocket.OPEN) {
            arenaWS.send(JSON.stringify({ type: 'get_stats' }));
        }
        
        refreshUserProfile();
    }, 3000);
}

// Сдача в бою
function surrenderBattle() {
    if (battleEnded) return;
    
    if (confirm('Вы уверены, что хотите сдаться?')) {
        if (arenaWS && arenaWS.readyState === WebSocket.OPEN) {
            arenaWS.send(JSON.stringify({
                type: 'surrender',
                battleId: currentBattle.battleId || window.currentBattleId
            }));
        }
    }
}

// Вступление в очередь
function joinArenaQueue() {
    if (selectedCreaturesForBattle.length !== 3) {
        showToast('Выберите 3 существа для боя!', '⚠️');
        return;
    }
    
    if (!arenaWS || arenaWS.readyState !== WebSocket.OPEN) {
        connectArena();
        setTimeout(() => joinArenaQueue(), 1000);
        return;
    }
    
    arenaWS.send(JSON.stringify({
        type: 'join_queue',
        creatureIds: selectedCreaturesForBattle
    }));
}

// Выход из очереди
function leaveArenaQueue() {
    if (arenaWS && arenaWS.readyState === WebSocket.OPEN) {
        arenaWS.send(JSON.stringify({ type: 'leave_queue' }));
    }
}

// Выбор существа для боя
function toggleCreatureForBattle(creatureId, creatureName, icon) {
    const index = selectedCreaturesForBattle.indexOf(creatureId);
    
    if (index === -1) {
        if (selectedCreaturesForBattle.length >= 3) {
            showToast('Можно выбрать только 3 существа для боя!', '⚠️');
            return;
        }
        selectedCreaturesForBattle.push(creatureId);
        addToBattleSelectionUI(creatureId, creatureName, icon);
    } else {
        selectedCreaturesForBattle.splice(index, 1);
        removeFromBattleSelectionUI(creatureId);
    }
    
    updateBattleSelectionUI();
}

// Обновление UI выбора существ
function updateBattleSelectionUI() {
    const selectBtn = document.getElementById('arenaJoinBtn');
    if (selectBtn) {
        if (selectedCreaturesForBattle.length === 3) {
            selectBtn.style.opacity = '1';
            selectBtn.disabled = false;
        } else {
            selectBtn.style.opacity = '0.5';
            selectBtn.disabled = true;
        }
    }
}

function addToBattleSelectionUI(creatureId, creatureName, icon) {
    const container = document.getElementById('arenaSelectedCreatures');
    if (container) {
        const el = document.createElement('div');
        el.className = 'arena-selected-creature';
        el.id = `arena_selected_${creatureId}`;
        el.innerHTML = `
            <img src="${icon}" alt="${creatureName}" style="width:32px;height:32px;object-fit:contain">
            <span class="arena-selected-name">${escapeHtml(creatureName)}</span>
        `;
        container.appendChild(el);
    }
}

function removeFromBattleSelectionUI(creatureId) {
    const el = document.getElementById(`arena_selected_${creatureId}`);
    if (el) el.remove();
}

// Загрузка статистики арены
async function loadArenaStats() {
    try {
        const res = await apiRequest('GET', '/api/arena/stats');
        if (res && res.success) {
            updateArenaStatsUI(res.stats);
        }
    } catch (e) {
        console.error('loadArenaStats error:', e);
    }
}

// Загрузка лидерборда арены
async function loadArenaLeaderboard() {
    const container = document.getElementById('arenaLeaderboardList');
    if (!container) return;
    
    try {
        const res = await apiRequest('GET', '/api/arena/leaderboard');
        if (res && res.success && res.leaderboard) {
            container.innerHTML = res.leaderboard.map(p => `
                <div class="arena-lb-item">
                    <div class="arena-lb-rank">#${p.rank}</div>
                    <div class="arena-lb-name">${escapeHtml(p.name)}</div>
                    <div class="arena-lb-league">${p.leagueIcon} ${p.league}</div>
                    <div class="arena-lb-rating">${p.rating}⭐</div>
                    <div class="arena-lb-stats">${p.wins}W / ${p.losses}L</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-listings">Нет данных</div>';
        }
    } catch (e) {
        console.error('loadArenaLeaderboard error:', e);
        container.innerHTML = '<div class="empty-listings">Ошибка загрузки</div>';
    }
}

// Подключение при загрузке
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        connectArena();
        loadArenaStats();
        loadArenaLeaderboard();
    }, 2000);
});