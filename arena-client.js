// ============================================================
// arena-client.js - Клиентская логика PvP арены
// ============================================================

class ArenaClient {
    constructor() {
        this.state = {
            selectedTeam: [],
            currentBattleId: null,
            isSearching: false,
            battleActive: false,
            sseConnection: null,
            currentBattleIsPlayer1: false,
            confirmationShown: false,
            battleLog: [],
            myTeam: [],
            enemyTeam: []
        };
        
        this.timers = {
            battleTimer: null,
            searchTimer: null
        };
        
        this.callbacks = {
            onBattleStart: null,
            onBattleUpdate: null,
            onBattleEnd: null,
            onMatchFound: null
        };
    }
    
    // ============================================================
    // GETTERS
    // ============================================================
    
    isSearching() { return this.state.isSearching; }
    isBattleActive() { return this.state.battleActive; }
    getBattleId() { return this.state.currentBattleId; }
    getSelectedTeam() { return this.state.selectedTeam; }
    getMyTeam() { return this.state.myTeam; }
    getEnemyTeam() { return this.state.enemyTeam; }
    getBattleLog() { return this.state.battleLog; }
    
    // ============================================================
// SETTERS
// ============================================================

setSelectedTeam(team) { 
    this.state.selectedTeam = [...team];
    this.saveTeamToStorage();
}

setConfirmationShown(value) {
    this.state.confirmationShown = value;
}

saveTeamToStorage() {
    localStorage.setItem('arena_selected_team', JSON.stringify(this.state.selectedTeam));
}

loadTeamFromStorage() {
    const saved = localStorage.getItem('arena_selected_team');
    if (saved) {
        try {
            this.state.selectedTeam = JSON.parse(saved);
        } catch(e) {}
    }
    return this.state.selectedTeam;
}
    
    // ============================================================
    // БОЙ
    // ============================================================
    
    startSearch() {
        this.state.isSearching = true;
        this.state.confirmationShown = false;
        this.startSearchTimer();
    }
    
    stopSearch() {
        this.state.isSearching = false;
        if (this.timers.searchTimer) {
            clearTimeout(this.timers.searchTimer);
            this.timers.searchTimer = null;
        }
    }
    
    startSearchTimer() {
        if (this.timers.searchTimer) clearTimeout(this.timers.searchTimer);
        this.timers.searchTimer = setTimeout(() => {
            if (this.state.isSearching) {
                this.stopSearch();
                if (this.callbacks.onSearchTimeout) {
                    this.callbacks.onSearchTimeout();
                }
            }
        }, 60000);
    }
    
    startBattle(battleId, isPlayer1, myTeam, enemyTeam) {
        this.state.battleActive = true;
        this.state.currentBattleId = battleId;
        this.state.currentBattleIsPlayer1 = isPlayer1;
        this.state.isSearching = false;
        this.state.myTeam = myTeam;
        this.state.enemyTeam = enemyTeam;
        this.state.battleLog = [];
        
        this.stopSearch();
        this.startBattleTimer();
        
        if (this.callbacks.onBattleStart) {
            this.callbacks.onBattleStart(battleId, isPlayer1, myTeam, enemyTeam);
        }
    }
    
    updateBattle(data) {
        if (!this.state.battleActive) return;
        
        // Обновляем команды
        if (data.player1Team && data.player2Team) {
            if (this.state.currentBattleIsPlayer1) {
                this.state.myTeam = data.player1Team;
                this.state.enemyTeam = data.player2Team;
            } else {
                this.state.myTeam = data.player2Team;
                this.state.enemyTeam = data.player1Team;
            }
        } else if (data.myTeam && data.opponentTeam) {
            this.state.myTeam = data.myTeam;
            this.state.enemyTeam = data.opponentTeam;
        }
        
        // Добавляем в лог
        if (data.lastMove) {
            this.state.battleLog.unshift({
                turn: data.turnCount || this.state.battleLog.length + 1,
                attackerName: data.lastMove.attackerName || 'Питомец',
                targetName: data.lastMove.targetName || 'Враг',
                damage: data.lastMove.damage,
                isCrit: data.lastMove.isCrit,
                timestamp: Date.now()
            });
            
            // Ограничиваем лог
            if (this.state.battleLog.length > 20) {
                this.state.battleLog.pop();
            }
        }
        
        if (this.callbacks.onBattleUpdate) {
            this.callbacks.onBattleUpdate(data, this.state.currentBattleIsPlayer1);
        }
    }
    
    endBattle(winnerId, prizePool) {
        this.state.battleActive = false;
        this.state.currentBattleId = null;
        
        if (this.timers.battleTimer) {
            clearInterval(this.timers.battleTimer);
            this.timers.battleTimer = null;
        }
        
        const isWin = winnerId === this.getCurrentUserId();
        
        if (this.callbacks.onBattleEnd) {
            this.callbacks.onBattleEnd(isWin, prizePool);
        }
        
        // Сбрасываем состояние через 3 секунды
        setTimeout(() => {
            this.state.currentBattleIsPlayer1 = false;
            this.state.confirmationShown = false;
        }, 3000);
    }
    
    startBattleTimer() {
        if (this.timers.battleTimer) clearInterval(this.timers.battleTimer);
        
        let timeLeft = 30;
        this.timers.battleTimer = setInterval(() => {
            timeLeft--;
            if (this.callbacks.onTimerTick) {
                this.callbacks.onTimerTick(timeLeft);
            }
            if (timeLeft <= 0) {
                clearInterval(this.timers.battleTimer);
                this.timers.battleTimer = null;
            }
        }, 1000);
    }
    
    // ============================================================
    // SSE
    // ============================================================
    
    connectSSE(token, apiUrl) {
        this.disconnectSSE();
        
        if (!token) {
            console.error('No token for SSE');
            return;
        }
        
        const url = `${apiUrl}/api/arena/events?token=${encodeURIComponent(token)}`;
        const sse = new EventSource(url);
        this.state.sseConnection = sse;
        
        sse.onopen = () => {
            console.log('✅ SSE connected');
        };
        
        sse.onerror = (e) => {
            console.error('SSE error:', e);
            if (this.state.isSearching || this.state.battleActive) {
                setTimeout(() => this.connectSSE(token, apiUrl), 3000);
            }
        };
        
        sse.addEventListener('match_found', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.state.confirmationShown = true;
                
                if (this.callbacks.onMatchFound) {
                    this.callbacks.onMatchFound(data);
                }
            } catch (err) {
                console.error('match_found parse error:', err);
            }
        });
        
        sse.addEventListener('battle_start', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.startBattle(
                    data.battleId,
                    data.isPlayer1,
                    data.myTeam,
                    data.opponentTeam
                );
                
                if (this.callbacks.onBattleStartUI) {
                    this.callbacks.onBattleStartUI(data);
                }
            } catch (err) {
                console.error('battle_start parse error:', err);
            }
        });
        
        sse.addEventListener('move_update', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.updateBattle(data);
            } catch (err) {
                console.error('move_update parse error:', err);
            }
        });
        
        sse.addEventListener('battle_end', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.endBattle(data.winnerId, data.prizePool);
            } catch (err) {
                console.error('battle_end parse error:', err);
            }
        });
        
        sse.addEventListener('confirmation_update', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (this.callbacks.onConfirmationUpdate) {
                    this.callbacks.onConfirmationUpdate(data);
                }
            } catch (err) {
                console.error('confirmation_update parse error:', err);
            }
        });
    }
    
    disconnectSSE() {
        if (this.state.sseConnection) {
            this.state.sseConnection.close();
            this.state.sseConnection = null;
        }
    }
    
    // ============================================================
    // CALLBACKS
    // ============================================================
    
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(event)) {
            this.callbacks[event] = callback;
        }
    }
    
    // ============================================================
    // UTILS
    // ============================================================
    
    getCurrentUserId() {
        return window.state?.user?._id?.toString() || null;
    }
    
    reset() {
        this.disconnectSSE();
        this.stopSearch();
        if (this.timers.battleTimer) clearInterval(this.timers.battleTimer);
        this.state = {
            selectedTeam: this.state.selectedTeam,
            currentBattleId: null,
            isSearching: false,
            battleActive: false,
            sseConnection: null,
            currentBattleIsPlayer1: false,
            confirmationShown: false,
            battleLog: [],
            myTeam: [],
            enemyTeam: []
        };
    }
}

// Создаём глобальный экземпляр
window.arenaClient = new ArenaClient();