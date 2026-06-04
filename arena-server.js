// ============================================================
// ARENA SERVER - WebSocket для PvP битв (УЛУЧШЕННАЯ ВЕРСИЯ)
// ============================================================

const socketIO = require('socket.io');
const mongoose = require('mongoose');

// Модель для истории боёв
const BattleHistorySchema = new mongoose.Schema({
    battleId: { type: String, required: true, unique: true },
    player1: {
        telegramId: String,
        username: String,
        elo: Number,
        team: Array
    },
    player2: {
        telegramId: String,
        username: String,
        elo: Number,
        team: Array
    },
    winner: String, // telegramId победителя
    loser: String,
    eloChange: Number,
    duration: Number, // в секундах
    log: Array,
    createdAt: { type: Date, default: Date.now }
});

let BattleHistory;
try {
    BattleHistory = mongoose.model('BattleHistory');
} catch (e) {
    BattleHistory = mongoose.model('BattleHistory', BattleHistorySchema);
}

class ArenaServer {
    constructor(server) {
        this.io = socketIO(server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            },
            transports: ['websocket', 'polling']
        });
        
        // Очередь поиска противников по лигам
        this.searchQueue = new Map();
        this.searchTimers = new Map(); // Таймеры для отмены поиска через 30 сек
        
        // Активные битвы
        this.activeBattles = new Map();
        
        // Подключенные игроки
        this.connectedPlayers = new Map();
        
        // Статистика игроков
        this.playerStats = new Map(); // telegramId -> { wins, losses, currentStreak, maxStreak }
        
        // Лиги и их требования
        this.leagues = {
            'bronze': { minElo: 0, maxElo: 999, name: 'Бронзовая', icon: '🥉', color: '#cd7c3a' },
            'silver': { minElo: 1000, maxElo: 1999, name: 'Серебряная', icon: '🥈', color: '#c0c0c0' },
            'gold': { minElo: 2000, maxElo: 2999, name: 'Золотая', icon: '🥇', color: '#ffd700' },
            'platinum': { minElo: 3000, maxElo: 3999, name: 'Платиновая', icon: '💎', color: '#00ffcc' },
            'diamond': { minElo: 4000, maxElo: 4999, name: 'Алмазная', icon: '🔷', color: '#4facfe' },
            'mythic': { minElo: 5000, maxElo: Infinity, name: 'Мифическая', icon: '🏆', color: '#ef4444' }
        };
        
        // Временные блокировки для защиты от флума
        this.actionCooldowns = new Map(); // socketId -> { lastAttack, lastSelectTarget }
        
        this.init();
    }
    
    init() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Игрок подключился: ${socket.id}`);
            
            socket.on('arena:register', (data) => this.handleRegister(socket, data));
            socket.on('arena:startSearch', (data) => this.handleStartSearch(socket, data));
            socket.on('arena:cancelSearch', () => this.handleCancelSearch(socket));
            socket.on('arena:attack', (data) => this.handleAttack(socket, data));
            socket.on('arena:selectTarget', (data) => this.handleSelectTarget(socket, data));
            socket.on('arena:getLeaderboard', (data) => this.handleGetLeaderboard(socket, data));
            socket.on('arena:getStats', () => this.handleGetStats(socket));
            socket.on('arena:getHistory', (data) => this.handleGetHistory(socket, data));
            socket.on('arena:disconnect', () => this.handleDisconnect(socket));
            socket.on('disconnect', () => this.handleDisconnect(socket));
        });
        
        // Запускаем таймер для очистки очереди
        setInterval(() => this.matchPlayers(), 1000);
        
        // Очистка таймеров поиска
        setInterval(() => this.cleanupSearchTimers(), 10000);
        
        // Сохраняем статистику в БД каждые 5 минут
        setInterval(() => this.savePlayerStats(), 5 * 60 * 1000);
        
        // Очистка старых историй боёв (старше 30 дней)
        setInterval(() => this.cleanupOldHistory(), 24 * 60 * 60 * 1000);
        
        console.log('⚔️ Арена сервер запущен!');
    }
    
    async handleRegister(socket, data) {
        const { userId, telegramId, username, token } = data;
        
        // Проверка токена (упрощённо)
        if (!token) {
            socket.emit('arena:error', { message: 'Не авторизован' });
            return;
        }
        
        // Получаем или создаём рейтинг игрока
        let elo = await this.getPlayerElo(telegramId);
        let stats = await this.getPlayerStats(telegramId);
        
        // Проверяем сезонный сброс
        const seasonData = await this.checkSeasonReset(telegramId, elo);
        if (seasonData.reset) {
            elo = seasonData.newElo;
            await this.saveEloToDb(telegramId, elo);
        }
        
        this.connectedPlayers.set(socket.id, {
            socketId: socket.id,
            userId,
            telegramId,
            username: username || 'Игрок',
            elo: elo || 1000,
            league: this.getLeagueByElo(elo || 1000),
            inBattle: false,
            battleId: null,
            searching: false,
            team: null,
            currentBattle: null,
            stats: stats || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 }
        });
        
        // Отправляем данные игроку
        socket.emit('arena:registered', {
            success: true,
            elo: elo || 1000,
            league: this.getLeagueByElo(elo || 1000),
            leagues: this.leagues,
            stats: stats || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 },
            seasonEndsAt: this.getSeasonEndDate()
        });
        
        console.log(`✅ Игрок зарегистрирован: ${username}, Эло: ${elo || 1000}`);
    }
    
    async getPlayerStats(telegramId) {
        if (this.playerStats.has(telegramId)) {
            return this.playerStats.get(telegramId);
        }
        
        try {
            const User = mongoose.model('User');
            const user = await User.findOne({ telegramId });
            if (user && user.arenaStats) {
                this.playerStats.set(telegramId, user.arenaStats);
                return user.arenaStats;
            }
        } catch (e) {
            console.error('Ошибка загрузки статистики:', e);
        }
        
        return { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
    }
    
    async savePlayerStats() {
        const User = mongoose.model('User');
        for (const [telegramId, stats] of this.playerStats.entries()) {
            try {
                await User.updateOne(
                    { telegramId },
                    { $set: { arenaStats: stats } }
                );
            } catch (e) {
                console.error('Ошибка сохранения статистики:', e);
            }
        }
    }
    
    async checkSeasonReset(telegramId, currentElo) {
        const User = mongoose.model('User');
        const user = await User.findOne({ telegramId });
        
        const now = new Date();
        const lastSeasonReset = user?.lastSeasonReset || new Date(0);
        const daysSinceReset = (now - lastSeasonReset) / (1000 * 60 * 60 * 24);
        
        // Сброс каждые 30 дней
        if (daysSinceReset >= 30) {
            // Новый Эло = 1000 + (старый - 1000) * 0.7
            const newElo = Math.floor(1000 + (currentElo - 1000) * 0.7);
            
            await User.updateOne(
                { telegramId },
                { 
                    $set: { 
                        lastSeasonReset: now,
                        lastSeasonElo: currentElo
                    }
                }
            );
            
            return { reset: true, newElo: Math.max(0, newElo) };
        }
        
        return { reset: false };
    }
    
    getSeasonEndDate() {
        const now = new Date();
        const nextReset = new Date(now);
        nextReset.setDate(now.getDate() + (30 - (now.getDate() % 30)));
        return nextReset.toISOString();
    }
    
    handleStartSearch(socket, data) {
        const player = this.connectedPlayers.get(socket.id);
        if (!player) {
            socket.emit('arena:error', { message: 'Игрок не найден' });
            return;
        }
        
        if (player.inBattle) {
            socket.emit('arena:error', { message: 'Вы уже в битве!' });
            return;
        }
        
        if (!data.team || data.team.length !== 3) {
            socket.emit('arena:error', { message: 'Выберите 3 существа для битвы!' });
            return;
        }
        
        player.searching = true;
        player.team = data.team;
        
        const league = player.league.id;
        if (!this.searchQueue.has(league)) {
            this.searchQueue.set(league, []);
        }
        
        this.searchQueue.get(league).push({
            socketId: socket.id,
            timestamp: Date.now()
        });
        
        // Таймер автоматической отмены поиска через 60 секунд
        const timer = setTimeout(() => {
            const stillSearching = this.searchQueue.get(league)?.find(
                q => q.socketId === socket.id
            );
            if (stillSearching) {
                this.handleCancelSearch(socket);
                socket.emit('arena:searchTimeout', { message: 'Поиск прерван: слишком долго ищем противника' });
            }
        }, 60000);
        
        this.searchTimers.set(socket.id, timer);
        
        socket.emit('arena:searchStarted', { message: 'Поиск противника...' });
        console.log(`🔍 Игрок ${player.username} ищет противника в лиге ${league}`);
    }
    
    cleanupSearchTimers() {
        for (const [socketId, timer] of this.searchTimers.entries()) {
            // Проверяем, не истёк ли таймер
            // Таймеры сами срабатывают, здесь просто чистим
        }
    }
    
    handleCancelSearch(socket) {
        const player = this.connectedPlayers.get(socket.id);
        if (!player) return;
        
        if (player.searching) {
            player.searching = false;
            player.team = null;
            
            // Очищаем таймер
            const timer = this.searchTimers.get(socket.id);
            if (timer) {
                clearTimeout(timer);
                this.searchTimers.delete(socket.id);
            }
            
            const league = player.league.id;
            const queue = this.searchQueue.get(league);
            if (queue) {
                const index = queue.findIndex(q => q.socketId === socket.id);
                if (index !== -1) queue.splice(index, 1);
            }
            
            socket.emit('arena:searchCancelled', { message: 'Поиск отменён' });
            console.log(`❌ Игрок ${player.username} отменил поиск`);
        }
    }
    
    matchPlayers() {
        for (const [league, queue] of this.searchQueue.entries()) {
            if (queue.length >= 2) {
                const entry1 = queue.shift();
                const entry2 = queue.shift();
                
                const player1 = this.connectedPlayers.get(entry1.socketId);
                const player2 = this.connectedPlayers.get(entry2.socketId);
                
                if (player1 && player2 && !player1.inBattle && !player2.inBattle) {
                    // Очищаем таймеры поиска
                    const timer1 = this.searchTimers.get(player1.socketId);
                    const timer2 = this.searchTimers.get(player2.socketId);
                    if (timer1) clearTimeout(timer1);
                    if (timer2) clearTimeout(timer2);
                    this.searchTimers.delete(player1.socketId);
                    this.searchTimers.delete(player2.socketId);
                    
                    this.startBattle(player1, player2);
                } else {
                    // Если один из игроков недоступен, возвращаем обоих в очередь
                    if (player1 && !player1.inBattle) queue.unshift(entry1);
                    if (player2 && !player2.inBattle) queue.unshift(entry2);
                }
            }
        }
    }
    
    async startBattle(player1, player2) {
        const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        // Получаем полные данные о существах из БД
        const team1 = await this.validateAndGetTeam(player1.team, player1.telegramId);
        const team2 = await this.validateAndGetTeam(player2.team, player2.telegramId);
        
        if (!team1 || !team2) {
            if (!team1) {
                this.io.to(player1.socketId).emit('arena:error', { message: 'Ошибка: некоторые существа не найдены в инвентаре' });
                player1.searching = false;
            }
            if (!team2) {
                this.io.to(player2.socketId).emit('arena:error', { message: 'Ошибка: некоторые существа не найдены в инвентаре' });
                player2.searching = false;
            }
            return;
        }
        
        // Создаём копии существ для битвы
        const battleTeam1 = team1.map(c => ({
            ...c,
            currentHp: c.hp,
            isAlive: true,
            maxHp: c.hp
        }));
        
        const battleTeam2 = team2.map(c => ({
            ...c,
            currentHp: c.hp,
            isAlive: true,
            maxHp: c.hp
        }));
        
        // Определяем порядок ходов (по скорости существ)
        const totalSpeed1 = battleTeam1.reduce((sum, c) => sum + (c.speed || 10), 0);
        const totalSpeed2 = battleTeam2.reduce((sum, c) => sum + (c.speed || 10), 0);
        const firstAttacker = totalSpeed1 >= totalSpeed2 ? player1.socketId : player2.socketId;
        const turnOrder = [firstAttacker, firstAttacker === player1.socketId ? player2.socketId : player1.socketId];
        
        const battleData = {
            id: battleId,
            player1: {
                socketId: player1.socketId,
                userId: player1.userId,
                telegramId: player1.telegramId,
                username: player1.username,
                elo: player1.elo,
                team: battleTeam1,
                selectedTarget: null,
                originalElo: player1.elo
            },
            player2: {
                socketId: player2.socketId,
                userId: player2.userId,
                telegramId: player2.telegramId,
                username: player2.username,
                elo: player2.elo,
                team: battleTeam2,
                selectedTarget: null,
                originalElo: player2.elo
            },
            currentTurn: turnOrder[0],
            turnOrder: turnOrder,
            winner: null,
            loser: null,
            startTime: Date.now(),
            lastActionTime: Date.now(),
            log: [],
            turnCount: 0
        };
        
        this.activeBattles.set(battleId, battleData);
        
        player1.inBattle = true;
        player1.battleId = battleId;
        player1.searching = false;
        player1.currentBattle = battleData;
        
        player2.inBattle = true;
        player2.battleId = battleId;
        player2.searching = false;
        player2.currentBattle = battleData;
        
        // Отправляем данные о битве обоим игрокам
        this.io.to(player1.socketId).emit('arena:battleStart', {
            battleId,
            yourTeam: battleTeam1,
            opponentTeam: battleTeam2,
            opponentName: player2.username,
            yourTurn: turnOrder[0] === player1.socketId,
            opponentElo: player2.elo,
            opponentLeague: this.getLeagueByElo(player2.elo),
            turnOrder: turnOrder[0] === player1.socketId ? 'first' : 'second'
        });
        
        this.io.to(player2.socketId).emit('arena:battleStart', {
            battleId,
            yourTeam: battleTeam2,
            opponentTeam: battleTeam1,
            opponentName: player1.username,
            yourTurn: turnOrder[0] === player2.socketId,
            opponentElo: player1.elo,
            opponentLeague: this.getLeagueByElo(player1.elo),
            turnOrder: turnOrder[0] === player2.socketId ? 'first' : 'second'
        });
        
        this.addBattleLog(battleData, `⚔️ БИТВА НАЧАЛАСЬ! ${player1.username} VS ${player2.username}`);
        this.addBattleLog(battleData, `🎲 Первым ходит ${turnOrder[0] === player1.socketId ? player1.username : player2.username}`);
        
        console.log(`⚔️ Битва началась: ${player1.username} vs ${player2.username}`);
        
        // Таймаут для битвы (5 минут бездействия)
        setTimeout(() => {
            const battle = this.activeBattles.get(battleId);
            if (battle && !battle.winner) {
                this.endBattleByTimeout(battleId);
            }
        }, 5 * 60 * 1000);
    }
    
    async validateAndGetTeam(teamData, telegramId) {
        // Проверяем наличие существ в инвентаре через БД
        try {
            const Inventory = mongoose.model('Inventory');
            const inventory = await Inventory.find({ telegramId }).lean();
            const inventoryMap = new Map();
            inventory.forEach(item => {
                inventoryMap.set(item.creatureId, item.count);
            });
            
            const validatedTeam = [];
            for (const creature of teamData) {
                const count = inventoryMap.get(creature.creatureId) || 0;
                if (count === 0) {
                    console.log(`❌ У игрока ${telegramId} нет существа ${creature.creatureId}`);
                    return null;
                }
                validatedTeam.push(creature);
            }
            
            // Рассчитываем HP и урон на основе редкости
            const hpByRarity = {
                'common': 60,
                'uncommon': 80,
                'rare': 100,
                'epic': 130,
                'legendary': 170,
                'mythic': 220
            };
            
            const damageByRarity = {
                'common': 8,
                'uncommon': 12,
                'rare': 18,
                'epic': 25,
                'legendary': 35,
                'mythic': 50
            };
            
            const speedByRarity = {
                'common': 8,
                'uncommon': 10,
                'rare': 12,
                'epic': 14,
                'legendary': 16,
                'mythic': 20
            };
            
            return validatedTeam.map(c => ({
                ...c,
                hp: hpByRarity[c.rarity] || 80,
                damage: damageByRarity[c.rarity] || 12,
                speed: speedByRarity[c.rarity] || 10,
                currentHp: hpByRarity[c.rarity] || 80,
                isAlive: true
            }));
        } catch (e) {
            console.error('Ошибка валидации команды:', e);
            return null;
        }
    }
    
    handleSelectTarget(socket, data) {
        const { targetIndex, teamSide } = data;
        const player = this.connectedPlayers.get(socket.id);
        
        if (!player || !player.inBattle) return;
        
        const battle = this.activeBattles.get(player.battleId);
        if (!battle) return;
        
        // Проверяем кулдаун выбора цели
        const now = Date.now();
        const lastSelect = this.actionCooldowns.get(`${socket.id}_select`) || 0;
        if (now - lastSelect < 300) {
            return; // Слишком быстро
        }
        this.actionCooldowns.set(`${socket.id}_select`, now);
        
        const isPlayer1 = battle.player1.socketId === socket.id;
        const playerData = isPlayer1 ? battle.player1 : battle.player2;
        const opponentData = isPlayer1 ? battle.player2 : battle.player1;
        
        // Проверяем, жива ли цель
        const targetCreature = opponentData.team[targetIndex];
        if (!targetCreature || !targetCreature.isAlive) {
            socket.emit('arena:error', { message: 'Эта цель уже мертва!' });
            return;
        }
        
        playerData.selectedTarget = { targetIndex, teamSide };
        
        socket.emit('arena:targetSelected', { targetIndex, teamSide });
    }
    
    async handleAttack(socket, data) {
        const { attackerIndex, targetIndex } = data;
        const player = this.connectedPlayers.get(socket.id);
        
        if (!player || !player.inBattle) {
            socket.emit('arena:error', { message: 'Вы не в битве!' });
            return;
        }
        
        const battle = this.activeBattles.get(player.battleId);
        if (!battle) return;
        
        // Проверяем кулдаун атаки
        const now = Date.now();
        const lastAttack = this.actionCooldowns.get(`${socket.id}_attack`) || 0;
        if (now - lastAttack < 500) {
            socket.emit('arena:error', { message: 'Слишком быстро!' });
            return;
        }
        this.actionCooldowns.set(`${socket.id}_attack`, now);
        
        // Проверяем, чей сейчас ход
        if (battle.currentTurn !== socket.id) {
            socket.emit('arena:error', { message: 'Сейчас не ваш ход!' });
            return;
        }
        
        if (battle.winner) {
            socket.emit('arena:error', { message: 'Битва уже завершена!' });
            return;
        }
        
        const isPlayer1Attacking = battle.player1.socketId === socket.id;
        const attacker = isPlayer1Attacking ? battle.player1 : battle.player2;
        const defender = isPlayer1Attacking ? battle.player2 : battle.player1;
        
        const attackerCreature = attacker.team[attackerIndex];
        if (!attackerCreature || !attackerCreature.isAlive) {
            socket.emit('arena:error', { message: 'Это существо мертво!' });
            return;
        }
        
        const targetCreature = defender.team[targetIndex];
        if (!targetCreature || !targetCreature.isAlive) {
            socket.emit('arena:error', { message: 'Цель уже мертва!' });
            return;
        }
        
        // Рассчитываем урон
        let damage = attackerCreature.damage;
        
        // Случайный разброс ±15%
        const variation = 0.85 + Math.random() * 0.3;
        damage = Math.floor(damage * variation);
        
        // Критический удар (15% шанс)
        const isCritical = Math.random() < 0.15;
        if (isCritical) {
            damage = Math.floor(damage * 1.5);
            this.addBattleLog(battle, `💥 КРИТИЧЕСКИЙ УДАР! ${attackerCreature.name} наносит ${damage} урона!`);
        } else {
            this.addBattleLog(battle, `⚔️ ${attackerCreature.name} атакует ${targetCreature.name} и наносит ${damage} урона!`);
        }
        
        targetCreature.currentHp -= damage;
        
        // Анимация урона
        this.io.to(battle.player1.socketId).emit('arena:damage', {
            targetTeam: isPlayer1Attacking ? 'opponent' : 'your',
            targetIndex: targetIndex,
            damage: damage,
            isCritical: isCritical,
            newHp: Math.max(0, targetCreature.currentHp),
            maxHp: targetCreature.hp
        });
        
        this.io.to(battle.player2.socketId).emit('arena:damage', {
            targetTeam: isPlayer1Attacking ? 'your' : 'opponent',
            targetIndex: targetIndex,
            damage: damage,
            isCritical: isCritical,
            newHp: Math.max(0, targetCreature.currentHp),
            maxHp: targetCreature.hp
        });
        
        // Проверяем смерть
        if (targetCreature.currentHp <= 0) {
            targetCreature.currentHp = 0;
            targetCreature.isAlive = false;
            this.addBattleLog(battle, `💀 ${targetCreature.name} (${defender.username}) пал в бою!`);
            
            this.io.to(battle.player1.socketId).emit('arena:death', {
                team: isPlayer1Attacking ? 'opponent' : 'your',
                index: targetIndex
            });
            this.io.to(battle.player2.socketId).emit('arena:death', {
                team: isPlayer1Attacking ? 'your' : 'opponent',
                index: targetIndex
            });
        }
        
        // Проверяем, не закончилась ли битва
        const allDefenderDead = defender.team.every(c => !c.isAlive);
        
        if (allDefenderDead) {
            battle.winner = attacker;
            battle.loser = defender;
            await this.endBattle(battle);
            return;
        }
        
        // Меняем ход
        battle.currentTurn = battle.turnOrder.find(id => id !== socket.id);
        battle.turnCount++;
        battle.lastActionTime = Date.now();
        
        // Уведомляем игроков о смене хода
        this.io.to(battle.player1.socketId).emit('arena:turnChange', {
            yourTurn: battle.currentTurn === battle.player1.socketId
        });
        
        this.io.to(battle.player2.socketId).emit('arena:turnChange', {
            yourTurn: battle.currentTurn === battle.player2.socketId
        });
        
        // Отправляем обновлённое состояние
        this.sendBattleState(battle);
        
        // Сбрасываем выбранные цели
        attacker.selectedTarget = null;
    }
    
    sendBattleState(battle) {
        this.io.to(battle.player1.socketId).emit('arena:battleState', {
            yourTeam: battle.player1.team,
            opponentTeam: battle.player2.team,
            currentTurn: battle.currentTurn === battle.player1.socketId,
            log: battle.log.slice(-5)
        });
        
        this.io.to(battle.player2.socketId).emit('arena:battleState', {
            yourTeam: battle.player2.team,
            opponentTeam: battle.player1.team,
            currentTurn: battle.currentTurn === battle.player2.socketId,
            log: battle.log.slice(-5)
        });
    }
    
    addBattleLog(battle, message) {
        battle.log.push({
            time: Date.now(),
            message: message
        });
        
        if (battle.log.length > 50) battle.log.shift();
    }
    
    async endBattle(battle) {
        const winner = battle.winner;
        const loser = battle.loser;
        const startTime = battle.startTime;
        const duration = Math.floor((Date.now() - startTime) / 1000);
        
        // Рассчитываем изменение Эло
        const eloChange = this.calculateEloChange(winner.originalElo, loser.originalElo);
        const winnerNewElo = winner.originalElo + eloChange;
        const loserNewElo = Math.max(0, loser.originalElo - eloChange);
        
        // Обновляем Эло в памяти
        winner.elo = winnerNewElo;
        loser.elo = loserNewElo;
        
        // Обновляем игроков в connectedPlayers
        const winnerPlayer = this.connectedPlayers.get(winner.socketId);
        const loserPlayer = this.connectedPlayers.get(loser.socketId);
        
        if (winnerPlayer) {
            winnerPlayer.elo = winnerNewElo;
            winnerPlayer.league = this.getLeagueByElo(winnerNewElo);
            winnerPlayer.inBattle = false;
            winnerPlayer.battleId = null;
            winnerPlayer.currentBattle = null;
            
            // Обновляем статистику победителя
            const winnerStats = this.playerStats.get(winnerPlayer.telegramId) || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
            winnerStats.wins++;
            winnerStats.currentStreak++;
            if (winnerStats.currentStreak > winnerStats.maxStreak) {
                winnerStats.maxStreak = winnerStats.currentStreak;
            }
            this.playerStats.set(winnerPlayer.telegramId, winnerStats);
        }
        
        if (loserPlayer) {
            loserPlayer.elo = loserNewElo;
            loserPlayer.league = this.getLeagueByElo(loserNewElo);
            loserPlayer.inBattle = false;
            loserPlayer.battleId = null;
            loserPlayer.currentBattle = null;
            
            // Обновляем статистику проигравшего
            const loserStats = this.playerStats.get(loserPlayer.telegramId) || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
            loserStats.losses++;
            loserStats.currentStreak = 0;
            this.playerStats.set(loserPlayer.telegramId, loserStats);
        }
        
        // Награда за победу
        const winReward = Math.floor(50 + winnerNewElo / 100);
        
        this.addBattleLog(battle, `🏆 ПОБЕДИТЕЛЬ: ${winner.username}!`);
        this.addBattleLog(battle, `📊 Изменение рейтинга: +${eloChange} / -${eloChange}`);
        this.addBattleLog(battle, `💰 Награда: +${winReward} MMO`);
        
        // Сохраняем историю битвы
        await this.saveBattleHistory(battle, winner, loser, eloChange, duration);
        
        // Отправляем результат битвы
        this.io.to(winner.socketId).emit('arena:battleEnd', {
            victory: true,
            message: `ПОБЕДА! +${winReward} MMO, +${eloChange} рейтинга`,
            newElo: winnerNewElo,
            newLeague: this.getLeagueByElo(winnerNewElo),
            reward: winReward,
            stats: this.playerStats.get(winner.telegramId)
        });
        
        this.io.to(loser.socketId).emit('arena:battleEnd', {
            victory: false,
            message: `ПОРАЖЕНИЕ! -${eloChange} рейтинга`,
            newElo: loserNewElo,
            newLeague: this.getLeagueByElo(loserNewElo),
            reward: 0,
            stats: this.playerStats.get(loser.telegramId)
        });
        
        // Сохраняем Эло в БД
        await this.saveEloToDb(winner.telegramId, winnerNewElo);
        await this.saveEloToDb(loser.telegramId, loserNewElo);
        
        // Начисляем награду победителю
        await this.addRewardToUser(winner.telegramId, winReward);
        
        // Добавляем ежедневную награду за участие
        await this.addDailyParticipationReward(winner.telegramId);
        await this.addDailyParticipationReward(loser.telegramId);
        
        // Удаляем битву
        this.activeBattles.delete(battle.id);
        
        console.log(`🏆 Битва завершена! Победитель: ${winner.username}, +${eloChange} Эло`);
    }
    
    async saveBattleHistory(battle, winner, loser, eloChange, duration) {
        try {
            await BattleHistory.create({
                battleId: battle.id,
                player1: {
                    telegramId: battle.player1.telegramId,
                    username: battle.player1.username,
                    elo: battle.player1.originalElo,
                    team: battle.player1.team.map(c => ({ name: c.name, rarity: c.rarity }))
                },
                player2: {
                    telegramId: battle.player2.telegramId,
                    username: battle.player2.username,
                    elo: battle.player2.originalElo,
                    team: battle.player2.team.map(c => ({ name: c.name, rarity: c.rarity }))
                },
                winner: winner.telegramId,
                loser: loser.telegramId,
                eloChange: eloChange,
                duration: duration,
                log: battle.log.slice(-20)
            });
            console.log(`📜 История битвы сохранена: ${battle.id}`);
        } catch (e) {
            console.error('Ошибка сохранения истории:', e);
        }
    }
    
    async addDailyParticipationReward(telegramId) {
        const today = new Date().toDateString();
        const key = `arena_participation_${telegramId}_${today}`;
        
        // Используем Redis или просто проверяем в памяти
        if (!this.dailyParticipation) {
            this.dailyParticipation = new Map();
        }
        
        if (this.dailyParticipation.has(key)) {
            return;
        }
        
        this.dailyParticipation.set(key, true);
        
        // Очищаем старые записи каждый день
        setTimeout(() => {
            this.dailyParticipation.delete(key);
        }, 24 * 60 * 60 * 1000);
        
        const dailyReward = 25;
        await this.addRewardToUser(telegramId, dailyReward);
        console.log(`🎁 Ежедневная награда за участие в арене: +${dailyReward} MMO игроку ${telegramId}`);
    }
    
    async cleanupOldHistory() {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        try {
            const result = await BattleHistory.deleteMany({
                createdAt: { $lt: thirtyDaysAgo }
            });
            console.log(`🗑️ Удалено ${result.deletedCount} старых записей истории боёв`);
        } catch (e) {
            console.error('Ошибка очистки истории:', e);
        }
    }
    
    endBattleByTimeout(battleId) {
        const battle = this.activeBattles.get(battleId);
        if (!battle || battle.winner) return;
        
        const player1 = this.connectedPlayers.get(battle.player1.socketId);
        const player2 = this.connectedPlayers.get(battle.player2.socketId);
        
        if (player1 && player2) {
            this.io.to(battle.player1.socketId).emit('arena:error', { message: 'Битва завершена по таймауту (ничья)' });
            this.io.to(battle.player2.socketId).emit('arena:error', { message: 'Битва завершена по таймауту (ничья)' });
        }
        
        this.activeBattles.delete(battleId);
        
        if (player1) {
            player1.inBattle = false;
            player1.battleId = null;
            player1.currentBattle = null;
        }
        if (player2) {
            player2.inBattle = false;
            player2.battleId = null;
            player2.currentBattle = null;
        }
    }
    
    calculateEloChange(winnerElo, loserElo) {
        const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
        const K = 32;
        return Math.floor(K * (1 - expectedWinner));
    }
    
    getLeagueByElo(elo) {
        for (const [id, league] of Object.entries(this.leagues)) {
            if (elo >= league.minElo && elo <= league.maxElo) {
                return { id, ...league };
            }
        }
        return { id: 'bronze', ...this.leagues.bronze };
    }
    
    async getPlayerElo(telegramId) {
        try {
            const User = mongoose.model('User');
            const user = await User.findOne({ telegramId });
            if (user && user.arenaElo !== undefined) {
                return user.arenaElo;
            }
        } catch (e) {
            console.error('Ошибка получения Эло:', e);
        }
        
        if (!this.playerElos) this.playerElos = new Map();
        return this.playerElos.get(telegramId) || 1000;
    }
    
    async saveEloToDb(telegramId, elo) {
        if (!this.playerElos) this.playerElos = new Map();
        this.playerElos.set(telegramId, elo);
        
        try {
            const User = mongoose.model('User');
            await User.updateOne(
                { telegramId },
                { $set: { arenaElo: elo } },
                { upsert: true }
            );
        } catch (e) {
            console.error('Ошибка сохранения Эло в БД:', e);
        }
    }
    
    async addRewardToUser(telegramId, amount) {
        try {
            const User = mongoose.model('User');
            await User.updateOne(
                { telegramId },
                { 
                    $inc: { balance: amount },
                    $push: {
                        transactions: {
                            $each: [{ name: 'Arena Victory Reward', amount: amount, time: new Date() }],
                            $position: 0,
                            $slice: 30
                        }
                    }
                }
            );
            console.log(`💰 Начислено ${amount} MMO игроку ${telegramId} за победу в арене`);
        } catch (e) {
            console.error('Ошибка начисления награды:', e);
        }
    }
    
    handleGetLeaderboard(socket, data) {
        const { limit = 50 } = data || {};
        
        if (!this.playerElos) {
            socket.emit('arena:leaderboard', { leaders: [] });
            return;
        }
        
        const leaders = Array.from(this.playerElos.entries())
            .map(([telegramId, elo]) => {
                let username = 'Игрок';
                for (const player of this.connectedPlayers.values()) {
                    if (player.telegramId === telegramId) {
                        username = player.username;
                        break;
                    }
                }
                const stats = this.playerStats.get(telegramId) || { wins: 0, losses: 0 };
                return { telegramId, username, elo, league: this.getLeagueByElo(elo), wins: stats.wins, losses: stats.losses };
            })
            .sort((a, b) => b.elo - a.elo)
            .slice(0, limit);
        
        socket.emit('arena:leaderboard', { leaders });
    }
    
    handleGetStats(socket) {
        const player = this.connectedPlayers.get(socket.id);
        if (!player) return;
        
        const stats = this.playerStats.get(player.telegramId) || { wins: 0, losses: 0, currentStreak: 0, maxStreak: 0 };
        socket.emit('arena:stats', { stats });
    }
    
    async handleGetHistory(socket, data) {
        const { limit = 10 } = data || {};
        const player = this.connectedPlayers.get(socket.id);
        if (!player) return;
        
        try {
            const history = await BattleHistory.find({
                $or: [
                    { 'player1.telegramId': player.telegramId },
                    { 'player2.telegramId': player.telegramId }
                ]
            })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
            
            const formattedHistory = history.map(battle => {
                const isWinner = battle.winner === player.telegramId;
                const opponent = battle.player1.telegramId === player.telegramId ? battle.player2 : battle.player1;
                return {
                    id: battle.battleId,
                    opponentName: opponent.username,
                    opponentElo: opponent.elo,
                    result: isWinner ? 'win' : 'loss',
                    eloChange: isWinner ? battle.eloChange : -battle.eloChange,
                    duration: battle.duration,
                    createdAt: battle.createdAt
                };
            });
            
            socket.emit('arena:history', { history: formattedHistory });
        } catch (e) {
            console.error('Ошибка получения истории:', e);
            socket.emit('arena:history', { history: [] });
        }
    }
    
    handleDisconnect(socket) {
        const player = this.connectedPlayers.get(socket.id);
        
        if (player) {
            // Удаляем из очереди поиска
            if (player.searching) {
                const league = player.league.id;
                const queue = this.searchQueue.get(league);
                if (queue) {
                    const index = queue.findIndex(q => q.socketId === socket.id);
                    if (index !== -1) queue.splice(index, 1);
                }
                
                const timer = this.searchTimers.get(socket.id);
                if (timer) {
                    clearTimeout(timer);
                    this.searchTimers.delete(socket.id);
                }
            }
            
            // Завершаем активную битву
            if (player.inBattle && player.battleId) {
                const battle = this.activeBattles.get(player.battleId);
                if (battle && !battle.winner) {
                    const winner = battle.player1.socketId === socket.id ? battle.player2 : battle.player1;
                    const loser = battle.player1.socketId === socket.id ? battle.player1 : battle.player2;
                    
                    battle.winner = winner;
                    battle.loser = loser;
                    
                    this.endBattle(battle);
                }
            }
            
            this.connectedPlayers.delete(socket.id);
            console.log(`🔌 Игрок отключился: ${player.username}`);
        }
    }
}

module.exports = ArenaServer;