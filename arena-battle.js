// ============================================
// ARENA BATTLE SYSTEM - ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================

let currentBattle = null;
let battleInterval = null;
let selectedTarget = null;

// Инициализация боя
function initBattle(battleData) {
    console.log('⚔️ initBattle called with data:', battleData);
    
    // Правильно обрабатываем монстров с сервера
    const playerMonsters = (battleData.player.monsters || []).map(m => ({
        ...m,
        hp: m.hp !== undefined ? m.hp : (m.maxHp || 100),
        maxHp: m.maxHp || 100,
        originalHp: m.hp !== undefined ? m.hp : (m.maxHp || 100)
    }));
    
    const opponentMonsters = (battleData.opponent.monsters || []).map(m => ({
        ...m,
        hp: m.hp !== undefined ? m.hp : (m.maxHp || 100),
        maxHp: m.maxHp || 100,
        originalHp: m.hp !== undefined ? m.hp : (m.maxHp || 100)
    }));
    
    currentBattle = {
        battleId: battleData.battleId,
        currentTurn: battleData.currentTurn || 'player',
        player: {
            id: battleData.player.id,
            name: battleData.player.name || 'You',
            rating: battleData.player.rating || 500,
            monsters: playerMonsters,
            totalHealth: playerMonsters.reduce((sum, m) => sum + m.hp, 0),
            maxHealth: playerMonsters.reduce((sum, m) => sum + m.maxHp, 0)
        },
        opponent: {
            id: battleData.opponent.id,
            name: battleData.opponent.name || 'Opponent',
            rating: battleData.opponent.rating || 500,
            monsters: opponentMonsters,
            totalHealth: opponentMonsters.reduce((sum, m) => sum + m.hp, 0),
            maxHealth: opponentMonsters.reduce((sum, m) => sum + m.maxHp, 0)
        },
        battleLog: [],
        turnStartTime: Date.now()
    };
    
    console.log('✅ Battle initialized:', currentBattle);
    
    // Показать экран боя
    showBattleScreen();
    
    // Отрисовать обе команды
    renderBattleTeams();
    
    // Добавить лог начала боя
    addBattleLogMessage('⚔️ БОЙ НАЧАЛСЯ! ⚔️', 'system');
    
    // Установить таймер хода
    startBattleTurnTimer();
    
    // Если ход противника - ждем
    if (currentBattle.currentTurn === 'opponent') {
        disablePlayerActions();
        addBattleLogMessage(`🔴 Ход ${currentBattle.opponent.name}...`, 'info');
    } else {
        enablePlayerActions();
        addBattleLogMessage(`🔵 ВАШ ХОД! Выберите цель для атаки`, 'info');
        highlightTargetableMonsters();
    }
}

// Показать экран боя
function showBattleScreen() {
    // Скрыть основной контент
    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    
    if (mainContent) mainContent.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    if (header) header.style.display = 'none';
    
    // Создать контейнер боя
    let battleContainer = document.getElementById('battleArenaContainer');
    if (!battleContainer) {
        battleContainer = document.createElement('div');
        battleContainer.id = 'battleArenaContainer';
        document.body.appendChild(battleContainer);
    }
    
    battleContainer.innerHTML = `
        <div class="battle-arena">
            <div class="battle-header">
                <button class="battle-exit-btn" onclick="exitBattle()">
                    <i class="fa-solid fa-times"></i> ВЫЙТИ
                </button>
                <div class="battle-timer">
                    <i class="fa-regular fa-clock"></i>
                    <span id="battleTimer">30</span>с
                </div>
            </div>
            
            <!-- Команда противника -->
            <div class="battle-team opponent-team">
                <div class="team-header">
                    <div class="team-name">
                        <i class="fa-solid fa-skull"></i>
                        ${escapeHtml(currentBattle.opponent.name)}
                        <span class="team-rating">(${currentBattle.opponent.rating})</span>
                    </div>
                    <div class="team-health">
                        ❤️ ${currentBattle.opponent.totalHealth}/${currentBattle.opponent.maxHealth}
                    </div>
                </div>
                <div class="monsters-grid" id="opponentMonstersGrid"></div>
            </div>
            
            <!-- Боевой лог -->
            <div class="battle-log-panel">
                <div class="log-header">
                    <i class="fa-solid fa-scroll"></i> БОЕВОЙ ЛОГ
                </div>
                <div class="log-messages" id="battleLogMessages"></div>
            </div>
            
            <!-- Команда игрока -->
            <div class="battle-team player-team">
                <div class="team-header">
                    <div class="team-name">
                        <i class="fa-solid fa-user-astronaut"></i>
                        ${escapeHtml(currentBattle.player.name)}
                        <span class="team-rating">(${currentBattle.player.rating})</span>
                    </div>
                    <div class="team-health">
                        ❤️ ${currentBattle.player.totalHealth}/${currentBattle.player.maxHealth}
                    </div>
                </div>
                <div class="monsters-grid" id="playerMonstersGrid"></div>
            </div>
            
            <div class="battle-message-area" id="battleMessageArea"></div>
        </div>
    `;
    
    battleContainer.style.display = 'block';
}

// Отрисовать команды
function renderBattleTeams() {
    // Отрисовка монстров противника
    const opponentGrid = document.getElementById('opponentMonstersGrid');
    if (opponentGrid && currentBattle.opponent.monsters) {
        opponentGrid.innerHTML = currentBattle.opponent.monsters.map((monster, idx) => {
            const hpPercent = monster.maxHp > 0 ? (monster.hp / monster.maxHp) * 100 : 0;
            const isDefeated = monster.hp <= 0;
            
            return `
                <div class="battle-monster-card enemy-card ${isDefeated ? 'defeated' : ''}" 
                     data-monster-idx="${idx}" 
                     data-side="opponent"
                     onclick="${!isDefeated && currentBattle.currentTurn === 'player' ? `selectAttackTarget(${idx})` : ''}">
                    <div class="monster-portrait">
                        <img src="${monster.icon || 'https://ndammo.github.io/Mmodna/default.png'}" 
                             alt="${escapeHtml(monster.name)}" 
                             onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                        ${isDefeated ? '<div class="defeated-overlay">💀</div>' : ''}
                    </div>
                    <div class="monster-name">${escapeHtml(monster.name)}</div>
                    <div class="monster-rarity-badge ${monster.rarity || 'common'}">${(monster.rarity || 'common').toUpperCase()}</div>
                    <div class="monster-hp-bar">
                        <div class="hp-fill" style="width: ${Math.max(0, hpPercent)}%"></div>
                        <div class="hp-text">${Math.max(0, monster.hp)}/${monster.maxHp}</div>
                    </div>
                    ${!isDefeated && currentBattle.currentTurn === 'player' ? 
                        '<div class="attack-indicator">⚔️ ЦЕЛЬ</div>' : 
                        isDefeated ? '<div class="defeated-indicator">☠️ ПОВЕРЖЕН</div>' : ''
                    }
                </div>
            `;
        }).join('');
    }
    
    // Отрисовка монстров игрока
    const playerGrid = document.getElementById('playerMonstersGrid');
    if (playerGrid && currentBattle.player.monsters) {
        playerGrid.innerHTML = currentBattle.player.monsters.map((monster, idx) => {
            const hpPercent = monster.maxHp > 0 ? (monster.hp / monster.maxHp) * 100 : 0;
            const isDefeated = monster.hp <= 0;
            
            return `
                <div class="battle-monster-card player-card ${isDefeated ? 'defeated' : ''}" 
                     data-monster-idx="${idx}">
                    <div class="monster-portrait">
                        <img src="${monster.icon || 'https://ndammo.github.io/Mmodna/default.png'}" 
                             alt="${escapeHtml(monster.name)}" 
                             onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                        ${isDefeated ? '<div class="defeated-overlay">💀</div>' : ''}
                    </div>
                    <div class="monster-name">${escapeHtml(monster.name)}</div>
                    <div class="monster-rarity-badge ${monster.rarity || 'common'}">${(monster.rarity || 'common').toUpperCase()}</div>
                    <div class="monster-hp-bar">
                        <div class="hp-fill" style="width: ${Math.max(0, hpPercent)}%"></div>
                        <div class="hp-text">${Math.max(0, monster.hp)}/${monster.maxHp}</div>
                    </div>
                    ${!isDefeated && currentBattle.currentTurn === 'player' ? 
                        '<div class="attack-indicator">⚔️ ЖИВ</div>' : 
                        isDefeated ? '<div class="defeated-indicator">☠️ ПОВЕРЖЕН</div>' : ''
                    }
                </div>
            `;
        }).join('');
    }
}

// Обновить здоровье после хода
function updateBattleHealth(playerHealth, opponentHealth) {
    if (playerHealth) {
        currentBattle.player.monsters = playerHealth.monsters;
        currentBattle.player.totalHealth = playerHealth.current;
    }
    if (opponentHealth) {
        currentBattle.opponent.monsters = opponentHealth.monsters;
        currentBattle.opponent.totalHealth = opponentHealth.current;
    }
    
    renderBattleTeams();
}

// Выделить цели для атаки
function highlightTargetableMonsters() {
    const enemyCards = document.querySelectorAll('.enemy-card:not(.defeated)');
    enemyCards.forEach(card => {
        card.classList.add('targetable');
        card.style.cursor = 'pointer';
    });
}

// Выбор цели для атаки
function selectAttackTarget(targetIndex) {
    if (currentBattle.currentTurn !== 'player') {
        addBattleLogMessage('❌ Сейчас не ваш ход!', 'error');
        return;
    }
    
    const targetMonster = currentBattle.opponent.monsters[targetIndex];
    if (!targetMonster || targetMonster.hp <= 0) {
        addBattleLogMessage('❌ Этот монстр уже повержен!', 'error');
        return;
    }
    
    // Найти живого атакующего монстра
    const attackerIndex = currentBattle.player.monsters.findIndex(m => m.hp > 0);
    if (attackerIndex === -1) {
        addBattleLogMessage('❌ У вас нет живых монстров!', 'error');
        return;
    }
    
    const attacker = currentBattle.player.monsters[attackerIndex];
    
    // Анимация атаки
    animateAttack(attackerIndex, targetIndex);
    
    // Отправить запрос на сервер
    if (window.arenaSocket && window.arenaSocket.connected) {
        window.arenaSocket.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: attackerIndex,
            targetIndex: targetIndex
        });
        addBattleLogMessage(`⚔️ ${attacker.name} атакует ${targetMonster.name}!`, 'combat');
    } else {
        addBattleLogMessage('❌ Ошибка соединения с сервером!', 'error');
    }
    
    // Отключить действия до ответа сервера
    disablePlayerActions();
    const msgArea = document.getElementById('battleMessageArea');
    if (msgArea) {
        msgArea.innerHTML = `
            <div class="waiting-message">
                <i class="fa-solid fa-hourglass-half"></i> Ожидание ответа сервера...
            </div>
        `;
    }
}

// Анимация атаки
function animateAttack(attackerIdx, targetIdx) {
    const attackerCard = document.querySelector(`.player-card[data-monster-idx="${attackerIdx}"]`);
    const targetCard = document.querySelector(`.enemy-card[data-monster-idx="${targetIdx}"]`);
    
    if (attackerCard) {
        attackerCard.classList.add('attacking');
        setTimeout(() => attackerCard.classList.remove('attacking'), 300);
    }
    
    if (targetCard) {
        targetCard.classList.add('defending');
        setTimeout(() => targetCard.classList.remove('defending'), 300);
    }
}

// Обработка хода оппонента
function handleOpponentMove(moveData) {
    console.log('🎯 Opponent move received:', moveData);
    
    // Обновить здоровье монстров
    if (moveData.playerHealth) {
        currentBattle.player.monsters = moveData.playerHealth.monsters;
        currentBattle.player.totalHealth = moveData.playerHealth.current;
    }
    if (moveData.opponentHealth) {
        currentBattle.opponent.monsters = moveData.opponentHealth.monsters;
        currentBattle.opponent.totalHealth = moveData.opponentHealth.current;
    }
    
    // Обновить отображение
    renderBattleTeams();
    
    // Обновить заголовки здоровья команд
    const playerHealthEl = document.querySelector('.player-team .team-health');
    const opponentHealthEl = document.querySelector('.opponent-team .team-health');
    if (playerHealthEl) playerHealthEl.innerHTML = `❤️ ${currentBattle.player.totalHealth}/${currentBattle.player.maxHealth}`;
    if (opponentHealthEl) opponentHealthEl.innerHTML = `❤️ ${currentBattle.opponent.totalHealth}/${currentBattle.opponent.maxHealth}`;
    
    // Добавить лог
    addBattleLogMessage(moveData.logMessage, 'combat');
    
    // Обновить текущий ход
    if (moveData.nextTurn) {
        currentBattle.currentTurn = moveData.nextTurn;
        currentBattle.turnStartTime = Date.now();
        resetTurnTimer();
        
        const msgArea = document.getElementById('battleMessageArea');
        
        if (currentBattle.currentTurn === 'player') {
            enablePlayerActions();
            addBattleLogMessage('🔵 ВАШ ХОД! Выберите цель для атаки', 'info');
            highlightTargetableMonsters();
            if (msgArea) msgArea.innerHTML = '';
        } else {
            disablePlayerActions();
            addBattleLogMessage(`🔴 Ход ${currentBattle.opponent.name}...`, 'info');
            if (msgArea) {
                msgArea.innerHTML = `
                    <div class="waiting-message">
                        <i class="fa-solid fa-hourglass-half"></i> Ход противника...
                    </div>
                `;
            }
        }
    }
}

// Завершение боя
function endBattle(result) {
    console.log('🏁 Battle ended:', result);
    
    addBattleLogMessage(result.resultMessage, result.winner === 'player' ? 'victory' : 'defeat');
    
    if (result.winner === 'player') {
        addBattleLogMessage(`🏆 ПОБЕДА! +${result.reward || 0} MMO +${result.ratingGain || 0} рейтинга`, 'victory');
        spawnConfetti();
    } else if (result.winner === 'opponent') {
        addBattleLogMessage(`💀 ПОРАЖЕНИЕ! -${result.ratingLoss || 0} рейтинга`, 'defeat');
    } else {
        addBattleLogMessage(`🤝 НИЧЬЯ!`, 'info');
    }
    
    // Обновить статистику в UI
    if (result.newStats && typeof updateArenaStats === 'function') {
        updateArenaStats(result.newStats);
    }
    
    // Задержка перед выходом
    setTimeout(() => {
        exitBattle();
        if (typeof showToast === 'function') {
            showToast(result.resultMessage, result.winner === 'player' ? '🏆' : '💀');
        }
    }, 4000);
}

// Выход из боя
function exitBattle() {
    if (battleInterval) {
        clearInterval(battleInterval);
        battleInterval = null;
    }
    
    // Убрать контейнер боя
    const battleContainer = document.getElementById('battleArenaContainer');
    if (battleContainer) {
        battleContainer.style.display = 'none';
    }
    
    // Показать основной интерфейс
    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    
    if (mainContent) mainContent.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (header) header.style.display = 'block';
    
    currentBattle = null;
    selectedTarget = null;
}

// Добавить сообщение в лог
function addBattleLogMessage(message, type = 'normal') {
    const logContainer = document.getElementById('battleLogMessages');
    if (!logContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `log-message ${type}`;
    
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    
    const icons = {
        victory: '🏆',
        defeat: '💀',
        error: '❌',
        info: 'ℹ️',
        combat: '⚔️',
        system: '⚙️',
        normal: '📜'
    };
    
    const icon = icons[type] || '📜';
    msgDiv.innerHTML = `${icon} <span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    
    logContainer.appendChild(msgDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Ограничить количество сообщений
    while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Таймер хода
function startBattleTurnTimer() {
    if (battleInterval) clearInterval(battleInterval);
    
    battleInterval = setInterval(() => {
        if (!currentBattle) {
            clearInterval(battleInterval);
            return;
        }
        
        const elapsed = Math.floor((Date.now() - currentBattle.turnStartTime) / 1000);
        const timeLeft = Math.max(0, 30 - elapsed);
        
        const timerEl = document.getElementById('battleTimer');
        if (timerEl) {
            timerEl.textContent = timeLeft;
            timerEl.style.color = timeLeft <= 5 ? '#ef4444' : '#f59e0b';
        }
        
        if (timeLeft <= 0 && currentBattle.currentTurn === 'player') {
            // Автоматический пропуск хода
            clearInterval(battleInterval);
            addBattleLogMessage('⏰ Время вышло! Ход переходит противнику', 'error');
            
            if (window.arenaSocket && window.arenaSocket.connected) {
                window.arenaSocket.emit('skip-turn', { battleId: currentBattle.battleId });
            }
        }
    }, 1000);
}

function resetTurnTimer() {
    if (battleInterval) {
        clearInterval(battleInterval);
    }
    startBattleTurnTimer();
}

// Включить/отключить действия игрока
function enablePlayerActions() {
    const targetableCards = document.querySelectorAll('.enemy-card:not(.defeated)');
    targetableCards.forEach(card => {
        card.style.cursor = 'pointer';
        card.classList.add('can-target', 'targetable');
    });
}

function disablePlayerActions() {
    const targetableCards = document.querySelectorAll('.enemy-card');
    targetableCards.forEach(card => {
        card.style.cursor = 'default';
        card.classList.remove('can-target', 'targetable');
    });
}

// Эффект конфетти при победе
function spawnConfetti() {
    const colors = ['#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444'];
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.style.cssText = `
                position: fixed;
                left: ${Math.random() * 100}%;
                top: -10px;
                width: ${Math.random() * 8 + 4}px;
                height: ${Math.random() * 8 + 4}px;
                background-color: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: 2px;
                pointer-events: none;
                z-index: 9999;
                animation: confettiFall ${Math.random() * 2 + 1}s linear forwards;
            `;
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 2000);
        }, i * 50);
    }
}

// Добавить CSS анимацию для конфетти
const confettiStyle = document.createElement('style');
confettiStyle.textContent = `
    @keyframes confettiFall {
        0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
        }
        100% {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
        }
    }
`;
document.head.appendChild(confettiStyle);

// Экспорт функций
window.initBattle = initBattle;
window.handleOpponentMove = handleOpponentMove;
window.endBattle = endBattle;
window.exitBattle = exitBattle;
window.selectAttackTarget = selectAttackTarget;
window.updateBattleHealth = updateBattleHealth;