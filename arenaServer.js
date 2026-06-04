// arenaServer.js - PvP Арена с веб-сокетами
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Модели
const ArenaPlayerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    rating: { type: Number, default: 1000 },
    league: { type: String, default: 'Bronze' },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalBattles: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    arenaTeam: [{ type: String }], // creature IDs
    lastBattleAt: { type: Date, default: null }
});

const ArenaPlayer = mongoose.model('ArenaPlayer', ArenaPlayerSchema);

// Конфигурация
const ARENA_CONFIG = {
    TURN_TIME: 30, // секунд на ход
    SEARCH_TIMEOUT: 60000, // ms
    RATING_K: 32,
    LEAGUES: [
        { name: 'Bronze', minRating: 0, color: '#cd7c3a', icon: '🥉', border: 'rgba(205,124,58,0.4)' },
        { name: 'Silver', minRating: 1100, color: '#94a3b8', icon: '🥈', border: 'rgba(148,163,184,0.5)' },
        { name: 'Gold', minRating: 1250, color: '#f59e0b', icon: '🥇', border: 'rgba(245,158,11,0.6)' },
        { name: 'Platinum', minRating: 1400, color: '#06b6d4', icon: '💎', border: 'rgba(6,182,212,0.7)' },
        { name: 'Diamond', minRating: 1600, color: '#a855f7', icon: '🔮', border: 'rgba(168,85,247,0.8)' },
        { name: 'Master', minRating: 1800, color: '#ef4444', icon: '👑', border: 'rgba(239,68,68,0.9)' },
        { name: 'Grandmaster', minRating: 2100, color: '#ec4899', icon: '🏆', border: 'rgba(236,72,153,1)' }
    ]
};

// Игровые комнаты
const battles = new Map(); // battleId -> battle state
const matchmakingQueue = []; // игроки в очереди
const playerBattleMap = new Map(); // telegramId -> battleId
const turnTimers = new Map(); // battleId -> timer

class ArenaServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws/arena' });
        this.setupWebSocket();
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws, req) => {
            let telegramId = null;
            let currentBattleId = null;

            // Аутентификация
            const token = this.extractToken(req);
            if (!token) {
                ws.close(1008, 'Unauthorized');
                return;
            }

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                telegramId = decoded.telegramId;
                
                // Получаем или создаем игрока арены
                let arenaPlayer = await ArenaPlayer.findOne({ telegramId });
                if (!arenaPlayer) {
                    arenaPlayer = await ArenaPlayer.create({
                        telegramId,
                        rating: 1000,
                        league: 'Bronze',
                        arenaTeam: []
                    });
                }

                ws.telegramId = telegramId;
                ws.arenaPlayer = arenaPlayer;

                // Отправляем начальные данные
                this.sendToClient(ws, 'connected', {
                    player: this.formatPlayer(arenaPlayer),
                    leagues: ARENA_CONFIG.LEAGUES
                });

            } catch (e) {
                ws.close(1008, 'Invalid token');
                return;
            }

            // Обработка сообщений
            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data);
                    await this.handleMessage(ws, msg, telegramId);
                } catch (e) {
                    console.error('WebSocket message error:', e);
                    this.sendToClient(ws, 'error', { message: 'Invalid message format' });
                }
            });

            ws.on('close', () => {
                // Удаляем из очереди
                const queueIndex = matchmakingQueue.findIndex(p => p.telegramId === telegramId);
                if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);
                
                // Обрабатываем выход из боя
                if (currentBattleId) {
                    this.handlePlayerDisconnect(currentBattleId, telegramId);
                }
                
                // Очищаем таймеры
                if (turnTimers.has(currentBattleId)) {
                    clearTimeout(turnTimers.get(currentBattleId));
                    turnTimers.delete(currentBattleId);
                }
            });
        });
    }

    extractToken(req) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        if (token) return token;
        
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return null;
    }

    sendToClient(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, ...data }));
        }
    }

    async handleMessage(ws, msg, telegramId) {
        switch (msg.type) {
            case 'set_team':
                await this.handleSetTeam(ws, msg.team, telegramId);
                break;
            case 'start_search':
                await this.handleStartSearch(ws, telegramId);
                break;
            case 'cancel_search':
                this.handleCancelSearch(telegramId);
                break;
            case 'accept_battle':
                await this.handleAcceptBattle(ws, msg.battleId, telegramId);
                break;
            case 'decline_battle':
                await this.handleDeclineBattle(msg.battleId, telegramId);
                break;
            case 'make_move':
                await this.handleMakeMove(ws, msg.battleId, msg.targetCreatureId, telegramId);
                break;
            case 'forfeit':
                await this.handleForfeit(ws, msg.battleId, telegramId);
                break;
            case 'get_stats':
                await this.sendPlayerStats(ws, telegramId);
                break;
            case 'get_leaderboard':
                await this.sendLeaderboard(ws, telegramId);
                break;
        }
    }

    async handleSetTeam(ws, team, telegramId) {
        if (!Array.isArray(team) || team.length !== 3) {
            this.sendToClient(ws, 'error', { message: 'Team must have exactly 3 creatures' });
            return;
        }

        // Проверяем, что существа есть в инвентаре
        const inventory = await mongoose.model('Inventory').find({ telegramId, creatureId: { $in: team } });
        const ownedIds = inventory.map(i => i.creatureId);
        
        const validTeam = team.filter(id => ownedIds.includes(id));
        if (validTeam.length !== 3) {
            this.sendToClient(ws, 'error', { message: 'You don\'t own one of these creatures' });
            return;
        }

        await ArenaPlayer.findOneAndUpdate(
            { telegramId },
            { $set: { arenaTeam: validTeam } }
        );
        
        ws.arenaPlayer.arenaTeam = validTeam;
        this.sendToClient(ws, 'team_set', { team: validTeam });
    }

    async handleStartSearch(ws, telegramId) {
        // Проверяем наличие команды
        const player = await ArenaPlayer.findOne({ telegramId });
        if (!player.arenaTeam || player.arenaTeam.length !== 3) {
            this.sendToClient(ws, 'error', { message: 'Set your arena team first (3 creatures)' });
            return;
        }

        // Проверяем, не в бою ли уже
        if (playerBattleMap.has(telegramId)) {
            this.sendToClient(ws, 'error', { message: 'Already in battle' });
            return;
        }

        // Проверяем, не в очереди ли уже
        if (matchmakingQueue.some(p => p.telegramId === telegramId)) {
            this.sendToClient(ws, 'error', { message: 'Already searching' });
            return;
        }

        this.sendToClient(ws, 'search_started', {});

        // Добавляем в очередь
        const queuePlayer = {
            telegramId,
            ws,
            player: player,
            rating: player.rating,
            startedAt: Date.now()
        };
        
        matchmakingQueue.push(queuePlayer);
        
        // Устанавливаем таймаут на поиск
        const timeout = setTimeout(async () => {
            const idx = matchmakingQueue.findIndex(p => p.telegramId === telegramId);
            if (idx !== -1) {
                matchmakingQueue.splice(idx, 1);
                if (ws.readyState === WebSocket.OPEN) {
                    this.sendToClient(ws, 'search_timeout', { message: 'No opponent found. Try again.' });
                }
            }
        }, ARENA_CONFIG.SEARCH_TIMEOUT);
        
        ws.searchTimeout = timeout;
        
        // Пытаемся найти соперника
        this.tryMatchmake();
    }

    tryMatchmake() {
        if (matchmakingQueue.length < 2) return;
        
        // Сортируем по рейтингу
        matchmakingQueue.sort((a, b) => a.rating - b.rating);
        
        for (let i = 0; i < matchmakingQueue.length - 1; i++) {
            const p1 = matchmakingQueue[i];
            const p2 = matchmakingQueue[i + 1];
            
            // Разница в рейтинге не более 300
            if (Math.abs(p1.rating - p2.rating) <= 300) {
                // Удаляем из очереди
                const idx1 = matchmakingQueue.findIndex(p => p.telegramId === p1.telegramId);
                const idx2 = matchmakingQueue.findIndex(p => p.telegramId === p2.telegramId);
                matchmakingQueue.splice(Math.max(idx1, idx2), 1);
                matchmakingQueue.splice(Math.min(idx1, idx2), 1);
                
                // Очищаем таймауты
                clearTimeout(p1.ws.searchTimeout);
                clearTimeout(p2.ws.searchTimeout);
                
                // Создаем битву
                this.createBattle(p1, p2);
                break;
            }
        }
    }

    async createBattle(p1, p2) {
        const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        
        // Получаем данные существ
        const creatures = await mongoose.model('Creature').find({});
        const creatureMap = new Map(creatures.map(c => [c.id, c]));
        
        const player1Team = p1.player.arenaTeam.map(id => ({
            id,
            name: creatureMap.get(id)?.name || id,
            icon: creatureMap.get(id)?.icon || '🧬',
            currentHp: 100 + creatureMap.get(id)?.incomeBase || 100,
            maxHp: 100 + creatureMap.get(id)?.incomeBase || 100,
            attack: Math.floor(10 + (creatureMap.get(id)?.incomeBase || 10) / 2),
            defense: Math.floor(5 + (creatureMap.get(id)?.incomeBase || 5) / 3),
            isAlive: true,
            position: 0
        }));
        
        const player2Team = p2.player.arenaTeam.map(id => ({
            id,
            name: creatureMap.get(id)?.name || id,
            icon: creatureMap.get(id)?.icon || '🧬',
            currentHp: 100 + creatureMap.get(id)?.incomeBase || 100,
            maxHp: 100 + creatureMap.get(id)?.incomeBase || 100,
            attack: Math.floor(10 + (creatureMap.get(id)?.incomeBase || 10) / 2),
            defense: Math.floor(5 + (creatureMap.get(id)?.incomeBase || 5) / 3),
            isAlive: true,
            position: 1
        }));
        
        // Случайный порядок ходов
        const firstPlayer = Math.random() < 0.5 ? p1.telegramId : p2.telegramId;
        
        const battle = {
            id: battleId,
            player1: {
                telegramId: p1.telegramId,
                ws: p1.ws,
                team: player1Team,
                originalRating: p1.player.rating
            },
            player2: {
                telegramId: p2.telegramId,
                ws: p2.ws,
                team: player2Team,
                originalRating: p2.player.rating
            },
            currentTurn: firstPlayer,
            turnStartTime: Date.now(),
            winner: null,
            status: 'waiting_accept',
            moveHistory: []
        };
        
        battles.set(battleId, battle);
        playerBattleMap.set(p1.telegramId, battleId);
        playerBattleMap.set(p2.telegramId, battleId);
        
        // Отправляем запрос на принятие боя
        this.sendToClient(p1.ws, 'battle_found', {
            battleId,
            opponent: {
                telegramId: p2.telegramId,
                username: p2.player.username || 'Anonymous',
                rating: p2.player.rating,
                league: this.getLeagueByRating(p2.player.rating).name
            },
            yourTeam: player1Team,
            acceptTimeout: 30000
        });
        
        this.sendToClient(p2.ws, 'battle_found', {
            battleId,
            opponent: {
                telegramId: p1.telegramId,
                username: p1.player.username || 'Anonymous',
                rating: p1.player.rating,
                league: this.getLeagueByRating(p1.player.rating).name
            },
            yourTeam: player2Team,
            acceptTimeout: 30000
        });
        
        // Таймаут на принятие боя
        setTimeout(async () => {
            const battle = battles.get(battleId);
            if (battle && battle.status === 'waiting_accept') {
                battle.status = 'cancelled';
                this.sendToClient(p1.ws, 'battle_cancelled', { reason: 'Opponent didn\'t accept' });
                this.sendToClient(p2.ws, 'battle_cancelled', { reason: 'Opponent didn\'t accept' });
                
                battles.delete(battleId);
                playerBattleMap.delete(p1.telegramId);
                playerBattleMap.delete(p2.telegramId);
            }
        }, 30000);
    }

    async handleAcceptBattle(ws, battleId, telegramId) {
        const battle = battles.get(battleId);
        if (!battle) {
            this.sendToClient(ws, 'error', { message: 'Battle not found' });
            return;
        }
        
        if (battle.status !== 'waiting_accept') {
            this.sendToClient(ws, 'error', { message: 'Battle already started or ended' });
            return;
        }
        
        // Отмечаем принятие
        if (battle.player1.telegramId === telegramId) {
            battle.player1.accepted = true;
        } else {
            battle.player2.accepted = true;
        }
        
        // Если оба приняли, начинаем бой
        if (battle.player1.accepted && battle.player2.accepted) {
            battle.status = 'active';
            
            // Отправляем начальное состояние боя
            this.sendBattleState(battle);
            
            // Запускаем таймер хода
            this.startTurnTimer(battle);
        }
    }

    async handleDeclineBattle(battleId, telegramId) {
        const battle = battles.get(battleId);
        if (!battle || battle.status !== 'waiting_accept') return;
        
        battle.status = 'cancelled';
        
        const opponent = battle.player1.telegramId === telegramId ? battle.player2 : battle.player1;
        this.sendToClient(opponent.ws, 'battle_cancelled', { reason: 'Opponent declined the battle' });
        
        battles.delete(battleId);
        playerBattleMap.delete(battle.player1.telegramId);
        playerBattleMap.delete(battle.player2.telegramId);
    }

    async handleMakeMove(ws, battleId, targetCreatureId, telegramId) {
        const battle = battles.get(battleId);
        if (!battle || battle.status !== 'active') {
            this.sendToClient(ws, 'error', { message: 'Battle not active' });
            return;
        }
        
        if (battle.currentTurn !== telegramId) {
            this.sendToClient(ws, 'error', { message: 'Not your turn!' });
            return;
        }
        
        if (battle.winner) {
            this.sendToClient(ws, 'error', { message: 'Battle already ended' });
            return;
        }
        
        // Определяем атакующего и защищающегося
        const attacker = battle.player1.telegramId === telegramId ? battle.player1 : battle.player2;
        const defender = battle.player1.telegramId === telegramId ? battle.player2 : battle.player1;
        
        // Находим цель
        const targetCreature = defender.team.find(c => c.id === targetCreatureId && c.isAlive);
        if (!targetCreature) {
            this.sendToClient(ws, 'error', { message: 'Invalid target or target already dead' });
            return;
        }
        
        // Находим атакующее существо (первое живое)
        const attackerCreature = attacker.team.find(c => c.isAlive);
        if (!attackerCreature) {
            this.sendToClient(ws, 'error', { message: 'No alive creatures to attack' });
            return;
        }
        
        // Расчет урона
        const damage = Math.max(1, attackerCreature.attack - Math.floor(targetCreature.defense / 2));
        const critical = Math.random() < 0.1; // 10% шанс крита
        const finalDamage = critical ? damage * 2 : damage;
        
        targetCreature.currentHp -= finalDamage;
        
        // Логируем ход
        const move = {
            turn: battle.moveHistory.length + 1,
            attacker: telegramId,
            attackerCreature: attackerCreature.id,
            target: targetCreatureId,
            damage: finalDamage,
            critical,
            timestamp: Date.now()
        };
        battle.moveHistory.push(move);
        
        // Проверяем, умерло ли существо
        let died = false;
        if (targetCreature.currentHp <= 0) {
            targetCreature.currentHp = 0;
            targetCreature.isAlive = false;
            died = true;
            
            move.killed = true;
        }
        
        // Отправляем результат хода
        this.sendToClient(battle.player1.ws, 'move_result', {
            move,
            yourTeam: battle.player1.team,
            opponentTeam: battle.player2.team,
            currentTurn: battle.currentTurn,
            died
        });
        
        this.sendToClient(battle.player2.ws, 'move_result', {
            move,
            yourTeam: battle.player2.team,
            opponentTeam: battle.player1.team,
            currentTurn: battle.currentTurn,
            died
        });
        
        // Проверяем победу
        const defenderHasAlive = defender.team.some(c => c.isAlive);
        
        if (!defenderHasAlive) {
            // Бой окончен
            await this.endBattle(battle, telegramId);
            return;
        }
        
        // Меняем ход
        battle.currentTurn = battle.player1.telegramId === telegramId ? battle.player2.telegramId : battle.player1.telegramId;
        battle.turnStartTime = Date.now();
        
        // Перезапускаем таймер
        this.startTurnTimer(battle);
        
        // Отправляем обновление хода
        this.sendToClient(battle.player1.ws, 'turn_change', { currentTurn: battle.currentTurn });
        this.sendToClient(battle.player2.ws, 'turn_change', { currentTurn: battle.currentTurn });
    }
    
    startTurnTimer(battle) {
        if (turnTimers.has(battle.id)) {
            clearTimeout(turnTimers.get(battle.id));
        }
        
        const timer = setTimeout(async () => {
            const currentBattle = battles.get(battle.id);
            if (!currentBattle || currentBattle.status !== 'active') return;
            
            if (currentBattle.winner) return;
            
            // Время вышло - автоматически пропускаем ход
            const currentPlayerId = currentBattle.currentTurn;
            const opponentId = currentBattle.player1.telegramId === currentPlayerId ? 
                currentBattle.player2.telegramId : currentBattle.player1.telegramId;
            
            // Пропуск хода - наносим небольшой урон пропустившему
            const currentPlayer = currentBattle.player1.telegramId === currentPlayerId ? 
                currentBattle.player1 : currentBattle.player2;
            
            const aliveCreature = currentPlayer.team.find(c => c.isAlive);
            if (aliveCreature) {
                aliveCreature.currentHp = Math.max(0, aliveCreature.currentHp - 5);
                
                const move = {
                    turn: currentBattle.moveHistory.length + 1,
                    attacker: null,
                    attackerCreature: null,
                    target: aliveCreature.id,
                    damage: 5,
                    critical: false,
                    timestamp: Date.now(),
                    timeout: true
                };
                currentBattle.moveHistory.push(move);
                
                this.sendToClient(currentBattle.player1.ws, 'move_result', {
                    move,
                    yourTeam: currentBattle.player1.team,
                    opponentTeam: currentBattle.player2.team,
                    currentTurn: currentBattle.currentTurn,
                    timeout: true
                });
                
                this.sendToClient(currentBattle.player2.ws, 'move_result', {
                    move,
                    yourTeam: currentBattle.player2.team,
                    opponentTeam: currentBattle.player1.team,
                    currentTurn: currentBattle.currentTurn,
                    timeout: true
                });
                
                if (aliveCreature.currentHp <= 0) {
                    aliveCreature.isAlive = false;
                    const hasAlive = currentPlayer.team.some(c => c.isAlive);
                    if (!hasAlive) {
                        await this.endBattle(currentBattle, opponentId);
                        return;
                    }
                }
            }
            
            // Меняем ход
            currentBattle.currentTurn = opponentId;
            currentBattle.turnStartTime = Date.now();
            this.startTurnTimer(currentBattle);
            
            this.sendToClient(currentBattle.player1.ws, 'turn_change', { currentTurn: currentBattle.currentTurn });
            this.sendToClient(currentBattle.player2.ws, 'turn_change', { currentTurn: currentBattle.currentTurn });
            
        }, ARENA_CONFIG.TURN_TIME * 1000);
        
        turnTimers.set(battle.id, timer);
    }
    
    async endBattle(battle, winnerId) {
        if (battle.winner) return;
        
        if (turnTimers.has(battle.id)) {
            clearTimeout(turnTimers.get(battle.id));
            turnTimers.delete(battle.id);
        }
        
        battle.status = 'ended';
        battle.winner = winnerId;
        
        const isPlayer1Winner = battle.player1.telegramId === winnerId;
        const winner = isPlayer1Winner ? battle.player1 : battle.player2;
        const loser = isPlayer1Winner ? battle.player2 : battle.player1;
        
        // Расчет изменения рейтинга
        const expectedWinner = 1 / (1 + Math.pow(10, (loser.originalRating - winner.originalRating) / 400));
        const ratingChange = Math.round(ARENA_CONFIG.RATING_K * (1 - expectedWinner));
        
        // Обновляем рейтинги в БД
        const winnerPlayer = await ArenaPlayer.findOne({ telegramId: winner.telegramId });
        const loserPlayer = await ArenaPlayer.findOne({ telegramId: loser.telegramId });
        
        if (winnerPlayer) {
            winnerPlayer.rating += ratingChange;
            winnerPlayer.wins += 1;
            winnerPlayer.totalBattles += 1;
            winnerPlayer.currentStreak += 1;
            winnerPlayer.bestStreak = Math.max(winnerPlayer.bestStreak, winnerPlayer.currentStreak);
            winnerPlayer.lastBattleAt = new Date();
            winnerPlayer.league = this.getLeagueByRating(winnerPlayer.rating).name;
            await winnerPlayer.save();
        }
        
        if (loserPlayer) {
            loserPlayer.rating -= ratingChange;
            loserPlayer.losses += 1;
            loserPlayer.totalBattles += 1;
            loserPlayer.currentStreak = 0;
            loserPlayer.lastBattleAt = new Date();
            loserPlayer.league = this.getLeagueByRating(loserPlayer.rating).name;
            await loserPlayer.save();
        }
        
        // Отправляем результат
        const battleResult = {
            winner: winnerId,
            winnerName: winner.telegramId,
            loserName: loser.telegramId,
            winnerRatingChange: ratingChange,
            loserRatingChange: -ratingChange,
            winnerNewRating: (winnerPlayer?.rating || winner.originalRating + ratingChange),
            loserNewRating: (loserPlayer?.rating || loser.originalRating - ratingChange),
            moveHistory: battle.moveHistory,
            winnerLeague: this.getLeagueByRating(winnerPlayer?.rating || winner.originalRating + ratingChange).name,
            loserLeague: this.getLeagueByRating(loserPlayer?.rating || loser.originalRating - ratingChange).name
        };
        
        this.sendToClient(battle.player1.ws, 'battle_end', battleResult);
        this.sendToClient(battle.player2.ws, 'battle_end', battleResult);
        
        // Очищаем
        battles.delete(battle.id);
        playerBattleMap.delete(battle.player1.telegramId);
        playerBattleMap.delete(battle.player2.telegramId);
    }
    
    async handleForfeit(ws, battleId, telegramId) {
        const battle = battles.get(battleId);
        if (!battle || battle.status !== 'active') {
            this.sendToClient(ws, 'error', { message: 'Battle not active' });
            return;
        }
        
        const opponentId = battle.player1.telegramId === telegramId ? 
            battle.player2.telegramId : battle.player1.telegramId;
        
        await this.endBattle(battle, opponentId);
    }
    
    handlePlayerDisconnect(battleId, telegramId) {
        const battle = battles.get(battleId);
        if (!battle) return;
        
        if (battle.status === 'waiting_accept') {
            // Если еще не начали, просто отменяем
            const opponent = battle.player1.telegramId === telegramId ? battle.player2 : battle.player1;
            this.sendToClient(opponent.ws, 'battle_cancelled', { reason: 'Opponent disconnected' });
            battles.delete(battleId);
            playerBattleMap.delete(battle.player1.telegramId);
            playerBattleMap.delete(battle.player2.telegramId);
        } else if (battle.status === 'active') {
            // Если в бою, засчитываем поражение
            const winnerId = battle.player1.telegramId === telegramId ? 
                battle.player2.telegramId : battle.player1.telegramId;
            this.endBattle(battle, winnerId);
        }
    }
    
    sendBattleState(battle) {
        this.sendToClient(battle.player1.ws, 'battle_start', {
            battleId: battle.id,
            yourTeam: battle.player1.team,
            opponentTeam: battle.player2.team,
            firstTurn: battle.currentTurn,
            opponentName: battle.player2.telegramId,
            opponentRating: battle.player2.originalRating
        });
        
        this.sendToClient(battle.player2.ws, 'battle_start', {
            battleId: battle.id,
            yourTeam: battle.player2.team,
            opponentTeam: battle.player1.team,
            firstTurn: battle.currentTurn,
            opponentName: battle.player1.telegramId,
            opponentRating: battle.player1.originalRating
        });
    }
    
    async sendPlayerStats(ws, telegramId) {
        const player = await ArenaPlayer.findOne({ telegramId });
        if (player) {
            this.sendToClient(ws, 'player_stats', this.formatPlayer(player));
        }
    }
    
    async sendLeaderboard(ws, telegramId) {
        const topPlayers = await ArenaPlayer.find()
            .sort({ rating: -1 })
            .limit(100)
            .lean();
        
        const myRank = await ArenaPlayer.countDocuments({ rating: { $gt: ws.arenaPlayer?.rating || 1000 } }) + 1;
        
        this.sendToClient(ws, 'leaderboard', {
            players: topPlayers.map((p, i) => ({
                rank: i + 1,
                telegramId: p.telegramId,
                username: p.username || 'Anonymous',
                rating: p.rating,
                league: p.league,
                wins: p.wins,
                losses: p.losses
            })),
            myRank
        });
    }
    
    formatPlayer(player) {
        const league = this.getLeagueByRating(player.rating);
        return {
            telegramId: player.telegramId,
            rating: player.rating,
            league: league.name,
            leagueIcon: league.icon,
            leagueColor: league.color,
            wins: player.wins,
            losses: player.losses,
            draws: player.draws,
            totalBattles: player.totalBattles,
            currentStreak: player.currentStreak,
            bestStreak: player.bestStreak,
            arenaTeam: player.arenaTeam
        };
    }
    
    getLeagueByRating(rating) {
        const leagues = [...ARENA_CONFIG.LEAGUES].reverse();
        for (const league of leagues) {
            if (rating >= league.minRating) return league;
        }
        return ARENA_CONFIG.LEAGUES[0];
    }
}

module.exports = { ArenaServer, ArenaPlayer, ARENA_CONFIG };