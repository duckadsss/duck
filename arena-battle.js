// ============================================
// ARENA BATTLE SYSTEM - ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================

let currentBattle = null;
let battleInterval = null;
let selectedTarget = null;
let arenaSocketInstance = null;

// Регистрация сокета для боя
function registerArenaSocket(socket) {
    console.log('🎮 Registering arena socket for battle...');
    
    if (arenaSocketInstance && arenaSocketInstance.id === socket.id) {
        console.log('⚠️ Socket already registered');
        return;
    }
    
    arenaSocketInstance = socket;
    
    if (arenaSocketInstance) {
        arenaSocketInstance.off('battle-start');
        arenaSocketInstance.off('opponent-move');
        arenaSocketInstance.off('battle-end');
        arenaSocketInstance.off('turn-update');
        
        arenaSocketInstance.on('battle-start', (data) => {
            console.log('⚔️ Battle start received:', data);
            initBattle(data);
        });
        
        arenaSocketInstance.on('opponent-move', (data) => {
            console.log('🎯 Opponent move received:', data);
            handleOpponentMove(data);
        });
        
        arenaSocketInstance.on('battle-end', (data) => {
            console.log('🏁 Battle end received:', data);
            endBattle(data);
        });
        
        arenaSocketInstance.on('turn-update', (data) => {
            updateTimerDisplay(data.timeLeft);
        });
    }
}

function initBattle(battleData) {
    console.log('⚔️ initBattle called');
    
    const playerMonsters = (battleData.player.monsters || []).map(m => ({
        id: m.id,
        name: m.name || 'Unknown',
        icon: m.icon || 'https://ndammo.github.io/Mmodna/default.png',
        rarity: m.rarity || 'common',
        hp: m.hp !== undefined ? m.hp : (m.maxHp || 100),
        maxHp: m.maxHp || 100
    }));
    
    const opponentMonsters = (battleData.opponent.monsters || []).map(m => ({
        id: m.id,
        name: m.name || 'Unknown',
        icon: m.icon || 'https://ndammo.github.io/Mmodna/default.png',
        rarity: m.rarity || 'common',
        hp: m.hp !== undefined ? m.hp : (m.maxHp || 100),
        maxHp: m.maxHp || 100
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
        turnStartTime: Date.now(),
        waitingForResponse: false
    };
    
    showBattleScreen();
    renderBattleTeams();
    addBattleLogMessage('⚔️ БОЙ НАЧАЛСЯ! ⚔️', 'system');
    startBattleTurnTimer();
    
    if (currentBattle.currentTurn === 'opponent') {
        disablePlayerActions();
        addBattleLogMessage(`🔴 Ход ${currentBattle.opponent.name}...`, 'info');
    } else {
        enablePlayerActions();
        addBattleLogMessage('🔵 ВАШ ХОД! Выберите врага для атаки', 'info');
        highlightTargetableMonsters();
    }
}

function showBattleScreen() {
    const oldContainer = document.getElementById('battleArenaContainer');
    if (oldContainer) oldContainer.remove();
    
    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    
    if (mainContent) mainContent.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    if (header) header.style.display = 'none';
    
    const container = document.createElement('div');
    container.id = 'battleArenaContainer';
    container.innerHTML = `
        <div class="battle-arena">
            <div class="battle-header">
                <button class="battle-exit-btn" onclick="exitBattle()"><i class="fa-solid fa-times"></i> ВЫЙТИ</button>
                <div class="battle-timer"><i class="fa-regular fa-clock"></i> <span id="battleTimer">30</span>с</div>
            </div>
            <div class="battle-team opponent-team">
                <div class="team-header">
                    <div class="team-name"><i class="fa-solid fa-skull"></i> ${escapeHtml(currentBattle.opponent.name)} <span class="team-rating">(${currentBattle.opponent.rating})</span></div>
                    <div class="team-health" id="opponentTeamHealth">❤️ ${currentBattle.opponent.totalHealth}/${currentBattle.opponent.maxHealth}</div>
                </div>
                <div class="monsters-grid" id="opponentMonstersGrid"></div>
            </div>
            <div class="battle-log-panel">
                <div class="log-header"><i class="fa-solid fa-scroll"></i> БОЕВОЙ ЛОГ</div>
                <div class="log-messages" id="battleLogMessages"></div>
            </div>
            <div class="battle-team player-team">
                <div class="team-header">
                    <div class="team-name"><i class="fa-solid fa-user-astronaut"></i> ${escapeHtml(currentBattle.player.name)} <span class="team-rating">(${currentBattle.player.rating})</span></div>
                    <div class="team-health" id="playerTeamHealth">❤️ ${currentBattle.player.totalHealth}/${currentBattle.player.maxHealth}</div>
                </div>
                <div class="monsters-grid" id="playerMonstersGrid"></div>
            </div>
            <div class="battle-message-area" id="battleMessageArea"></div>
        </div>
    `;
    document.body.appendChild(container);
}

function renderBattleTeams() {
    const opponentGrid = document.getElementById('opponentMonstersGrid');
    if (opponentGrid && currentBattle.opponent.monsters) {
        opponentGrid.innerHTML = currentBattle.opponent.monsters.map((monster, idx) => {
            const hpPercent = (monster.hp / monster.maxHp) * 100;
            const isDefeated = monster.hp <= 0;
            return `
                <div class="battle-monster-card enemy-card ${isDefeated ? 'defeated' : ''}" 
                     data-monster-idx="${idx}" data-alive="${!isDefeated}" 
                     onclick="${!isDefeated && currentBattle.currentTurn === 'player' && !currentBattle.waitingForResponse ? `selectAttackTarget(${idx})` : ''}">
                    <div class="monster-portrait">
                        <img src="${monster.icon}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                        ${isDefeated ? '<div class="defeated-overlay">💀</div>' : ''}
                    </div>
                    <div class="monster-name">${escapeHtml(monster.name)}</div>
                    <div class="monster-rarity-badge ${monster.rarity}">${monster.rarity.toUpperCase()}</div>
                    <div class="monster-hp-bar">
                        <div class="hp-fill" style="width: ${hpPercent}%"></div>
                        <div class="hp-text">${monster.hp}/${monster.maxHp}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    const playerGrid = document.getElementById('playerMonstersGrid');
    if (playerGrid && currentBattle.player.monsters) {
        playerGrid.innerHTML = currentBattle.player.monsters.map((monster, idx) => {
            const hpPercent = (monster.hp / monster.maxHp) * 100;
            const isDefeated = monster.hp <= 0;
            return `
                <div class="battle-monster-card player-card ${isDefeated ? 'defeated' : ''}" data-monster-idx="${idx}" data-alive="${!isDefeated}">
                    <div class="monster-portrait">
                        <img src="${monster.icon}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                        ${isDefeated ? '<div class="defeated-overlay">💀</div>' : ''}
                    </div>
                    <div class="monster-name">${escapeHtml(monster.name)}</div>
                    <div class="monster-rarity-badge ${monster.rarity}">${monster.rarity.toUpperCase()}</div>
                    <div class="monster-hp-bar">
                        <div class="hp-fill" style="width: ${hpPercent}%"></div>
                        <div class="hp-text">${monster.hp}/${monster.maxHp}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function highlightTargetableMonsters() {
    document.querySelectorAll('.enemy-card:not(.defeated)').forEach(card => {
        card.classList.add('targetable');
        card.style.cursor = 'pointer';
    });
}

function selectAttackTarget(targetIndex) {
    if (!currentBattle) {
        addBattleLogMessage('❌ Нет активного боя!', 'error');
        return;
    }
    
    if (currentBattle.currentTurn !== 'player') {
        addBattleLogMessage('❌ Сейчас не ваш ход!', 'error');
        return;
    }
    
    if (currentBattle.waitingForResponse) {
        addBattleLogMessage('⏳ Ожидание ответа от сервера...', 'error');
        return;
    }
    
    const targetMonster = currentBattle.opponent.monsters[targetIndex];
    if (!targetMonster || targetMonster.hp <= 0) {
        addBattleLogMessage('❌ Этот монстр уже повержен!', 'error');
        return;
    }
    
    const attackerIndex = currentBattle.player.monsters.findIndex(m => m.hp > 0);
    if (attackerIndex === -1) {
        addBattleLogMessage('❌ У вас нет живых монстров!', 'error');
        return;
    }
    
    const attacker = currentBattle.player.monsters[attackerIndex];
    
    animateAttack(attackerIndex, targetIndex);
    addBattleLogMessage(`⚔️ ${attacker.name} атакует ${targetMonster.name}!`, 'combat');
    
    currentBattle.waitingForResponse = true;
    
    if (arenaSocketInstance && arenaSocketInstance.connected) {
        arenaSocketInstance.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: attackerIndex,
            targetIndex: targetIndex
        });
    } else if (window.arenaSocket && window.arenaSocket.connected) {
        window.arenaSocket.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: attackerIndex,
            targetIndex: targetIndex
        });
    } else {
        addBattleLogMessage('❌ Нет соединения с сервером!', 'error');
        currentBattle.waitingForResponse = false;
        return;
    }
    
    disablePlayerActions();
    const msgArea = document.getElementById('battleMessageArea');
    if (msgArea) {
        msgArea.innerHTML = '<div class="waiting-message"><i class="fa-solid fa-hourglass-half"></i> Ожидание ответа...</div>';
    }
}

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

function handleOpponentMove(moveData) {
    console.log('🎯 Opponent move received:', moveData);
    
    currentBattle.waitingForResponse = false;
    
    if (moveData.playerHealth) {
        currentBattle.player.monsters = moveData.playerHealth.monsters;
        currentBattle.player.totalHealth = moveData.playerHealth.current;
    }
    if (moveData.opponentHealth) {
        currentBattle.opponent.monsters = moveData.opponentHealth.monsters;
        currentBattle.opponent.totalHealth = moveData.opponentHealth.current;
    }
    
    renderBattleTeams();
    
    const playerHealthEl = document.getElementById('playerTeamHealth');
    const opponentHealthEl = document.getElementById('opponentTeamHealth');
    if (playerHealthEl) playerHealthEl.innerHTML = `❤️ ${currentBattle.player.totalHealth}/${currentBattle.player.maxHealth}`;
    if (opponentHealthEl) opponentHealthEl.innerHTML = `❤️ ${currentBattle.opponent.totalHealth}/${currentBattle.opponent.maxHealth}`;
    
    addBattleLogMessage(moveData.logMessage, 'combat');
    
    // Проверка на окончание боя
    const playerAlive = currentBattle.player.monsters.some(m => m.hp > 0);
    const opponentAlive = currentBattle.opponent.monsters.some(m => m.hp > 0);
    
    if (!playerAlive || !opponentAlive) {
        let winner = !playerAlive ? 'opponent' : 'player';
        if (!playerAlive && !opponentAlive) winner = 'draw';
        endBattle({ winner: winner, resultMessage: winner === 'player' ? 'You won!' : winner === 'opponent' ? 'You lost!' : 'Draw!' });
        return;
    }
    
    if (moveData.nextTurn) {
        currentBattle.currentTurn = moveData.nextTurn;
        currentBattle.turnStartTime = Date.now();
        resetTurnTimer();
        
        const msgArea = document.getElementById('battleMessageArea');
        
        if (currentBattle.currentTurn === 'player') {
            enablePlayerActions();
            addBattleLogMessage('🔵 ВАШ ХОД! Выберите врага для атаки', 'info');
            highlightTargetableMonsters();
            if (msgArea) msgArea.innerHTML = '';
        } else {
            disablePlayerActions();
            addBattleLogMessage(`🔴 Ход ${currentBattle.opponent.name}...`, 'info');
            if (msgArea) {
                msgArea.innerHTML = '<div class="waiting-message"><i class="fa-solid fa-hourglass-half"></i> Ход противника...</div>';
            }
        }
    }
}

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
    
    if (result.newStats && typeof window.updateArenaStats === 'function') {
        window.updateArenaStats(result.newStats);
    }
    
    setTimeout(() => {
        exitBattle();
        if (typeof window.showToast === 'function') {
            window.showToast(result.resultMessage, result.winner === 'player' ? '🏆' : '💀');
        }
    }, 4000);
}

function exitBattle() {
    console.log('🚪 Exiting battle');
    
    if (battleInterval) {
        clearInterval(battleInterval);
        battleInterval = null;
    }
    
    const battleContainer = document.getElementById('battleArenaContainer');
    if (battleContainer) battleContainer.remove();
    
    const mainContent = document.getElementById('mainContent');
    const bottomNav = document.querySelector('.bottom-nav');
    const header = document.querySelector('.header');
    
    if (mainContent) mainContent.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (header) header.style.display = 'block';
    
    currentBattle = null;
    selectedTarget = null;
}

function addBattleLogMessage(message, type = 'normal') {
    const logContainer = document.getElementById('battleLogMessages');
    if (!logContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `log-message ${type}`;
    
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    
    const icons = { victory: '🏆', defeat: '💀', error: '❌', info: 'ℹ️', combat: '⚔️', system: '⚙️', normal: '📜' };
    const icon = icons[type] || '📜';
    msgDiv.innerHTML = `${icon} <span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    
    logContainer.appendChild(msgDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

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
        
        if (timeLeft <= 0 && currentBattle.currentTurn === 'player' && !currentBattle.waitingForResponse) {
            clearInterval(battleInterval);
            addBattleLogMessage('⏰ Время вышло! Ход переходит противнику', 'error');
            
            if (arenaSocketInstance && arenaSocketInstance.connected) {
                arenaSocketInstance.emit('skip-turn', { battleId: currentBattle.battleId });
            }
        }
    }, 1000);
}

function resetTurnTimer() {
    if (battleInterval) clearInterval(battleInterval);
    startBattleTurnTimer();
}

function updateTimerDisplay(seconds) {
    const timerEl = document.getElementById('battleTimer');
    if (timerEl) {
        timerEl.textContent = seconds;
        timerEl.style.color = seconds <= 5 ? '#ef4444' : '#f59e0b';
    }
}

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

if (!document.querySelector('#confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `@keyframes confettiFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(360deg); opacity: 0; } }`;
    document.head.appendChild(style);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.initBattle = initBattle;
window.registerArenaSocket = registerArenaSocket;
window.handleOpponentMove = handleOpponentMove;
window.endBattle = endBattle;
window.exitBattle = exitBattle;
window.selectAttackTarget = selectAttackTarget;

console.log('🎮 Arena battle system loaded');