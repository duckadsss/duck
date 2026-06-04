// ============================================
// ARENA PVP SYSTEM - FULL REWRITE (FIXED)
// ============================================

let arenaSocket = null;
let arenaCurrentTeam = [null, null, null];
let arenaIsSearching = false;
let arenaCurrentMatchRequest = null;
let arenaCurrentBattle = null;
let arenaSelectedSlotIndex = null;

// League data for display
const ARENA_LEAGUES = [
    { name: 'BRONZE', min: 0, max: 999, color: '#cd7c3a', icon: '🥉', reward: 100 },
    { name: 'SILVER', min: 1000, max: 1999, color: '#94a3b8', icon: '🥈', reward: 150 },
    { name: 'GOLD', min: 2000, max: 2999, color: '#f59e0b', icon: '🥇', reward: 250 },
    { name: 'PLATINUM', min: 3000, max: 3999, color: '#06b6d4', icon: '💎', reward: 400 },
    { name: 'DIAMOND', min: 4000, max: 9999, color: '#a855f7', icon: '👑', reward: 600 }
];

// Initialize WebSocket connection
function initArenaWebSocket() {
    if (arenaSocket && arenaSocket.connected) return;
    
    const token = state.token;
    if (!token) return;
    
    if (typeof io === 'undefined') {
        console.log('⚠️ Socket.IO not loaded yet, waiting...');
        setTimeout(initArenaWebSocket, 500);
        return;
    }
    
    arenaSocket = io(API_URL, {
        transports: ['websocket'],
        query: { token }
    });
    
    arenaSocket.on('connect', () => {
        console.log('✅ Arena WebSocket connected');
        if (arenaIsSearching) {
            arenaSocket.emit('find-match', { team: arenaCurrentTeam.filter(m => m !== null) });
        }
    });
    
    arenaSocket.on('match-found', (data) => {
        console.log('🎯 Match found:', data);
        arenaCurrentMatchRequest = data;
        showAcceptBattleModal(data.opponent);
    });
    
    arenaSocket.on('match-cancelled', (data) => {
        console.log('❌ Match cancelled:', data);
        showToast(data?.reason || 'Match search cancelled', '❌');
        stopArenaSearch();
    });
    
    arenaSocket.on('battle-start', (data) => {
        console.log('⚔️ Battle start:', data);
        arenaCurrentBattle = data;
        startBattle(data);
    });
    
    arenaSocket.on('opponent-move', (data) => {
        console.log('🔄 Opponent move:', data);
        handleOpponentMove(data);
    });
    
    arenaSocket.on('turn-update', (data) => {
        updateTurnTimer(data.timeLeft);
    });
    
    arenaSocket.on('battle-end', (data) => {
        console.log('🏁 Battle end:', data);
        endBattle(data);
    });
    
    arenaSocket.on('error', (data) => {
        console.error('❌ Arena error:', data);
        showToast(data.message, '❌');
    });
    
    arenaSocket.on('disconnect', () => {
        console.log('❌ Arena WebSocket disconnected');
        if (arenaIsSearching) stopArenaSearch();
    });
}

// Find Match
function findArenaMatch() {
    const filledSlots = arenaCurrentTeam.filter(m => m !== null).length;
    if (filledSlots !== 3) {
        showToast('You need to select 3 monsters!', '⚠️');
        return;
    }
    
    // Check for duplicates
    const uniqueIds = new Set(arenaCurrentTeam.map(m => m.id));
    if (uniqueIds.size !== 3) {
        showToast('Cannot select duplicate monsters!', '⚠️');
        return;
    }
    
    const tokensEl = document.getElementById('arenaTokens');
    if (!tokensEl) return;
    
    const tokens = parseInt(tokensEl.innerText);
    if (tokens <= 0) {
        showToast('No arena tokens left! Buy more in shop.', '❌');
        return;
    }
    
    if (arenaIsSearching) return;
    
    initArenaWebSocket();
    
    arenaIsSearching = true;
    const findBtn = document.getElementById('arenaFindBtn');
    const cancelBtn = document.getElementById('arenaCancelBtn');
    if (findBtn) findBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'block';
    
    arenaSocket.emit('find-match', { team: arenaCurrentTeam });
    showToast('Searching for opponent...', '🔍');
}

function cancelArenaSearch() {
    if (!arenaIsSearching) return;
    if (arenaSocket) arenaSocket.emit('cancel-search');
    stopArenaSearch();
}

function stopArenaSearch() {
    arenaIsSearching = false;
    const findBtn = document.getElementById('arenaFindBtn');
    const cancelBtn = document.getElementById('arenaCancelBtn');
    if (findBtn) findBtn.style.display = 'flex';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function showAcceptBattleModal(opponent) {
    const overlay = document.getElementById('acceptBattleOverlay');
    if (!overlay) return;
    
    const opponentNameEl = document.getElementById('acceptOpponentName');
    const opponentRatingEl = document.getElementById('acceptOpponentRating');
    
    if (opponentNameEl) opponentNameEl.innerText = opponent.name;
    if (opponentRatingEl) opponentRatingEl.innerHTML = `Rating: ${opponent.rating} · League: ${opponent.league}`;
    
    overlay.classList.add('show');
}

function acceptBattle() {
    const overlay = document.getElementById('acceptBattleOverlay');
    if (overlay) overlay.classList.remove('show');
    
    if (arenaSocket && arenaCurrentMatchRequest) {
        // IMPORTANT: Server expects 'matchId', not 'battleId'
        arenaSocket.emit('accept-battle', { matchId: arenaCurrentMatchRequest.matchId });
    }
    stopArenaSearch();
}

function declineBattle() {
    const overlay = document.getElementById('acceptBattleOverlay');
    if (overlay) overlay.classList.remove('show');
    
    if (arenaSocket && arenaCurrentMatchRequest) {
        arenaSocket.emit('decline-battle', { matchId: arenaCurrentMatchRequest.matchId });
    }
    arenaCurrentMatchRequest = null;
    showToast('Battle declined', '❌');
}

// Battle UI
function startBattle(battleData) {
    arenaCurrentBattle = battleData;
    
    // Hide arena UI, show battle screen
    const arenaMainUI = document.getElementById('arenaMainUI');
    const arenaBattleScreen = document.getElementById('arenaBattleScreen');
    if (arenaMainUI) arenaMainUI.style.display = 'none';
    if (arenaBattleScreen) arenaBattleScreen.style.display = 'block';
    
    // Set player names
    const playerNameEl = document.getElementById('battlePlayerName');
    const opponentNameEl = document.getElementById('battleOpponentName');
    if (playerNameEl) playerNameEl.innerHTML = `YOU <span style="font-size:10px">(${battleData.player.rating})</span>`;
    if (opponentNameEl) opponentNameEl.innerHTML = `${battleData.opponent.name} <span style="font-size:10px">(${battleData.opponent.rating})</span>`;
    
    // Render monsters
    renderBattleMonsters('player', battleData.player.monsters, true);
    renderBattleMonsters('opponent', battleData.opponent.monsters, false);
    
    // Clear battle log
    const logContainer = document.getElementById('battleLogMessages');
    if (logContainer) logContainer.innerHTML = '';
    addBattleLogMessage('⚔️ BATTLE STARTED! ⚔️');
    
    // Show turn indicator
    const messageEl = document.getElementById('battleMessage');
    if (battleData.currentTurn === 'player') {
        if (messageEl) messageEl.innerHTML = '🔵 YOUR TURN - Attack! 🔵';
        enableAttackButtons();
    } else {
        if (messageEl) messageEl.innerHTML = '🔴 OPPONENT\'S TURN - Waiting... 🔴';
        disableAttackButtons();
    }
}

function renderBattleMonsters(side, monsters, isPlayer) {
    const container = document.getElementById(`${side}Monsters`);
    if (!container) return;
    
    container.innerHTML = monsters.map((monster, idx) => `
        <div class="arena-battle-monster-card ${monster.hp <= 0 ? 'defeated' : ''}" data-side="${side}" data-index="${idx}">
            <div class="monster-icon">
                <img src="${monster.icon}" alt="${monster.name}" 
                     onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                <div class="monster-rarity ${monster.rarity}"></div>
            </div>
            <div class="monster-name">${escapeHtml(monster.name)}</div>
            <div class="monster-hp-bar">
                <div class="monster-hp-fill" style="width: ${(monster.hp / monster.maxHp) * 100}%"></div>
                <span class="monster-hp-text">${Math.floor(monster.hp)}/${monster.maxHp}</span>
            </div>
            ${isPlayer && monster.hp > 0 ? 
                `<button class="monster-attack-btn" onclick="arenaAttack(${idx})">⚔️ ATTACK</button>` : 
                monster.hp <= 0 ? '<div class="monster-defeated">💀 DEFEATED</div>' : ''
            }
        </div>
    `).join('');
}

function arenaAttack(attackerIndex) {
    if (!arenaCurrentBattle || arenaCurrentBattle.currentTurn !== 'player') {
        addBattleLogMessage('❌ Not your turn!', true);
        return;
    }
    
    const attackerMonster = arenaCurrentBattle.player.monsters[attackerIndex];
    if (!attackerMonster || attackerMonster.hp <= 0) {
        addBattleLogMessage('❌ This monster is defeated!', true);
        return;
    }
    
    // Show target selection UI
    showTargetSelection(attackerIndex);
}

function showTargetSelection(attackerIndex) {
    const opponentMonsters = document.querySelectorAll('#opponentMonsters .arena-battle-monster-card');
    
    // Highlight enemy monsters
    opponentMonsters.forEach(card => {
        const idx = parseInt(card.dataset.index);
        const monster = arenaCurrentBattle.opponent.monsters[idx];
        if (monster && monster.hp > 0) {
            card.classList.add('targetable');
            card.style.cursor = 'pointer';
            card.onclick = () => {
                confirmAttack(attackerIndex, idx);
                clearTargetSelection();
            };
        }
    });
    
    // Add cancel button to message
    const battleMessage = document.getElementById('battleMessage');
    const originalMessage = battleMessage.innerHTML;
    battleMessage.innerHTML = '🎯 SELECT A TARGET 🎯 <button class="cancel-target-btn" onclick="clearTargetSelection()">CANCEL</button>';
    
    window._tempTargetCallback = () => {
        battleMessage.innerHTML = originalMessage;
    };
}

function clearTargetSelection() {
    const opponentMonsters = document.querySelectorAll('#opponentMonsters .arena-battle-monster-card');
    opponentMonsters.forEach(card => {
        card.classList.remove('targetable');
        card.style.cursor = '';
        card.onclick = null;
    });
    
    const battleMessage = document.getElementById('battleMessage');
    if (arenaCurrentBattle?.currentTurn === 'player') {
        battleMessage.innerHTML = '🔵 YOUR TURN - Attack! 🔵';
    } else {
        battleMessage.innerHTML = '🔴 OPPONENT\'S TURN - Waiting... 🔴';
    }
    
    if (window._tempTargetCallback) window._tempTargetCallback();
}

function confirmAttack(attackerIndex, targetIndex) {
    clearTargetSelection();
    
    // Animate attack
    animateAttack(attackerIndex, targetIndex);
    
    // Send move to server
    if (arenaSocket) {
        arenaSocket.emit('make-move', {
            battleId: arenaCurrentBattle.battleId,
            attackerIndex: attackerIndex,
            targetIndex: targetIndex
        });
    }
    
    disableAttackButtons();
    const messageEl = document.getElementById('battleMessage');
    if (messageEl) messageEl.innerHTML = '⏳ Waiting for server...';
}

function animateAttack(attackerIndex, targetIndex) {
    const attackerCard = document.querySelector(`#playerMonsters .arena-battle-monster-card[data-index="${attackerIndex}"]`);
    const targetCard = document.querySelector(`#opponentMonsters .arena-battle-monster-card[data-index="${targetIndex}"]`);
    
    if (attackerCard) {
        attackerCard.classList.add('attacking');
        setTimeout(() => attackerCard.classList.remove('attacking'), 300);
    }
    if (targetCard) {
        targetCard.classList.add('defending');
        setTimeout(() => targetCard.classList.remove('defending'), 300);
    }
}

function handleOpponentMove(data) {
    addBattleLogMessage(data.logMessage);
    
    // Update health and UI
    if (data.playerHealth) {
        updateBattleMonsters('player', data.playerHealth.monsters);
    }
    if (data.opponentHealth) {
        updateBattleMonsters('opponent', data.opponentHealth.monsters);
    }
    
    // Animate opponent's attack
    if (data.attackerIndex !== undefined && data.targetIndex !== undefined) {
        const attackerCard = document.querySelector(`#opponentMonsters .arena-battle-monster-card[data-index="${data.attackerIndex}"]`);
        const targetCard = document.querySelector(`#playerMonsters .arena-battle-monster-card[data-index="${data.targetIndex}"]`);
        if (attackerCard) {
            attackerCard.classList.add('attacking');
            setTimeout(() => attackerCard.classList.remove('attacking'), 300);
        }
        if (targetCard) {
            targetCard.classList.add('defending');
            setTimeout(() => targetCard.classList.remove('defending'), 300);
        }
    }
    
    // Check if it's player's turn
    const messageEl = document.getElementById('battleMessage');
    if (data.nextTurn === 'player') {
        if (messageEl) messageEl.innerHTML = '🔵 YOUR TURN - Attack! 🔵';
        enableAttackButtons();
    } else {
        if (messageEl) messageEl.innerHTML = '🔴 OPPONENT\'S TURN - Waiting... 🔴';
        disableAttackButtons();
    }
}

function updateBattleMonsters(side, monsters) {
    monsters.forEach((monster, idx) => {
        const card = document.querySelector(`#${side}Monsters .arena-battle-monster-card[data-index="${idx}"]`);
        if (card) {
            const hpFill = card.querySelector('.monster-hp-fill');
            const hpText = card.querySelector('.monster-hp-text');
            const attackBtn = card.querySelector('.monster-attack-btn');
            const defeatedDiv = card.querySelector('.monster-defeated');
            
            const hpPercent = (monster.hp / monster.maxHp) * 100;
            if (hpFill) hpFill.style.width = `${hpPercent}%`;
            if (hpText) hpText.innerHTML = `${Math.floor(monster.hp)}/${monster.maxHp}`;
            
            if (monster.hp <= 0) {
                card.classList.add('defeated');
                if (attackBtn) attackBtn.remove();
                if (!defeatedDiv) {
                    const defeatedMark = document.createElement('div');
                    defeatedMark.className = 'monster-defeated';
                    defeatedMark.innerHTML = '💀 DEFEATED';
                    card.appendChild(defeatedMark);
                }
            } else {
                card.classList.remove('defeated');
                if (defeatedDiv) defeatedDiv.remove();
                // Re-add attack button if missing and it's player side
                if (side === 'player' && !attackBtn && !card.querySelector('.monster-attack-btn')) {
                    const idxAttr = parseInt(card.dataset.index);
                    const newBtn = document.createElement('button');
                    newBtn.className = 'monster-attack-btn';
                    newBtn.innerHTML = '⚔️ ATTACK';
                    newBtn.onclick = () => arenaAttack(idxAttr);
                    card.appendChild(newBtn);
                }
            }
        }
    });
}

function updateTurnTimer(seconds) {
    const timerEl = document.getElementById('turnTimer');
    if (timerEl) {
        timerEl.innerHTML = `${seconds}s`;
        timerEl.style.color = seconds <= 5 ? '#ef4444' : '#f59e0b';
    }
}

function enableAttackButtons() {
    const buttons = document.querySelectorAll('#playerMonsters .monster-attack-btn');
    buttons.forEach(btn => {
        const card = btn.closest('.arena-battle-monster-card');
        if (card && !card.classList.contains('defeated')) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    });
}

function disableAttackButtons() {
    const buttons = document.querySelectorAll('#playerMonsters .monster-attack-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    });
}

function addBattleLogMessage(message, isError = false) {
    const logContainer = document.getElementById('battleLogMessages');
    if (!logContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = isError ? `❌ ${message}` : `⚔️ ${message}`;
    msgDiv.style.color = isError ? '#ef4444' : '#94a3b8';
    msgDiv.style.marginBottom = '4px';
    msgDiv.style.fontSize = '10px';
    logContainer.appendChild(msgDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Keep only last 20 messages
    while (logContainer.children.length > 20) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

function endBattle(data) {
    addBattleLogMessage(data.resultMessage);
    
    const messageEl = document.getElementById('battleMessage');
    if (data.winner === 'player') {
        addBattleLogMessage(`🏆 VICTORY! +${data.reward} MMO +${data.ratingGain} rating`);
        if (messageEl) messageEl.innerHTML = '🎉 VICTORY! 🎉';
        if (typeof spawnStars === 'function') spawnStars('epic');
    } else if (data.winner === 'opponent') {
        addBattleLogMessage(`💀 DEFEAT! -${data.ratingLoss} rating`);
        if (messageEl) messageEl.innerHTML = '💀 DEFEAT! 💀';
    } else {
        addBattleLogMessage(`🤝 DRAW!`);
        if (messageEl) messageEl.innerHTML = '🤝 DRAW! 🤝';
    }
    
    updateArenaStats(data.newStats);
    
    setTimeout(() => {
        closeBattle();
    }, 4000);
}

function closeBattle() {
    // Hide battle screen, show arena UI
    const arenaMainUI = document.getElementById('arenaMainUI');
    const arenaBattleScreen = document.getElementById('arenaBattleScreen');
    if (arenaMainUI) arenaMainUI.style.display = 'block';
    if (arenaBattleScreen) arenaBattleScreen.style.display = 'none';
    arenaCurrentBattle = null;
    disableAttackButtons();
    
    // Refresh arena stats
    loadArenaStats();
}

// Team selection
function openMonsterSelector(slotIndex) {
    arenaSelectedSlotIndex = slotIndex;
    
    const inventory = state.inventory.filter(item => {
        const creature = getCreature(item.creatureId);
        return creature && item.count > 0;
    });
    
    if (inventory.length === 0) {
        showToast('You have no monsters! Open some capsules first.', '⚠️');
        return;
    }
    
    const grid = document.getElementById('monsterSelectorGrid');
    if (!grid) return;
    
    // Get currently selected monster IDs to disable duplicates
    const selectedIds = arenaCurrentTeam.map(m => m?.id).filter(id => id !== null);
    
    grid.innerHTML = inventory.map(item => {
        const creature = getCreature(item.creatureId);
        const isSelected = arenaCurrentTeam[arenaSelectedSlotIndex]?.id === creature.id;
        const isDuplicate = selectedIds.includes(creature.id) && !isSelected;
        
        return `
            <div class="monster-selector-item ${isSelected ? 'selected' : ''} ${isDuplicate ? 'duplicate' : ''}" 
                 onclick="${!isDuplicate ? `selectMonsterForTeam('${creature.id}')` : ''}">
                <img src="${creature.icon}" alt="${creature.name}" onerror="this.src='https://ndammo.github.io/Mmodna/default.png'">
                <div class="monster-selector-item-name">${escapeHtml(creature.name)}</div>
                <div style="font-size:8px;color:#22c55e">x${item.count}</div>
                ${isDuplicate ? '<div class="duplicate-badge">ALREADY SELECTED</div>' : ''}
            </div>
        `;
    }).join('');
    
    const overlay = document.getElementById('monsterSelectorOverlay');
    if (overlay) overlay.classList.add('show');
}

function selectMonsterForTeam(creatureId) {
    const creature = getCreature(creatureId);
    if (!creature) return;
    
    // Check for duplicate
    const isDuplicate = arenaCurrentTeam.some((m, idx) => m?.id === creatureId && idx !== arenaSelectedSlotIndex);
    if (isDuplicate) {
        showToast('This monster is already in your team!', '⚠️');
        return;
    }
    
    arenaCurrentTeam[arenaSelectedSlotIndex] = {
        id: creature.id,
        name: creature.name,
        icon: creature.icon,
        rarity: creature.rarity,
        incomeBase: creature.incomeBase
    };
    
    updateArenaTeamSlots();
    closeMonsterSelector();
}

function updateArenaTeamSlots() {
    const slots = document.querySelectorAll('.arena-slot');
    slots.forEach((slot, idx) => {
        const monster = arenaCurrentTeam[idx];
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
    const overlay = document.getElementById('monsterSelectorOverlay');
    if (overlay) overlay.classList.remove('show');
    arenaSelectedSlotIndex = null;
}

// Arena Stats and UI
async function loadArenaStats() {
    try {
        const res = await apiRequest('GET', '/api/arena/stats');
        if (res && res.success) {
            updateArenaStats(res.stats);
            loadBattleHistory();
            updateLeagueDisplay(res.stats.rating);
        }
    } catch (e) {
        console.error('loadArenaStats error:', e);
    }
}

function updateArenaStats(stats) {
    const leagueEl = document.getElementById('arenaLeague');
    const ratingEl = document.getElementById('arenaRating');
    const winsEl = document.getElementById('arenaWins');
    const lossesEl = document.getElementById('arenaLosses');
    const drawsEl = document.getElementById('arenaDraws');
    const tokensEl = document.getElementById('arenaTokens');
    
    if (leagueEl) leagueEl.innerHTML = stats.league;
    if (ratingEl) ratingEl.innerHTML = stats.rating;
    if (winsEl) winsEl.innerHTML = stats.wins;
    if (lossesEl) lossesEl.innerHTML = stats.losses;
    if (drawsEl) drawsEl.innerHTML = stats.draws;
    if (tokensEl) tokensEl.innerHTML = stats.tokens;
    
    if (stats.balance && state.user) {
        state.user.balance = stats.balance;
        if (typeof updateHeader === 'function') updateHeader();
    }
    
    updateLeagueDisplay(stats.rating);
}

function updateLeagueDisplay(rating) {
    const leagueScroll = document.getElementById('leagueScroll');
    if (!leagueScroll) return;
    
    let currentLeagueIndex = 0;
    for (let i = 0; i < ARENA_LEAGUES.length; i++) {
        if (rating >= ARENA_LEAGUES[i].min && rating <= ARENA_LEAGUES[i].max) {
            currentLeagueIndex = i;
            break;
        }
    }
    
    leagueScroll.innerHTML = ARENA_LEAGUES.map((league, idx) => {
        const isCurrent = idx === currentLeagueIndex;
        const isPast = idx < currentLeagueIndex;
        const isFuture = idx > currentLeagueIndex;
        
        let progressHtml = '';
        if (isCurrent && idx < ARENA_LEAGUES.length - 1) {
            const nextMin = ARENA_LEAGUES[idx + 1].min;
            const needed = nextMin - rating;
            const totalNeeded = nextMin - league.min;
            const progressPercent = ((rating - league.min) / totalNeeded) * 100;
            progressHtml = `
                <div class="league-progress">
                    <div class="league-progress-bar" style="width: ${progressPercent}%"></div>
                    <div class="league-progress-text">${needed} to ${ARENA_LEAGUES[idx + 1].name}</div>
                </div>
            `;
        }
        
        return `
            <div class="league-card ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''} ${isFuture ? 'future' : ''}" 
                 style="border-color: ${league.color}">
                <div class="league-icon" style="color: ${league.color}">${league.icon}</div>
                <div class="league-name" style="color: ${league.color}">${league.name}</div>
                <div class="league-range">${league.min}-${league.max}</div>
                <div class="league-reward">+${league.reward} MMO/win</div>
                ${progressHtml}
            </div>
        `;
    }).join('');
    
    // Scroll to current league
    setTimeout(() => {
        const currentCard = leagueScroll.querySelector('.league-card.current');
        if (currentCard) {
            currentCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    }, 100);
}

async function loadBattleHistory() {
    try {
        const res = await apiRequest('GET', '/api/arena/history');
        if (res && res.success) {
            const historyContainer = document.getElementById('arenaHistoryList');
            if (!historyContainer) return;
            
            if (res.history.length === 0) {
                historyContainer.innerHTML = '<div style="text-align:center;color:#4a5568;padding:20px">No battles yet</div>';
                return;
            }
            
            historyContainer.innerHTML = res.history.map(battle => `
                <div class="arena-history-item ${battle.result}">
                    <span>${battle.result === 'win' ? '🏆' : battle.result === 'loss' ? '💀' : '🤝'}</span>
                    <span>vs ${escapeHtml(battle.opponentName)}</span>
                    <span>${battle.result === 'win' ? '+' : ''}${battle.ratingChange}</span>
                    <span>${new Date(battle.date).toLocaleDateString()}</span>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('loadBattleHistory error:', e);
    }
}

async function buyArenaTokens() {
    const amount = 3;
    const cost = amount * 500;
    
    if (state.serverBalance < cost) {
        showToast(`Need ${cost} MMO for 3 arena tokens!`, '❌');
        return;
    }
    
    const res = await apiRequest('POST', '/api/arena/buy-tokens', { amount });
    if (res && res.success) {
        updateArenaStats({ tokens: res.tokens });
        if (res.balance !== undefined && state.user) {
            state.user.balance = res.balance;
            if (typeof updateHeader === 'function') updateHeader();
        }
        showToast(`+${amount} arena tokens!`, '✅');
    } else {
        showToast(res?.message || 'Error buying tokens', '❌');
    }
}

function initArena() {
    loadArenaStats();
    updateArenaTeamSlots();
    initArenaWebSocket();
}

// Make functions global
window.findArenaMatch = findArenaMatch;
window.cancelArenaSearch = cancelArenaSearch;
window.acceptBattle = acceptBattle;
window.declineBattle = declineBattle;
window.arenaAttack = arenaAttack;
window.openMonsterSelector = openMonsterSelector;
window.selectMonsterForTeam = selectMonsterForTeam;
window.closeMonsterSelector = closeMonsterSelector;
window.buyArenaTokens = buyArenaTokens;
window.closeBattle = closeBattle;
window.clearTargetSelection = clearTargetSelection;
window.initArena = initArena;