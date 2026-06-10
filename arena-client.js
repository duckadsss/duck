// ============================================================
// arena-client.js - Клиентская логика PvP арены (WebSocket для Railway)
// ============================================================

class ArenaClient {
    constructor() {
        this.state = {
            selectedTeam: [],
            currentBattleId: null,
            isSearching: false,
            battleActive: false,
            socket: null,
            currentBattleIsPlayer1: false,
            confirmationShown: false,
            battleLog: [],
            myTeam: [],
            enemyTeam: []
        };
        
        this.timers = {
            battleTimer: null,
            searchTimer: null,
            searchTickTimer: null,
            reconnectTimer: null
        };
        
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        this.callbacks = {
            onBattleStart: null,
            onBattleUpdate: null,
            onBattleEnd: null,
            onMatchFound: null,
            onBattleStartUI: null,
            onTimerTick: null,
            onSearchTimeout: null,
            onSearchTick: null,
            onConfirmationUpdate: null,
            onMatchRejected: null,
            onConnected: null,
            onDisconnected: null
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
    getConfirmationShown() { return this.state.confirmationShown; }
    isConnected() { return this.state.socket && this.state.socket.connected; }
    
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
        if (this.state.isSearching) {
            this.stopSearch();
        }
        this.state.isSearching = true;
        this.state.confirmationShown = false;
        this.startSearchTimer();
    }
    
    stopSearch() {
        this.state.isSearching = false;
        this.state.confirmationShown = false; // сбрасываем флаг при любой остановке поиска
        if (this.timers.searchTimer) {
            clearTimeout(this.timers.searchTimer);
            this.timers.searchTimer = null;
        }
        if (this.timers.searchTickTimer) {
            clearInterval(this.timers.searchTickTimer);
            this.timers.searchTickTimer = null;
        }
    }
    
    startSearchTimer() {
        if (this.timers.searchTimer) clearTimeout(this.timers.searchTimer);
        if (this.timers.searchTickTimer) clearInterval(this.timers.searchTickTimer);

        let elapsed = 0;
        const TIMEOUT = 60;

        this.timers.searchTickTimer = setInterval(() => {
            elapsed++;
            if (this.callbacks.onSearchTick) {
                this.callbacks.onSearchTick(TIMEOUT - elapsed);
            }
            if (elapsed >= TIMEOUT) {
                clearInterval(this.timers.searchTickTimer);
                this.timers.searchTickTimer = null;
            }
        }, 1000);

        this.timers.searchTimer = setTimeout(() => {
            if (this.state.isSearching) {
                this.stopSearch();
                if (this.callbacks.onSearchTimeout) {
                    this.callbacks.onSearchTimeout();
                }
            }
        }, TIMEOUT * 1000);
    }
    
    startBattle(battleId, isPlayer1, myTeam, enemyTeam) {
        this.state.battleActive = true;
        this.state.currentBattleId = battleId;
        this.state.currentBattleIsPlayer1 = isPlayer1;
        this.state.myTeam = myTeam;
        this.state.enemyTeam = enemyTeam;
        this.state.battleLog = [];
        
        this.stopSearch();
        
        if (this.callbacks.onBattleStart) {
            this.callbacks.onBattleStart(battleId, isPlayer1, myTeam, enemyTeam);
        }
        
        if (this.callbacks.onBattleStartUI) {
            this.callbacks.onBattleStartUI({
                battleId: battleId,
                isPlayer1: isPlayer1,
                player1Team: isPlayer1 ? myTeam : enemyTeam,
                player2Team: isPlayer1 ? enemyTeam : myTeam,
                myTeam: myTeam,
                opponentTeam: enemyTeam,
                currentTurn: isPlayer1 ? 'player1' : 'player2',
                battleLog: []
            });
        }
    }
    
    updateBattle(data) {
        if (!this.state.battleActive) return;
        
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
        
        if (data.lastMove) {
            this.state.battleLog.unshift({
                turn: data.turnCount || this.state.battleLog.length + 1,
                attackerName: data.lastMove.attackerName || 'Питомец',
                targetName: data.lastMove.targetName || 'Враг',
                damage: data.lastMove.damage,
                isCrit: data.lastMove.isCrit,
                timestamp: Date.now()
            });
            
            if (this.state.battleLog.length > 20) {
                this.state.battleLog.pop();
            }
        }
        
        // Обновляем таймер с компенсацией сетевой задержки
        if (data.timeLeft !== undefined) {
            let correctedTimeLeft = data.timeLeft;
            if (data.serverTimestamp) {
                const elapsed = (Date.now() - data.serverTimestamp) / 1000;
                correctedTimeLeft = Math.max(0, Math.floor(data.timeLeft - elapsed));
            }
            this.startBattleTimer(correctedTimeLeft);
        }
        
        if (this.callbacks.onBattleUpdate) {
            this.callbacks.onBattleUpdate(data, this.state.currentBattleIsPlayer1);
        }
    }
    
    endBattle(winnerId, prizePool) {
        // Идемпотентная защита: если бой уже завершён — не вызываем onBattleEnd повторно.
        // Это предотвращает двойной popup: HTTP ответ makeAttack + WS battle_end.
        if (!this.state.battleActive) return;
        this.state.battleActive = false;
        this.state.currentBattleId = null;
        this.state.battleEndedAt = Date.now();
        
        if (this.timers.battleTimer) {
            clearInterval(this.timers.battleTimer);
            this.timers.battleTimer = null;
        }
        
        const isWin = winnerId === this.getCurrentUserId();
        
        if (this.callbacks.onBattleEnd) {
            this.callbacks.onBattleEnd(isWin, prizePool);
        }
        
        setTimeout(() => {
            this.state.currentBattleIsPlayer1 = false;
            this.state.confirmationShown = false;
        }, 3000);
    }
    
    startBattleTimer(initialTimeLeft = 30) {
    // ИСПРАВЛЕНО: очищаем предыдущий таймер, чтобы избежать утечки
    if (this.timers.battleTimer) {
        clearInterval(this.timers.battleTimer);
        this.timers.battleTimer = null;
    }
    
    let timeLeft = initialTimeLeft;
    // Сразу показываем текущее время без задержки
    if (this.callbacks.onTimerTick) {
        this.callbacks.onTimerTick(timeLeft);
    }
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
    // WEBSOCKET (для Railway)
    // ============================================================
    
    connectSocket(token, apiUrl) {
        // Если сокет уже подключён или активно подключается — не создаём дубль.
        // .active = true когда socket.io находится в состоянии connecting/reconnecting.
        if (this.state.socket && (this.state.socket.connected || this.state.socket.active)) {
            console.log('🔌 WebSocket уже подключён/подключается, пропускаем');
            return;
        }
        this.disconnectSocket();
        
        if (!token) {
            console.error('No token for WebSocket');
            return;
        }
        
        console.log(`🔌 Подключение WebSocket к ${apiUrl}`);
        
        try {
            const socket = io(apiUrl, {
                transports: ['websocket', 'polling'],
                auth: { token },
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 30000,
                timeout: 30000,
                upgrade: true,
                forceNew: false,
                path: '/socket.io/'
            });
            
            this.state.socket = socket;
            
            socket.on('connect', () => {
                console.log('✅ WebSocket connected');
                this.reconnectAttempts = 0;
                if (this.timers.reconnectTimer) {
                    clearTimeout(this.timers.reconnectTimer);
                    this.timers.reconnectTimer = null;
                }
                if (this.callbacks.onConnected) {
                    this.callbacks.onConnected();
                }
            });
            
            socket.on('disconnect', (reason) => {
                console.log('❌ WebSocket disconnected:', reason);
                if (this.callbacks.onDisconnected) {
                    this.callbacks.onDisconnected(reason);
                }
            });
            
            socket.on('connect_error', (err) => {
                console.error('WebSocket connect error:', err.message);
            });
            
            socket.on('connected', (data) => {
                console.log('📡 Connected to arena server', data);
            });
            
            socket.on('battle_status', (data) => {
                console.log('📡 Battle status received', data);
                if (data.hasBattle && data.status === 'active' && !this.state.battleActive) {
                    this.startBattle(
                        data.battleId,
                        data.isPlayer1,
                        data.myTeam,
                        data.opponentTeam
                    );
                } else if (data.hasBattle && data.status === 'pending_confirmation' && !this.state.confirmationShown) {
                    this.stopSearch();
                    this.state.confirmationShown = true;
                    this.state.currentBattleId = data.battleId;
                    if (this.callbacks.onMatchFound) {
                        this.callbacks.onMatchFound(data);
                    }
                }
            });
            
            socket.on('match_found', (data) => {
                console.log('⚔️ Match found!', data);
                this.state.confirmationShown = true;
                this.state.currentBattleId = data.battleId;
                this.state.currentBattleIsPlayer1 = data.isPlayer1;
                if (this.callbacks.onMatchFound) {
                    this.callbacks.onMatchFound(data);
                }
            });
            
            socket.on('battle_start', (data) => {
                console.log('⚔️ Battle start!', data);
                this.state.confirmationShown = false;
                this.startBattle(
                    data.battleId,
                    data.isPlayer1,
                    data.myTeam,
                    data.opponentTeam
                );
                // Запускаем таймер с переданным временем
                if (data.timeLeft !== undefined) {
                    this.startBattleTimer(data.timeLeft);
                } else {
                    this.startBattleTimer(30);
                }
            });
            
            socket.on('move_update', (data) => {
                this.updateBattle(data);
                // Обновляем таймер, если есть время
                if (data.timeLeft !== undefined) {
                    this.startBattleTimer(data.timeLeft);
                }
            });
            
            socket.on('battle_end', (data) => {
                console.log('🏆 Battle end!', data);
                this.endBattle(data.winnerId, data.prizePool);
            });
            
            socket.on('confirmation_update', (data) => {
    console.log('📡 Получено confirmation_update:', data);
    
    // Обновляем состояние в клиенте
    if (this.state.currentBattleId) {
        if (data.player1Confirmed !== undefined) {
            this.state.player1Confirmed = data.player1Confirmed;
        }
        if (data.player2Confirmed !== undefined) {
            this.state.player2Confirmed = data.player2Confirmed;
        }
    }
    
    // Передаём обновление в UI
    if (this.callbacks.onConfirmationUpdate) {
        this.callbacks.onConfirmationUpdate(data);
    }
    
    // ИСПРАВЛЕНО: Если оба игрока подтвердили, принудительно закрываем модалку
    const myConfirmed = this.state.currentBattleIsPlayer1 
        ? data.player1Confirmed 
        : data.player2Confirmed;
    const opponentConfirmed = this.state.currentBattleIsPlayer1 
        ? data.player2Confirmed 
        : data.player1Confirmed;
    
    if (myConfirmed && opponentConfirmed) {
        console.log('✅ Оба игрока подтвердили, закрываем confirmation state');
        this.state.confirmationShown = false;
    }
});
            
            socket.on('match_rejected', (data) => {
                console.log('❌ Match rejected by opponent', data);
                this.state.confirmationShown = false;
                this.state.currentBattleId = null;
                if (this.callbacks.onMatchRejected) {
                    this.callbacks.onMatchRejected(data);
                }
            });
            
            socket.on('error', (error) => {
                console.error('WebSocket error:', error);
                if (window.addDebugLog) window.addDebugLog(`WebSocket ошибка: ${error}`, 'error');
            });
            
            socket.on('reconnect_attempt', (attempt) => {
                console.log(`Reconnect attempt ${attempt}`);
                if (window.addDebugLog) window.addDebugLog(`Попытка переподключения ${attempt}...`, 'info');
            });
            
            socket.on('reconnect', () => {
                console.log('Reconnected successfully');
                if (window.addDebugLog) window.addDebugLog('Переподключено!', 'success');
                if (this.state.battleActive && this.state.currentBattleId) {
                    socket.emit('check_battle_status', { battleId: this.state.currentBattleId });
                }
            });

            // Все попытки реконнекта исчерпаны — сообщаем пользователю
            socket.on('reconnect_failed', () => {
                console.error('WebSocket: все попытки реконнекта исчерпаны');
                if (window.addDebugLog) window.addDebugLog('Нет соединения с сервером', 'error');
                if (this.callbacks.onDisconnected) {
                    this.callbacks.onDisconnected('reconnect_failed');
                }
            });

            // Ручной ping убран: socket.io сам обрабатывает heartbeat (pingInterval/pingTimeout).
            
        } catch (err) {
            console.error('Failed to create WebSocket connection:', err);
            this.scheduleReconnect(token, apiUrl);
        }
    }
    
    scheduleReconnect(token, apiUrl) {
        if (this.timers.reconnectTimer) return;
        
        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached');
            return;
        }
        
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        const savedAttempts = this.reconnectAttempts;
        this.timers.reconnectTimer = setTimeout(() => {
            this.timers.reconnectTimer = null;
            // Закрываем только сокет, не трогаем reconnectAttempts
            if (this.state.socket) {
                this.state.socket.removeAllListeners();
                this.state.socket.disconnect();
                this.state.socket = null;
            }
            // Восстанавливаем счётчик после того как disconnectSocket его обнулил бы
            this.reconnectAttempts = savedAttempts;
            this.connectSocket(token, apiUrl);
        }, delay);
    }
    
    disconnectSocket() {
        if (this.state.socket) {
            this.state.socket.disconnect();
            this.state.socket = null;
        }
        if (this.timers.reconnectTimer) {
            clearTimeout(this.timers.reconnectTimer);
            this.timers.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
    }
    
    // ============================================================
    // CALLBACKS
    // ============================================================
    
    on(event, callback) {
        this.callbacks[event] = callback;
    }
    
    // ============================================================
    // UTILS
    // ============================================================
    
    setCurrentUserId(id) {
        this._currentUserId = id ? id.toString() : null;
    }

    getCurrentUserId() {
        // Приоритет: явно установленный id > window.state
        if (this._currentUserId) return this._currentUserId;
        if (window.state && window.state.user) {
            if (window.state.user.id) return window.state.user.id.toString();
            if (window.state.user._id) return window.state.user._id.toString();
        }
        return null;
    }
    
    reset() {
        this.disconnectSocket();
        this.stopSearch();
        if (this.timers.battleTimer) clearInterval(this.timers.battleTimer);
        if (this.timers.searchTickTimer) clearInterval(this.timers.searchTickTimer);
        this.state = {
            selectedTeam: this.state.selectedTeam,
            currentBattleId: null,
            isSearching: false,
            battleActive: false,
            socket: null,
            currentBattleIsPlayer1: false,
            confirmationShown: false,
            battleLog: [],
            myTeam: [],
            enemyTeam: []
        };
        this.reconnectAttempts = 0;
        // _currentUserId не сбрасываем — пользователь не меняется между боями
    }
    
    checkBattleStatus(battleId) {
        if (this.state.socket && this.state.socket.connected) {
            this.state.socket.emit('check_battle_status', { battleId });
        }
    }
}

window.arenaClient = new ArenaClient();