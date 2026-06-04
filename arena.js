// ============================================================
// ARENA CLIENT - PvP Битвы с WebSocket (УЛУЧШЕННАЯ ВЕРСИЯ)
// ============================================================

class ArenaClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.isInBattle = false;
        this.isSearching = false;
        this.currentBattle = null;
        this.team = [];
        this.elo = 1000;
        this.league = null;
        this.leagues = {};
        this.selectedTarget = null;
        this.selectedAttacker = null;
        this.stats = { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
        this.battleHistory = [];
        this.searchStartTime = null;
        this.searchInterval = null;
        
        // DOM элементы
        this.elements = {
            arenaContainer: null,
            arenaScene: null,
            searchBtn: null,
            cancelBtn: null,
            yourTeamContainer: null,
            opponentTeamContainer: null,
            battleLog: null,
            yourElo: null,
            opponentElo: null,
            yourLeague: null,
            opponentLeague: null,
            turnIndicator: null,
            attackBtn: null,
            statsWins: null,
            statsLosses: null,
            statsStreak: null,
            searchTimer: null
        };
    }
    
    init() {
        this.createArenaUI();
        this.connect();
        this.bindEvents();
        this.loadFromStorage();
    }
    
    loadFromStorage() {
        const savedTeam = localStorage.getItem('arena_team');
        if (savedTeam) {
            try {
                this.team = JSON.parse(savedTeam);
                this.renderTeamSelection();
            } catch (e) {}
        }
    }
    
    saveTeamToStorage() {
        localStorage.setItem('arena_team', JSON.stringify(this.team));
    }
    
    createArenaUI() {
        const gameTab = document.getElementById('tab-game');
        
        // Проверяем, не добавлена ли уже арена
        if (document.querySelector('.arena-section')) return;
        
        const arenaSection = document.createElement('div');
        arenaSection.className = 'arena-section';
        arenaSection.innerHTML = `
            <div class="section-title" style="margin-top: 16px;">
                <i class="fa-solid fa-sword" style="color: var(--legendary)"></i> 
                <span data-i18n="arena.title">PvP Арена</span>
                <span class="arena-elo" id="arenaElo">⭐ Рейтинг: 1000</span>
                <span class="arena-league" id="arenaLeague">🥉 Бронзовая</span>
            </div>
            
            <div class="arena-stats-bar" id="arenaStatsBar" style="display: flex; gap: 12px; margin-bottom: 12px; font-size: 10px; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 12px;">
                <span>🏆 Побед: <strong id="arenaStatsWins">0</strong></span>
                <span>💀 Поражений: <strong id="arenaStatsLosses">0</strong></span>
                <span>⚡ Серия: <strong id="arenaStatsStreak">0</strong></span>
            </div>
            
            <div class="arena-panel">
                <div class="arena-team-selector">
                    <div class="arena-team-title">
                        <i class="fa-solid fa-users"></i> 
                        <span data-i18n="arena.selectTeam">Выберите 3 существа для битвы</span>
                    </div>
                    <div class="arena-team-grid" id="arenaTeamGrid"></div>
                    <div class="arena-team-actions">
                        <button class="arena-search-btn" id="arenaSearchBtn">
                            <i class="fa-solid fa-magnifying-glass"></i> 
                            <span data-i18n="arena.searchBattle">НАЙТИ ПРОТИВНИКА</span>
                        </button>
                        <button class="arena-cancel-btn" id="arenaCancelBtn" style="display:none">
                            <i class="fa-solid fa-times"></i> 
                            <span data-i18n="arena.cancelSearch">ОТМЕНА</span>
                        </button>
                    </div>
                    <div class="arena-search-timer" id="arenaSearchTimer" style="display:none; text-align: center; margin-top: 8px; font-size: 11px; color: #f59e0b;">
                        ⏳ Поиск... <span id="searchTimerSeconds">0</span> сек
                    </div>
                </div>
            </div>
            
            <div class="arena-battle-container" id="arenaBattleContainer" style="display:none">
                <div class="arena-battle-scene">
                    <div class="arena-versus">
                        <span class="vs-text">VS</span>
                    </div>
                    
                    <div class="arena-opponent-info">
                        <div class="arena-player-name" id="arenaOpponentName">Противник</div>
                        <div class="arena-player-elo" id="arenaOpponentElo">⭐ 1000</div>
                        <div class="arena-player-league" id="arenaOpponentLeague">🥉 Бронзовая</div>
                    </div>
                    
                    <div class="arena-teams">
                        <div class="arena-team your-team">
                            <div class="arena-team-label">⚔️ ВАША КОМАНДА</div>
                            <div class="arena-creatures" id="arenaYourTeam"></div>
                        </div>
                        <div class="arena-team opponent-team">
                            <div class="arena-team-label">👾 КОМАНДА ПРОТИВНИКА</div>
                            <div class="arena-creatures" id="arenaOpponentTeam"></div>
                        </div>
                    </div>
                    
                    <div class="arena-turn-indicator" id="arenaTurnIndicator">
                        <i class="fa-solid fa-hourglass-half"></i> Ожидание хода...
                    </div>
                    
                    <div class="arena-battle-controls">
                        <button class="arena-attack-btn" id="arenaAttackBtn" disabled>
                            <i class="fa-solid fa-bolt"></i> АТАКОВАТЬ
                        </button>
                    </div>
                    
                    <div class="arena-battle-log" id="arenaBattleLog">
                        <div class="log-title">📜 Ход битвы</div>
                        <div class="log-messages"></div>
                    </div>
                </div>
            </div>
        `;
        
        gameTab.appendChild(arenaSection);
        
        // Сохраняем ссылки на элементы
        this.elements.arenaContainer = arenaSection;
        this.elements.arenaScene = document.getElementById('arenaBattleContainer');
        this.elements.searchBtn = document.getElementById('arenaSearchBtn');
        this.elements.cancelBtn = document.getElementById('arenaCancelBtn');
        this.elements.yourTeamContainer = document.getElementById('arenaYourTeam');
        this.elements.opponentTeamContainer = document.getElementById('arenaOpponentTeam');
        this.elements.battleLog = document.getElementById('arenaBattleLog');
        this.elements.yourElo = document.getElementById('arenaElo');
        this.elements.opponentElo = document.getElementById('arenaOpponentElo');
        this.elements.yourLeague = document.getElementById('arenaLeague');
        this.elements.opponentLeague = document.getElementById('arenaOpponentLeague');
        this.elements.turnIndicator = document.getElementById('arenaTurnIndicator');
        this.elements.attackBtn = document.getElementById('arenaAttackBtn');
        this.elements.statsWins = document.getElementById('arenaStatsWins');
        this.elements.statsLosses = document.getElementById('arenaStatsLosses');
        this.elements.statsStreak = document.getElementById('arenaStatsStreak');
        this.elements.searchTimer = document.getElementById('arenaSearchTimer');
        
        this.renderTeamSelection();
    }
    
    renderTeamSelection() {
        const grid = document.getElementById('arenaTeamGrid');
        if (!grid) return;
        
        if (!state.inventory || state.inventory.length === 0) {
            grid.innerHTML = '<div class="empty-grid" style="grid-column:1/-1;padding:20px">Откройте капсулы, чтобы получить существ для арены!</div>';
            return;
        }
        
        const sorted = [...state.inventory].sort((a, b) => {
            const aRarity = RARITY_ORDER.indexOf(getCreature(a.creatureId)?.rarity || 'common');
            const bRarity = RARITY_ORDER.indexOf(getCreature(b.creatureId)?.rarity || 'common');
            return bRarity - aRarity;
        });
        
        grid.innerHTML = sorted.map(item => {
            const c = getCreature(item.creatureId);
            if (!c) return '';
            const selectedCount = this.team.filter(t => t.creatureId === item.creatureId).length;
            const isSelected = selectedCount > 0;
            
            return `
                <div class="arena-creature-select ${isSelected ? 'selected' : ''}" 
                     onclick="arenaClient.toggleSelectCreature('${item.creatureId}', ${item.count})"
                     data-creature="${item.creatureId}">
                    <div class="select-icon">${getIconHtml(c)}</div>
                    <div class="select-name">${escapeHtml(c.name)}</div>
                    <div class="select-rarity ${c.rarity}">${c.rarity}</div>
                    <div class="select-count">x${item.count}</div>
                    ${isSelected ? `<div class="select-badge">${selectedCount}/3</div>` : ''}
                </div>
            `;
        }).join('');
    }
    
    toggleSelectCreature(creatureId, count) {
        const selectedCount = this.team.filter(t => t.creatureId === creatureId).length;
        
        if (selectedCount > 0) {
            const index = this.team.findIndex(t => t.creatureId === creatureId);
            if (index !== -1) {
                this.team.splice(index, 1);
            }
        } else {
            if (this.team.length >= 3) {
                showToast('Можно выбрать только 3 существа для битвы!', '⚠️');
                return;
            }
            
            const creature = getCreature(creatureId);
            if (creature) {
                this.team.push({
                    creatureId: creature.id,
                    name: creature.name,
                    rarity: creature.rarity,
                    icon: creature.icon
                });
            }
        }
        
        this.saveTeamToStorage();
        this.renderTeamSelection();
        
        const searchBtn = this.elements.searchBtn;
        if (searchBtn) {
            const canSearch = this.team.length === 3;
            searchBtn.style.opacity = canSearch ? '1' : '0.5';
            searchBtn.disabled = !canSearch;
        }
    }
    
    connect() {
        const wsUrl = API_URL.replace('https://', 'wss://').replace('http://', 'ws://');
        this.socket = io(wsUrl, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        this.socket.on('connect', () => {
            console.log('✅ WebSocket подключен к арене');
            this.isConnected = true;
            
            this.socket.emit('arena:register', {
                userId: state.user?._id,
                telegramId: state.user?.telegramId,
                username: state.user?.username || state.user?.firstName || 'Игрок',
                token: state.token
            });
        });
        
        this.socket.on('arena:registered', (data) => {
            console.log('✅ Зарегистрирован на арене:', data);
            this.elo = data.elo;
            this.league = data.league;
            this.leagues = data.leagues;
            this.stats = data.stats || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
            
            this.updateStatsDisplay();
            
            if (this.elements.yourElo) {
                this.elements.yourElo.textContent = `⭐ Рейтинг: ${this.elo}`;
            }
            if (this.elements.yourLeague) {
                this.elements.yourLeague.textContent = `${this.league.icon} ${this.league.name}`;
            }
        });
        
        this.socket.on('arena:searchStarted', (data) => {
            this.isSearching = true;
            this.searchStartTime = Date.now();
            if (this.elements.searchBtn) this.elements.searchBtn.style.display = 'none';
            if (this.elements.cancelBtn) this.elements.cancelBtn.style.display = 'flex';
            if (this.elements.searchTimer) this.elements.searchTimer.style.display = 'block';
            this.startSearchTimer();
            showToast('🔍 Поиск противника...', '⚔️');
        });
        
        this.socket.on('arena:searchCancelled', (data) => {
            this.isSearching = false;
            this.stopSearchTimer();
            if (this.elements.searchBtn) this.elements.searchBtn.style.display = 'flex';
            if (this.elements.cancelBtn) this.elements.cancelBtn.style.display = 'none';
            if (this.elements.searchTimer) this.elements.searchTimer.style.display = 'none';
            showToast('Поиск отменён', '❌');
        });
        
        this.socket.on('arena:searchTimeout', (data) => {
            this.isSearching = false;
            this.stopSearchTimer();
            if (this.elements.searchBtn) this.elements.searchBtn.style.display = 'flex';
            if (this.elements.cancelBtn) this.elements.cancelBtn.style.display = 'none';
            if (this.elements.searchTimer) this.elements.searchTimer.style.display = 'none';
            showToast(data.message, '⏰');
        });
        
        this.socket.on('arena:battleStart', (data) => {
            this.isSearching = false;
            this.isInBattle = true;
            this.currentBattle = data;
            this.selectedAttacker = null;
            this.selectedTarget = null;
            
            this.stopSearchTimer();
            
            if (this.elements.searchBtn) this.elements.searchBtn.style.display = 'flex';
            if (this.elements.cancelBtn) this.elements.cancelBtn.style.display = 'none';
            if (this.elements.searchTimer) this.elements.searchTimer.style.display = 'none';
            
            this.showBattleScene(data);
        });
        
        this.socket.on('arena:damage', (data) => {
            this.playDamageAnimation(data);
            this.updateCreatureHp(data);
            this.playSound('hit');
        });
        
        this.socket.on('arena:death', (data) => {
            this.playDeathAnimation(data);
            this.playSound('death');
        });
        
        this.socket.on('arena:turnChange', (data) => {
            this.updateTurnIndicator(data.yourTurn);
            if (data.yourTurn) {
                this.playSound('yourTurn');
            }
        });
        
        this.socket.on('arena:battleState', (data) => {
            this.updateBattleState(data);
        });
        
        this.socket.on('arena:battleEnd', (data) => {
            this.endBattle(data);
            if (data.victory) {
                this.playSound('victory');
            } else {
                this.playSound('defeat');
            }
        });
        
        this.socket.on('arena:targetSelected', (data) => {
            this.showTargetSelectedFeedback(data);
        });
        
        this.socket.on('arena:error', (data) => {
            showToast(data.message, '❌');
        });
        
        this.socket.on('arena:leaderboard', (data) => {
            this.updateLeaderboard(data.leaders);
        });
        
        this.socket.on('arena:stats', (data) => {
            this.stats = data.stats;
            this.updateStatsDisplay();
        });
        
        this.socket.on('arena:history', (data) => {
            this.battleHistory = data.history;
        });
        
        this.socket.on('disconnect', () => {
            console.warn('⚠️ WebSocket отключен');
            this.isConnected = false;
            this.isInBattle = false;
            this.isSearching = false;
            this.stopSearchTimer();
        });
    }
    
    startSearchTimer() {
        if (this.searchInterval) clearInterval(this.searchInterval);
        
        this.searchInterval = setInterval(() => {
            if (!this.isSearching) {
                this.stopSearchTimer();
                return;
            }
            
            const elapsed = Math.floor((Date.now() - this.searchStartTime) / 1000);
            const timerSpan = document.getElementById('searchTimerSeconds');
            if (timerSpan) timerSpan.textContent = elapsed;
        }, 1000);
    }
    
    stopSearchTimer() {
        if (this.searchInterval) {
            clearInterval(this.searchInterval);
            this.searchInterval = null;
        }
        this.searchStartTime = null;
    }
    
    playSound(type) {
        // Опционально: звуковые эффекты через Web Audio API
        // Реализация по желанию
    }
    
    updateStatsDisplay() {
        if (this.elements.statsWins) {
            this.elements.statsWins.textContent = this.stats.wins || 0;
        }
        if (this.elements.statsLosses) {
            this.elements.statsLosses.textContent = this.stats.losses || 0;
        }
        if (this.elements.statsStreak) {
            const streak = this.stats.currentStreak || 0;
            this.elements.statsStreak.textContent = streak;
            this.elements.statsStreak.style.color = streak >= 3 ? '#f59e0b' : streak >= 5 ? '#ef4444' : '#e2e8f0';
        }
    }
    
    showBattleScene(battleData) {
        const teamSelector = document.querySelector('.arena-team-selector');
        if (teamSelector) teamSelector.style.display = 'none';
        
        if (this.elements.arenaScene) {
            this.elements.arenaScene.style.display = 'block';
        }
        
        const opponentNameEl = document.getElementById('arenaOpponentName');
        if (opponentNameEl) opponentNameEl.textContent = battleData.opponentName;
        
        if (this.elements.opponentElo) {
            this.elements.opponentElo.textContent = `⭐ ${battleData.opponentElo}`;
        }
        
        if (this.elements.opponentLeague && battleData.opponentLeague) {
            this.elements.opponentLeague.textContent = `${battleData.opponentLeague.icon} ${battleData.opponentLeague.name}`;
        }
        
        this.renderBattleTeams(battleData.yourTeam, battleData.opponentTeam);
        this.updateTurnIndicator(battleData.yourTurn);
        
        this.addBattleLog('⚔️ БИТВА НАЧАЛАСЬ!');
        this.addBattleLog(`🎲 ${battleData.yourTurn ? 'Ваш ход! Атакуйте!' : 'Ход противника! Ожидайте...'}`);
    }
    
    renderBattleTeams(yourTeam, opponentTeam) {
        if (this.elements.yourTeamContainer) {
            this.elements.yourTeamContainer.innerHTML = yourTeam.map((creature, index) => `
                <div class="battle-creature ${!creature.isAlive ? 'dead' : ''}" 
                     data-index="${index}" 
                     data-team="your"
                     onclick="arenaClient.selectAttacker(${index})">
                    <div class="battle-creature-icon">${getIconHtml(creature)}</div>
                    <div class="battle-creature-name">${escapeHtml(creature.name)}</div>
                    <div class="battle-creature-hp">
                        <div class="hp-bar" style="width: ${(creature.currentHp / creature.hp) * 100}%"></div>
                        <span class="hp-text">${Math.max(0, creature.currentHp)}/${creature.hp}</span>
                    </div>
                    <div class="battle-creature-damage">⚔️ ${creature.damage}</div>
                    ${!creature.isAlive ? '<div class="dead-mark">💀</div>' : ''}
                </div>
            `).join('');
        }
        
        if (this.elements.opponentTeamContainer) {
            this.elements.opponentTeamContainer.innerHTML = opponentTeam.map((creature, index) => `
                <div class="battle-creature opponent ${!creature.isAlive ? 'dead' : ''}" 
                     data-index="${index}" 
                     data-team="opponent"
                     onclick="arenaClient.selectTarget(${index})">
                    <div class="battle-creature-icon">${getIconHtml(creature)}</div>
                    <div class="battle-creature-name">${escapeHtml(creature.name)}</div>
                    <div class="battle-creature-hp">
                        <div class="hp-bar" style="width: ${(creature.currentHp / creature.hp) * 100}%"></div>
                        <span class="hp-text">${Math.max(0, creature.currentHp)}/${creature.hp}</span>
                    </div>
                    ${!creature.isAlive ? '<div class="dead-mark">💀</div>' : ''}
                </div>
            `).join('');
        }
    }
    
    selectAttacker(index) {
        if (!this.isInBattle) return;
        if (!this.currentBattle?.yourTurn) {
            showToast('Сейчас не ваш ход!', '⏳');
            return;
        }
        
        const attackerEl = document.querySelector(`.battle-creature[data-team="your"][data-index="${index}"]`);
        if (!attackerEl) return;
        
        const isAlive = !attackerEl.classList.contains('dead');
        if (!isAlive) {
            showToast('Это существо мертво!', '💀');
            return;
        }
        
        document.querySelectorAll('.battle-creature.selected-attacker').forEach(el => {
            el.classList.remove('selected-attacker');
        });
        
        attackerEl.classList.add('selected-attacker');
        this.selectedAttacker = index;
        
        if (this.selectedTarget !== null) {
            this.enableAttackButton();
        }
    }
    
    selectTarget(index) {
        if (!this.isInBattle) return;
        if (!this.currentBattle?.yourTurn) {
            showToast('Сейчас не ваш ход!', '⏳');
            return;
        }
        
        const targetEl = document.querySelector(`.battle-creature.opponent[data-index="${index}"]`);
        if (!targetEl) return;
        
        const isAlive = !targetEl.classList.contains('dead');
        if (!isAlive) {
            showToast('Эта цель уже мертва!', '💀');
            return;
        }
        
        document.querySelectorAll('.battle-creature.opponent.selected-target').forEach(el => {
            el.classList.remove('selected-target');
        });
        
        targetEl.classList.add('selected-target');
        this.selectedTarget = index;
        
        this.socket.emit('arena:selectTarget', {
            targetIndex: index,
            teamSide: 'opponent'
        });
        
        if (this.selectedAttacker !== null) {
            this.enableAttackButton();
        }
    }
    
    enableAttackButton() {
        if (this.elements.attackBtn) {
            this.elements.attackBtn.disabled = false;
            this.elements.attackBtn.style.opacity = '1';
            this.elements.attackBtn.style.cursor = 'pointer';
        }
    }
    
    disableAttackButton() {
        if (this.elements.attackBtn) {
            this.elements.attackBtn.disabled = true;
            this.elements.attackBtn.style.opacity = '0.5';
            this.elements.attackBtn.style.cursor = 'not-allowed';
        }
    }
    
    attack() {
        if (this.selectedAttacker === null || this.selectedTarget === null) {
            showToast('Выберите атакующего и цель!', '⚔️');
            return;
        }
        
        this.socket.emit('arena:attack', {
            attackerIndex: this.selectedAttacker,
            targetIndex: this.selectedTarget
        });
        
        this.disableAttackButton();
        
        this.selectedAttacker = null;
        this.selectedTarget = null;
        
        document.querySelectorAll('.battle-creature.selected-attacker, .battle-creature.selected-target').forEach(el => {
            el.classList.remove('selected-attacker', 'selected-target');
        });
    }
    
    playDamageAnimation(data) {
        const targetSelector = `[data-team="${data.targetTeam}"][data-index="${data.targetIndex}"]`;
        const targetEl = document.querySelector(targetSelector);
        
        if (targetEl) {
            targetEl.classList.add('taking-damage');
            
            const damageEl = document.createElement('div');
            damageEl.className = 'damage-number';
            damageEl.textContent = `-${data.damage}`;
            if (data.isCritical) damageEl.classList.add('critical');
            targetEl.appendChild(damageEl);
            
            setTimeout(() => {
                targetEl.classList.remove('taking-damage');
                damageEl.remove();
            }, 500);
        }
        
        this.updateCreatureHp(data);
    }
    
    updateCreatureHp(data) {
        const targetSelector = `[data-team="${data.targetTeam}"][data-index="${data.targetIndex}"]`;
        const targetEl = document.querySelector(targetSelector);
        
        if (targetEl) {
            const hpBar = targetEl.querySelector('.hp-bar');
            const hpText = targetEl.querySelector('.hp-text');
            
            if (hpBar && data.maxHp) {
                const hpPercent = (data.newHp / data.maxHp) * 100;
                hpBar.style.width = `${Math.max(0, Math.min(100, hpPercent))}%`;
            }
            if (hpText) {
                const maxHp = hpText.textContent.split('/')[1];
                hpText.textContent = `${data.newHp}/${maxHp}`;
            }
        }
        
        if (data.targetTeam === 'your') {
            if (this.currentBattle?.yourTeam[data.targetIndex]) {
                this.currentBattle.yourTeam[data.targetIndex].currentHp = data.newHp;
                this.currentBattle.yourTeam[data.targetIndex].isAlive = data.newHp > 0;
            }
        } else {
            if (this.currentBattle?.opponentTeam[data.targetIndex]) {
                this.currentBattle.opponentTeam[data.targetIndex].currentHp = data.newHp;
                this.currentBattle.opponentTeam[data.targetIndex].isAlive = data.newHp > 0;
            }
        }
    }
    
    playDeathAnimation(data) {
        const targetSelector = `[data-team="${data.team}"][data-index="${data.index}"]`;
        const targetEl = document.querySelector(targetSelector);
        
        if (targetEl) {
            targetEl.classList.add('dying');
            setTimeout(() => {
                targetEl.classList.add('dead');
                targetEl.classList.remove('dying');
            }, 500);
        }
    }
    
    updateTurnIndicator(yourTurn) {
        if (this.currentBattle) {
            this.currentBattle.yourTurn = yourTurn;
        }
        
        if (this.elements.turnIndicator) {
            if (yourTurn) {
                this.elements.turnIndicator.innerHTML = '<i class="fa-solid fa-bolt" style="color:#22c55e"></i> ВАШ ХОД! Атакуйте!';
                this.elements.turnIndicator.style.background = 'rgba(34,197,94,0.2)';
                this.elements.turnIndicator.style.borderColor = '#22c55e';
            } else {
                this.elements.turnIndicator.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Ход противника... Ожидание';
                this.elements.turnIndicator.style.background = 'rgba(100,100,100,0.2)';
                this.elements.turnIndicator.style.borderColor = '#4a5568';
            }
        }
        
        this.selectedAttacker = null;
        this.selectedTarget = null;
        this.disableAttackButton();
        
        document.querySelectorAll('.battle-creature.selected-attacker, .battle-creature.selected-target').forEach(el => {
            el.classList.remove('selected-attacker', 'selected-target');
        });
    }
    
    updateBattleState(data) {
        if (data.yourTeam) {
            this.currentBattle.yourTeam = data.yourTeam;
        }
        if (data.opponentTeam) {
            this.currentBattle.opponentTeam = data.opponentTeam;
        }
        
        this.renderBattleTeams(
            this.currentBattle.yourTeam || data.yourTeam,
            this.currentBattle.opponentTeam || data.opponentTeam
        );
        
        this.updateTurnIndicator(data.currentTurn);
        
        if (data.log) {
            const logContainer = this.elements.battleLog?.querySelector('.log-messages');
            if (logContainer) {
                logContainer.innerHTML = data.log.map(log => 
                    `<div class="log-message">${log.message}</div>`
                ).join('');
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        }
    }
    
    addBattleLog(message) {
        const logContainer = this.elements.battleLog?.querySelector('.log-messages');
        if (logContainer) {
            logContainer.innerHTML += `<div class="log-message">${message}</div>`;
            logContainer.scrollTop = logContainer.scrollHeight;
            
            const messages = logContainer.querySelectorAll('.log-message');
            if (messages.length > 30) {
                messages[0].remove();
            }
        }
    }
    
    showTargetSelectedFeedback(data) {
        showToast(`Цель выбрана!`, '🎯');
    }
    
    endBattle(data) {
        this.isInBattle = false;
        this.currentBattle = null;
        this.selectedAttacker = null;
        this.selectedTarget = null;
        
        if (data.newElo !== undefined) {
            this.elo = data.newElo;
            if (this.elements.yourElo) {
                this.elements.yourElo.textContent = `⭐ Рейтинг: ${this.elo}`;
            }
            if (data.newLeague && this.elements.yourLeague) {
                this.elements.yourLeague.textContent = `${data.newLeague.icon} ${data.newLeague.name}`;
            }
        }
        
        if (data.stats) {
            this.stats = data.stats;
            this.updateStatsDisplay();
        }
        
        if (data.victory) {
            showToast(data.message, '🏆');
            this.addBattleLog(`🏆 ПОБЕДА! ${data.message}`);
            this.playVictoryAnimation();
        } else {
            showToast(data.message, '💀');
            this.addBattleLog(`💀 ПОРАЖЕНИЕ! ${data.message}`);
        }
        
        setTimeout(() => {
            this.hideBattleScene();
            this.renderTeamSelection();
        }, 3000);
    }
    
    playVictoryAnimation() {
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const el = document.createElement('div');
                el.className = 'victory-sparkle';
                el.innerHTML = '✨';
                el.style.left = Math.random() * 100 + '%';
                el.style.top = Math.random() * 100 + '%';
                document.body.appendChild(el);
                setTimeout(() => el.remove(), 1000);
            }, i * 50);
        }
    }
    
    hideBattleScene() {
        if (this.elements.arenaScene) {
            this.elements.arenaScene.style.display = 'none';
        }
        
        const teamSelector = document.querySelector('.arena-team-selector');
        if (teamSelector) teamSelector.style.display = 'block';
        
        this.team = [];
        this.saveTeamToStorage();
        this.renderTeamSelection();
    }
    
    startSearch() {
        if (this.team.length !== 3) {
            showToast('Выберите 3 существа для битвы!', '⚠️');
            return;
        }
        
        if (!this.isConnected) {
            showToast('Нет соединения с сервером арены', '❌');
            return;
        }
        
        this.socket.emit('arena:startSearch', { team: this.team });
    }
    
    cancelSearch() {
        this.socket.emit('arena:cancelSearch');
    }
    
    updateLeaderboard(leaders) {
        console.log('Арена лидерборд:', leaders);
        // Можно добавить отображение в отдельной вкладке
    }
    
    bindEvents() {
        const originalRenderCards = window.renderCards;
        window.renderCards = () => {
            if (originalRenderCards) originalRenderCards();
            if (!this.isInBattle) {
                this.renderTeamSelection();
            }
        };
        
        if (this.elements.searchBtn) {
            this.elements.searchBtn.onclick = () => this.startSearch();
        }
        if (this.elements.cancelBtn) {
            this.elements.cancelBtn.onclick = () => this.cancelSearch();
        }
        if (this.elements.attackBtn) {
            this.elements.attackBtn.onclick = () => this.attack();
        }
    }
}

const originalInit = window.initTelegramApp;
if (originalInit) {
    window.initTelegramApp = async function() {
        await originalInit();
        
        setTimeout(() => {
            arenaClient = new ArenaClient();
            arenaClient.init();
        }, 1500);
    };
}