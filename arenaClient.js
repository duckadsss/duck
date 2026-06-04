// arenaClient.js - PvP Арена клиентская часть

class ArenaClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSearching = false;
        this.currentBattle = null;
        this.selectedTarget = null;
        this.turnTimer = null;
        this.arenaStats = null;
        this.eventListeners = new Map();
        
        this.SERVER_URL = window.location.hostname === 'localhost' 
            ? 'ws://localhost:3000/ws/arena' 
            : 'wss://serv-production-dbf3.up.railway.app/ws/arena';
    }
    
    connect(token) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`${this.SERVER_URL}?token=${token}`);
            
            this.ws.onopen = () => {
                this.isConnected = true;
                this.emit('connected');
                resolve();
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Parse error:', e);
                }
            };
            
            this.ws.onerror = (error) => {
                this.emit('error', error);
                reject(error);
            };
            
            this.ws.onclose = () => {
                this.isConnected = false;
                this.isSearching = false;
                this.emit('disconnected');
            };
        });
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'connected':
                this.arenaStats = data.player;
                this.emit('connected', data);
                break;
                
            case 'search_started':
                this.isSearching = true;
                this.emit('search_started');
                break;
                
            case 'search_timeout':
                this.isSearching = false;
                this.emit('search_timeout', data);
                break;
                
            case 'battle_found':
                this.isSearching = false;
                this.emit('battle_found', data);
                break;
                
            case 'battle_cancelled':
                this.emit('battle_cancelled', data);
                break;
                
            case 'battle_start':
                this.currentBattle = data;
                this.emit('battle_start', data);
                break;
                
            case 'turn_change':
                this.emit('turn_change', data);
                break;
                
            case 'move_result':
                this.emit('move_result', data);
                break;
                
            case 'battle_end':
                this.currentBattle = null;
                this.emit('battle_end', data);
                break;
                
            case 'player_stats':
                this.arenaStats = data;
                this.emit('player_stats', data);
                break;
                
            case 'leaderboard':
                this.emit('leaderboard', data);
                break;
                
            case 'team_set':
                this.emit('team_set', data);
                break;
                
            case 'error':
                this.emit('error', data);
                break;
        }
    }
    
    // API методы
    setTeam(team) {
        this.send('set_team', { team });
    }
    
    startSearch() {
        if (!this.isSearching && !this.currentBattle) {
            this.send('start_search');
        }
    }
    
    cancelSearch() {
        if (this.isSearching) {
            this.send('cancel_search');
            this.isSearching = false;
        }
    }
    
    acceptBattle(battleId) {
        this.send('accept_battle', { battleId });
    }
    
    declineBattle(battleId) {
        this.send('decline_battle', { battleId });
    }
    
    makeMove(battleId, targetCreatureId) {
        this.send('make_move', { battleId, targetCreatureId });
    }
    
    forfeit(battleId) {
        this.send('forfeit', { battleId });
    }
    
    getStats() {
        this.send('get_stats');
    }
    
    getLeaderboard() {
        this.send('get_leaderboard');
    }
    
    send(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, ...data }));
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
    
    // Event system
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    
    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index !== -1) listeners.splice(index, 1);
        }
    }
    
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(cb => cb(data));
        }
    }
}

// Экспортируем для глобального использования
window.ArenaClient = ArenaClient;