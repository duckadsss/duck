// ============================================
// server.js - ПОЛНАЯ ВЕРСИЯ С АРЕНОЙ
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const http = require('http');
const socketIo = require('socket.io');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token']
}));
app.use(express.json());
app.use(compression());

// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ============================================
// НОВАЯ СИСТЕМА РЕКЛАМЫ - ПОЧАСОВОЕ ВОССТАНОВЛЕНИЕ
// ============================================
const MAX_ADS_AVAILABLE = 10;
const ADS_REGEN_INTERVAL = 60 * 60 * 1000;
const AD_COOLDOWN_SECONDS = 60;

// ============================================
// РАСШИРЕННЫЙ RATE LIMITING С АВТООЧИСТКОЙ
// ============================================
const rateLimit = new Map();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW = 60 * 1000;

// ============================================
// ЗАЩИТА ОТ ФАРМА
// ============================================
const MAX_COMMON_PRICE = 1100;

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimit.entries()) {
        if (now > record.resetAt) {
            rateLimit.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW);

function rateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    
    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    const record = rateLimit.get(ip);
    if (now > record.resetAt) {
        rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    if (record.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ success: false, message: 'Слишком много запросов. Подождите.' });
    }
    
    record.count++;
    next();
}

app.use(rateLimiter);

// ============================================
// СПЕЦИАЛЬНЫЙ RATE LIMIT ДЛЯ АДМИН-ЛОГИНА
// ============================================
const adminLoginAttempts = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of adminLoginAttempts.entries()) {
        if (now > data.resetAt) {
            adminLoginAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000);

// ============================================
// ПРОВЕРКА JWT_SECRET
// ============================================
if (!process.env.JWT_SECRET) {
    console.error('❌ JWT_SECRET не задан в .env');
    process.exit(1);
}

// ============================================
// ПОДКЛЮЧЕНИЕ К MongoDB
// ============================================
mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 5
})
    .then(() => {
        console.log('✅ MongoDB подключена');
        createIndexes();
    })
    .catch(err => console.error('❌ MongoDB ошибка:', err));

async function createIndexes() {
    try {
        await User.collection.createIndex({ level: -1, xp: -1 });
        await User.collection.createIndex({ telegramId: 1 });
        await User.collection.createIndex({ referralCode: 1 });
        await User.collection.createIndex({ referredBy: 1 });
        await User.collection.createIndex({ lastLogin: -1 });
        await Inventory.collection.createIndex({ telegramId: 1, creatureId: 1 });
        await Inventory.collection.createIndex({ telegramId: 1, count: -1 });
        await Marketplace.collection.createIndex({ active: 1, createdAt: -1 });
        await User.collection.createIndex({ level: -1, xp: -1, balance: -1 });
        console.log('✅ Индексы созданы');
    } catch (e) {
        console.warn('⚠️ Индексы:', e.message);
    }
}

// ============================================
// КОНСТАНТЫ
// ============================================
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
const MAX_OFFLINE_HOURS = 8;
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const RECORD_TTL = 60 * 60 * 1000;
const MIN_TRANSACTION_AMOUNT = 10000;
const MAX_ACTIVE_REQUESTS = 2;
const REFERRAL_BONUS_PERCENT = 2;
const MAX_ACTIVE_LISTINGS = 2;
const MIN_MARKETPLACE_PRICE = 500;

// Arena Constants
const LEAGUES = {
    'BRONZE': { min: 0, max: 999, color: '#cd7c3a', reward: 100 },
    'SILVER': { min: 1000, max: 1999, color: '#94a3b8', reward: 150 },
    'GOLD': { min: 2000, max: 2999, color: '#f59e0b', reward: 250 },
    'PLATINUM': { min: 3000, max: 3999, color: '#06b6d4', reward: 400 },
    'DIAMOND': { min: 4000, max: 9999, color: '#a855f7', reward: 600 }
};

const getDateKey = (date) => {
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
};

// КЭШИ
let leaderboardCache = { data: null, expiresAt: 0 };
let marketplaceListingsCache = { data: null, expiresAt: 0 };
let cachedConfig = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 60 * 1000;
const inventoryCache = new Map();
const INVENTORY_CACHE_TTL = 5000;
let cachedAdminStats = { data: null, expiresAt: 0 };
const ADMIN_STATS_CACHE_TTL = 60 * 1000;
const userIncomeCache = new Map();
const INCOME_CACHE_TTL = 10000;

// Блокировки для рекламы
const adLocks = new Map();

// Arena WebSocket хранилища
let waitingPlayers = [];
let activeBattles = new Map();
let battleTimers = new Map();

// ============================================
// ФУНКЦИЯ ВОССТАНОВЛЕНИЯ РЕКЛАМЫ
// ============================================
async function regenerateAds(user) {
    const now = Date.now();
    const lastRegen = user.adsLastRegen ? new Date(user.adsLastRegen).getTime() : now;
    const hoursPassed = Math.floor((now - lastRegen) / ADS_REGEN_INTERVAL);
    
    if (hoursPassed <= 0) return user.adsAvailable;
    
    const newCount = Math.min(MAX_ADS_AVAILABLE, user.adsAvailable + hoursPassed);
    const newLastRegen = new Date(lastRegen + (hoursPassed * ADS_REGEN_INTERVAL));
    
    await User.updateOne(
        { _id: user._id },
        { 
            $set: { 
                adsAvailable: newCount,
                adsLastRegen: newLastRegen
            }
        }
    );
    
    user.adsAvailable = newCount;
    user.adsLastRegen = newLastRegen;
 
    return newCount;
}

// ============================================
// АРЕНА - ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getLeagueFromRating(rating) {
    for (const [league, data] of Object.entries(LEAGUES)) {
        if (rating >= data.min && rating <= data.max) return league;
    }
    return 'BRONZE';
}

function getRewardForLeague(league) {
    return LEAGUES[league]?.reward || 100;
}

function calculateRatingChange(winnerRating, loserRating) {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const k = 32;
    return Math.floor(k * (1 - expected));
}

function getCreatureType(creature) {
    const name = creature.name.toLowerCase();
    if (name.includes('dragon') || name.includes('fire')) return 'fire';
    if (name.includes('shark') || name.includes('water')) return 'water';
    if (name.includes('duck') || name.includes('owl')) return 'grass';
    if (name.includes('electric')) return 'electric';
    if (name.includes('dark')) return 'dark';
    return 'light';
}

function calculateDamageWithType(attacker, defender) {
    const typeAdvantages = {
        'fire': { strong: ['grass'], weak: ['water'] },
        'water': { strong: ['fire'], weak: ['electric', 'grass'] },
        'grass': { strong: ['water'], weak: ['fire'] },
        'electric': { strong: ['water'], weak: [] },
        'dark': { strong: [], weak: [] },
        'light': { strong: [], weak: [] }
    };
    
    const attackerType = getCreatureType(attacker);
    const defenderType = getCreatureType(defender);
    
    let multiplier = 1.0;
    const adv = typeAdvantages[attackerType];
    if (adv && adv.strong.includes(defenderType)) multiplier = 1.5;
    if (adv && adv.weak.includes(defenderType)) multiplier = 0.75;
    
    const isCritical = Math.random() < 0.1;
    const critMultiplier = isCritical ? 2 : 1;
    
    let damage = Math.max(1, Math.floor((attacker.atk - defender.def) * multiplier * critMultiplier));
    damage = Math.floor(damage * (0.8 + Math.random() * 0.4));
    
    return { damage, multiplier, isCritical };
}

function createBattleMonster(creature, multiplier = 1) {
    return {
        id: creature.id,
        name: creature.name,
        icon: creature.icon,
        rarity: creature.rarity,
        atk: Math.floor((creature.incomeBase || 10) * 2 * multiplier),
        def: Math.floor((creature.incomeBase || 10) * 1.5 * multiplier),
        hp: Math.floor((creature.incomeBase || 10) * 10 * multiplier),
        maxHp: Math.floor((creature.incomeBase || 10) * 10 * multiplier)
    };
}

function getTotalHealth(monsters) {
    return monsters.reduce((sum, m) => sum + (m.hp || 0), 0);
}

function getMaxHealth(monsters) {
    return monsters.reduce((sum, m) => sum + (m.maxHp || 0), 0);
}

// ============================================
// АРЕНА - WEBHOOK HANDLERS
// ============================================

function tryFindMatch() {
    if (waitingPlayers.length < 2) return;
    
    waitingPlayers.sort((a, b) => a.rating - b.rating);
    
    for (let i = 0; i < waitingPlayers.length - 1; i++) {
        const player1 = waitingPlayers[i];
        const player2 = waitingPlayers[i + 1];
        
        if (Math.abs(player1.rating - player2.rating) <= 200) {
            waitingPlayers.splice(i, 2);
            
            const battleId = `battle_${Date.now()}_${player1.userId}_${player2.userId}`;
            
            const battle = {
    battleId,
    status: 'waiting',
    player: {
        id: player1.userId,
        socketId: player1.socketId,
        name: player1.name,
        rating: player1.rating,
        league: player1.league,
        team: player1.team,
        accepted: false,
        monsters: null,
        totalHealth: 0,
        maxHealth: 0
    },
    opponent: {
        id: player2.userId,
        socketId: player2.socketId,
        name: player2.name,
        rating: player2.rating,
        league: player2.league,
        team: player2.team,
        accepted: false,
        monsters: null,
        totalHealth: 0,
        maxHealth: 0
    },
    createdAt: Date.now(),
    currentTurn: null,
    turnStartTime: null,
    timerInterval: null  // <-- ДОБАВИТЬ ЭТУ СТРОКУ
};
            
            activeBattles.set(battleId, battle);
            
            io.to(player1.socketId).emit('match-found', {
                matchId: battleId,
                opponent: {
                    name: player2.name,
                    rating: player2.rating,
                    league: player2.league
                }
            });
            
            io.to(player2.socketId).emit('match-found', {
                matchId: battleId,
                opponent: {
                    name: player1.name,
                    rating: player1.rating,
                    league: player1.league
                }
            });
            
            setTimeout(() => {
                const battle = activeBattles.get(battleId);
                if (battle && battle.status === 'waiting') {
                    activeBattles.delete(battleId);
                    io.to(player1.socketId).emit('match-cancelled', { reason: 'Timeout' });
                    io.to(player2.socketId).emit('match-cancelled', { reason: 'Timeout' });
                }
            }, 30000);
            
            break;
        }
    }
}

function startTurnTimer(battle) {
    if (battleTimers.has(battle.battleId)) {
        clearTimeout(battleTimers.get(battle.battleId));
    }
    
    // Очищаем предыдущий интервал обновления, если есть
    if (battle.timerInterval) {
        clearInterval(battle.timerInterval);
    }
    
    const timer = setTimeout(async () => {
        if (!activeBattles.has(battle.battleId)) return;
        
        // Очищаем интервал обновления таймера
        if (battle.timerInterval) {
            clearInterval(battle.timerInterval);
            battle.timerInterval = null;
        }
        
        const currentPlayer = battle.currentTurn === 'player' ? battle.player : battle.opponent;
        
        battle.currentTurn = battle.currentTurn === 'player' ? 'opponent' : 'player';
        battle.turnStartTime = Date.now();
        
        const moveData = {
            logMessage: `${currentPlayer.name} ran out of time! Turn passed.`,
            nextTurn: battle.currentTurn
        };
        
        io.to(battle.player.socketId).emit('opponent-move', moveData);
        io.to(battle.opponent.socketId).emit('opponent-move', moveData);
        
        startTurnTimer(battle);
    }, 30000);
    
    battleTimers.set(battle.battleId, timer);
    
    // Update timer display every second
    battle.timerInterval = setInterval(() => {
        if (!activeBattles.has(battle.battleId)) {
            clearInterval(battle.timerInterval);
            return;
        }
        const timeLeft = Math.max(0, 30 - Math.floor((Date.now() - battle.turnStartTime) / 1000));
        io.to(battle.player.socketId).emit('turn-update', { timeLeft });
        io.to(battle.opponent.socketId).emit('turn-update', { timeLeft });
        
        if (timeLeft <= 0) clearInterval(battle.timerInterval);
    }, 1000);
}

// Замените функцию processBattleMove в server.js на эту:

function processBattleMove(battle, attackerId, attackerIndex, targetIndex) {
    const isPlayerAttacking = attackerId === battle.player.id;
    const attacker = isPlayerAttacking ? battle.player : battle.opponent;
    const defender = isPlayerAttacking ? battle.opponent : battle.player;
    
    // Используем конкретного монстра по индексу, а не ищем первого живого
    const attackerMonster = attacker.monsters[attackerIndex];
    if (!attackerMonster || attackerMonster.hp <= 0) {
        return { success: false, message: 'This monster is defeated!' };
    }
    
    const targetMonster = defender.monsters[targetIndex];
    if (!targetMonster || targetMonster.hp <= 0) {
        return { success: false, message: 'Target already defeated' };
    }
    
    const { damage, multiplier, isCritical } = calculateDamageWithType(attackerMonster, targetMonster);
    
    targetMonster.hp = Math.max(0, targetMonster.hp - damage);
    
    let logMessage = `${isPlayerAttacking ? 'YOU' : battle.opponent.name}'s ${attackerMonster.name} attacked ${targetMonster.name} for ${damage} damage${isCritical ? ' (CRITICAL!)' : ''}${multiplier !== 1 ? ` (${multiplier > 1 ? 'SUPER EFFECTIVE!' : 'NOT VERY EFFECTIVE...'})` : ''}`;
    
    if (targetMonster.hp <= 0) {
        logMessage += ` 💀 ${targetMonster.name} defeated!`;
    }
    
    const playerTotalHealth = battle.player.monsters.reduce((sum, m) => sum + m.hp, 0);
    const opponentTotalHealth = battle.opponent.monsters.reduce((sum, m) => sum + m.hp, 0);
    
    battle.player.totalHealth = playerTotalHealth;
    battle.opponent.totalHealth = opponentTotalHealth;
    
    const playerDefeated = playerTotalHealth <= 0;
    const opponentDefeated = opponentTotalHealth <= 0;
    
    let winner = null;
    if (playerDefeated && opponentDefeated) winner = 'draw';
    else if (playerDefeated) winner = 'opponent';
    else if (opponentDefeated) winner = 'player';
    
    if (winner) {
        return { success: true, logMessage, winner, battleEnded: true };
    }
    
    battle.currentTurn = isPlayerAttacking ? 'opponent' : 'player';
    battle.turnStartTime = Date.now();
    
    return { success: true, logMessage, battleEnded: false, nextTurn: battle.currentTurn };
}

async function endBattle(battle, winner) {
    if (battleTimers.has(battle.battleId)) {
        clearTimeout(battleTimers.get(battle.battleId));
        battleTimers.delete(battle.battleId);
    }
    
    const player = await User.findById(battle.player.id);
    const opponent = await User.findById(battle.opponent.id);
    
    if (!player || !opponent) return;
    
    let playerStats = player.pvpStats || { rating: 500, wins: 0, losses: 0, draws: 0, tokens: 3, lastReset: new Date() };
    let opponentStats = opponent.pvpStats || { rating: 500, wins: 0, losses: 0, draws: 0, tokens: 3, lastReset: new Date() };
    
    let playerRatingChange = 0;
    let opponentRatingChange = 0;
    let playerReward = 0;
    let opponentReward = 0;
    
    if (winner === 'player') {
        playerRatingChange = calculateRatingChange(playerStats.rating, opponentStats.rating);
        opponentRatingChange = -playerRatingChange;
        playerStats.wins++;
        opponentStats.losses++;
        
        const league = getLeagueFromRating(playerStats.rating);
        playerReward = getRewardForLeague(league);
        
        playerStats.tokens = Math.max(0, playerStats.tokens - 1);
        opponentStats.tokens = Math.max(0, opponentStats.tokens - 1);
        
        player.balance += playerReward;
        
    } else if (winner === 'opponent') {
        opponentRatingChange = calculateRatingChange(opponentStats.rating, playerStats.rating);
        playerRatingChange = -opponentRatingChange;
        playerStats.losses++;
        opponentStats.wins++;
        
        const league = getLeagueFromRating(opponentStats.rating);
        opponentReward = getRewardForLeague(league);
        
        playerStats.tokens = Math.max(0, playerStats.tokens - 1);
        opponentStats.tokens = Math.max(0, opponentStats.tokens - 1);
        
        opponent.balance += opponentReward;
        
    } else {
        playerStats.draws++;
        opponentStats.draws++;
        playerStats.tokens = Math.max(0, playerStats.tokens - 1);
        opponentStats.tokens = Math.max(0, opponentStats.tokens - 1);
    }
    
    playerStats.rating = Math.max(0, playerStats.rating + playerRatingChange);
    opponentStats.rating = Math.max(0, opponentStats.rating + opponentRatingChange);
    
    playerStats.league = getLeagueFromRating(playerStats.rating);
    opponentStats.league = getLeagueFromRating(opponentStats.rating);
    
    player.pvpStats = playerStats;
    opponent.pvpStats = opponentStats;
    
    player.battleHistory = player.battleHistory || [];
    opponent.battleHistory = opponent.battleHistory || [];
    
    player.battleHistory.unshift({
        opponentId: opponent._id,
        opponentName: opponent.username || opponent.firstName || 'Player',
        result: winner === 'player' ? 'win' : winner === 'opponent' ? 'loss' : 'draw',
        ratingChange: playerRatingChange,
        date: new Date()
    });
    
    opponent.battleHistory.unshift({
        opponentId: player._id,
        opponentName: player.username || player.firstName || 'Player',
        result: winner === 'opponent' ? 'win' : winner === 'player' ? 'loss' : 'draw',
        ratingChange: opponentRatingChange,
        date: new Date()
    });
    
    if (player.battleHistory.length > 50) player.battleHistory = player.battleHistory.slice(0, 50);
    if (opponent.battleHistory.length > 50) opponent.battleHistory = opponent.battleHistory.slice(0, 50);
    
    await player.save();
    await opponent.save();
    
    const playerResult = {
        winner: winner === 'player' ? 'player' : winner === 'opponent' ? 'opponent' : 'draw',
        resultMessage: winner === 'player' ? 'You won!' : winner === 'opponent' ? 'You lost!' : 'Draw!',
        reward: playerReward,
        ratingGain: playerRatingChange > 0 ? playerRatingChange : 0,
        ratingLoss: playerRatingChange < 0 ? -playerRatingChange : 0,
        newStats: {
            rating: playerStats.rating,
            league: playerStats.league,
            wins: playerStats.wins,
            losses: playerStats.losses,
            draws: playerStats.draws,
            tokens: playerStats.tokens,
            balance: player.balance
        }
    };
    
    const opponentResult = {
        winner: winner === 'player' ? 'player' : winner === 'opponent' ? 'opponent' : 'draw',
        resultMessage: winner === 'opponent' ? 'You won!' : winner === 'player' ? 'You lost!' : 'Draw!',
        reward: opponentReward,
        ratingGain: opponentRatingChange > 0 ? opponentRatingChange : 0,
        ratingLoss: opponentRatingChange < 0 ? -opponentRatingChange : 0,
        newStats: {
            rating: opponentStats.rating,
            league: opponentStats.league,
            wins: opponentStats.wins,
            losses: opponentStats.losses,
            draws: opponentStats.draws,
            tokens: opponentStats.tokens,
            balance: opponent.balance
        }
    };
    
    io.to(battle.player.socketId).emit('battle-end', playerResult);
    io.to(battle.opponent.socketId).emit('battle-end', opponentResult);
    
    activeBattles.delete(battle.battleId);
}

function formatBattleStart(battle, perspective) {
    const isPlayer = perspective === 'player';
    
    return {
        battleId: battle.battleId,
        currentTurn: battle.currentTurn,
        player: {
            id: isPlayer ? battle.player.id : battle.opponent.id,
            name: isPlayer ? battle.player.name : battle.opponent.name,
            rating: isPlayer ? battle.player.rating : battle.opponent.rating,
            league: isPlayer ? battle.player.league : battle.opponent.league,
            monsters: isPlayer ? battle.player.team : battle.opponent.team,
            totalHealth: isPlayer ? battle.player.totalHealth : battle.opponent.totalHealth,
            maxHealth: isPlayer ? battle.player.maxHealth : battle.opponent.maxHealth
        },
        opponent: {
            id: isPlayer ? battle.opponent.id : battle.player.id,
            name: isPlayer ? battle.opponent.name : battle.player.name,
            rating: isPlayer ? battle.opponent.rating : battle.player.rating,
            league: isPlayer ? battle.opponent.league : battle.player.league,
            monsters: isPlayer ? battle.opponent.team : battle.player.team,
            totalHealth: isPlayer ? battle.opponent.totalHealth : battle.player.totalHealth,
            maxHealth: isPlayer ? battle.opponent.maxHealth : battle.player.maxHealth
        }
    };
}

// ============================================
// АРЕНА - WEBHOOK SETUP
// ============================================

function setupArenaServer() {
    io.on('connection', (socket) => {
        let userId = null;
        
        const token = socket.handshake.query.token;
        if (!token) {
            socket.disconnect();
            return;
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.userId;
        } catch (e) {
            socket.disconnect();
            return;
        }
        
        console.log(`🏟️ Arena connected: ${userId}`);
        
        socket.on('find-match', async (data) => {
            if (!data.team || data.team.length !== 3) {
                socket.emit('error', { message: 'Need 3 monsters' });
                return;
            }
            
            const dbUser = await User.findById(userId);
            if (!dbUser) return;
            
            const pvpStats = dbUser.pvpStats || { rating: 500, tokens: 3, lastReset: new Date() };
            
            if (pvpStats.tokens <= 0) {
                socket.emit('error', { message: 'No arena tokens left' });
                return;
            }
            
            waitingPlayers.push({
                socketId: socket.id,
                userId: userId,
                name: dbUser.username || dbUser.firstName || 'Player',
                rating: pvpStats.rating || 500,
                league: pvpStats.league || 'BRONZE',
                team: data.team,
                joinedAt: Date.now()
            });
            
            socket.emit('searching', { status: true });
            
            setTimeout(() => tryFindMatch(), 100);
        });
        
        socket.on('cancel-search', () => {
            const index = waitingPlayers.findIndex(p => p.socketId === socket.id);
            if (index !== -1) waitingPlayers.splice(index, 1);
            socket.emit('search-cancelled');
        });
        
        socket.on('accept-battle', async (data) => {
            const battle = activeBattles.get(data.matchId);
            if (!battle) return;
            
            if (battle.player.socketId === socket.id) {
                battle.player.accepted = true;
            } else if (battle.opponent.socketId === socket.id) {
                battle.opponent.accepted = true;
            }
            
            if (battle.player.accepted && battle.opponent.accepted) {
                battle.status = 'active';
                battle.currentTurn = Math.random() < 0.5 ? 'player' : 'opponent';
                battle.turnStartTime = Date.now();
                
                battle.player.monsters = battle.player.team.map(m => createBattleMonster(m));
                battle.opponent.monsters = battle.opponent.team.map(m => createBattleMonster(m));
                
                battle.player.totalHealth = getTotalHealth(battle.player.monsters);
                battle.player.maxHealth = getMaxHealth(battle.player.monsters);
                battle.opponent.totalHealth = getTotalHealth(battle.opponent.monsters);
                battle.opponent.maxHealth = getMaxHealth(battle.opponent.monsters);
                
                io.to(battle.player.socketId).emit('battle-start', formatBattleStart(battle, 'player'));
                io.to(battle.opponent.socketId).emit('battle-start', formatBattleStart(battle, 'opponent'));
                
                startTurnTimer(battle);
            }
        });
        
        socket.on('decline-battle', (data) => {
            const battle = activeBattles.get(data.matchId);
            if (battle) {
                const decliner = battle.player.socketId === socket.id ? 'player' : 'opponent';
                const other = decliner === 'player' ? battle.opponent : battle.player;
                
                io.to(other.socketId).emit('match-cancelled', { reason: 'Opponent declined' });
                activeBattles.delete(data.matchId);
            }
        });
        
        socket.on('make-move', async (data) => {
    const battle = activeBattles.get(data.battleId);
    if (!battle) return;
    if (battle.status !== 'active') return;
    
    const isPlayerTurn = (battle.currentTurn === 'player' && battle.player.socketId === socket.id) ||
                        (battle.currentTurn === 'opponent' && battle.opponent.socketId === socket.id);
    
    if (!isPlayerTurn) {
        socket.emit('error', { message: 'Not your turn!' });
        return;
    }
    
    if (battleTimers.has(data.battleId)) {
        clearTimeout(battleTimers.get(data.battleId));
        battleTimers.delete(data.battleId);
    }
    
    // ИСПРАВЛЕНО: передаем attackerIndex
    const result = processBattleMove(battle, 
        battle.player.socketId === socket.id ? battle.player.id : battle.opponent.id,
        data.attackerIndex,  // <-- теперь используем attackerIndex
        data.targetIndex
    );
    
    if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
    }
    
    const moveData = {
        logMessage: result.logMessage,
        playerHealth: {
            current: battle.player.totalHealth,
            max: battle.player.maxHealth,
            monsters: battle.player.monsters
        },
        opponentHealth: {
            current: battle.opponent.totalHealth,
            max: battle.opponent.maxHealth,
            monsters: battle.opponent.monsters
        },
        attackerIndex: data.attackerIndex,
        targetIndex: data.targetIndex,
        nextTurn: result.nextTurn
    };
    
    io.to(battle.player.socketId).emit('opponent-move', moveData);
    io.to(battle.opponent.socketId).emit('opponent-move', moveData);
    
    if (result.battleEnded) {
        await endBattle(battle, result.winner);
    } else {
        startTurnTimer(battle);
    }
});
        
        socket.on('disconnect', () => {
            const waitIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
            if (waitIndex !== -1) waitingPlayers.splice(waitIndex, 1);
            
            for (const [battleId, battle] of activeBattles) {
                if (battle.player.socketId === socket.id || battle.opponent.socketId === socket.id) {
                    const winner = battle.player.socketId === socket.id ? 'opponent' : 'player';
                    endBattle(battle, winner);
                }
            }
        });
    });
}

// ============================================
// АДМИН АВТОРИЗАЦИЯ
// ============================================
const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    console.error('❌ ОШИБКА: ADMIN_LOGIN и ADMIN_PASSWORD должны быть заданы в .env');
    process.exit(1);
}

const adminSessions = new Map();

const adminAuthMiddleware = async (req, res, next) => {
    const sessionToken = req.headers['x-admin-token'];
    
    if (!sessionToken) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    
    const session = adminSessions.get(sessionToken);
    if (!session || session.expiresAt < Date.now()) {
        if (session) adminSessions.delete(sessionToken);
        return res.status(401).json({ success: false, message: 'Сессия истекла' });
    }
    
    req.adminLogin = session.login;
    next();
};

// ============================================
// МОДЕЛИ
// ============================================

const TransactionRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    type: { type: String, enum: ['deposit', 'withdraw'], required: true },
    amount: { type: Number, required: true, min: MIN_TRANSACTION_AMOUNT },
    wallet: { type: String, default: '' },
    memo: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminNote: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null }
});

const BroadcastSchema = new mongoose.Schema({
    message: { type: String, required: true },
    imageUrl: { type: String, default: null },
    buttons: { type: Array, default: [] },
    parseMode: { type: String, default: 'HTML' },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    totalUsers: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
});

const Broadcast = mongoose.model('Broadcast', BroadcastSchema);
const TransactionRequest = mongoose.model('TransactionRequest', TransactionRequestSchema);

const PendingDepositSchema = new mongoose.Schema({
    memo: { type: String, required: true, unique: true },
    telegramId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});
const PendingDeposit = mongoose.model('PendingDeposit', PendingDepositSchema);

const MarketSaleHistorySchema = new mongoose.Schema({
    listingId: { type: mongoose.Schema.Types.ObjectId, required: true },
    creatureId: { type: String, required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerTgId: { type: String, required: true },
    sellerName: { type: String, default: '' },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    buyerTgId: { type: String, required: true },
    buyerName: { type: String, default: '' },
    price: { type: Number, required: true },
    fee: { type: Number, required: true },
    sellerEarns: { type: Number, required: true },
    soldAt: { type: Date, default: Date.now }
});

const MarketSaleHistory = mongoose.model('MarketSaleHistory', MarketSaleHistorySchema);

const SpecialQuestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '🎯' },
    reward: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ['telegram_channel', 'custom_link', 'referral_count'], required: true },
    link: { type: String, default: '' },
    required_count: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const GameConfigSchema = new mongoose.Schema({
    capsuleCosts: { basic: Number, premium: Number },
    capsuleRarities: {
        basic: { common: Number, uncommon: Number, rare: Number, epic: Number, legendary: Number },
        premium: { common: Number, uncommon: Number, rare: Number, epic: Number, legendary: Number }
    },
    adReward: { type: Number, default: 50 },
    adCooldown: { type: Number, default: 60 },
    upgradeBaseCost: { type: Number, default: 300 },
    upgradeMultiplier: { type: Number, default: 1.4 },
    specialQuests: [SpecialQuestSchema],
    limits: {
        maxInventorySlots: { type: Number, default: 50 },
        maxMarketplacePrice: { type: Number, default: 100000 },
        maxLevel: { type: Number, default: 100 }
    },
    updatedAt: { type: Date, default: Date.now }
});
const GameConfig = mongoose.model('GameConfig', GameConfigSchema);

const CreatureSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    rarity: { type: String, enum: RARITY_ORDER, required: true },
    icon: { type: String, required: true, default: '🧬' },
    incomeBase: { type: Number, required: true, min: 1 },
    desc: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const Creature = mongoose.model('Creature', CreatureSchema);

const UserSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    balance: { type: Number, default: 4000 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    mergeCount: { type: Number, default: 0 },
    capsulesOpened: { type: Number, default: 0 },
    inventorySlots: { type: Number, default: 10 },
    inventoryUpgrades: { type: Number, default: 0 },
    discovered: [{ type: String }],
    completedSpecialQuests: [{ type: String }],
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: '' },
    transactions: [{
        name: String,
        amount: Number,
        time: { type: Date, default: Date.now }
    }],
    adsAvailable: { type: Number, default: MAX_ADS_AVAILABLE },
    adsLastRegen: { type: Date, default: Date.now },
    adsCooldownUntil: { type: Date, default: null },
    adsDailyCount: { type: Number, default: 0 },
    adsDailyReset: { type: Date, default: Date.now },
    lastPassiveIncome: { type: Date, default: Date.now },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    totalReferralBonus: { type: Number, default: 0 },
    notifiedLostIncome: { type: Boolean, default: false },
    lastLogin: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    cachedIncome: { type: Number, default: 0 },
    incomeCacheExpires: { type: Date, default: Date.now },
    // Arena PvP Stats
    pvpStats: {
        rating: { type: Number, default: 500 },
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        league: { type: String, default: 'BRONZE' },
        tokens: { type: Number, default: 3 },
        lastReset: { type: Date, default: Date.now }
    },
    battleHistory: [{
        opponentId: mongoose.Schema.Types.ObjectId,
        opponentName: String,
        result: String,
        ratingChange: Number,
        date: Date
    }]
});

UserSchema.pre('save', function(next) {
    if (!this.referralCode) {
        this.referralCode = 'REF' + this.telegramId + Math.random().toString(36).slice(2, 7).toUpperCase();
    }
    next();
});

const User = mongoose.model('User', UserSchema);

const InventorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    creatureId: { type: String, required: true },
    count: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now }
});
InventorySchema.index({ telegramId: 1, creatureId: 1 }, { unique: true });
const Inventory = mongoose.model('Inventory', InventorySchema);

const MarketplaceSchema = new mongoose.Schema({
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerTgId: { type: String, required: true },
    sellerName: { type: String, default: '' },
    creatureId: { type: String, required: true },
    price: { type: Number, required: true, min: MIN_MARKETPLACE_PRICE },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const Marketplace = mongoose.model('Marketplace', MarketplaceSchema);

// ============================================
// ФУНКЦИИ УВЕДОМЛЕНИЙ
// ============================================
async function sendNotificationToUser(telegramId, message) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN || !telegramId) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        console.log(`✅ Уведомление отправлено пользователю ${telegramId}`);
    } catch (e) {
        console.error('Failed to send user notification:', e);
    }
}

async function notifyAdmins(message, replyMarkup = null) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    
    if (!BOT_TOKEN || ADMIN_IDS.length === 0) return;
    
    for (const adminId of ADMIN_IDS) {
        try {
            const body = {
                chat_id: adminId,
                text: message,
                parse_mode: 'HTML'
            };
            if (replyMarkup) {
                body.reply_markup = replyMarkup;
            }
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            console.log(`✅ Уведомление отправлено админу ${adminId}`);
        } catch (e) {
            console.error('Failed to send admin notification:', e);
        }
    }
}

async function sendBroadcastAsync(broadcastId, users, testMode) {
    const broadcast = await Broadcast.findById(broadcastId);
    if (!broadcast) return;
    
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) {
        console.error('❌ BOT_TOKEN не задан');
        broadcast.status = 'cancelled';
        await broadcast.save();
        return;
    }
    
    let sent = 0;
    let failed = 0;
    
    console.log(`📢 Начинаем рассылку #${broadcastId} для ${users.length} пользователей`);
    
    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        
        try {
            let replyMarkup = null;
            if (broadcast.buttons && broadcast.buttons.length > 0) {
                const inlineKeyboard = [];
                for (const btn of broadcast.buttons) {
                    inlineKeyboard.push([{ text: btn.text, url: btn.url }]);
                }
                replyMarkup = { inline_keyboard: inlineKeyboard };
            }
            
            if (broadcast.imageUrl) {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user.telegramId,
                        photo: broadcast.imageUrl,
                        caption: broadcast.message,
                        parse_mode: broadcast.parseMode,
                        reply_markup: replyMarkup,
                        disable_web_page_preview: true
                    })
                });
            } else {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user.telegramId,
                        text: broadcast.message,
                        parse_mode: broadcast.parseMode,
                        reply_markup: replyMarkup,
                        disable_web_page_preview: true
                    })
                });
            }
            
            sent++;
            
            if (sent % 100 === 0) {
                console.log(`📢 Рассылка #${broadcastId}: отправлено ${sent}/${users.length}`);
                broadcast.sentCount = sent;
                broadcast.failedCount = failed;
                await broadcast.save();
            }
            
        } catch (e) {
            failed++;
            console.error(`❌ Ошибка отправки пользователю ${user.telegramId}:`, e.message);
        }
        
        await new Promise(r => setTimeout(r, 30));
    }
    
    broadcast.sentCount = sent;
    broadcast.failedCount = failed;
    broadcast.status = 'completed';
    broadcast.completedAt = new Date();
    await broadcast.save();
    
    console.log(`✅ Рассылка #${broadcastId} завершена! Отправлено: ${sent}, Ошибок: ${failed}`);
    
    await notifyAdmins(`📢 <b>Рассылка завершена!</b>\n\n` +
        `📝 ID: #${broadcastId.toString().slice(-8)}\n` +
        `✅ Отправлено: ${sent}\n` +
        `❌ Ошибок: ${failed}\n` +
        `👥 Всего: ${users.length}\n` +
        `🕐 ${new Date().toLocaleString()}`);
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ С КЭШИРОВАНИЕМ
// ============================================

function escapeRegex(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let creaturesCache = null;

async function formatInventory(telegramId) {
    const inventory = await Inventory.find({ telegramId }).lean();
    
    if (inventory.length === 0) {
        return [];
    }
    
    let creatures = creaturesCache;
    if (!creatures || creatures.length === 0) {
        creatures = await Creature.find({ isActive: true }).lean();
        creaturesCache = creatures;
    }
    
    const creatureMap = new Map();
    for (const c of creatures) {
        creatureMap.set(c.id, c);
    }
    
    const result = inventory.map(item => {
        const creature = creatureMap.get(item.creatureId);
        return { 
            ...item, 
            incomeBase: creature?.incomeBase || 1,
            name: creature?.name || item.creatureId,
            icon: creature?.icon || '🧬'
        };
    });
        
    inventoryCache.set(telegramId, { data: result, expiresAt: Date.now() + INVENTORY_CACHE_TTL });
    return result;
}

function invalidateInventoryCache(telegramId) {
    inventoryCache.delete(telegramId);
    userIncomeCache.delete(telegramId);
}

async function getUserIncome(telegramId) {
    const cached = userIncomeCache.get(telegramId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.income;
    }
    
    const inventory = await Inventory.find({ telegramId }).lean();
    if (inventory.length === 0) return 0;
    
    let creatures = creaturesCache;
    if (!creatures) {
        creatures = await Creature.find({ isActive: true }).lean();
        creaturesCache = creatures;
    }
    
    const creatureMap = new Map();
    for (const c of creatures) {
        creatureMap.set(c.id, c);
    }
    
    let income = 0;
    for (const item of inventory) {
        const creature = creatureMap.get(item.creatureId);
        if (creature) {
            income += creature.incomeBase * item.count;
        }
    }
    
    userIncomeCache.set(telegramId, { income, expiresAt: Date.now() + INCOME_CACHE_TTL });
    return income;
}

function addTransaction(user, name, amount) {
    user.transactions.unshift({ name, amount, time: new Date() });
    if (user.transactions.length > 30) user.transactions = user.transactions.slice(0, 30);
}

function addXP(user, amount) {
    user.xp += amount;
    const needed = user.level * 100;
    if (user.xp >= needed) {
        user.xp -= needed;
        user.level += 1;
    }
}

function formatUser(user) {
    const totalReferralBonus = user.totalReferralBonus || 0;
    return {
        id: user._id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        balance: user.balance,
        xp: user.xp,
        level: user.level,
        mergeCount: user.mergeCount,
        capsulesOpened: user.capsulesOpened,
        inventorySlots: user.inventorySlots,
        inventoryUpgrades: user.inventoryUpgrades,
        discovered: user.discovered || [],
        completedSpecialQuests: user.completedSpecialQuests || [],
        transactions: (user.transactions || []).slice(0, 20),
        adsAvailable: user.adsAvailable,
        adsCooldownUntil: user.adsCooldownUntil,
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        totalReferralBonus: totalReferralBonus,
        isBanned: user.isBanned,
        banReason: user.banReason,
        lastLogin: user.lastLogin,
        lastPassiveIncome: user.lastPassiveIncome,
        createdAt: user.createdAt
    };
}

// ============================================
// ПАССИВНЫЙ ДОХОД
// ============================================
const incomeLocks = new Map();

async function calculateAndAddIncome(user, forceCheck = false) {
    const telegramId = user.telegramId;

    if (incomeLocks.get(telegramId)) {
        return { earned: 0, elapsedSeconds: 0 };
    }
    incomeLocks.set(telegramId, true);

    try {
        const freshUser = await User.findOne({ telegramId }).select('lastPassiveIncome balance transactions');
        if (!freshUser) return { earned: 0, elapsedSeconds: 0 };

        const now = Date.now();
        const lastIncome = new Date(freshUser.lastPassiveIncome).getTime();
        let elapsedSeconds = (now - lastIncome) / 1000;
        if (elapsedSeconds < 0) elapsedSeconds = 0;

        if (!forceCheck && elapsedSeconds < 60) {
            return { earned: 0, elapsedSeconds: 0 };
        }

        const MAX_SECONDS = MAX_OFFLINE_HOURS * 3600;
        const cappedSeconds = Math.min(elapsedSeconds, MAX_SECONDS);

        const inventory = await Inventory.find({ telegramId }).lean();
        
        let creatures = creaturesCache;
        if (!creatures) {
            creatures = await Creature.find({ isActive: true }).lean();
            creaturesCache = creatures;
        }
        
        const creatureMap = new Map();
        for (const c of creatures) {
            creatureMap.set(c.id, c);
        }
        
        let incomePerHour = 0;
        for (const item of inventory) {
            const creature = creatureMap.get(item.creatureId);
            if (creature) incomePerHour += creature.incomeBase * item.count;
        }

        const earned = Math.floor((incomePerHour / 3600) * cappedSeconds * 100) / 100;
        if (earned < 0.01) {
            return { earned: 0, elapsedSeconds: 0, incomePerHour };
        }

        const newLastPassiveIncome = new Date(now);
        const newTx = { name: 'Passive Income', amount: earned, time: new Date() };

        const updated = await User.findOneAndUpdate(
            {
                telegramId,
                lastPassiveIncome: freshUser.lastPassiveIncome
            },
            {
                $inc: { balance: earned },
                $set: { lastPassiveIncome: newLastPassiveIncome },
                $push: {
                    transactions: {
                        $each: [newTx],
                        $position: 0,
                        $slice: 30
                    }
                }
            },
            { new: true }
        );

        if (!updated) {
            return { earned: 0, elapsedSeconds: 0, incomePerHour };
        }

        user.balance = updated.balance;
        user.lastPassiveIncome = updated.lastPassiveIncome;
        user.transactions = updated.transactions;

        return { earned, elapsedSeconds: cappedSeconds, incomePerHour };
    } finally {
        incomeLocks.delete(telegramId);
    }
}

// ============================================
// КЭШИРОВАНИЕ КОНФИГА
// ============================================
async function getGameConfig() {
    const now = Date.now();
    if (cachedConfig && now - configCacheTime < CONFIG_CACHE_TTL) {
        return cachedConfig;
    }
    
    let config = await GameConfig.findOne();
    if (!config) {
        config = await GameConfig.create({
            capsuleCosts: { basic: 1000, premium: 6000 },
            capsuleRarities: {
                basic: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
                premium: { common: 70, uncommon: 20, rare: 10, epic: 0, legendary: 0 }
            },
            adReward: 50,
            adCooldown: 60,
            upgradeBaseCost: 300,
            upgradeMultiplier: 1.4,
            specialQuests: [],
            limits: {
                maxInventorySlots: 50,
                maxMarketplacePrice: 100000,
                maxLevel: 100
            }
        });
        console.log('✅ Созданы настройки игры по умолчанию');
    }
    
    cachedConfig = config;
    configCacheTime = now;
    return config;
}

async function invalidateConfigCache() {
    cachedConfig = null;
    configCacheTime = 0;
    leaderboardCache = { data: null, expiresAt: 0 };
    marketplaceListingsCache = { data: null, expiresAt: 0 };
    creaturesCache = null;
    inventoryCache.clear();
    userIncomeCache.clear();
    console.log('🔄 Кэш конфига сброшен');
}

// ============================================
// ФУНКЦИИ ДЛЯ СУЩЕСТВ
// ============================================

async function getCreature(id) {
    if (creaturesCache) {
        return creaturesCache.find(c => c.id === id) || null;
    }
    const creature = await Creature.findOne({ id });
    return creature;
}

async function loadCreaturesToCache() {
    creaturesCache = await Creature.find({ isActive: true }).lean();
}

async function randomCreatureByRarity(rarity) {
    const pool = creaturesCache ? creaturesCache.filter(c => c.rarity === rarity && c.isActive) : await Creature.find({ rarity, isActive: true });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================
// ОЧИСТКА СТАРЫХ ЗАПИСЕЙ
// ============================================
const lastOpenTimes = new Map();
const lastMergeTimes = new Map();

function cleanupOldRecords() {
    const now = Date.now();
    
    for (const [id, time] of lastOpenTimes) {
        if (now - time > RECORD_TTL) {
            lastOpenTimes.delete(id);
        }
    }
    
    for (const [id, time] of lastMergeTimes) {
        if (now - time > RECORD_TTL) {
            lastMergeTimes.delete(id);
        }
    }
}

setInterval(cleanupOldRecords, CLEANUP_INTERVAL);

// ============================================
// MIDDLEWARE (ОСНОВНОЙ API)
// ============================================
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ success: false, message: 'Пользователь не найден' });
        if (user.isBanned) {
            return res.status(403).json({ success: false, message: `Ваш аккаунт заблокирован. Причина: ${user.banReason || 'Нарушение правил'}` });
        }
        req.user = user;
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: 'Невалидный токен' });
    }
};

// ============================================
// API ENDPOINTS
// ============================================

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
    res.json({ success: true, message: '🚀 DNA MMO Backend работает!', version: '5.0.8' });
});

// Public endpoints
app.get('/api/game/config', async (req, res) => {
    try {
        const config = await getGameConfig();
        res.json({
            success: true,
            config: {
                capsuleCosts: config.capsuleCosts,
                capsuleRarities: config.capsuleRarities,
                adReward: config.adReward,
                adCooldown: config.adCooldown,
                upgradeBaseCost: config.upgradeBaseCost,
                upgradeMultiplier: config.upgradeMultiplier,
                limits: config.limits,
                specialQuests: config.specialQuests.filter(q => q.isActive),
                marketplace: {
                    minPrice: MIN_MARKETPLACE_PRICE,
                    maxActiveListings: MAX_ACTIVE_LISTINGS
                }
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/creatures', async (req, res) => {
    try {
        const creatures = await Creature.find({ isActive: true }).sort({ rarity: 1, name: 1 });
        res.json({ success: true, creatures });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// User stats
app.get('/api/user/stats', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const adsWatched = user.transactions.filter(tx => tx.name === 'Watch Ad Reward').length;
        const adsEarned = user.transactions
            .filter(tx => tx.name === 'Watch Ad Reward')
            .reduce((sum, tx) => sum + tx.amount, 0);
        
        const totalWithdrawn = user.transactions
            .filter(tx => tx.name && (tx.name.includes('Withdraw') || tx.name.includes('Вывод')) && tx.amount < 0)
            .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
        
        const referralEarned = user.totalReferralBonus || 0;
        
        res.json({
            success: true,
            stats: {
                adsWatched,
                adsEarned,
                totalWithdrawn,
                referralEarned
            }
        });
    } catch (e) {
        console.error('user stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Arena Stats
app.get('/api/arena/stats', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const stats = user.pvpStats || {
            rating: 500,
            wins: 0,
            losses: 0,
            draws: 0,
            league: 'BRONZE',
            tokens: 3
        };
        
        const lastReset = stats.lastReset ? new Date(stats.lastReset) : new Date();
        const now = new Date();
        if (now.toDateString() !== lastReset.toDateString()) {
            stats.tokens = 3;
            stats.lastReset = now;
            user.pvpStats = stats;
            await user.save();
        }
        
        res.json({ success: true, stats });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Battle History
app.get('/api/arena/history', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const history = user.battleHistory || [];
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Buy Arena Tokens
app.post('/api/arena/buy-tokens', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        const cost = amount * 500;
        
        if (req.user.balance < cost) {
            return res.status(400).json({ success: false, message: 'Not enough MMO' });
        }
        
        req.user.balance -= cost;
        if (!req.user.pvpStats) req.user.pvpStats = { tokens: 0, rating: 500, wins: 0, losses: 0, draws: 0, league: 'BRONZE', lastReset: new Date() };
        req.user.pvpStats.tokens += amount;
        await req.user.save();
        
        res.json({ success: true, tokens: req.user.pvpStats.tokens, balance: req.user.balance });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// AUTH
const verifyTelegramData = (initData, botToken) => {
    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        if (!hash) return null;
        urlParams.delete('hash');
        const params = [];
        urlParams.forEach((value, key) => params.push(`${key}=${value}`));
        params.sort();
        const dataCheckString = params.join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (calculatedHash !== hash) return null;
        const userStr = urlParams.get('user');
        if (!userStr) return null;
        return JSON.parse(decodeURIComponent(userStr));
    } catch (e) {
        console.error('Telegram auth error:', e);
        return null;
    }
};

app.post('/api/auth/login', async (req, res) => {
    try {
        const { initData, referralCode } = req.body;
        
        if (!initData) {
            return res.status(400).json({ success: false, message: 'initData обязателен' });
        }

        let userData = verifyTelegramData(initData, process.env.BOT_TOKEN);

        if (!userData && process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH === 'true') {
            try {
                const urlParams = new URLSearchParams(initData);
                const userStr = urlParams.get('user');
                if (userStr) userData = JSON.parse(decodeURIComponent(userStr));
                if (!userData) userData = JSON.parse(initData);
                console.warn('⚠️ DEV MODE: Используется мок-авторизация');
            } catch (e) {}
        }

        if (!userData) {
            return res.status(401).json({ success: false, message: 'Невалидные данные Telegram' });
        }

        let user = await User.findOne({ telegramId: String(userData.id) });
        const isNewUser = !user;

        if (!user) {
            user = new User({
                telegramId: String(userData.id),
                username: userData.username || '',
                firstName: userData.first_name || '',
                lastName: userData.last_name || '',
                photoUrl: userData.photo_url || '',
                balance: 4000,
                adsAvailable: MAX_ADS_AVAILABLE,
                adsLastRegen: new Date(),
                pvpStats: {
                    rating: 500,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    league: 'BRONZE',
                    tokens: 3,
                    lastReset: new Date()
                }
            });

            let referrerInfo = null;
            if (referralCode) {
                const referrer = await User.findOne({ referralCode });
                if (referrer && referrer.telegramId !== String(userData.id)) {
                    user.referredBy = referrer.telegramId;
                    referrer.referralCount += 1;
                    await referrer.save();
                    referrerInfo = referrer;
                    console.log(`✅ Реферал: ${userData.username || userData.first_name} приглашен ${referrer.username || referrer.firstName}`);
                }
            }
            await user.save();
            
            const inviterName = referrerInfo 
                ? (referrerInfo.username || referrerInfo.firstName || referrerInfo.telegramId)
                : (referralCode ? 'неизвестный код' : 'самостоятельно');
            
            const notificationMessage = `🆕 <b>НОВЫЙ ИГРОК!</b>\n\n` +
                `👤 ID: <code>${userData.id}</code>\n` +
                `📛 Имя: ${userData.first_name || '?'} ${userData.last_name || ''}\n` +
                `🔗 Username: ${userData.username ? '@' + userData.username : 'нет'}\n` +
                `🎁 Пригласил: ${inviterName}\n` +
                `💰 Баланс: ${user.balance} MMO\n` +
                `🕐 Время: ${new Date().toLocaleString()}`;
            
            await notifyAdmins(notificationMessage);
            
        } else {
            user.username = userData.username || user.username;
            user.firstName = userData.first_name || user.firstName;
            user.lastName = userData.last_name || user.lastName;
            user.lastLogin = new Date();
            await user.save();
        }

        const token = jwt.sign(
            { userId: user._id, telegramId: user.telegramId },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        const inventoryWithIncome = await formatInventory(user.telegramId);

        res.json({ 
            success: true, 
            token, 
            isNewUser, 
            user: formatUser(user), 
            inventory: inventoryWithIncome 
        });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// User Profile
app.get('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const incomeResult = await calculateAndAddIncome(user, false);
        const incomePerHour = incomeResult.incomePerHour ?? await getUserIncome(user.telegramId);
        const freshUser = await User.findOne({ telegramId: user.telegramId });
        const inventoryWithIncome = await formatInventory(user.telegramId);

        res.json({
            success: true,
            user: formatUser(freshUser),
            inventory: inventoryWithIncome,
            offlineEarned: incomeResult.earned || 0,
            incomePerHour: Math.floor(incomePerHour * 100) / 100,
            lastPassiveIncome: freshUser.lastPassiveIncome
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Collect Income
app.post('/api/game/collect-income', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const incomeResult = await calculateAndAddIncome(user, true);
        const freshUser = await User.findOne({ telegramId: user.telegramId })
            .select('balance lastPassiveIncome transactions');
        const incomePerHour = incomeResult.incomePerHour ?? await getUserIncome(user.telegramId);

        res.json({
            success: true,
            earned: incomeResult.earned || 0,
            balance: freshUser.balance,
            incomePerHour: Math.floor(incomePerHour * 100) / 100,
            lastPassiveIncome: freshUser.lastPassiveIncome
        });
    } catch (e) {
        console.error('collect-income error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Referrals
app.get('/api/user/referrals', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const allReferrals = await User.find({ referredBy: user.telegramId })
            .select('username firstName balance level createdAt')
            .lean();
        
        const qualifiedReferrals = allReferrals.filter(r => r.level >= 5);
        const qualifiedCount = qualifiedReferrals.length;
        
        if (user.referralCount !== qualifiedCount) {
            user.referralCount = qualifiedCount;
            await user.save();
        }

        res.json({
            success: true,
            referralCode: user.referralCode,
            referralLink: `https://t.me/${process.env.BOT_USERNAME}?start=${user.referralCode}`,
            referralCount: qualifiedCount,
            referrals: allReferrals.map(r => ({
                username: r.username || r.firstName || 'Аноним',
                balance: r.balance,
                level: r.level,
                isQualified: r.level >= 5,
                joinedAt: r.createdAt
            }))
        });
    } catch (e) {
        console.error('referrals error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

async function getQualifiedReferralsCount(telegramId) {
    const qualifiedUsers = await User.find({ 
        referredBy: telegramId,
        level: { $gte: 5 }
    }).select('_id');
    return qualifiedUsers.length;
}

// Claim Friend Reward
app.post('/api/game/claim-friend-reward', authMiddleware, async (req, res) => {
    try {
        const { requiredFriends, creatureId } = req.body;
        const user = req.user;
        
        const qualifiedCount = await getQualifiedReferralsCount(user.telegramId);
        
        if (qualifiedCount < requiredFriends) {
            return res.status(400).json({ 
                success: false, 
                message: `Нужно ${requiredFriends} друзей 5+ уровня (у вас ${qualifiedCount})` 
            });
        }
        
        const rewardKey = `friend_reward_${requiredFriends}`;
        if (user.completedSpecialQuests?.includes(rewardKey)) {
            return res.status(400).json({ success: false, message: 'Награда уже получена' });
        }
        
        const creature = await getCreature(creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });
        
        const inventory = await Inventory.find({ telegramId: user.telegramId });
        const usedSlots = inventory.reduce((sum, i) => sum + i.count, 0);
        if (usedSlots >= user.inventorySlots) {
            return res.status(400).json({ success: false, message: 'Инвентарь полон' });
        }
        
        let invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId });
        if (invItem) {
            invItem.count += 1;
            await invItem.save();
        } else {
            await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId, count: 1 });
        }
        
        if (!user.discovered.includes(creatureId)) user.discovered.push(creatureId);
        if (!user.completedSpecialQuests) user.completedSpecialQuests = [];
        user.completedSpecialQuests.push(rewardKey);
        await user.save();
        
        const updatedInventory = await formatInventory(user.telegramId);
        const incomePerHour = await getUserIncome(user.telegramId);
        
        res.json({ 
            success: true, 
            creatureName: creature.name, 
            creatureIcon: creature.icon, 
            user: formatUser(user), 
            inventory: updatedInventory, 
            incomePerHour: Math.floor(incomePerHour * 100) / 100 
        });
    } catch (e) {
        console.error('claim-friend-reward error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Open Capsule
app.post('/api/game/open-capsule', authMiddleware, async (req, res) => {
    try {
        const { type } = req.body;
        const user = req.user;
        
        const config = await getGameConfig();
        
        const lastOpen = lastOpenTimes.get(user.telegramId) || 0;
        if (Date.now() - lastOpen < 2000) {
            return res.status(429).json({ success: false, message: 'Слишком часто! Подождите 2 секунды.' });
        }
        lastOpenTimes.set(user.telegramId, Date.now());

        if (!['basic', 'premium'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Неверный тип капсулы' });
        }

        const cost = config.capsuleCosts[type];

        const inventoryBefore = await Inventory.find({ telegramId: user.telegramId });
        const usedSlots = inventoryBefore.reduce((sum, i) => sum + i.count, 0);
        if (usedSlots >= user.inventorySlots) {
            return res.status(400).json({ success: false, message: 'Инвентарь полон' });
        }

        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: cost } },
            {
                $inc: { balance: -cost, capsulesOpened: 1 },
                $push: {
                    transactions: {
                        $each: [{ name: `${type === 'premium' ? 'Premium' : 'DNA'} Capsule`, amount: -cost, time: new Date() }],
                        $position: 0, $slice: 30
                    }
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Недостаточно MMO' });
        }

        addXP(updatedUser, 10);

        const weights = config.capsuleRarities[type];
        const roll = Math.random() * 100;
        let cum = 0;
        let rarity = 'common';
        for (const [r, chance] of Object.entries(weights)) {
            cum += chance;
            if (roll < cum) { rarity = r; break; }
        }

        const creature = await randomCreatureByRarity(rarity);
        if (!creature) {
            await User.findByIdAndUpdate(user._id, { $inc: { balance: cost, capsulesOpened: -1 } });
            return res.status(500).json({ success: false, message: 'Ошибка: существо не найдено' });
        }

        let invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId: creature.id });
        if (invItem) {
            invItem.count += 1;
            await invItem.save();
        } else {
            invItem = await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId: creature.id, count: 1 });
        }

        if (!updatedUser.discovered.includes(creature.id)) {
            updatedUser.discovered.push(creature.id);
        }

        await updatedUser.save();
        
        invalidateInventoryCache(user.telegramId);
        
        const updatedInventory = await formatInventory(user.telegramId);
        const incomePerHour = await getUserIncome(user.telegramId);

        res.json({
            success: true,
            creature: { id: creature.id, name: creature.name, rarity: creature.rarity, icon: creature.icon, incomeBase: creature.incomeBase, desc: creature.desc },
            user: formatUser(updatedUser),
            inventory: updatedInventory,
            incomePerHour: Math.floor(incomePerHour * 100) / 100
        });
    } catch (e) {
        console.error('open-capsule error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Merge
app.post('/api/game/merge', authMiddleware, async (req, res) => {
    try {
        const { creatureId } = req.body;
        const user = req.user;
        
        const lastMerge = lastMergeTimes.get(user.telegramId) || 0;
        if (Date.now() - lastMerge < 1000) {
            return res.status(429).json({ success: false, message: 'Слишком часто! Подождите.' });
        }
        lastMergeTimes.set(user.telegramId, Date.now());

        const creature = await getCreature(creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });

        if (creature.rarity === 'legendary' || creature.rarity === 'mythic') {
            return res.status(400).json({ success: false, message: 'Это существо нельзя слить' });
        }

        const inventoryBefore = await Inventory.find({ telegramId: user.telegramId });
        const usedSlots = inventoryBefore.reduce((sum, i) => sum + i.count, 0);
        
        const invItemCheck = inventoryBefore.find(i => i.creatureId === creatureId);
        if (!invItemCheck || invItemCheck.count < 3) {
            return res.status(400).json({ success: false, message: 'Нужно 3 одинаковых существа' });
        }
        
        if (usedSlots - 2 > user.inventorySlots) {
            return res.status(400).json({ success: false, message: 'Инвентарь полон' });
        }

        const invItem = await Inventory.findOneAndUpdate(
            { telegramId: user.telegramId, creatureId, count: { $gte: 3 } },
            { $inc: { count: -3 } },
            { new: true }
        );

        if (!invItem) {
            return res.status(400).json({ success: false, message: 'Нужно 3 одинаковых существа' });
        }

        if (invItem.count === 0) {
            await Inventory.deleteOne({ _id: invItem._id });
        }

        const currentRarityIdx = RARITY_ORDER.indexOf(creature.rarity);
        const success = Math.random() < 0.3;

        let resultCreature;
        if (success && currentRarityIdx < RARITY_ORDER.length - 2) {
            const nextRarity = RARITY_ORDER[currentRarityIdx + 1];
            resultCreature = await Creature.findOne({ name: creature.name, rarity: nextRarity });
            if (!resultCreature) resultCreature = creature;
        } else {
            resultCreature = creature;
        }

        let resultItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId: resultCreature.id });
        if (resultItem) {
            resultItem.count += 1;
            await resultItem.save();
        } else {
            await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId: resultCreature.id, count: 1 });
        }

        if (!user.discovered.includes(resultCreature.id)) {
            user.discovered.push(resultCreature.id);
        }

        user.mergeCount += 1;
        addXP(user, 20);
        addTransaction(user, `Merge → ${resultCreature.name} (${resultCreature.rarity})`, 0);
        await user.save();

        invalidateInventoryCache(user.telegramId);
        
        const updatedInventory = await formatInventory(user.telegramId);
        const incomePerHour = await getUserIncome(user.telegramId);

        res.json({
            success: true,
            upgraded: success,
            fromCreature: { id: creature.id, name: creature.name, rarity: creature.rarity, icon: creature.icon, incomeBase: creature.incomeBase },
            resultCreature: { id: resultCreature.id, name: resultCreature.name, rarity: resultCreature.rarity, icon: resultCreature.icon, incomeBase: resultCreature.incomeBase },
            user: formatUser(user),
            inventory: updatedInventory,
            incomePerHour: Math.floor(incomePerHour * 100) / 100
        });
    } catch (e) {
        console.error('merge error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Upgrade Inventory
app.post('/api/game/upgrade-inventory', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const config = await getGameConfig();
        const limits = config.limits;
        
        if (user.inventorySlots >= limits.maxInventorySlots) {
            return res.status(400).json({ success: false, message: 'Максимум слотов достигнут' });
        }
        
        const cost = Math.floor(config.upgradeBaseCost * Math.pow(config.upgradeMultiplier, user.inventoryUpgrades));

        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: cost } },
            {
                $inc: { balance: -cost, inventorySlots: 1, inventoryUpgrades: 1 },
                $push: {
                    transactions: {
                        $each: [{ name: 'Inventory Upgrade', amount: -cost, time: new Date() }],
                        $position: 0, $slice: 30
                    }
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Недостаточно MMO', required: cost });
        }

        addXP(updatedUser, 25);
        await updatedUser.save();
        
        invalidateInventoryCache(user.telegramId);

        res.json({ success: true, user: formatUser(updatedUser) });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Watch Ad
app.post('/api/game/watch-ad', authMiddleware, async (req, res) => {
    const userId = req.user.telegramId;
    if (adLocks.get(userId)) {
        return res.status(429).json({ success: false, message: 'Подождите, запрос обрабатывается' });
    }
    adLocks.set(userId, true);
    
    try {
        const user = req.user;
        const config = await getGameConfig();
        const now = new Date();
        
        await regenerateAds(user);
        
        const freshUser = await User.findById(user._id);
        
        if (freshUser.adsAvailable <= 0) {
            const lastRegen = new Date(freshUser.adsLastRegen || freshUser.createdAt).getTime();
            const nextRegenIn = ADS_REGEN_INTERVAL - (now.getTime() - lastRegen);
            const nextRegenMinutes = Math.ceil(nextRegenIn / 60000);
            
            adLocks.delete(userId);
            return res.status(400).json({ 
                success: false, 
                message: `Нет доступной рекламы. Следующая через ${nextRegenMinutes} мин.`,
                adsAvailable: 0,
                nextRegenMinutes: nextRegenMinutes
            });
        }
        
        const cooldownUntil = freshUser.adsCooldownUntil ? new Date(freshUser.adsCooldownUntil) : null;
        if (cooldownUntil && cooldownUntil > now) {
            const secondsLeft = Math.ceil((cooldownUntil - now) / 1000);
            adLocks.delete(userId);
            return res.status(400).json({ 
                success: false, 
                message: `Реклама ещё не доступна. Подождите ${secondsLeft}с.`,
                secondsLeft: secondsLeft
            });
        }
        
        const reward = config.adReward;
        const newCooldown = new Date(now.getTime() + config.adCooldown * 1000);
        
        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, adsAvailable: { $gt: 0 } },
            {
                $inc: { 
                    balance: reward,
                    adsAvailable: -1
                },
                $set: { 
                    adsCooldownUntil: newCooldown
                },
                $push: {
                    transactions: {
                        $each: [{ name: 'Watch Ad Reward', amount: reward, time: new Date() }],
                        $position: 0,
                        $slice: 30
                    }
                }
            },
            { new: true }
        );
        
        if (!updatedUser) {
            adLocks.delete(userId);
            return res.status(400).json({ 
                success: false, 
                message: 'Не удалось получить награду. Попробуйте ещё раз.'
            });
        }
        
        addXP(updatedUser, 15);
        await updatedUser.save();
        
        const lastRegen = new Date(updatedUser.adsLastRegen || updatedUser.createdAt).getTime();
        const nextRegenIn = ADS_REGEN_INTERVAL - (now.getTime() - lastRegen);
        const nextRegenMinutes = Math.ceil(nextRegenIn / 60000);
        
        adLocks.delete(userId);
        
        res.json({ 
            success: true,
            reward: reward,
            cooldownSeconds: config.adCooldown,
            adsAvailable: updatedUser.adsAvailable,
            maxAdsPerDay: MAX_ADS_AVAILABLE,
            nextRegenMinutes: nextRegenMinutes,
            user: formatUser(updatedUser)
        });
    } catch (e) {
        console.error('watch-ad error:', e);
        adLocks.delete(userId);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Ads Status
app.get('/api/game/ads-status', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        await regenerateAds(user);
        
        const freshUser = await User.findById(user._id).select('adsAvailable adsLastRegen adsCooldownUntil');
        
        const now = new Date();
        const cooldownSeconds = freshUser.adsCooldownUntil 
            ? Math.max(0, Math.ceil((new Date(freshUser.adsCooldownUntil) - now) / 1000))
            : 0;
        
        const lastRegen = new Date(freshUser.adsLastRegen || user.createdAt).getTime();
        const nextRegenIn = Math.max(0, ADS_REGEN_INTERVAL - (now.getTime() - lastRegen));
        const nextRegenMinutes = Math.ceil(nextRegenIn / 60000);
        
        res.json({
            success: true,
            adsAvailable: freshUser.adsAvailable,
            maxAdsPerDay: MAX_ADS_AVAILABLE,
            cooldownSeconds: cooldownSeconds,
            nextRegenMinutes: nextRegenMinutes,
            willRegenAt: new Date(lastRegen + ADS_REGEN_INTERVAL).toISOString()
        });
    } catch (e) {
        console.error('ads-status error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Special Quest Complete
app.post('/api/game/complete-special-quest', authMiddleware, async (req, res) => {
    try {
        const { questId } = req.body;
        const user = req.user;
        
        const config = await getGameConfig();
        
        if (user.completedSpecialQuests.includes(questId)) {
            return res.status(400).json({ success: false, message: 'Вы уже получили награду за этот квест' });
        }
        
        const quest = config.specialQuests.find(q => q.id === questId && q.isActive);
        if (!quest) {
            return res.status(404).json({ success: false, message: 'Квест не найден или отключён' });
        }
        
        if (quest.type === 'referral_count') {
            if (user.referralCount < quest.required_count) {
                return res.status(400).json({ success: false, message: `Нужно ${quest.required_count} друзей (у вас ${user.referralCount})` });
            }
        }
        
        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, completedSpecialQuests: { $ne: questId } },
            {
                $inc: { balance: quest.reward },
                $push: {
                    completedSpecialQuests: questId,
                    transactions: {
                        $each: [{ name: `Special Quest: ${quest.title}`, amount: quest.reward, time: new Date() }],
                        $position: 0, $slice: 30
                    }
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Вы уже получили награду за этот квест' });
        }

        addXP(updatedUser, 20);
        await updatedUser.save();
        
        res.json({ success: true, reward: quest.reward, message: `Выполнено! +${quest.reward} MMO`, user: formatUser(updatedUser) });
    } catch (e) {
        console.error('complete-special-quest error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Marketplace endpoints (simplified)
app.get('/api/marketplace/listings', async (req, res) => {
    try {
        if (Date.now() < marketplaceListingsCache.expiresAt && marketplaceListingsCache.data) {
            return res.json({ success: true, listings: marketplaceListingsCache.data });
        }
        
        const listings = await Marketplace.find({ active: true })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
            
        marketplaceListingsCache = {
            data: listings,
            expiresAt: Date.now() + 60 * 1000
        };
        
        res.json({ success: true, listings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/api/marketplace/my-listings', authMiddleware, async (req, res) => {
    try {
        const listings = await Marketplace.find({
            sellerTgId: req.user.telegramId,
            active: true
        }).sort({ createdAt: -1 }).lean();

        res.json({ success: true, listings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/marketplace/list', authMiddleware, async (req, res) => {
    try {
        const { creatureId, price } = req.body;
        const user = req.user;
        
        const config = await getGameConfig();
        const limits = config.limits;

        const creature = await getCreature(creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });
        
        if (creature.rarity === 'common' && price > MAX_COMMON_PRICE) {
            return res.status(400).json({ 
                success: false, 
                message: `Common существ нельзя продавать дороже ${MAX_COMMON_PRICE} MMO` 
            });
        }

        if (!price || price < MIN_MARKETPLACE_PRICE) {
            return res.status(400).json({ success: false, message: `Минимальная цена ${MIN_MARKETPLACE_PRICE} MMO` });
        }
        
        if (price > limits.maxMarketplacePrice) {
            return res.status(400).json({ success: false, message: `Максимальная цена ${limits.maxMarketplacePrice} MMO` });
        }

        const activeListingsCount = await Marketplace.countDocuments({
            sellerTgId: user.telegramId,
            active: true
        });
        
        if (activeListingsCount >= MAX_ACTIVE_LISTINGS) {
            return res.status(400).json({ 
                success: false, 
                message: `Вы уже выставили ${MAX_ACTIVE_LISTINGS} лотов. Сначала отмените или дождитесь продажи существующих.` 
            });
        }

        const invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId });
        if (!invItem || invItem.count < 1) {
            return res.status(400).json({ success: false, message: 'Существо не найдено в инвентаре' });
        }

        invItem.count -= 1;
        if (invItem.count <= 0) {
            await Inventory.deleteOne({ _id: invItem._id });
        } else {
            await invItem.save();
        }

        const listing = await Marketplace.create({
            sellerId: user._id,
            sellerTgId: user.telegramId,
            sellerName: user.username || user.firstName || `User${user.telegramId.slice(-4)}`,
            creatureId,
            price,
            active: true
        });
        
        marketplaceListingsCache = { data: null, expiresAt: 0 };
        
        invalidateInventoryCache(user.telegramId);
        
        const updatedInventory = await formatInventory(user.telegramId);

        res.json({ success: true, listing, inventory: updatedInventory });
    } catch (e) {
        console.error('marketplace list error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/marketplace/buy', authMiddleware, async (req, res) => {
    try {
        const { listingId } = req.body;
        const buyer = req.user;

        const listing = await Marketplace.findById(listingId);
        if (!listing || !listing.active) {
            return res.status(400).json({ success: false, message: 'Лот не найден или уже продан' });
        }

        if (listing.sellerTgId === buyer.telegramId) {
            return res.status(400).json({ success: false, message: 'Нельзя купить свой лот' });
        }

        const buyerInventory = await Inventory.find({ telegramId: buyer.telegramId });
        const usedSlots = buyerInventory.reduce((sum, i) => sum + i.count, 0);
        if (usedSlots >= buyer.inventorySlots) {
            return res.status(400).json({ success: false, message: 'Инвентарь покупателя полон' });
        }

        const creature = await getCreature(listing.creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });

        const closedListing = await Marketplace.findOneAndUpdate(
            { _id: listingId, active: true },
            { $set: { active: false } },
            { new: true }
        );

        if (!closedListing) {
            return res.status(400).json({ success: false, message: 'Лот уже куплен другим игроком' });
        }

        const updatedBuyer = await User.findOneAndUpdate(
            { _id: buyer._id, balance: { $gte: listing.price } },
            {
                $inc: { balance: -listing.price },
                $push: {
                    transactions: {
                        $each: [{ name: `Bought: ${creature.name} from ${listing.sellerName}`, amount: -listing.price, time: new Date() }],
                        $position: 0, $slice: 30
                    }
                }
            },
            { new: true }
        );

        if (!updatedBuyer) {
            await Marketplace.findByIdAndUpdate(listingId, { $set: { active: true } });
            return res.status(400).json({ success: false, message: 'Недостаточно MMO' });
        }

        const fee = Math.floor(listing.price * 0.1);
        const sellerEarns = listing.price - fee;
        const seller = await User.findOne({ telegramId: listing.sellerTgId });
        if (seller) {
            await User.findByIdAndUpdate(seller._id, {
                $inc: { balance: sellerEarns },
                $push: {
                    transactions: {
                        $each: [{ name: `Sold: ${creature.name}`, amount: sellerEarns, time: new Date() }],
                        $position: 0, $slice: 30
                    }
                }
            });
        }

        await MarketSaleHistory.create({
            listingId: closedListing._id,
            creatureId: listing.creatureId,
            sellerId: listing.sellerId,
            sellerTgId: listing.sellerTgId,
            sellerName: listing.sellerName,
            buyerId: updatedBuyer._id,
            buyerTgId: updatedBuyer.telegramId,
            buyerName: updatedBuyer.username || updatedBuyer.firstName || 'Аноним',
            price: listing.price,
            fee: fee,
            sellerEarns: sellerEarns,
            soldAt: new Date()
        });

        let invItem = await Inventory.findOne({ telegramId: buyer.telegramId, creatureId: listing.creatureId });
        if (invItem) {
            invItem.count += 1;
            await invItem.save();
        } else {
            await Inventory.create({ userId: buyer._id, telegramId: buyer.telegramId, creatureId: listing.creatureId, count: 1 });
        }

        if (!updatedBuyer.discovered.includes(listing.creatureId)) {
            updatedBuyer.discovered.push(listing.creatureId);
            await updatedBuyer.save();
        }

        addXP(updatedBuyer, 5);
        await updatedBuyer.save();

        marketplaceListingsCache = { data: null, expiresAt: 0 };
        
        invalidateInventoryCache(buyer.telegramId);
        
        const updatedInventory = await formatInventory(buyer.telegramId);

        res.json({
            success: true,
            creature: { id: creature.id, name: creature.name, icon: creature.icon, incomeBase: creature.incomeBase },
            user: formatUser(updatedBuyer),
            inventory: updatedInventory
        });
    } catch (e) {
        console.error('marketplace buy error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/marketplace/cancel', authMiddleware, async (req, res) => {
    try {
        const { listingId } = req.body;
        const user = req.user;

        const listing = await Marketplace.findById(listingId);
        if (!listing || !listing.active) {
            return res.status(400).json({ success: false, message: 'Лот не найден' });
        }

        if (listing.sellerTgId !== user.telegramId) {
            return res.status(403).json({ success: false, message: 'Это не ваш лот' });
        }

        const inventory = await Inventory.find({ telegramId: user.telegramId });
        const usedSlots = inventory.reduce((sum, i) => sum + i.count, 0);
        
        if (usedSlots >= user.inventorySlots) {
            return res.status(400).json({ 
                success: false, 
                message: 'Нет свободных слотов в инвентаре. Продайте или объедините существа.' 
            });
        }

        let invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId: listing.creatureId });
        if (invItem) {
            invItem.count += 1;
            await invItem.save();
        } else {
            await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId: listing.creatureId, count: 1 });
        }

        listing.active = false;
        await listing.save();
        
        marketplaceListingsCache = { data: null, expiresAt: 0 };
        
        invalidateInventoryCache(user.telegramId);
        
        const updatedInventory = await formatInventory(user.telegramId);

        res.json({ success: true, inventory: updatedInventory });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Leaderboard
app.get('/api/user/leaderboard', authMiddleware, async (req, res) => {
    try {
        if (Date.now() < leaderboardCache.expiresAt && leaderboardCache.data) {
            return res.json({ success: true, ...leaderboardCache.data });
        }
        
        const leaders = await User.find({ isBanned: { $ne: true } })
            .sort({ level: -1, xp: -1, balance: -1 })
            .limit(50)
            .select('username firstName telegramId balance level xp')
            .lean();
            
        const myRank = await User.countDocuments({ 
            isBanned: { $ne: true },
            $or: [
                { level: { $gt: req.user.level } },
                { level: req.user.level, xp: { $gt: req.user.xp } }
            ]
        }) + 1;
        
        const data = {
            myRank,
            leaders: leaders.map((u, i) => ({
                rank: i + 1,
                username: u.username || u.firstName || `User${u.telegramId.slice(-4)}`,
                balance: u.balance,
                level: u.level,
                xp: u.xp,
                isMe: u.telegramId === req.user.telegramId
            }))
        };
        
        leaderboardCache = {
            data,
            expiresAt: Date.now() + 120 * 1000
        };
        
        res.json({ success: true, ...data });
    } catch (e) {
        console.error('leaderboard error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Deposit endpoints (simplified)
app.post('/api/wallet/get-payment-details', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        const user = req.user;
        
        if (amount < MIN_TRANSACTION_AMOUNT) {
            return res.status(400).json({ success: false, message: `Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO` });
        }
        
        const walletAddress = process.env.TON_DEPOSIT_WALLET || 'UQAERj-q7eOitwIl9rHrgsb_6i35E6MwYoDwU0WeS8O5LBzX';
        const generatedMemo = crypto.randomBytes(16).toString('hex');
        
        await PendingDeposit.create({
            memo: generatedMemo,
            telegramId: user.telegramId,
            userId: user._id,
            amount: amount
        });
        
        res.json({
            success: true,
            wallet: walletAddress,
            memo: generatedMemo,
            amount: amount
        });
        
    } catch (e) {
        console.error('get-payment-details error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/wallet/create-deposit-request', authMiddleware, async (req, res) => {
    try {
        const { memo } = req.body;
        const user = req.user;
        
        const pending = await PendingDeposit.findOne({ memo });
        if (!pending) {
            return res.status(404).json({ success: false, message: 'Данные платежа не найдены или истекли. Начните заново.' });
        }
        
        if (pending.telegramId !== user.telegramId) {
            return res.status(403).json({ success: false, message: 'Неверный мемо' });
        }
        
        const pendingCount = await TransactionRequest.countDocuments({
            telegramId: user.telegramId,
            status: 'pending'
        });
        
        if (pendingCount >= MAX_ACTIVE_REQUESTS) {
            return res.status(400).json({ success: false, message: `У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок` });
        }
        
        const request = await TransactionRequest.create({
            userId: user._id,
            telegramId: user.telegramId,
            type: 'deposit',
            amount: pending.amount,
            wallet: process.env.TON_DEPOSIT_WALLET,
            memo: memo
        });
        
        await PendingDeposit.deleteOne({ memo });
        
        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: "✅ ПОДТВЕРДИТЬ", callback_data: `approve_${request._id}` },
                    { text: "❌ ОТКЛОНИТЬ", callback_data: `reject_${request._id}` }
                ]
            ]
        };
        
        const adminMessage = `💎 <b>НОВАЯ ЗАЯВКА НА ДЕПОЗИТ</b>\n\n` +
            `🆔 #${request._id.toString().slice(-8)}\n` +
            `👤 ${user.username || user.firstName || user.telegramId}\n` +
            `💰 Сумма: ${request.amount.toLocaleString()} MMO\n` +
            `🏦 Кошелек TON: ${request.wallet}\n` +
            `📝 Мемо: <code>${request.memo}</code>\n` +
            `🕐 ${new Date().toLocaleString()}\n\n` +
            `⚠️ Проверьте получение средств по мемо и подтвердите заявку.`;
        
        await notifyAdmins(adminMessage, replyMarkup);
        
        res.json({
            success: true,
            request,
            message: 'Заявка создана! Администратор проверит платеж и начислит средства.'
        });
        
    } catch (e) {
        console.error('create-deposit-request error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/wallet/withdraw-request', authMiddleware, async (req, res) => {
    try {
        const { amount, wallet } = req.body;
        const user = req.user;
        
        if (amount < MIN_TRANSACTION_AMOUNT) {
            return res.status(400).json({ success: false, message: `Минимальная сумма ${MIN_TRANSACTION_AMOUNT.toLocaleString()} MMO` });
        }
        
        if (!wallet || wallet.trim().length < 20) {
            return res.status(400).json({ success: false, message: 'Введите корректный TON кошелек (минимум 20 символов)' });
        }
        
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: 'Недостаточно средств' });
        }
        
        const pendingCount = await TransactionRequest.countDocuments({
            telegramId: user.telegramId,
            status: 'pending'
        });
        
        if (pendingCount >= MAX_ACTIVE_REQUESTS) {
            return res.status(400).json({ success: false, message: `У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок. Дождитесь обработки.` });
        }
        
        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: amount } },
            {
                $inc: { balance: -amount },
                $push: {
                    transactions: {
                        $each: [{ 
                            name: `Withdraw request: ${amount} MMO to ${wallet.slice(0, 10)}...`, 
                            amount: -amount, 
                            time: new Date() 
                        }],
                        $position: 0,
                        $slice: 30
                    }
                }
            },
            { new: true }
        );
        
        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Ошибка списания средств' });
        }
        
        const request = await TransactionRequest.create({
            userId: user._id,
            telegramId: user.telegramId,
            type: 'withdraw',
            amount,
            wallet: wallet.trim(),
            status: 'pending'
        });
        
        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: "✅ ПОДТВЕРДИТЬ", callback_data: `approve_${request._id}` },
                    { text: "❌ ОТКЛОНИТЬ", callback_data: `reject_${request._id}` }
                ]
            ]
        };
        
        const adminMessage = `💸 <b>НОВАЯ ЗАЯВКА НА ВЫВОД</b>\n\n` +
            `🆔 #${request._id.toString().slice(-8)}\n` +
            `👤 ${user.username || user.firstName || user.telegramId}\n` +
            `💰 Сумма: ${amount.toLocaleString()} MMO\n` +
            `🏦 TON Кошелек: <code>${wallet}</code>\n` +
            `📊 Баланс после списания: ${updatedUser.balance.toLocaleString()} MMO\n` +
            `🕐 ${new Date().toLocaleString()}\n\n` +
            `⚠️ Средства уже списаны с баланса пользователя.\n` +
            `Подтвердите вывод, чтобы отправить средства на кошелек.`;
        
        await notifyAdmins(adminMessage, replyMarkup);
        
        try {
            await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: user.telegramId,
                    text: `💸 <b>Заявка на вывод создана</b>\n\n` +
                        `Сумма: -${amount.toLocaleString()} MMO\n` +
                        `Кошелек: <code>${wallet}</code>\n` +
                        `Статус: ⏳ Ожидает подтверждения администратора\n\n` +
                        `После подтверждения средства будут отправлены на ваш кошелек.`,
                    parse_mode: 'HTML'
                })
            });
        } catch (e) {}
        
        res.json({ 
            success: true, 
            request, 
            balance: updatedUser.balance,
            message: 'Заявка создана, средства списаны. Ожидайте подтверждения администратора.' 
        });
        
    } catch (e) {
        console.error('withdraw-request error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/requests', authMiddleware, async (req, res) => {
    try {
        const requests = await TransactionRequest.find({
            telegramId: req.user.telegramId,
            status: 'pending'
        }).sort({ createdAt: -1 });
        
        res.json({ success: true, requests });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// BACKGROUND TASKS
// ============================================

setInterval(async () => {
    try {
        const now = Date.now();
        const users = await User.find({
            adsAvailable: { $lt: MAX_ADS_AVAILABLE },
            adsLastRegen: { $lte: new Date(now - ADS_REGEN_INTERVAL) }
        }).limit(100);
        
        for (const user of users) {
            await regenerateAds(user);
        }
    } catch (e) {
        console.error('Фоновая регенерация ошибка:', e);
    }
}, 5 * 60 * 1000);

// ============================================
// INITIALIZATION
// ============================================

async function initCreatures() {
    const staticCreatures = [
        { id: 'duck_c', name: 'Duck', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/dc.png', incomeBase: 2, desc: 'Young waterfowl.' },
        { id: 'duck_u', name: 'Duck', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/du.png', incomeBase: 8, desc: 'Mature waterfowl.' },
        { id: 'duck_r', name: 'Duck', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/dr.png', incomeBase: 25, desc: 'Ancient waterfowl.' },
        { id: 'duck_e', name: 'Duck', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/de.png', incomeBase: 120, desc: 'Eternal waterfowl.' },
        { id: 'duck_l', name: 'Duck', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/dl.png', incomeBase: 400, desc: 'Divine waterfowl.' },
        { id: 'owl_c', name: 'Owl', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/oc.png', incomeBase: 2, desc: 'Small night hunter.' },
        { id: 'owl_u', name: 'Owl', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/ou.png', incomeBase: 8, desc: 'Experienced night hunter.' },
        { id: 'owl_r', name: 'Owl', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/or.png', incomeBase: 25, desc: 'Wise night guardian.' },
        { id: 'owl_e', name: 'Owl', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/oe.png', incomeBase: 120, desc: 'Eternal guardian.' },
        { id: 'owl_l', name: 'Owl', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/ol.png', incomeBase: 400, desc: 'Divine guardian.' },
        { id: 'shark_c', name: 'Shark', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/sc.png', incomeBase: 2, desc: 'Young predator.' },
        { id: 'shark_u', name: 'Shark', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/su.png', incomeBase: 8, desc: 'Experienced apex predator.' },
        { id: 'shark_r', name: 'Shark', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/sr.png', incomeBase: 25, desc: 'Legendary predator.' },
        { id: 'shark_e', name: 'Shark', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/se.png', incomeBase: 120, desc: 'Eternal terror.' },
        { id: 'shark_l', name: 'Shark', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/sl.png', incomeBase: 400, desc: 'Divine terror.' },
        { id: 'wolf_c', name: 'Wolf', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/wc.png', incomeBase: 2, desc: 'Young pack member.' },
        { id: 'wolf_u', name: 'Wolf', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/wu.png', incomeBase: 8, desc: 'Pack leader in training.' },
        { id: 'wolf_r', name: 'Rare Wolf', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/wr.png', incomeBase: 25, desc: 'Rare wolf for 10 friends 5+.' },
        { id: 'wolf_e', name: 'Epic Wolf', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/we.png', incomeBase: 120, desc: 'Epic wolf for 50 friends 5+.' },
        { id: 'wolf_l', name: 'Legendary Wolf', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/wl.png', incomeBase: 400, desc: 'Legendary wolf for 150 friends 5+.' },
        { id: 'dragon_c', name: 'Dragon', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/ddc.png', incomeBase: 2, desc: 'Young fire breather.' },
        { id: 'dragon_u', name: 'Dragon', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/ddu.png', incomeBase: 8, desc: 'Grown fire breather.' },
        { id: 'dragon_r', name: 'Dragon', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/ddr.png', incomeBase: 25, desc: 'Ancient fire drake.' },
        { id: 'dragon_e', name: 'Dragon', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/dde.png', incomeBase: 120, desc: 'Eternal flame.' },
        { id: 'dragon_l', name: 'Dragon', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/ddl.png', incomeBase: 400, desc: 'Divine flame.' },
        { id: 'unicorn_c', name: 'Unicorn', rarity: 'common', icon: 'https://ndammo.github.io/Mmodna/uc.png', incomeBase: 2, desc: 'Young magical beast.' },
        { id: 'unicorn_u', name: 'Unicorn', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/uu.png', incomeBase: 8, desc: 'Magical evolution.' },
        { id: 'unicorn_r', name: 'Unicorn', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/ru.png', incomeBase: 25, desc: 'Rare magical entity.' },
        { id: 'unicorn_e', name: 'Unicorn', rarity: 'epic', icon: 'https://ndammo.github.io/Mmodna/er.png', incomeBase: 120, desc: 'Eternal magic.' },
        { id: 'unicorn_l', name: 'Unicorn', rarity: 'legendary', icon: 'https://ndammo.github.io/Mmodna/ll.png', incomeBase: 400, desc: 'Divine magic.' },
        { id: 'lion_mythic', name: 'Lion', rarity: 'mythic', icon: 'https://ndammo.github.io/Mmodna/lm.png', incomeBase: 1000, desc: 'THE MYTHIC KING.' },
        { id: 'panther_mythic', name: 'Black Panther', rarity: 'mythic', icon: 'https://ndammo.github.io/Mmodna/pm.png', incomeBase: 2000, desc: 'TOP 1 SEASON.' }
    ];

    for (const creature of staticCreatures) {
        const exists = await Creature.findOne({ id: creature.id });
        if (!exists) {
            await Creature.create(creature);
        }
    }
    await loadCreaturesToCache();
    console.log('✅ Существа инициализированы');
}

// Setup Arena WebSocket Server
setupArenaServer();

// Start server
mongoose.connection.once('open', async () => {
    await initCreatures();
    await getGameConfig();
    console.log('✅ Сервер готов');
    console.log('👥 Telegram Админы: ' + (ADMIN_IDS.join(', ') || 'не заданы'));
    console.log('🔐 Web Админ: ' + ADMIN_LOGIN);
    console.log('💰 Мин. сумма транзакции: ' + MIN_TRANSACTION_AMOUNT + ' MMO');
    console.log('📋 Макс. активных заявок: ' + MAX_ACTIVE_REQUESTS);
    console.log('📺 Новая система рекламы: макс. ' + MAX_ADS_AVAILABLE + ', восстановление +1/час');
    console.log('🎁 Реферальный бонус: ' + REFERRAL_BONUS_PERCENT + '% от депозита друга');
    console.log('🏪 Маркет: мин. цена ' + MIN_MARKETPLACE_PRICE + ' MMO, макс. лотов ' + MAX_ACTIVE_LISTINGS);
    console.log('🏟️ Арена PvP: рейтинговая система, 3 монстра, пошаговые бои');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📌 Режим: ${process.env.NODE_ENV || 'production'}`);
});