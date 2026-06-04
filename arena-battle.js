// ============================================
// ARENA BATTLE SYSTEM - НОВАЯ ВЕРСИЯ
// ============================================

let currentBattle = null;
let battleInterval = null;
let selectedTarget = null;

// Инициализация боя
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

// Показать экран боя (вместо модального окна)
function showBattleScreen() {
    // Скрыть основной контент
    document.getElementById('mainContent').style.display = 'none';
    document.querySelector('.bottom-nav').style.display = 'none';
    document.querySelector('.header').style.display = 'none';
    
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
    if (opponentGrid) {
        opponentGrid.innerHTML = currentBattle.opponent.monsters.map((monster, idx) => `
            <div class="battle-monster-card enemy-card ${monster.hp <= 0 ? 'defeated' : ''}" 
                 data-monster-idx="${idx}" 
                 data-side="opponent"
                 onclick="${monster.hp > 0 && currentBattle.currentTurn === 'player' ? `selectAttackTarget(${idx})` : ''}">
                <div class="monster-portrait">
                    <img src="${monster.icon}" alt="${monster.name}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                    ${monster.hp <= 0 ? '<div class="defeated-overlay">💀</div>' : ''}
                </div>
                <div class="monster-name">${escapeHtml(monster.name)}</div>
                <div class="monster-rarity-badge ${monster.rarity}">${monster.rarity}</div>
                <div class="monster-hp-bar">
                    <div class="hp-fill" style="width: ${(monster.hp / monster.maxHp) * 100}%"></div>
                    <div class="hp-text">${Math.max(0, monster.hp)}/${monster.maxHp}</div>
                </div>
            </div>
        `).join('');
    }
    
    // Отрисовка монстров игрока
    const playerGrid = document.getElementById('playerMonstersGrid');
    if (playerGrid) {
        playerGrid.innerHTML = currentBattle.player.monsters.map((monster, idx) => `
            <div class="battle-monster-card player-card ${monster.hp <= 0 ? 'defeated' : ''}" 
                 data-monster-idx="${idx}">
                <div class="monster-portrait">
                    <img src="${monster.icon}" alt="${monster.name}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                    ${monster.hp <= 0 ? '<div class="defeated-overlay">💀</div>' : ''}
                </div>
                <div class="monster-name">${escapeHtml(monster.name)}</div>
                <div class="monster-rarity-badge ${monster.rarity}">${monster.rarity}</div>
                <div class="monster-hp-bar">
                    <div class="hp-fill" style="width: ${(monster.hp / monster.maxHp) * 100}%"></div>
                    <div class="hp-text">${Math.max(0, monster.hp)}/${monster.maxHp}</div>
                </div>
                ${monster.hp > 0 && currentBattle.currentTurn === 'player' ? 
                    '<div class="attack-indicator">⚔️ ГОТОВ</div>' : 
                    monster.hp <= 0 ? '<div class="defeated-indicator">☠️ ПОВЕРЖЕН</div>' : ''
                }
            </div>
        `).join('');
    }
}

// Выделить цели для атаки
function highlightTargetableMonsters() {
    const enemyCards = document.querySelectorAll('.enemy-card:not(.defeated)');
    enemyCards.forEach(card => {
        card.classList.add('targetable');
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
    if (arenaSocket) {
        arenaSocket.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: attackerIndex,
            targetIndex: targetIndex
        });
    }
    
    // Отключить действия до ответа сервера
    disablePlayerActions();
    document.getElementById('battleMessageArea').innerHTML = `
        <div class="waiting-message">
            <i class="fa-solid fa-hourglass-half"></i> Ожидание ответа сервера...
        </div>
    `;
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
    // Обновить здоровье монстров
    if (moveData.playerHealth) {
        currentBattle.player.monsters = moveData.playerHealth.monsters;
    }
    if (moveData.opponentHealth) {
        currentBattle.opponent.monsters = moveData.opponentHealth.monsters;
    }
    
    // Обновить отображение
    renderBattleTeams();
    
    // Добавить лог
    addBattleLogMessage(moveData.logMessage, 'combat');
    
    // Обновить текущий ход
    if (moveData.nextTurn) {
        currentBattle.currentTurn = moveData.nextTurn;
        currentBattle.turnStartTime = Date.now();
        resetTurnTimer();
        
        if (currentBattle.currentTurn === 'player') {
            enablePlayerActions();
            addBattleLogMessage('🔵 ВАШ ХОД! Выберите цель для атаки', 'info');
            highlightTargetableMonsters();
            document.getElementById('battleMessageArea').innerHTML = '';
        } else {
            disablePlayerActions();
            addBattleLogMessage(`🔴 Ход ${currentBattle.opponent.name}...`, 'info');
        }
    }
}

// Завершение боя
function endBattle(result) {
    addBattleLogMessage(result.resultMessage, result.winner === 'player' ? 'victory' : 'defeat');
    
    if (result.winner === 'player') {
        addBattleLogMessage(`🏆 ПОБЕДА! +${result.reward} MMO +${result.ratingGain} рейтинга`, 'victory');
        spawnConfetti();
    } else if (result.winner === 'opponent') {
        addBattleLogMessage(`💀 ПОРАЖЕНИЕ! -${result.ratingLoss} рейтинга`, 'defeat');
    } else {
        addBattleLogMessage(`🤝 НИЧЬЯ!`, 'info');
    }
    
    // Обновить статистику в UI
    updateArenaStats(result.newStats);
    
    // Задержка перед выходом
    setTimeout(() => {
        exitBattle();
        showToast(result.resultMessage, result.winner === 'player' ? '🏆' : '💀');
    }, 3000);
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
    document.getElementById('mainContent').style.display = 'block';
    document.querySelector('.bottom-nav').style.display = 'flex';
    document.querySelector('.header').style.display = 'block';
    
    currentBattle = null;
    selectedTarget = null;
}

// Добавить сообщение в лог
function addBattleLogMessage(message, type = 'normal') {
    const logContainer = document.getElementById('battleLogMessages');
    if (!logContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `log-message ${type}`;
    
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    switch(type) {
        case 'victory':
            msgDiv.innerHTML = `🏆 <span class="log-time">[${time}]</span> ${message}`;
            break;
        case 'defeat':
            msgDiv.innerHTML = `💀 <span class="log-time">[${time}]</span> ${message}`;
            break;
        case 'error':
            msgDiv.innerHTML = `❌ <span class="log-time">[${time}]</span> ${message}`;
            break;
        case 'info':
            msgDiv.innerHTML = `ℹ️ <span class="log-time">[${time}]</span> ${message}`;
            break;
        case 'combat':
            msgDiv.innerHTML = `⚔️ <span class="log-time">[${time}]</span> ${message}`;
            break;
        default:
            msgDiv.innerHTML = `📜 <span class="log-time">[${time}]</span> ${message}`;
    }
    
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
            
            if (arenaSocket) {
                arenaSocket.emit('skip-turn', { battleId: currentBattle.battleId });
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
        card.classList.add('can-target');
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
            confetti.className = 'confetti-piece';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = Math.random() * 8 + 4 + 'px';
            confetti.style.height = Math.random() * 8 + 4 + 'px';
            confetti.style.animationDuration = Math.random() * 2 + 1 + 's';
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 2000);
        }, i * 50);
    }
}