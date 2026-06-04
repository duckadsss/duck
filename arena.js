// ============================================
// ARENA PVP SYSTEM
// ============================================

let socket = null;
let currentTeam = [null, null, null];
let isSearching = false;
let currentMatchRequest = null;
let currentBattle = null;
let selectedSlotIndex = null;

// Element Type Advantages
const TYPE_ADVANTAGES = {
    'fire': { strong: ['grass'], weak: ['water'] },
    'water': { strong: ['fire'], weak: ['electric', 'grass'] },
    'grass': { strong: ['water'], weak: ['fire'] },
    'electric': { strong: ['water'], weak: [] },
    'dark': { strong: [], weak: [] },
    'light': { strong: [], weak: [] }
};

// Get creature type from icon/name
function getCreatureType(creature) {
    const name = creature.name.toLowerCase();
    if (name.includes('dragon') || name.includes('fire')) return 'fire';
    if (name.includes('shark') || name.includes('water')) return 'water';
    if (name.includes('duck') || name.includes('owl') || name.includes('grass')) return 'grass';
    if (name.includes('electric') || name.includes('thunder')) return 'electric';
    if (name.includes('dark') || name.includes('shadow')) return 'dark';
    return 'light';
}

// Calculate damage with type advantage
function calculateDamage(attacker, defender) {
    const attackerType = getCreatureType(attacker);
    const defenderType = getCreatureType(defender);
    
    let multiplier = 1.0;
    const adv = TYPE_ADVANTAGES[attackerType];
    
    if (adv && adv.strong.includes(defenderType)) multiplier = 1.5;
    if (adv && adv.weak.includes(defenderType)) multiplier = 0.75;
    
    const isCritical = Math.random() < 0.1;
    const critMultiplier = isCritical ? 2 : 1;
    
    let damage = Math.max(1, Math.floor((attacker.atk - defender.def) * multiplier * critMultiplier));
    damage = Math.floor(damage * (0.8 + Math.random() * 0.4));
    
    return { damage, multiplier, isCritical };
}

// Initialize WebSocket connection
function initArenaWebSocket() {
    if (socket && socket.connected) return;
    
    const token = state.token;
    if (!token) return;
    
    // Connect to Socket.IO server
    socket = io(API_URL, {
        transports: ['websocket'],
        query: { token }
    });
    
    socket.on('connect', () => {
        console.log('✅ Arena WebSocket connected');
        if (isSearching) {
            socket.emit('find-match', { team: currentTeam.filter(m => m !== null) });
        }
    });
    
    socket.on('match-found', (data) => {
        currentMatchRequest = data;
        showAcceptBattleModal(data.opponent);
    });
    
    socket.on('match-cancelled', () => {
        showToast('Match search cancelled', '❌');
        stopSearching();
    });
    
    socket.on('battle-start', (data) => {
        currentBattle = data;
        startBattle(data);
    });
    
    socket.on('opponent-move', (data) => {
        handleOpponentMove(data);
    });
    
    socket.on('turn-update', (data) => {
        updateTurnTimer(data.timeLeft);
    });
    
    socket.on('battle-end', (data) => {
        endBattle(data);
    });
    
    socket.on('rating-update', (data) => {
        updateArenaStats(data);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Arena WebSocket disconnected');
        if (isSearching) stopSearching();
    });
}

// Find Match
function findMatch() {
    if (currentTeam.filter(m => m !== null).length !== 3) {
        showToast('You need to select 3 monsters!', '⚠️');
        return;
    }
    
    const tokens = parseInt(document.getElementById('arenaTokens').innerText);
    if (tokens <= 0) {
        showToast('No arena tokens left! Buy more in shop.', '❌');
        return;
    }
    
    if (isSearching) return;
    
    initArenaWebSocket();
    
    isSearching = true;
    document.getElementById('arenaFindBtn').style.display = 'none';
    document.getElementById('arenaCancelBtn').style.display = 'block';
    
    socket.emit('find-match', { team: currentTeam });
    showToast('Searching for opponent...', '🔍');
}

function cancelSearch() {
    if (!isSearching) return;
    if (socket) socket.emit('cancel-search');
    stopSearching();
}

function stopSearching() {
    isSearching = false;
    document.getElementById('arenaFindBtn').style.display = 'flex';
    document.getElementById('arenaCancelBtn').style.display = 'none';
}

function showAcceptBattleModal(opponent) {
    document.getElementById('acceptOpponentName').innerText = opponent.name;
    document.getElementById('acceptOpponentRating').innerHTML = `Rating: ${opponent.rating} · League: ${opponent.league}`;
    document.getElementById('acceptBattleOverlay').classList.add('show');
}

function acceptBattle() {
    document.getElementById('acceptBattleOverlay').classList.remove('show');
    if (socket && currentMatchRequest) {
        socket.emit('accept-battle', { matchId: currentMatchRequest.matchId });
    }
    stopSearching();
}

function declineBattle() {
    document.getElementById('acceptBattleOverlay').classList.remove('show');
    if (socket && currentMatchRequest) {
        socket.emit('decline-battle', { matchId: currentMatchRequest.matchId });
    }
    currentMatchRequest = null;
    showToast('Battle declined', '❌');
}

function startBattle(battleData) {
    currentBattle = battleData;
    document.getElementById('battleOverlay').classList.add('show');
    
    // Set player names
    document.getElementById('playerName').innerHTML = `YOU <span style="font-size:10px">(${battleData.player.rating})</span>`;
    document.getElementById('opponentName').innerHTML = `${battleData.opponent.name} <span style="font-size:10px">(${battleData.opponent.rating})</span>`;
    
    // Render monsters
    renderBattleMonsters('player', battleData.player.monsters, true);
    renderBattleMonsters('opponent', battleData.opponent.monsters, false);
    
    // Update health bars
    updateHealthBar('player', battleData.player.totalHealth, battleData.player.maxHealth);
    updateHealthBar('opponent', battleData.opponent.totalHealth, battleData.opponent.maxHealth);
    
    // Clear battle log
    document.getElementById('battleLogMessages').innerHTML = '';
    addBattleLogMessage('⚔️ BATTLE STARTED! ⚔️');
    
    // Show whose turn
    if (battleData.currentTurn === 'player') {
        document.getElementById('battleMessage').innerHTML = '🔵 YOUR TURN - Click a monster to attack!';
        enableAttackSelection();
    } else {
        document.getElementById('battleMessage').innerHTML = '🔴 OPPONENT\'S TURN - Waiting...';
        disableAttackSelection();
    }
}

function renderBattleMonsters(side, monsters, isPlayer) {
    const container = document.getElementById(`${side}Monsters`);
    container.innerHTML = monsters.map((monster, idx) => `
        <div class="battle-monster-card ${isPlayer && monster.hp > 0 ? 'can-attack' : ''}" 
             data-side="${side}" data-index="${idx}" data-alive="${monster.hp > 0}"
             onclick="${isPlayer && monster.hp > 0 ? `selectAttackTarget(${idx})` : ''}">
            <img src="${monster.icon}" alt="${monster.name}" 
                 onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
            <div class="battle-monster-name">${monster.name}</div>
            <div class="battle-monster-hp">❤️ ${monster.hp}/${monster.maxHp}</div>
        </div>
    `).join('');
}

function selectAttackTarget(targetIndex) {
    if (!currentBattle || currentBattle.currentTurn !== 'player') {
        addBattleLogMessage('❌ Not your turn!', true);
        return;
    }
    
    const playerMonster = currentBattle.player.monsters.find(m => m.hp > 0);
    if (!playerMonster) {
        addBattleLogMessage('❌ You have no alive monsters!', true);
        return;
    }
    
    const targetMonster = currentBattle.opponent.monsters[targetIndex];
    if (!targetMonster || targetMonster.hp <= 0) {
        addBattleLogMessage('❌ That monster is already defeated!', true);
        return;
    }
    
    // Animate attack
    animateAttack(targetIndex);
    
    // Calculate damage
    const { damage, multiplier, isCritical } = calculateDamage(playerMonster, targetMonster);
    
    // Send move to server
    if (socket) {
        socket.emit('make-move', {
            battleId: currentBattle.battleId,
            attackerIndex: currentBattle.player.monsters.findIndex(m => m.id === playerMonster.id),
            targetIndex: targetIndex
        });
    }
    
    disableAttackSelection();
    document.getElementById('battleMessage').innerHTML = '⏳ Waiting for server...';
}

function animateAttack(targetIndex) {
    const targetCard = document.querySelector(`#opponentMonsters .battle-monster-card[data-index="${targetIndex}"]`);
    if (targetCard) {
        targetCard.classList.add('defending');
        setTimeout(() => targetCard.classList.remove('defending'), 300);
    }
    
    // Find attacking monster card
    const attackerCard = document.querySelector(`#playerMonsters .battle-monster-card.can-attack`);
    if (attackerCard) {
        attackerCard.classList.add('attacking');
        setTimeout(() => attackerCard.classList.remove('attacking'), 300);
    }
}

function handleOpponentMove(data) {
    addBattleLogMessage(data.logMessage);
    
    // Update health
    if (data.playerHealth) {
        updateHealthBar('player', data.playerHealth.current, data.playerHealth.max);
        updateMonsterHealth('player', data.playerHealth.monsters);
    }
    if (data.opponentHealth) {
        updateHealthBar('opponent', data.opponentHealth.current, data.opponentHealth.max);
        updateMonsterHealth('opponent', data.opponentHealth.monsters);
    }
    
    // Animate opponent's attack
    if (data.attackerIndex !== undefined && data.targetIndex !== undefined) {
        const attackerCard = document.querySelector(`#opponentMonsters .battle-monster-card[data-index="${data.attackerIndex}"]`);
        const targetCard = document.querySelector(`#playerMonsters .battle-monster-card[data-index="${data.targetIndex}"]`);
        if (attackerCard) attackerCard.classList.add('attacking');
        if (targetCard) targetCard.classList.add('defending');
        setTimeout(() => {
            if (attackerCard) attackerCard.classList.remove('attacking');
            if (targetCard) targetCard.classList.remove('defending');
        }, 300);
    }
    
    // Check if it's player's turn
    if (data.nextTurn === 'player') {
        document.getElementById('battleMessage').innerHTML = '🔵 YOUR TURN - Click a monster to attack!';
        enableAttackSelection();
    } else {
        document.getElementById('battleMessage').innerHTML = '🔴 OPPONENT\'S TURN - Waiting...';
        disableAttackSelection();
    }
}

function updateHealthBar(side, current, max) {
    const percent = (current / max) * 100;
    const fill = document.getElementById(`${side}HealthFill`);
    const text = document.getElementById(`${side}HealthText`);
    if (fill) fill.style.width = `${percent}%`;
    if (text) text.innerHTML = `${Math.floor(current)}/${Math.floor(max)}`;
}

function updateMonsterHealth(side, monsters) {
    monsters.forEach((monster, idx) => {
        const card = document.querySelector(`#${side}Monsters .battle-monster-card[data-index="${idx}"]`);
        if (card) {
            const hpDiv = card.querySelector('.battle-monster-hp');
            if (hpDiv) hpDiv.innerHTML = `❤️ ${monster.hp}/${monster.maxHp}`;
            if (monster.hp <= 0) {
                card.classList.add('disabled');
                card.classList.remove('can-attack');
                card.setAttribute('data-alive', 'false');
            }
        }
    });
}

function updateTurnTimer(seconds) {
    const timerEl = document.getElementById('turnTimer');
    if (timerEl) {
        timerEl.innerHTML = `${seconds}s`;
        if (seconds <= 5) timerEl.style.color = '#ef4444';
        else timerEl.style.color = '#f59e0b';
    }
}

function enableAttackSelection() {
    const monsters = document.querySelectorAll('#playerMonsters .battle-monster-card');
    monsters.forEach(card => {
        if (card.getAttribute('data-alive') !== 'false') {
            card.classList.add('can-attack');
        }
    });
}

function disableAttackSelection() {
    const monsters = document.querySelectorAll('#playerMonsters .battle-monster-card');
    monsters.forEach(card => card.classList.remove('can-attack'));
}

function addBattleLogMessage(message, isError = false) {
    const logContainer = document.getElementById('battleLogMessages');
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = isError ? `❌ ${message}` : `⚔️ ${message}`;
    msgDiv.style.color = isError ? '#ef4444' : '#94a3b8';
    logContainer.appendChild(msgDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function endBattle(data) {
    addBattleLogMessage(data.resultMessage);
    
    if (data.winner === 'player') {
        addBattleLogMessage(`🏆 VICTORY! +${data.reward} MMO +${data.ratingGain} rating`);
        document.getElementById('battleMessage').innerHTML = '🎉 VICTORY! 🎉';
        spawnStars('epic');
    } else if (data.winner === 'opponent') {
        addBattleLogMessage(`💀 DEFEAT! -${data.ratingLoss} rating`);
        document.getElementById('battleMessage').innerHTML = '💀 DEFEAT! 💀';
    } else {
        addBattleLogMessage(`🤝 DRAW!`);
        document.getElementById('battleMessage').innerHTML = '🤝 DRAW! 🤝';
    }
    
    // Update arena stats
    updateArenaStats(data.newStats);
    
    // Close battle after 3 seconds
    setTimeout(() => {
        closeBattle();
    }, 3000);
}

function closeBattle() {
    document.getElementById('battleOverlay').classList.remove('show');
    currentBattle = null;
    disableAttackSelection();
}

function updateArenaStats(stats) {
    document.getElementById('arenaLeague').innerHTML = stats.league;
    document.getElementById('arenaRating').innerHTML = stats.rating;
    document.getElementById('arenaWins').innerHTML = stats.wins;
    document.getElementById('arenaLosses').innerHTML = stats.losses;
    document.getElementById('arenaDraws').innerHTML = stats.draws;
    document.getElementById('arenaTokens').innerHTML = stats.tokens;
    
    // Update user balance if changed
    if (stats.balance && state.user) {
        state.user.balance = stats.balance;
        updateHeader();
    }
}

// Monster Selection
function openMonsterSelector(slotIndex) {
    selectedSlotIndex = slotIndex;
    
    const inventory = state.inventory.filter(item => {
        const creature = getCreature(item.creatureId);
        return creature && item.count > 0;
    });
    
    if (inventory.length === 0) {
        showToast('You have no monsters! Open some capsules first.', '⚠️');
        return;
    }
    
    const grid = document.getElementById('monsterSelectorGrid');
    grid.innerHTML = inventory.map(item => {
        const creature = getCreature(item.creatureId);
        const isSelected = currentTeam[selectedSlotIndex]?.id === creature.id;
        return `
            <div class="monster-selector-item ${isSelected ? 'selected' : ''}" onclick="selectMonsterForTeam('${creature.id}')">
                <img src="${creature.icon}" alt="${creature.name}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                <div class="monster-selector-item-name">${creature.name}</div>
                <div style="font-size:8px;color:#22c55e">x${item.count}</div>
            </div>
        `;
    }).join('');
    
    document.getElementById('monsterSelectorOverlay').classList.add('show');
}

function selectMonsterForTeam(creatureId) {
    const creature = getCreature(creatureId);
    if (!creature) return;
    
    currentTeam[selectedSlotIndex] = {
        id: creature.id,
        name: creature.name,
        icon: creature.icon,
        rarity: creature.rarity,
        atk: creature.incomeBase * 2,
        def: Math.floor(creature.incomeBase * 1.5),
        hp: creature.incomeBase * 10,
        maxHp: creature.incomeBase * 10
    };
    
    updateTeamSlots();
    closeMonsterSelector();
}

function updateTeamSlots() {
    const slots = document.querySelectorAll('.arena-slot');
    slots.forEach((slot, idx) => {
        const monster = currentTeam[idx];
        if (monster) {
            slot.innerHTML = `
                <img src="${monster.icon}" alt="${monster.name}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                <div class="slot-rarity ${monster.rarity}">${monster.rarity.slice(0, 3)}</div>
            `;
            slot.classList.add('filled');
            slot.classList.remove('empty');
        } else {
            slot.innerHTML = '+';
            slot.classList.remove('filled');
            slot.classList.add('empty');
        }
    });
}

function closeMonsterSelector() {
    document.getElementById('monsterSelectorOverlay').classList.remove('show');
    selectedSlotIndex = null;
}

// Load arena stats from server
async function loadArenaStats() {
    try {
        const res = await apiRequest('GET', '/api/arena/stats');
        if (res && res.success) {
            updateArenaStats(res.stats);
            loadBattleHistory();
        }
    } catch (e) {
        console.error('loadArenaStats error:', e);
    }
}

async function loadBattleHistory() {
    try {
        const res = await apiRequest('GET', '/api/arena/history');
        if (res && res.success) {
            const historyContainer = document.getElementById('arenaHistoryList');
            if (res.history.length === 0) {
                historyContainer.innerHTML = '<div style="text-align:center;color:#4a5568;padding:20px">No battles yet</div>';
                return;
            }
            
            historyContainer.innerHTML = res.history.map(battle => `
                <div class="arena-history-item ${battle.result}">
                    <span>${battle.result === 'win' ? '🏆' : battle.result === 'loss' ? '💀' : '🤝'}</span>
                    <span>vs ${battle.opponentName}</span>
                    <span>${battle.result === 'win' ? '+' : ''}${battle.ratingChange}</span>
                    <span>${new Date(battle.date).toLocaleDateString()}</span>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('loadBattleHistory error:', e);
    }
}

// Initialize arena when tab is opened
function initArena() {
    loadArenaStats();
    updateTeamSlots();
    initArenaWebSocket();
}

// Socket.io script - add to HTML head
function loadSocketIO() {
    if (!document.querySelector('script[src*="socket.io"]')) {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
        document.head.appendChild(script);
    }
}

// Call this when page loads
loadSocketIO();