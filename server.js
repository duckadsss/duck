// ============================================
// server.js - DNA MMO Backend (WebSocket + Арена)
// ПОЛНАЯ ВЕРСИЯ: Арена + Админ-панель + Защита от фарма
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { getSkillForCreature } = require('./arena-skills');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
app.set('trust proxy', 1);

// ============================================
// ИМПОРТ МОДУЛЯ АРЕНЫ (WebSocket версия)
// ============================================
const ArenaModule = require('./arena-socket');

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token']
}));
app.use(express.json());
app.use(compression());

app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    res.sendStatus(200);
});

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
const MAX_ACTIVE_LISTINGS = 2;
const MIN_MARKETPLACE_PRICE = 500;
const MIN_DUST_PRICE = 3;
const MAX_COMMON_PRICE = 1100;
const MAX_ADS_AVAILABLE = 10;
const ADS_REGEN_INTERVAL = 60 * 60 * 1000;

const MAX_ARENA_BATTLES = 10;
const ARENA_BATTLE_REGEN_INTERVAL = 60 * 60 * 1000;
const REFERRAL_BONUS_PERCENT = 2;

// ============================================
// RATE LIMITING
// ============================================
const rateLimit = new Map();
const RATE_LIMIT_MAX = 600;
const RATE_LIMIT_WINDOW = 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimit.entries()) {
        if (now > record.resetAt) rateLimit.delete(key);
    }
}, RATE_LIMIT_WINDOW);

function resetRateLimitForUser(userId) {
    if (userId) rateLimit.delete('u:' + userId.toString());
}

function rateLimiter(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    let key;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const payload = JSON.parse(Buffer.from(authHeader.split('.')[1], 'base64').toString());
            key = 'u:' + (payload.id || payload._id || payload.userId);
        } catch (_) {}
    }
    if (!key) {
        const forwarded = req.headers['x-forwarded-for'];
        key = 'ip:' + (forwarded ? forwarded.split(',')[0].trim() : (req.ip || 'unknown'));
    }
    const now = Date.now();
    const record = rateLimit.get(key);
    if (!record || now > record.resetAt) {
        rateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return next();
    }
    if (record.count >= RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((record.resetAt - now) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ success: false, message: `Слишком много запросов. Подождите ${retryAfter} сек.` });
    }
    record.count++;
    next();
}

app.use(rateLimiter);

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

// Удаляем уникальный индекс для стейкинга (чтобы можно было делать несколько)
mongoose.connection.once('open', async () => {
    try {
        await Staking.collection.dropIndex('userId_1');
        console.log('✅ Удалён уникальный индекс userId_1 из stakings');
    } catch (err) {
        if (err.code !== 27) {
            console.log('⚠️ Ошибка при удалении индекса:', err.message);
        } else {
            console.log('ℹ️ Индекс userId_1 уже удалён');
        }
    }
});
async function createIndexes() {
    try {
        await User.collection.createIndex({ level: -1, xp: -1 });
        await User.collection.createIndex({ referredBy: 1 });
        await User.collection.createIndex({ lastLogin: -1 });
        await Inventory.collection.createIndex({ telegramId: 1, creatureId: 1 });
        await Inventory.collection.createIndex({ telegramId: 1, count: -1 });
        await Marketplace.collection.createIndex({ active: 1, createdAt: -1 });
        await User.collection.createIndex({ level: -1, xp: -1, balance: -1 });
        await ArenaBattle.collection.createIndex({ status: 1, league: 1, expiresAt: 1 });
        await ArenaBattle.collection.createIndex({ player1Id: 1, player2Id: 1 });
        await ArenaBattle.collection.createIndex({ status: 1, lastMoveAt: 1 });
        await ArenaBattle.collection.createIndex({ player1Id: 1, status: 1, createdAt: -1 });
        await ArenaBattle.collection.createIndex({ player2Id: 1, status: 1, createdAt: -1 });
        await ArenaStats.collection.createIndex({ rating: -1 });
        console.log('✅ Индексы созданы');
    } catch (e) {
        console.warn('⚠️ Индексы:', e.message);
    }
}

// ============================================
// МОДЕЛИ
// ============================================

const UserSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    balance: { type: Number, default: 4000 },
    dust: { type: Number, default: 0 },
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
    adsWatchedTotal: { type: Number, default: 0 },
    arenaBattlesLeft: { type: Number, default: MAX_ARENA_BATTLES },
    arenaLastBattleRegen: { type: Date, default: Date.now },
    adsCooldownUntil: { type: Date, default: null },
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
    arenaTeam: [{ type: String, default: [] }],
    arenaCooldownUntil: { type: Date, default: null },
    currentBattleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaBattle', default: null },
    lastOpponentId: { type: mongoose.Schema.Types.ObjectId, default: null }
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

const CreatureSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    rarity: { type: String, enum: RARITY_ORDER, required: true },
    icon: { type: String, required: true, default: '🧬' },
    incomeBase: { type: Number, required: true, min: 1 },
    desc: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    premiumOnly: { type: Boolean, default: false },
    stakingOnly: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Creature = mongoose.model('Creature', CreatureSchema);

const MarketplaceSchema = new mongoose.Schema({
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerTgId: { type: String, required: true },
    sellerName: { type: String, default: '' },
    creatureId: { type: String, default: null },
    isDust: { type: Boolean, default: false },
    dustAmount: { type: Number, default: 0 },
    price: { type: Number, required: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const Marketplace = mongoose.model('Marketplace', MarketplaceSchema);

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
const TransactionRequest = mongoose.model('TransactionRequest', TransactionRequestSchema);

const PendingDepositSchema = new mongoose.Schema({
    memo: { type: String, required: true, unique: true },
    telegramId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});
const PendingDeposit = mongoose.model('PendingDeposit', PendingDepositSchema);

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
    specialQuests: [{
        id: String, title: String, description: String, icon: String,
        reward: Number, type: String, link: String, required_count: Number, isActive: Boolean
    }],
    limits: {
        maxInventorySlots: { type: Number, default: 50 },
        maxMarketplacePrice: { type: Number, default: 100000 },
        maxLevel: { type: Number, default: 100 }
    },
    updatedAt: { type: Date, default: Date.now }
});
const GameConfig = mongoose.model('GameConfig', GameConfigSchema);

const ArenaBattleSchema = new mongoose.Schema({
    player1Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    player2Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    
    player1Team: [{ creatureId: String, name: String, icon: String, rarity: String,
        maxHp: Number, currentHp: Number, attack: Number, defense: Number, critChance: Number, isAlive: Boolean,
        stunned: Boolean, shielded: Boolean,
        skillDisabledTurns: { type: Number, default: 0 },
        poisonTurns: { type: Number, default: 0 },
        skill: { id: String, name: String, chance: Number, description: String } }],
    player2Team: [{ creatureId: String, name: String, icon: String, rarity: String,
        maxHp: Number, currentHp: Number, attack: Number, defense: Number, critChance: Number, isAlive: Boolean,
        stunned: Boolean, shielded: Boolean,
        skillDisabledTurns: { type: Number, default: 0 },
        poisonTurns: { type: Number, default: 0 },
        skill: { id: String, name: String, chance: Number, description: String } }],
    
    currentTurn: { type: String, enum: ['player1', 'player2', '__processing__'], default: 'player1' },
    processingStartedAt: { type: Date, default: null },
    processingByPlayer: { type: String, default: null },
    turnCount: { type: Number, default: 0 },
    battleLog: [{
        turn: Number, player: String, attackerName: String, attackerIndex: Number,
        targetName: String, targetIndex: Number, damage: Number, isCrit: Boolean,
        remainingHp: Number, timestamp: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['waiting', 'pending_confirmation', 'active', 'finished', 'cancelled', 'expired'], default: 'waiting' },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    league: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'], required: true },
    entryFee: { type: Number, required: true },
    prizePool: { type: Number, required: true },
    player1Confirmed: { type: Boolean, default: false },
    player2Confirmed: { type: Boolean, default: false },
    player1LastMoveAt: { type: Date, default: null },
    player2LastMoveAt: { type: Date, default: null },
    lastMoveAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 1000) },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const ArenaBattle = mongoose.model('ArenaBattle', ArenaBattleSchema);

const ArenaStatsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    rating: { type: Number, default: 1000 },
    league: { type: String, default: 'bronze' },
    peakRating: { type: Number, default: 1000 },
    promotions: { type: Number, default: 0 },
    demotions: { type: Number, default: 0 },
    promotionProtection: { type: Boolean, default: true },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    totalBattles: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    totalLost: { type: Number, default: 0 },
    lastBattleAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now }
});
const ArenaStats = mongoose.model('ArenaStats', ArenaStatsSchema);

const StakingSchema = new mongoose.Schema({
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount:    { type: Number, required: true },
    days:      { type: Number, required: true },
    rate:      { type: Number, required: true },
    reward:    { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    endsAt:    { type: Date, required: true },
    claimed:   { type: Boolean, default: false },
    skinName:  { type: String, default: null },      // 👈 ДОБАВИТЬ ЭТУ СТРОКУ
    skinDuration: { type: String, default: null }    // 👈 ДОБАВИТЬ ЭТУ СТРОКУ
});
StakingSchema.index({ userId: 1, claimed: 1 });
const Staking = mongoose.model('Staking', StakingSchema);

// ============================================
// RAID BOSS МОДЕЛИ
// ============================================

const RaidSchema = new mongoose.Schema({
    raidId: { type: String, required: true, unique: true },
    phase: { type: String, enum: ['registration', 'fighting', 'finished', 'cooldown'], default: 'registration' },
    currentTurn: { type: Number, default: 1 },
    turnEndsAt: { type: Date, default: null },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date, default: null },
    entryFee: { type: Number, default: 100 },
    totalPrizePool: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    playersPrizePool: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    scheduledAt: { type: Date, default: null }
});

const RaidParticipantSchema = new mongoose.Schema({
    raidId: { type: mongoose.Schema.Types.ObjectId, ref: 'Raid', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    username: { type: String, default: '' },
    petId: { type: String, required: true },
    petAttack: { type: Number, required: true },
    petCritChance: { type: Number, default: 0.1 },
    petSkill: { type: Object, default: null },
    totalDamage: { type: Number, default: 0 },
    attacksCount: { type: Number, default: 0 },
    attackedInCurrentTurn: { type: Boolean, default: false },
    reward: { type: Number, default: 0 },
    claimed: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now }
});
RaidParticipantSchema.index({ raidId: 1, telegramId: 1 }, { unique: true });

const RaidHistorySchema = new mongoose.Schema({
    raidId: { type: String, required: true },
    totalParticipants: { type: Number, default: 0 },
    totalPrizePool: { type: Number, default: 0 },
    commissionEarned: { type: Number, default: 0 },
    playersPrizePool: { type: Number, default: 0 },
    defeatedAt: { type: Date, default: Date.now },
    topDamage: [{
        username: String,
        telegramId: String,
        damage: Number,
        reward: Number
    }]
});

const Raid = mongoose.model('Raid', RaidSchema);
const RaidParticipant = mongoose.model('RaidParticipant', RaidParticipantSchema);
const RaidHistory = mongoose.model('RaidHistory', RaidHistorySchema);

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
const adminLoginAttempts = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of adminLoginAttempts.entries()) {
        if (now > data.resetAt) {
            adminLoginAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000);

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (session.expiresAt < now) {
            adminSessions.delete(token);
        }
    }
}, 60 * 60 * 1000);

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

app.post('/api/admin/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        
        if (!login || !password) {
            return res.status(400).json({ success: false, message: 'Введите логин и пароль' });
        }
        
        let attempts = adminLoginAttempts.get(ip);
        const now = Date.now();
        
        if (!attempts) {
            attempts = { count: 0, resetAt: now + 15 * 60 * 1000 };
            adminLoginAttempts.set(ip, attempts);
        }
        
        if (now > attempts.resetAt) {
            attempts.count = 0;
            attempts.resetAt = now + 15 * 60 * 1000;
        }
        
        if (attempts.count >= 5) {
            return res.status(429).json({ success: false, message: 'Слишком много попыток. Попробуйте через 15 минут.' });
        }
        
        if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
            attempts.count++;
            adminLoginAttempts.set(ip, attempts);
            return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        adminLoginAttempts.delete(ip);
        
        const token = crypto.randomBytes(32).toString('hex');
        adminSessions.set(token, { login: login, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
        
        res.json({ success: true, token: token });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// АДМИН-МЕТРИКИ
// ============================================
let recentErrors = [];
let requestLog = [];
const REQUEST_LOG_MAX = 1000;

app.use((req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        
        if (res.statusCode >= 500) {
            recentErrors.unshift({
                timestamp: new Date().toISOString(),
                status: res.statusCode,
                path: req.path,
                method: req.method,
                message: res.statusMessage || 'Server error'
            });
            if (recentErrors.length > 100) recentErrors.pop();
            console.error(`❌ ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
        }
        
        requestLog.unshift({
            timestamp: Date.now(),
            path: req.path,
            status: res.statusCode
        });
        if (requestLog.length > REQUEST_LOG_MAX) requestLog.pop();
    });
    
    next();
});

app.get('/api/admin/metrics', adminAuthMiddleware, async (req, res) => {
    try {
        const oneMinuteAgo = Date.now() - 60 * 1000;
        
        const requestsLastMinute = requestLog.filter(log => log.timestamp > oneMinuteAgo).length;
        const errorsLastMinute = requestLog.filter(log => 
            log.timestamp > oneMinuteAgo && log.status >= 500 && log.status < 600
        ).length;
        
        const errorRate5xx = requestsLastMinute > 0 
            ? (errorsLastMinute / requestsLastMinute * 100).toFixed(3)
            : 0;
        
        const memUsage = process.memoryUsage();
        res.json({
            success: true,
            requestsLastMinute: requestsLastMinute,
            errorRate5xx: parseFloat(errorRate5xx),
            uptime: Math.floor(process.uptime()),
            memoryUsage: Math.round(memUsage.rss / 1024 / 1024),
            recentErrors: recentErrors.slice(0, 20),
            timestamp: Date.now()
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/admin/metrics/errors', adminAuthMiddleware, async (req, res) => {
    recentErrors = [];
    res.json({ success: true, message: 'Ошибки очищены' });
});

// ============================================
// ПОДОЗРИТЕЛЬНЫЕ СОБЫТИЯ
// ============================================
let suspiciousEvents = [];

app.get('/api/admin/suspicious-events', adminAuthMiddleware, async (req, res) => {
    try {
        res.json({ success: true, events: suspiciousEvents });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/suspicious-events', adminAuthMiddleware, async (req, res) => {
    try {
        const { userId, userName, reason } = req.body;
        if (!userId || !reason) {
            return res.status(400).json({ success: false, message: 'Не все поля заполнены' });
        }
        
        const event = {
            id: Date.now().toString(),
            userId,
            userName: userName || 'Unknown',
            reason,
            timestamp: new Date().toISOString(),
            status: 'open'
        };
        
        suspiciousEvents.unshift(event);
        if (suspiciousEvents.length > 100) suspiciousEvents.pop();
        
        res.json({ success: true, event });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// ИСТОРИЯ ПРОДАЖ МАРКЕТА (АДМИН)
// ============================================
app.get('/api/admin/market-sales-history', adminAuthMiddleware, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        
        const history = await MarketSaleHistory.find()
            .sort({ soldAt: -1 })
            .limit(parseInt(limit))
            .lean();
        
        let creatures = creaturesCache;
        if (!creatures) {
            creatures = await Creature.find({ isActive: true }).lean();
        }
        
        const creatureMap = new Map();
        for (const c of creatures) {
            creatureMap.set(c.id, c);
        }
        
        const enrichedHistory = history.map(sale => ({
            ...sale,
            creature: creatureMap.get(sale.creatureId) || { name: sale.creatureId, rarity: 'common', icon: '🧬' }
        }));
        
        res.json({ success: true, history: enrichedHistory });
    } catch (e) {
        console.error('market-sales-history error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// API ДЛЯ БОТА
// ============================================
app.get('/api/bot/user/:telegramId', async (req, res) => {
    const botKey = req.headers['x-bot-key'];
    if (!process.env.BOT_INTERNAL_KEY || botKey !== process.env.BOT_INTERNAL_KEY) {
        return res.status(403).json({ success: false, message: 'Доступ запрещён' });
    }
    
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }
        res.json({
            success: true,
            user: {
                telegramId: user.telegramId,
                username: user.username,
                firstName: user.firstName,
                balance: user.balance,
                level: user.level,
                xp: user.xp,
                mergeCount: user.mergeCount,
                capsulesOpened: user.capsulesOpened,
                inventorySlots: user.inventorySlots,
                referralCode: user.referralCode,
                referralCount: user.referralCount
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeRegex(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatUser(user) {
    return {
        id: user._id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        balance: user.balance,
        dust: user.dust || 0,
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
        totalReferralBonus: user.totalReferralBonus || 0,
        isBanned: user.isBanned,
        banReason: user.banReason,
        lastLogin: user.lastLogin,
        lastPassiveIncome: user.lastPassiveIncome,
        createdAt: user.createdAt
    };
}

function addTransaction(user, name, amount) {
    user.transactions.unshift({ name, amount, time: new Date() });
    if (user.transactions.length > 30) user.transactions = user.transactions.slice(0, 30);
}

function xpNeeded(level) {
    if (level <= 15) return level * 100;
    return 1500 + (level - 15) * 1000;
}

function addXP(user, amount) {
    user.xp += amount;
    const needed = xpNeeded(user.level);
    if (user.xp >= needed) {
        user.xp -= needed;
        user.level += 1;
    }
}

// ============================================
// КЭШИ
// ============================================
let creaturesCache = null;
let cachedConfig = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 60 * 1000;
const inventoryCache = new Map();
const INVENTORY_CACHE_TTL = 5000;
const userIncomeCache = new Map();
const INCOME_CACHE_TTL = 10000;
let leaderboardCache = { data: null, expiresAt: 0 };
let marketplaceListingsCache = { data: null, expiresAt: 0 };
let cachedAdminStats = { data: null, expiresAt: 0 };
const ADMIN_STATS_CACHE_TTL = 60 * 1000;

const lastOpenTimes = new Map();
const lastMergeTimes = new Map();
const adLocks = new Map();
const incomeLocks = new Map();

setInterval(() => {
    const cutoff = Date.now() - 60 * 1000;
    for (const [k, v] of lastOpenTimes.entries()) { if (v < cutoff) lastOpenTimes.delete(k); }
    for (const [k, v] of lastMergeTimes.entries()) { if (v < cutoff) lastMergeTimes.delete(k); }
}, 5 * 60 * 1000);

async function getCreature(id) {
    if (creaturesCache) {
        return creaturesCache.find(c => c.id === id) || null;
    }
    return await Creature.findOne({ id });
}

async function loadCreaturesToCache() {
    creaturesCache = await Creature.find({ isActive: true }).lean();
    console.log(`✅ Загружено ${creaturesCache.length} существ в кэш`);
}

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
            adReward: 5,
            adCooldown: 60,
            upgradeBaseCost: 300,
            upgradeMultiplier: 1.4,
            specialQuests: [],
            limits: { maxInventorySlots: 50, maxMarketplacePrice: 100000, maxLevel: 100 }
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
    cachedAdminStats = { data: null, expiresAt: 0 };
    console.log('🔄 Кэш конфига сброшен');
}

async function getSpecialQuestsRaw() {
    const doc = await GameConfig.collection.findOne({}, { projection: { specialQuests: 1 } });
    const quests = doc?.specialQuests || [];
    return quests.filter(q => q && typeof q === 'object' && q.id);
}

async function formatInventory(telegramId) {
    const cached = inventoryCache.get(telegramId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }
    
    const inventory = await Inventory.find({ telegramId }).lean();
    if (inventory.length === 0) return [];
    
    let creatures = creaturesCache;
    if (!creatures) {
        creatures = await Creature.find({ isActive: true }).lean();
        creaturesCache = creatures;
    }
    
    const creatureMap = new Map();
    for (const c of creatures) {
        creatureMap.set(c.id, c);
    }
    
    const result = inventory.map(item => ({
        ...item,
        incomeBase: creatureMap.get(item.creatureId)?.incomeBase || 1,
        name: creatureMap.get(item.creatureId)?.name || item.creatureId,
        icon: creatureMap.get(item.creatureId)?.icon || '🧬'
    }));
    
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
        if (creature) income += creature.incomeBase * item.count;
    }
    
    userIncomeCache.set(telegramId, { income, expiresAt: Date.now() + INCOME_CACHE_TTL });
    return income;
}

async function randomCreatureByRarity(rarity, capsuleType = 'premium') {
    const allByRarity = creaturesCache
        ? creaturesCache.filter(c => c.rarity === rarity && c.isActive)
        : await Creature.find({ rarity, isActive: true });
    const pool = allByRarity.filter(c => {
        if (c.stakingOnly) return false;
        if (capsuleType === 'basic' && c.premiumOnly) return false;
        return true;
    });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================
// ПАССИВНЫЙ ДОХОД
// ============================================
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
            { telegramId, lastPassiveIncome: freshUser.lastPassiveIncome },
            {
                $inc: { balance: earned },
                $set: { lastPassiveIncome: newLastPassiveIncome },
                $push: { transactions: { $each: [newTx], $position: 0, $slice: 30 } }
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
// РЕГЕНЕРАЦИЯ РЕКЛАМЫ
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
        { $set: { adsAvailable: newCount, adsLastRegen: newLastRegen } }
    );
    
    user.adsAvailable = newCount;
    user.adsLastRegen = newLastRegen;
    
    return newCount;
}

// ============================================
// РЕГЕНЕРАЦИЯ БОЁВ АРЕНЫ
// ============================================
async function regenerateArenaBattles(user) {
    const now = Date.now();
    const lastRegen = user.arenaLastBattleRegen ? new Date(user.arenaLastBattleRegen).getTime() : now;
    const hoursPassed = Math.floor((now - lastRegen) / ARENA_BATTLE_REGEN_INTERVAL);

    if (hoursPassed <= 0) return user.arenaBattlesLeft ?? MAX_ARENA_BATTLES;

    const current = user.arenaBattlesLeft ?? MAX_ARENA_BATTLES;
    const newCount = Math.min(MAX_ARENA_BATTLES, current + hoursPassed);
    const newLastRegen = new Date(lastRegen + (hoursPassed * ARENA_BATTLE_REGEN_INTERVAL));

    await User.updateOne(
        { _id: user._id },
        { $set: { arenaBattlesLeft: newCount, arenaLastBattleRegen: newLastRegen } }
    );

    user.arenaBattlesLeft = newCount;
    user.arenaLastBattleRegen = newLastRegen;

    return newCount;
}

// ============================================
// УВЕДОМЛЕНИЯ
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
        } catch (e) {
            console.error('Failed to send admin notification:', e);
        }
    }
}

// ============================================
// AUTH MIDDLEWARE
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
// HEALTH CHECK
// ============================================
const STATIC_WHITELIST = ['index.html', 'style.css', 'script.js', 'arena-client.js',
    'arena-skills.js', 'localization.js', 'admin.html'];
app.get('/admin.html', (req, res) => res.sendFile(__dirname + '/admin.html'));
app.get('/style.css', (req, res) => res.sendFile(__dirname + '/style.css'));
app.get('/script.js', (req, res) => res.sendFile(__dirname + '/script.js'));
app.get('/arena-client.js', (req, res) => res.sendFile(__dirname + '/arena-client.js'));
app.get('/arena-skills.js', (req, res) => res.sendFile(__dirname + '/arena-skills.js'));
app.get('/localization.js', (req, res) => res.sendFile(__dirname + '/localization.js'));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================
// ПУБЛИЧНЫЕ ЭНДПОИНТЫ
// ============================================
app.get('/api/game/config', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, message: 'Server starting...' });
    }
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
                specialQuests: (await getSpecialQuestsRaw()).filter(q => q.isActive),
                marketplace: { minPrice: MIN_MARKETPLACE_PRICE, maxActiveListings: MAX_ACTIVE_LISTINGS }
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

// ============================================
// AUTH LOGIN
// ============================================
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
            const newReferralCode = 'REF' + String(userData.id) + Math.random().toString(36).slice(2, 7).toUpperCase();
            const newUserData = {
                telegramId: String(userData.id),
                username: userData.username || '',
                firstName: userData.first_name || '',
                lastName: userData.last_name || '',
                photoUrl: userData.photo_url || '',
                balance: 4000,
                adsAvailable: MAX_ADS_AVAILABLE,
                adsLastRegen: new Date()
            };

            let referrerInfo = null;
            if (referralCode) {
                const referrer = await User.findOne({ referralCode });
                if (referrer && referrer.telegramId !== String(userData.id)) {
                    newUserData.referredBy = referrer.telegramId;
                    await User.findByIdAndUpdate(referrer._id, { $inc: { referralCount: 1 } });
                    referrerInfo = referrer;
                }
            }

            const upsertResult = await User.findOneAndUpdate(
                { telegramId: String(userData.id) },
                {
                    $setOnInsert: {
                        ...newUserData,
                        referralCode: newReferralCode
                    }
                },
                { upsert: true, new: true }
            );
            user = upsertResult;

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

// ============================================
// USER PROFILE
// ============================================
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

// ============================================
// РЕФЕРАЛЫ
// ============================================
app.get('/api/user/referrals', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const allReferrals = await User.find({ referredBy: user.telegramId })
            .select('username firstName balance level createdAt')
            .lean();
        
        const qualifiedReferrals = allReferrals.filter(r => r.level >= 5);
        const qualifiedCount = qualifiedReferrals.length;
        
        if (user.referralCount !== qualifiedCount) {
            await User.updateOne({ _id: user._id }, { $set: { referralCount: qualifiedCount } });
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

// ============================================
// СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ
// ============================================
app.get('/api/user/stats', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const adsWatched = user.adsWatchedTotal || 0;
        const adsEarned = user.transactions
            .filter(tx => tx.name === 'Watch Ad Reward')
            .reduce((sum, tx) => sum + tx.amount, 0);
        
        const totalWithdrawn = user.transactions
            .filter(tx => tx.name && (tx.name.includes('Withdraw') || tx.name.includes('Вывод')) && tx.amount < 0)
            .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
        
        const referralEarned = user.totalReferralBonus || 0;
        
        res.json({
            success: true,
            stats: { adsWatched, adsEarned, totalWithdrawn, referralEarned }
        });
    } catch (e) {
        console.error('user stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// НАГРАДЫ ЗА ДРУЗЕЙ
// ============================================
async function getQualifiedReferralsCount(telegramId) {
    return await User.countDocuments({ referredBy: telegramId, level: { $gte: 5 } });
}

app.post('/api/game/claim-friend-reward', authMiddleware, async (req, res) => {
    try {
        const { requiredFriends, creatureId } = req.body;
        const user = req.user;

        const ALLOWED_FRIEND_COUNTS = [10, 25, 50, 100];
        if (!ALLOWED_FRIEND_COUNTS.includes(Number(requiredFriends))) {
            return res.status(400).json({ success: false, message: 'Неверное количество друзей' });
        }

        const qualifiedCount = await getQualifiedReferralsCount(user.telegramId);

        if (qualifiedCount < requiredFriends) {
            return res.status(400).json({ success: false, message: `Нужно ${requiredFriends} друзей 5+ уровня (у вас ${qualifiedCount})` });
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

// ============================================
// GAME: OPEN CAPSULE
// ============================================
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
                $push: { transactions: { $each: [{ name: `${type === 'premium' ? 'Premium' : 'DNA'} Capsule`, amount: -cost, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Недостаточно MMO' });
        }

        {
            const xpGain = type === 'premium' ? 100 : 10;
            const needed = xpNeeded(updatedUser.level);
            const newXp = updatedUser.xp + xpGain;
            if (newXp >= needed) {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { level: 1 }, $set: { xp: newXp - needed } });
                updatedUser.level += 1;
                updatedUser.xp = newXp - needed;
            } else {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { xp: xpGain } });
                updatedUser.xp = newXp;
            }
        }

        const weights = config.capsuleRarities[type];
        const roll = Math.random() * 100;
        let cum = 0;
        let rarity = 'common';
        for (const [r, chance] of Object.entries(weights)) {
            cum += chance;
            if (roll < cum) { rarity = r; break; }
        }

        const creature = await randomCreatureByRarity(rarity, type);
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
            await User.updateOne({ _id: updatedUser._id }, { $addToSet: { discovered: creature.id } });
        }
        
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

// ============================================
// GAME: MERGE
// ============================================
app.post('/api/game/merge', authMiddleware, async (req, res) => {
    try {
        const { creatureId, useDust } = req.body;
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

        const DUST_BONUS_TABLE = {
            common:   { 10: 600,  20: 950,   30: 1200,  40: 1350,  50: 1500,  60: 1600,  70: 3200  },
            uncommon: { 10: 3000, 20: 5200,  30: 6600,  40: 7500,  50: 8000,  60: 8400,  70: 16800 },
            rare:     { 10: 132000, 20: 180000, 30: 205000, 40: 223000, 50: 237000, 60: 248000, 70: 257000, 80: 266000 }
        };
        const { dustBonusPercent: _dbp } = req.body;
        const dustBonusPercent = (typeof req.body.dustBonusPercent === 'number' && req.body.dustBonusPercent > 0)
            ? req.body.dustBonusPercent : 0;
        const rarityTable = DUST_BONUS_TABLE[creature.rarity];
        const dustCost = (dustBonusPercent > 0 && rarityTable && rarityTable[dustBonusPercent])
            ? rarityTable[dustBonusPercent] : 0;
        if (dustBonusPercent > 0 && dustCost > 0) {
            const dustUpdated = await User.findOneAndUpdate(
                { _id: user._id, dust: { $gte: dustCost } },
                { $inc: { dust: -dustCost } },
                { new: true }
            );
            if (!dustUpdated) {
                return res.status(400).json({ success: false, message: `\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043f\u044b\u043b\u0438. \u041d\u0443\u0436\u043d\u043e ${dustCost.toLocaleString()} \uD83C\uDF2B\uFE0F` });
            }
            user.dust = dustUpdated.dust;
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
        const MERGE_CHANCES = { common: 0.3, uncommon: 0.3, rare: 0.1, epic: 0.10, legendary: 0.05 };
        const baseChance = MERGE_CHANCES[creature.rarity] ?? 0.3;
        const dustBonus = (dustBonusPercent > 0 && dustCost > 0) ? (dustBonusPercent / 100) : 0;
        const mergeChance = Math.min(1.0, baseChance + dustBonus);
        const success = Math.random() < mergeChance;

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

        const xpGain = 20;
        const needed = xpNeeded(user.level);
        const newXp = user.xp + xpGain;
        const xpUpdate = newXp >= needed
            ? { $inc: { level: 1 }, $set: { xp: newXp - needed } }
            : { $inc: { xp: xpGain } };

        const mergedUser = await User.findOneAndUpdate(
            { _id: user._id },
            {
                $inc: { mergeCount: 1, ...xpUpdate.$inc },
                $set: { ...(xpUpdate.$set || {}) },
                $addToSet: { discovered: resultCreature.id },
                $push: { transactions: { $each: [{ name: `Merge → ${resultCreature.name} (${resultCreature.rarity})`, amount: 0, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );
        if (mergedUser) {
            user.mergeCount = mergedUser.mergeCount;
            user.xp = mergedUser.xp;
            user.level = mergedUser.level;
            user.transactions = mergedUser.transactions;
            user.discovered = mergedUser.discovered;
        }

        invalidateInventoryCache(user.telegramId);
        
        const updatedInventory = await formatInventory(user.telegramId);
        const incomePerHour = await getUserIncome(user.telegramId);

        res.json({
            success: true,
            upgraded: success,
            dustUsed: dustCost,
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

// ============================================
// GAME: UPGRADE INVENTORY
// ============================================
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
                $push: { transactions: { $each: [{ name: 'Inventory Upgrade', amount: -cost, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Недостаточно MMO', required: cost });
        }

        {
            const xpGain = 30;
            const needed = xpNeeded(updatedUser.level);
            const newXp = updatedUser.xp + xpGain;
            if (newXp >= needed) {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { level: 1 }, $set: { xp: newXp - needed } });
                updatedUser.level += 1;
                updatedUser.xp = newXp - needed;
            } else {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { xp: xpGain } });
                updatedUser.xp = newXp;
            }
        }
        
        invalidateInventoryCache(user.telegramId);

        res.json({ success: true, user: formatUser(updatedUser) });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// GAME: WATCH AD
// ============================================
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
                $inc: { balance: reward, adsAvailable: -1, adsWatchedTotal: 1 },
                $set: { adsCooldownUntil: newCooldown },
                $push: { transactions: { $each: [{ name: 'Watch Ad Reward', amount: reward, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );
        
        if (!updatedUser) {
            adLocks.delete(userId);
            return res.status(400).json({ success: false, message: 'Не удалось получить награду. Попробуйте ещё раз.' });
        }
        
        {
            const xpGain = 5;
            const needed = xpNeeded(updatedUser.level);
            const newXp = updatedUser.xp + xpGain;
            if (newXp >= needed) {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { level: 1 }, $set: { xp: newXp - needed } });
                updatedUser.level += 1;
                updatedUser.xp = newXp - needed;
            } else {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { xp: xpGain } });
                updatedUser.xp = newXp;
            }
        }
        
        const lastRegen = new Date(updatedUser.adsLastRegen || updatedUser.createdAt).getTime();
        const nextRegenIn = ADS_REGEN_INTERVAL - (now.getTime() - lastRegen);
        const nextRegenMinutes = Math.ceil(nextRegenIn / 60000);

        let kangarooUnlocked = false;
        const newTotal = updatedUser.adsWatchedTotal;
        if (newTotal >= 200 && !(updatedUser.discovered || []).includes('kangaroo_u')) {
            let inv = await Inventory.findOne({ telegramId: updatedUser.telegramId, creatureId: 'kangaroo_u' });
            if (inv) { inv.count += 1; await inv.save(); }
            else { await Inventory.create({ userId: updatedUser._id, telegramId: updatedUser.telegramId, creatureId: 'kangaroo_u', count: 1 }); }
            await User.findByIdAndUpdate(updatedUser._id, { $addToSet: { discovered: 'kangaroo_u' } });
            invalidateInventoryCache(updatedUser.telegramId);
            kangarooUnlocked = true;
        }
        
        adLocks.delete(userId);
        
        res.json({ 
            success: true,
            reward: reward,
            cooldownSeconds: config.adCooldown,
            adsAvailable: updatedUser.adsAvailable,
            maxAdsPerDay: MAX_ADS_AVAILABLE,
            nextRegenMinutes: nextRegenMinutes,
            kangarooUnlocked,
            user: formatUser(updatedUser)
        });
    } catch (e) {
        console.error('watch-ad error:', e);
        adLocks.delete(userId);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// GAME: ADS STATUS
// ============================================
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

// ============================================
// АДМИН: СТАТИСТИКА РЕКЛАМЫ
// ============================================
app.get('/api/admin/ads-stats', adminAuthMiddleware, async (req, res) => {
    try {
        const { limit = 100, sortBy = 'adsWatched' } = req.query;
        
        const adsStats = await User.aggregate([
            {
                $project: {
                    telegramId: 1,
                    username: 1,
                    firstName: 1,
                    level: 1,
                    adsAvailable: 1,
                    adsLastRegen: 1,
                    adsWatched: { $ifNull: ['$adsWatchedTotal', 0] }
                }
            },
            { $sort: { [sortBy]: -1 } },
            { $limit: parseInt(limit) }
        ]);
        
        const totalStats = await User.aggregate([
            {
                $group: {
                    _id: null,
                    totalAdsWatched: { $sum: { $ifNull: ['$adsWatchedTotal', 0] } },
                    avgAdsPerUser: { $avg: { $ifNull: ['$adsWatchedTotal', 0] } }
                }
            }
        ]);
        
        res.json({
            success: true,
            stats: adsStats,
            total: totalStats[0] || { totalAdsWatched: 0, avgAdsPerUser: 0 }
        });
    } catch (e) {
        console.error('ads-stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/user/:id/reset-ads-stats', adminAuthMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }
        
        const originalCount = user.transactions.filter(tx => tx.name === 'Watch Ad Reward').length;
        user.transactions = user.transactions.filter(tx => tx.name !== 'Watch Ad Reward');
        
        user.adsAvailable = MAX_ADS_AVAILABLE;
        user.adsLastRegen = new Date();
        user.adsCooldownUntil = null;
        
        await user.save();
        
        res.json({
            success: true,
            message: `Удалено ${originalCount} записей о просмотре рекламы у ${user.username || user.firstName}`,
            removedCount: originalCount
        });
    } catch (e) {
        console.error('reset-ads-stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/reset-all-ads-stats', adminAuthMiddleware, async (req, res) => {
    try {
        const users = await User.find({});
        let totalRemoved = 0;
        
        for (const user of users) {
            const removedCount = user.transactions.filter(tx => tx.name === 'Watch Ad Reward').length;
            if (removedCount > 0) {
                user.transactions = user.transactions.filter(tx => tx.name !== 'Watch Ad Reward');
                user.adsAvailable = MAX_ADS_AVAILABLE;
                user.adsLastRegen = new Date();
                user.adsCooldownUntil = null;
                await user.save();
                totalRemoved += removedCount;
            }
        }
        
        res.json({
            success: true,
            message: `Удалено ${totalRemoved} записей о просмотре рекламы у всех пользователей`,
            totalRemoved
        });
    } catch (e) {
        console.error('reset-all-ads-stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/give-ads-to-all', adminAuthMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0 || amount > 50) {
            return res.status(400).json({ success: false, message: 'Укажите количество от 1 до 50' });
        }
        
        const result = await User.updateMany(
            {},
            { 
                $inc: { adsAvailable: amount },
                $set: { adsLastRegen: new Date() }
            }
        );
        
        await User.updateMany(
            { adsAvailable: { $gt: MAX_ADS_AVAILABLE } },
            { $set: { adsAvailable: MAX_ADS_AVAILABLE } }
        );
        
        res.json({
            success: true,
            message: `Выдано +${amount} рекламы ${result.modifiedCount} игрокам`,
            modifiedCount: result.modifiedCount
        });
    } catch (e) {
        console.error('give-ads-to-all error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/ads-config', adminAuthMiddleware, async (req, res) => {
    try {
        const { adReward, adCooldownSeconds } = req.body;
        
        let config = await GameConfig.findOne();
        if (!config) {
            config = new GameConfig();
        }
        
        if (adReward !== undefined) config.adReward = adReward;
        if (adCooldownSeconds !== undefined) config.adCooldown = adCooldownSeconds;
        
        await config.save();
        
        await notifyAdmins(`⚙️ <b>Изменены настройки рекламы</b>\n\n` +
            `💰 Награда: ${adReward || config.adReward} MMO\n` +
            `🔄 Кулдаун: ${adCooldownSeconds || config.adCooldown} сек`);
        
        await invalidateConfigCache();
        
        res.json({ success: true, message: 'Настройки рекламы обновлены' });
    } catch (e) {
        console.error('ads-config error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// GAME: SPECIAL QUEST COMPLETE
// ============================================
app.post('/api/game/complete-special-quest', authMiddleware, async (req, res) => {
    try {
        const { questId } = req.body;
        const user = req.user;
        
        const config = await getGameConfig();
        
        if (user.completedSpecialQuests.includes(questId)) {
            return res.status(400).json({ success: false, message: 'Вы уже получили награду за этот квест' });
        }
        
        const quest = (await getSpecialQuestsRaw()).find(q => q.id === questId && q.isActive);
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
                $push: { completedSpecialQuests: questId, transactions: { $each: [{ name: `Special Quest: ${quest.title}`, amount: quest.reward, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Вы уже получили награду за этот квест' });
        }

        {
            const xpGain = 20;
            const needed = xpNeeded(updatedUser.level);
            const newXp = updatedUser.xp + xpGain;
            if (newXp >= needed) {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { level: 1 }, $set: { xp: newXp - needed } });
                updatedUser.level += 1;
                updatedUser.xp = newXp - needed;
            } else {
                await User.updateOne({ _id: updatedUser._id }, { $inc: { xp: xpGain } });
                updatedUser.xp = newXp;
            }
        }
        
        res.json({ success: true, reward: quest.reward, message: `Выполнено! +${quest.reward} MMO`, user: formatUser(updatedUser) });
    } catch (e) {
        console.error('complete-special-quest error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// MARKETPLACE (С ЗАЩИТОЙ ОТ ФАРМА)
// ============================================
app.post('/api/marketplace/list', authMiddleware, async (req, res) => {
    try {
        const { creatureId, price, isDust, dustAmount } = req.body;
        const user = req.user;

        if ((user.level || 1) < 5) {
            return res.status(403).json({ success: false, message: 'Маркет доступен с 5 уровня' });
        }

        const config = await getGameConfig();
        const limits = config.limits;

        const activeListingsCount = await Marketplace.countDocuments({ sellerTgId: user.telegramId, active: true });
        if (activeListingsCount >= MAX_ACTIVE_LISTINGS) {
            return res.status(400).json({ success: false, message: `Вы уже выставили ${MAX_ACTIVE_LISTINGS} лотов. Сначала отмените или дождитесь продажи существующих.` });
        }

        if (isDust) {
            const amount = parseInt(dustAmount, 10);
            if (!amount || amount < 1) {
                return res.status(400).json({ success: false, message: 'Укажите количество пыли' });
            }
            if (!price || price < MIN_DUST_PRICE * amount) {
                return res.status(400).json({ success: false, message: `Минимальная цена ${MIN_DUST_PRICE} MMO за 1 пыль` });
            }
            if (price > limits.maxMarketplacePrice) {
                return res.status(400).json({ success: false, message: `Максимальная цена ${limits.maxMarketplacePrice} MMO` });
            }
            const dustUpdated = await User.findOneAndUpdate(
                { _id: user._id, dust: { $gte: amount } },
                { $inc: { dust: -amount } },
                { new: true }
            );
            if (!dustUpdated) {
                return res.status(400).json({ success: false, message: `Недостаточно пыли (у вас: ${user.dust || 0})` });
            }
            let listing;
            try {
                listing = await Marketplace.create({
                    sellerId: user._id,
                    sellerTgId: user.telegramId,
                    sellerName: user.username || user.firstName || `User${user.telegramId.slice(-4)}`,
                    isDust: true,
                    dustAmount: amount,
                    price,
                    active: true
                });
            } catch (createErr) {
                await User.findByIdAndUpdate(user._id, { $inc: { dust: amount } });
                throw createErr;
            }
            marketplaceListingsCache = { data: null, expiresAt: 0 };
            return res.json({ success: true, listing, dust: dustUpdated.dust });
        }

        const creature = await getCreature(creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });

        if (creature.rarity === 'common' && price > MAX_COMMON_PRICE) {
            return res.status(400).json({ success: false, message: `Common существ нельзя продавать дороже ${MAX_COMMON_PRICE} MMO` });
        }
        if (!price || price < MIN_MARKETPLACE_PRICE) {
            return res.status(400).json({ success: false, message: `Минимальная цена ${MIN_MARKETPLACE_PRICE} MMO` });
        }
        if (price > limits.maxMarketplacePrice) {
            return res.status(400).json({ success: false, message: `Максимальная цена ${limits.maxMarketplacePrice} MMO` });
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

        if (invItem.count <= 0 && user.arenaTeam && user.arenaTeam.includes(creatureId)) {
            const newTeam = user.arenaTeam.filter(id => id !== creatureId);
            await User.updateOne({ _id: user._id }, { $set: { arenaTeam: newTeam } });
        }

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

        if (!listingId || !mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ success: false, message: 'Неверный listingId' });
        }
        const listing = await Marketplace.findById(listingId);
        if (!listing || !listing.active) {
            return res.status(400).json({ success: false, message: 'Лот не найден или уже продан' });
        }

        if (listing.sellerTgId === buyer.telegramId) {
            return res.status(400).json({ success: false, message: 'Нельзя купить свой лот' });
        }

        if ((buyer.level || 1) < 5) {
            return res.status(403).json({ success: false, message: 'Маркет доступен с 5 уровня' });
        }

        const buyerInventory = await Inventory.find({ telegramId: buyer.telegramId });
        const usedSlots = buyerInventory.reduce((sum, i) => sum + i.count, 0);
        if (usedSlots >= buyer.inventorySlots) {
            return res.status(400).json({ success: false, message: 'Инвентарь покупателя полон' });
        }

        const closedListing = await Marketplace.findOneAndUpdate(
            { _id: listingId, active: true },
            { $set: { active: false } },
            { new: true }
        );
        if (!closedListing) {
            return res.status(400).json({ success: false, message: 'Лот уже куплен другим игроком' });
        }

        const fee = Math.floor(listing.price * 0.1);
        const sellerEarns = listing.price - fee;

        if (listing.isDust) {
            const updatedBuyer = await User.findOneAndUpdate(
                { _id: buyer._id, balance: { $gte: listing.price } },
                { $inc: { balance: -listing.price, dust: listing.dustAmount } },
                { new: true }
            );
            if (!updatedBuyer) {
                await Marketplace.findByIdAndUpdate(listingId, { $set: { active: true } });
                return res.status(400).json({ success: false, message: 'Недостаточно MMO' });
            }
            const seller = await User.findOne({ telegramId: listing.sellerTgId });
            if (seller) {
                await User.findByIdAndUpdate(seller._id, { $inc: { balance: sellerEarns } });
            }
            MarketSaleHistory.create({
                listingId: closedListing._id,
                creatureId: 'DUST',
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
            }).catch(() => {});
            marketplaceListingsCache = { data: null, expiresAt: 0 };
            return res.json({
                success: true,
                isDust: true,
                dustAmount: listing.dustAmount,
                user: formatUser(updatedBuyer),
                inventory: await formatInventory(buyer.telegramId)
            });
        }

        const creature = await getCreature(listing.creatureId);
        if (!creature) {
            await Marketplace.findByIdAndUpdate(listingId, { $set: { active: true } });
            return res.status(400).json({ success: false, message: 'Существо не найдено' });
        }

        const updatedBuyer = await User.findOneAndUpdate(
            { _id: buyer._id, balance: { $gte: listing.price } },
            {
                $inc: { balance: -listing.price },
                $push: { transactions: { $each: [{ name: `Bought: ${creature.name} from ${listing.sellerName}`, amount: -listing.price, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );

        if (!updatedBuyer) {
            await Marketplace.findByIdAndUpdate(listingId, { $set: { active: true } });
            return res.status(400).json({ success: false, message: 'Недостаточно MMO' });
        }

        const seller = await User.findOne({ telegramId: listing.sellerTgId });
        if (seller) {
            await User.findByIdAndUpdate(seller._id, {
                $inc: { balance: sellerEarns },
                $push: { transactions: { $each: [{ name: `Sold: ${creature.name}`, amount: sellerEarns, time: new Date() }], $position: 0, $slice: 30 } }
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

        {
            const xpGain = 5;
            const needed = xpNeeded(updatedBuyer.level);
            const newXp = updatedBuyer.xp + xpGain;
            const xpUpdate = newXp >= needed
                ? { $inc: { level: 1 }, $set: { xp: newXp - needed } }
                : { $inc: { xp: xpGain } };
            await User.findOneAndUpdate(
                { _id: updatedBuyer._id },
                {
                    $addToSet: { discovered: listing.creatureId },
                    $inc: { ...(xpUpdate.$inc || {}) },
                    $set: { ...(xpUpdate.$set || {}) }
                }
            );
            if (newXp >= needed) { updatedBuyer.level += 1; updatedBuyer.xp = newXp - needed; }
            else { updatedBuyer.xp = newXp; }
        }

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

app.get('/api/marketplace/listings', async (req, res) => {
    try {
        if (Date.now() < marketplaceListingsCache.expiresAt && marketplaceListingsCache.data) {
            return res.json({ success: true, listings: marketplaceListingsCache.data });
        }
        
        const listings = await Marketplace.find({ active: true }).sort({ createdAt: -1 }).limit(50).lean();
        marketplaceListingsCache = { data: listings, expiresAt: Date.now() + 10 * 1000 };
        res.json({ success: true, listings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/api/marketplace/my-listings', authMiddleware, async (req, res) => {
    try {
        const listings = await Marketplace.find({ sellerTgId: req.user.telegramId, active: true }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, listings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/marketplace/cancel', authMiddleware, async (req, res) => {
    try {
        const { listingId } = req.body;
        const user = req.user;

        if (!listingId || !mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ success: false, message: 'Неверный listingId' });
        }

        const listing = await Marketplace.findOneAndUpdate(
            { _id: listingId, active: true, sellerTgId: user.telegramId },
            { $set: { active: false } },
            { new: false }
        );
        if (!listing) {
            return res.status(400).json({ success: false, message: 'Лот не найден, уже отменён или не принадлежит вам' });
        }

        if (!listing.isDust) {
            const inventory = await Inventory.find({ telegramId: user.telegramId });
            const usedSlots = inventory.reduce((sum, i) => sum + i.count, 0);
            if (usedSlots >= user.inventorySlots) {
                await Marketplace.findByIdAndUpdate(listingId, { $set: { active: true } });
                return res.status(400).json({ success: false, message: 'Нет свободных слотов в инвентаре. Продайте или объедините существа.' });
            }
        }

        if (listing.isDust) {
            const dustRefunded = await User.findByIdAndUpdate(
                user._id, { $inc: { dust: listing.dustAmount } }, { new: true }
            );
            marketplaceListingsCache = { data: null, expiresAt: 0 };
            return res.json({ success: true, dust: dustRefunded?.dust ?? ((user.dust || 0) + listing.dustAmount) });
        }

        let invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId: listing.creatureId });
        if (invItem) {
            invItem.count += 1;
            await invItem.save();
        } else {
            await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId: listing.creatureId, count: 1 });
        }

        marketplaceListingsCache = { data: null, expiresAt: 0 };
        invalidateInventoryCache(user.telegramId);
        const updatedInventory = await formatInventory(user.telegramId);

        res.json({ success: true, inventory: updatedInventory });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// LEADERBOARD
// ============================================
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
        
        leaderboardCache = { data, expiresAt: Date.now() + 120 * 1000 };
        res.json({ success: true, ...data });
    } catch (e) {
        console.error('leaderboard error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// АРЕНА - ЭНДПОИНТЫ
// ============================================

let arenaSocketManager = null;
let arenaManager = null;

app.get('/api/arena/team', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const arenaTeam = user.arenaTeam || [];
        
        const teamWithStats = [];
        for (const creatureId of arenaTeam) {
            const creature = await getCreature(creatureId);
            if (creature) {
                const stats = ArenaModule.calculateCreatureStats(creature, user.level);
                teamWithStats.push({
                    creatureId: creature.id,
                    name: creature.name,
                    icon: creature.icon,
                    rarity: creature.rarity,
                    ...stats
                });
            }
        }
        
        res.json({ success: true, team: teamWithStats, teamIds: arenaTeam });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/team', authMiddleware, async (req, res) => {
    try {
        const { team } = req.body;
        const user = req.user;
        
        if (!Array.isArray(team) || team.length !== 3) {
            return res.status(400).json({ success: false, message: 'Нужно выбрать ровно 3 питомца' });
        }
        
        const uniqueIds = new Set(team);
        if (uniqueIds.size !== 3) {
            return res.status(400).json({ success: false, message: 'Питомцы не должны повторяться' });
        }
        
        const inventory = await Inventory.find({ telegramId: user.telegramId }).lean();
        const inventoryMap = new Map();
        for (const item of inventory) {
            inventoryMap.set(item.creatureId, item.count);
        }
        
        for (const creatureId of team) {
            const count = inventoryMap.get(creatureId);
            if (count === undefined || count < 1) {
                return res.status(400).json({ success: false, message: `Питомец ${creatureId} не найден в инвентаре` });
            }
        }
        
        await User.updateOne({ _id: user._id }, { $set: { arenaTeam: team } });
        
        res.json({ success: true, team });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/cancel-search', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (user.currentBattleId) {
            const battle = await ArenaBattle.findOneAndUpdate(
                { _id: user.currentBattleId, status: 'waiting' },
                { $set: { status: 'expired' } },
                { new: false }
            );
            if (battle) {
                await User.findByIdAndUpdate(user._id, {
                    $inc: { balance: battle.entryFee },
                    $set: { currentBattleId: null }
                });
                await User.updateOne(
                    { _id: user._id, arenaBattlesLeft: { $lt: MAX_ARENA_BATTLES } },
                    { $inc: { arenaBattlesLeft: 1 } }
                );
            } else {
                await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/find-match', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова, попробуйте позже' });
    try {
        const user = req.user;
        
        const arenaTeam = user.arenaTeam || [];
        if (arenaTeam.length !== 3) {
            return res.status(400).json({ success: false, message: 'Сначала выберите команду из 3 питомцев' });
        }

        if ((user.level || 1) < 3) {
            return res.status(403).json({ success: false, message: 'Арена доступна с 3 уровня' });
        }
        
        if (user.currentBattleId) {
            const existingBattle = await ArenaBattle.findById(user.currentBattleId);
            if (existingBattle && ['waiting', 'pending_confirmation', 'active'].includes(existingBattle.status)) {
                return res.status(400).json({ success: false, message: 'У вас уже есть активный бой или поиск' });
            }
        }
        
        if (user.arenaCooldownUntil && new Date(user.arenaCooldownUntil) > new Date()) {
            const secondsLeft = Math.ceil((new Date(user.arenaCooldownUntil) - new Date()) / 1000);
            return res.status(400).json({ success: false, message: `Подождите ${secondsLeft} секунд перед следующим боем` });
        }

        const battlesLeft = 999;

        const inventory = await Inventory.find({ telegramId: user.telegramId }).lean();
        const inventoryMap = new Map(inventory.map(i => [i.creatureId, i.count]));
        const missingCreatures = arenaTeam.filter(id => !inventoryMap.get(id) || inventoryMap.get(id) < 1);
        if (missingCreatures.length > 0) {
            const newTeam = arenaTeam.filter(id => inventoryMap.get(id) >= 1);
            await User.updateOne({ _id: user._id }, { $set: { arenaTeam: newTeam } });
            return res.status(400).json({ 
                success: false, 
                message: 'Некоторых существ из вашей команды нет в инвентаре (возможно они на маркете). Обновите команду в разделе "Команда".',
                teamReset: true
            });
        }

        const result = await arenaManager.findMatch(user, arenaTeam);

        if (!result.success) {
            return res.status(400).json(result);
        }

        let battlesLeftAfter = 999;
        
        if (!result.isNew) {
            arenaSocketManager?.send(result.battle.player1Id, 'match_found', {
                battleId: result.battle._id,
                status: 'pending_confirmation',
                isPlayer1: true,
                prizePool: result.battle.prizePool,
                entryFee: result.entryFee,
                myTeam: result.battle.player1Team
            });
            
            arenaSocketManager?.send(result.battle.player2Id, 'match_found', {
                battleId: result.battle._id,
                status: 'pending_confirmation',
                isPlayer1: false,
                prizePool: result.battle.prizePool,
                entryFee: result.entryFee,
                myTeam: result.battle.player2Team
            });
        }
        
        res.json({
            success: true,
            battle: result.battle,
            isNew: result.isNew,
            battlesLeft: battlesLeftAfter,
            maxArenaBattles: MAX_ARENA_BATTLES,
            message: result.isNew ? 'Поиск соперника...' : 'Соперник найден! Ожидайте подтверждения.'
        });
    } catch (e) {
        console.error('arena find-match error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/arena/battle/status', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const user = req.user;
        
        if (!user.currentBattleId) {
            return res.json({ success: true, hasBattle: false });
        }
        
        const battle = await ArenaBattle.findById(user.currentBattleId);
        if (!battle) {
            await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
            return res.json({ success: true, hasBattle: false });
        }
        
        if (['waiting', 'pending_confirmation'].includes(battle.status) && battle.expiresAt < new Date()) {
            battle.status = 'expired';
            await battle.save();
            await User.updateOne({ _id: user._id }, {
                $set: { currentBattleId: null, arenaCooldownUntil: null }
            });
            await User.updateOne(
                { _id: user._id, arenaBattlesLeft: { $lt: MAX_ARENA_BATTLES } },
                { $inc: { arenaBattlesLeft: 1 } }
            );
            return res.json({ success: true, hasBattle: false, expired: true });
        }
        
        const isPlayer1 = battle.player1Id.toString() === user._id.toString();
        const isActive = battle.status === 'active';

        const response = {
            success: true,
            hasBattle: true,
            battleId: battle._id,
            status: battle.status,
            isPlayer1: isPlayer1,
            player1Confirmed: battle.player1Confirmed,
            player2Confirmed: battle.player2Confirmed,
            league: battle.league,
            entryFee: battle.entryFee,
            prizePool: battle.prizePool,
            currentTurn: battle.currentTurn,
            turnCount: battle.turnCount,
            lastMoveAt: battle.lastMoveAt,
            myTeam: isPlayer1 ? battle.player1Team : battle.player2Team,
            opponentTeam: isActive ? (isPlayer1 ? battle.player2Team : battle.player1Team) : undefined,
            battleLog: battle.battleLog ? battle.battleLog.slice(-20) : []
        };

        if (isActive) {
            const timeSinceLastMove = (Date.now() - new Date(battle.lastMoveAt).getTime()) / 1000;
            response.timeLeft = Math.max(0, 30 - Math.floor(timeSinceLastMove));
            response.serverTimestamp = Date.now();
            const opponentId = isPlayer1 ? battle.player2Id : battle.player1Id;
            if (opponentId) {
                const opp = await User.findById(opponentId).select('username firstName level').lean();
                response.opponent = { name: opp?.username || opp?.firstName || 'Соперник', level: opp?.level };
            }
        }

        return res.json(response);
        
    } catch (e) {
        console.error('arena battle status error:', e);
        return res.status(200).json({ success: false, hasBattle: false, message: e.message });
    }
});

app.post('/api/arena/accept-match', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова' });
    try {
        const { battleId } = req.body;
        if (!battleId || !mongoose.Types.ObjectId.isValid(battleId)) {
            return res.status(400).json({ success: false, message: 'Неверный battleId' });
        }
        const result = await arenaManager.acceptMatch(battleId, req.user._id);
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        if (result.bothConfirmed) {
            const battle = result.battle;
            const player1 = await User.findById(battle.player1Id).select('username firstName level');
            const player2 = await User.findById(battle.player2Id).select('username firstName level');
            
            arenaSocketManager?.send(battle.player1Id, 'battle_start', {
                battleId: battle._id,
                status: 'active',
                isPlayer1: true,
                currentTurn: battle.currentTurn,
                myTeam: battle.player1Team,
                opponentTeam: battle.player2Team,
                opponent: { name: player2?.username || player2?.firstName || 'Соперник', level: player2?.level },
                prizePool: battle.prizePool,
                entryFee: battle.entryFee,
                battleLog: battle.battleLog,
                timeLeft: 30
            });
            
            arenaSocketManager?.send(battle.player2Id, 'battle_start', {
                battleId: battle._id,
                status: 'active',
                isPlayer1: false,
                currentTurn: battle.currentTurn,
                myTeam: battle.player2Team,
                opponentTeam: battle.player1Team,
                opponent: { name: player1?.username || player1?.firstName || 'Соперник', level: player1?.level },
                prizePool: battle.prizePool,
                entryFee: battle.entryFee,
                battleLog: battle.battleLog,
                timeLeft: 30
            });
        } else {
            arenaSocketManager?.send(result.battle.player1Id, 'confirmation_update', {
                player1Confirmed: result.battle.player1Confirmed,
                player2Confirmed: result.battle.player2Confirmed
            });
            arenaSocketManager?.send(result.battle.player2Id, 'confirmation_update', {
                player1Confirmed: result.battle.player1Confirmed,
                player2Confirmed: result.battle.player2Confirmed
            });
        }
        
        res.json(result);
    } catch (e) {
        console.error('arena accept error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/reject-match', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова' });
    try {
        const { battleId } = req.body;
        if (!battleId || !mongoose.Types.ObjectId.isValid(battleId)) {
            return res.status(400).json({ success: false, message: 'Неверный battleId' });
        }
        const battleBefore = await ArenaBattle.findById(battleId);
        const result = await arenaManager.rejectMatch(battleId, req.user._id);
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        if (battleBefore && arenaSocketManager) {
            const rejecterId = req.user._id.toString();
            const otherId = battleBefore.player1Id.toString() === rejecterId
                ? battleBefore.player2Id
                : battleBefore.player1Id;
            if (otherId) {
                arenaSocketManager?.send(otherId, 'match_rejected', {
                    battleId: battleId,
                    message: 'Соперник отклонил бой. Ставка возвращена.'
                });
            }
            arenaSocketManager?.send(req.user._id, 'match_rejected', {
                battleId: battleId,
                message: 'Вы отклонили бой. Ставка возвращена.'
            });
        }
        
        res.json(result);
    } catch (e) {
        console.error('arena reject error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/move', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова' });
    try {
        const { battleId, targetIndex } = req.body;
        if (!battleId || !mongoose.Types.ObjectId.isValid(battleId)) {
            return res.status(400).json({ success: false, message: 'Неверный battleId' });
        }
        const ti = parseInt(targetIndex, 10);
        if (isNaN(ti) || ti < 0 || ti > 2) {
            return res.status(400).json({ success: false, message: 'Неверный targetIndex (0-2)' });
        }
        const result = await arenaManager.processMove(battleId, req.user._id, ti);
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        if (result.finished) {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) {
                const _lcEnd = ArenaModule?.LEAGUE_CONFIG?.[battle.league] || { dustWin: 0 };
                const _isP1Win = result.winnerId && battle.player1Id.toString() === result.winnerId.toString();
                const _xpW = result.xpGained || 0;
                const _xpL = result.xpLose || 0;
                const _base = { battleId: battle._id, winnerId: result.winnerId?.toString(), lastMove: result.lastMove, prizePool: battle.prizePool, dustWin: _lcEnd.dustWin||0, ratingChange: result.ratingChange||0, entryFee: battle.entryFee||0 };
                arenaSocketManager?.send(battle.player1Id, 'battle_end', { ..._base, xpGained: _isP1Win?_xpW:_xpL });
                arenaSocketManager?.send(battle.player2Id, 'battle_end', { ..._base, xpGained: _isP1Win?_xpL:_xpW });
                result.dustWin = _lcEnd.dustWin || 0;
                result.entryFee = battle.entryFee || 0;
                resetRateLimitForUser(battle.player1Id);
                resetRateLimitForUser(battle.player2Id);
            }
        } else {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) {
                const isPlayer1Move = battle.player1Id.toString() === req.user._id.toString();
                const opponentId = isPlayer1Move ? battle.player2Id : battle.player1Id;
                const moverId = req.user._id;
                
                const moveUpdatePayload = {
                    battleId: battle._id,
                    lastMove: result.lastMove,
                    currentTurn: result.currentTurn,
                    turnCount: result.turnCount,
                    player1Team: battle.player1Team,
                    player2Team: battle.player2Team,
                    skillResult: result.skillResult || null,
                    poisonLog: result.poisonLog || [],
                    timeLeft: result.timeLeft || 30,
                    serverTimestamp: result.serverTimestamp || Date.now()
                };
                
                arenaSocketManager?.send(opponentId, 'move_update', moveUpdatePayload);
            }
        }
        
        res.json(result);
    } catch (e) {
        console.error('arena move error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/arena/surrender', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова' });
    try {
        const { battleId } = req.body;
        if (!battleId || !mongoose.Types.ObjectId.isValid(battleId)) {
            return res.status(400).json({ success: false, message: 'Неверный battleId' });
        }
        const result = await arenaManager.surrenderBattle(battleId, req.user._id);
        
        if (result.success) {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) {
                const _lcSurr = ArenaModule?.LEAGUE_CONFIG?.[battle.league] || { dustWin: 0 };
                const _sWid = battle.winnerId?.toString();
                const _isP1WS = _sWid && battle.player1Id.toString() === _sWid;
                const _xpWS = result.xpGained || 0;
                const _xpLS = result.xpLose || 0;
                const _baseS = { battleId: battle._id, winnerId: _sWid, surrendered: true, prizePool: battle.prizePool, dustWin: _lcSurr.dustWin||0, ratingChange: result.ratingChange||0, entryFee: battle.entryFee||0 };
                arenaSocketManager?.send(battle.player1Id, 'battle_end', { ..._baseS, xpGained: _isP1WS?_xpWS:_xpLS });
                arenaSocketManager?.send(battle.player2Id, 'battle_end', { ..._baseS, xpGained: _isP1WS?_xpLS:_xpWS });
                resetRateLimitForUser(battle.player1Id);
                resetRateLimitForUser(battle.player2Id);
            }
        }
        
        res.json(result);
    } catch (e) {
        console.error('arena surrender error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/arena/battles-status', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        await regenerateArenaBattles(user);
        const battlesLeft = user.arenaBattlesLeft ?? MAX_ARENA_BATTLES;
        const now = Date.now();
        const lastRegen = user.arenaLastBattleRegen ? new Date(user.arenaLastBattleRegen).getTime() : now;
        const msUntilNext = ARENA_BATTLE_REGEN_INTERVAL - ((now - lastRegen) % ARENA_BATTLE_REGEN_INTERVAL);
        res.json({
            success: true,
            battlesLeft,
            maxArenaBattles: MAX_ARENA_BATTLES,
            nextRegenMinutes: battlesLeft < MAX_ARENA_BATTLES ? Math.ceil(msUntilNext / 60000) : 0
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/arena/leaderboard', authMiddleware, async (req, res) => {
    if (!arenaManager) return res.status(503).json({ success: false, message: 'Арена не готова' });
    try {
        const leaders = await arenaManager.getLeaderboard();
        const myStats = await arenaManager.getUserStats(req.user._id);
        
        let nextLeague = null;
        let nextRatingRequired = null;
        let currentLeagueRating = 1000;
        
        if (myStats) {
            const leagues = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
            const currentIdx = leagues.indexOf(myStats.league);
            
            if (currentIdx < leagues.length - 1) {
                nextLeague = leagues[currentIdx + 1];
                const leagueConf = ArenaModule.LEAGUE_CONFIG;
                nextRatingRequired = leagueConf[nextLeague]?.minRating || null;
                currentLeagueRating = leagueConf[myStats.league]?.minRating || 0;
            }
        }
        
        const myRank = await ArenaStats.countDocuments({ rating: { $gt: myStats?.rating || 1000 } }) + 1;
        
        res.json({ 
            success: true, 
            leaders: leaders.map(l => ({
                ...l,
                league: l.league || 'bronze'
            })),
            myRank, 
            myStats: {
                rating: myStats?.rating || 1000,
                league: myStats?.league || 'bronze',
                wins: myStats?.wins || 0,
                losses: myStats?.losses || 0,
                streak: myStats?.streak || 0,
                peakRating: myStats?.peakRating || 1000,
                promotions: myStats?.promotions || 0,
                totalEarned: myStats?.totalEarned || 0,
                totalLost: myStats?.totalLost || 0
            },
            nextLeague: nextLeague,
            nextRatingRequired: nextRatingRequired,
            currentLeagueRating: currentLeagueRating
        });
    } catch (e) {
        console.error('arena leaderboard error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/arena/history', authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id;
        
        const battles = await ArenaBattle.find({
            $or: [{ player1Id: userId }, { player2Id: userId }],
            status: 'finished'
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('player1Id', 'username firstName')
            .populate('player2Id', 'username firstName')
            .lean();
        
        const history = battles.map(battle => {
            const isPlayer1 = battle.player1Id._id.toString() === userId.toString();
            const opponent = isPlayer1 ? battle.player2Id : battle.player1Id;
            const isWin = battle.winnerId && battle.winnerId.toString() === userId.toString();
            
            return {
                id: battle._id,
                opponent: opponent?.username || opponent?.firstName || 'Unknown',
                isWin: isWin,
                league: battle.league,
                prizePool: battle.prizePool,
                entryFee: battle.entryFee,
                createdAt: battle.createdAt
            };
        });
        
        res.json({ success: true, history });
    } catch (e) {
        console.error('arena history error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// RAID BOSS API
// ============================================

// Получить текущий рейд
app.get('/api/raid/current', authMiddleware, async (req, res) => {
    try {
        const raid = await ensureRaidForToday();
        
        const participantsCount = await RaidParticipant.countDocuments({ raidId: raid._id });
        const myParticipant = await RaidParticipant.findOne({
            raidId: raid._id,
            telegramId: req.user.telegramId
        });
        
        const participants = await RaidParticipant.find({ raidId: raid._id })
            .sort({ totalDamage: -1 })
            .limit(10)
            .populate('userId', 'username firstName');
        
        const raidTime = raid.scheduledAt || getRaidTime();
        const fightEndTime = new Date(raidTime.getTime() + 15 * 20 * 1000); // 15 ходов * 20 сек
        
        res.json({
            success: true,
            raid: {
                _id: raid._id,
                raidId: raid.raidId,
                phase: raid.phase,
                entryFee: raid.entryFee,
                totalPrizePool: raid.totalPrizePool,
                currentTurn: raid.currentTurn,
                turnEndsAt: raid.turnEndsAt ? new Date(raid.turnEndsAt).getTime() : null,
                startTime: raid.startTime,
                endTime: raid.endTime,
                participantsCount,
                myDamage: myParticipant?.totalDamage || 0,
                myAttacks: myParticipant?.attacksCount || 0,
                myPetId: myParticipant?.petId || null,
                isRegistered: !!myParticipant,
                raidStartTime: raidTime,
                raidEndTime: fightEndTime,
                topParticipants: participants.map(p => ({
                    username: p.userId?.username || p.username || 'Anonymous',
                    damage: p.totalDamage
                }))
            }
        });
    } catch (e) {
        console.error('raid current error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Записаться на рейд и выбрать питомца
app.post('/api/raid/join', authMiddleware, async (req, res) => {
    try {
        const { petId } = req.body;
        const user = req.user;
        
        const raid = await ensureRaidForToday();
        
        if (raid.phase !== 'registration') {
            return res.status(400).json({ success: false, message: 'Рейд уже начался или завершён' });
        }
        
        const existing = await RaidParticipant.findOne({
            raidId: raid._id,
            telegramId: user.telegramId
        });
        
        if (existing) {
            return res.status(400).json({ success: false, message: 'Вы уже записаны на рейд' });
        }
        
        // Получаем данные питомца
        const creature = await getCreature(petId);
        if (!creature) {
            return res.status(400).json({ success: false, message: 'Питомец не найден' });
        }
        
        // Проверяем, есть ли питомец в инвентаре
        const inventory = await Inventory.findOne({
            telegramId: user.telegramId,
            creatureId: petId,
            count: { $gte: 1 }
        });
        
        if (!inventory) {
            return res.status(400).json({ success: false, message: 'У вас нет этого питомца' });
        }
        
        // Списываем взнос
        const entryFee = raid.entryFee;
        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: entryFee } },
            {
                $inc: { balance: -entryFee },
                $push: {
                    transactions: {
                        $each: [{ name: `Raid Entry: ${raid.raidId}`, amount: -entryFee, time: new Date() }],
                        $position: 0,
                        $slice: 30
                    }
                }
            },
            { new: true }
        );
        
        if (!updatedUser) {
            return res.status(400).json({ success: false, message: `Недостаточно MMO. Нужно ${entryFee} MMO` });
        }
        
        // Добавляем взнос в пул
        await Raid.findByIdAndUpdate(raid._id, {
            $inc: { totalPrizePool: entryFee }
        });
        
        // Создаём запись участника
        const skill = getSkillForCreature(petId);
        await RaidParticipant.create({
            raidId: raid._id,
            userId: user._id,
            telegramId: user.telegramId,
            username: user.username || user.firstName || `User${user.telegramId.slice(-4)}`,
            petId,
            petAttack: creature.incomeBase * 2, // ATK питомца для рейда
            petCritChance: 0.1,
            petSkill: skill,
            totalDamage: 0,
            attacksCount: 0,
            attackedInCurrentTurn: false
        });
        
        res.json({
            success: true,
            message: `Вы записаны на рейд! Питомец: ${creature.name}`,
            balance: updatedUser.balance,
            totalPrizePool: raid.totalPrizePool + entryFee
        });
        
    } catch (e) {
        console.error('raid join error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Атаковать босса
app.post('/api/raid/attack', authMiddleware, async (req, res) => {
    try {
        const user = req.user;

const raid = await Raid.findOne({ phase: { $in: ['registration', 'fighting'] } }).sort({ scheduledAt: 1 });
        if (!raid || raid.phase !== 'fighting') {
            return res.status(400).json({ success: false, message: 'Рейд не активен' });
        }
        
        // Проверяем, что ход ещё не закончился
        if (raid.turnEndsAt && new Date() >= raid.turnEndsAt) {
            return res.status(400).json({ success: false, message: 'Ход закончился! Следующий ход через несколько секунд.' });
        }
        
        const participant = await RaidParticipant.findOne({
            raidId: raid._id,
            telegramId: user.telegramId
        });
        
        if (!participant) {
            return res.status(400).json({ success: false, message: 'Вы не записаны на рейд' });
        }
        
        // Проверяем, не атаковал ли уже в этом ходу
        if (participant.attackedInCurrentTurn) {
            return res.status(400).json({ success: false, message: 'Вы уже атаковали в этом ходу!' });
        }
        
        // Расчёт урона
        let baseDamage = participant.petAttack;
        
        // Крит
        let isCrit = false;
        if (Math.random() < participant.petCritChance) {
            baseDamage = Math.floor(baseDamage * 1.5);
            isCrit = true;
        }
        
        let finalDamage = baseDamage;
        let skillTriggered = false;
        let skillName = null;
        
        // Скилл (если есть)
        if (participant.petSkill && Math.random() < participant.petSkill.chance) {
            skillTriggered = true;
            skillName = participant.petSkill.name;
            
            // Применяем множитель скилла
            switch (participant.petSkill.id) {
                case 'ancient_wings':
                    finalDamage = Math.floor(baseDamage * 1.8);
                    break;
                case 'divine_flood':
                case 'sharp_talons':
                case 'howl':
                case 'eternal_flame':
                case 'king_roar':
                    finalDamage = Math.floor(baseDamage * 1.5);
                    break;
                case 'eternal_magic':
                case 'divine_sight':
                case 'ancient_fire':
                case 'legendary_fury':
                case 'divine_inferno':
                    finalDamage = Math.floor(baseDamage * 2);
                    break;
                case 'alpha_strike':
                    finalDamage = Math.floor(baseDamage * 2.5);
                    break;
                case 'twin_axes':
                    finalDamage = Math.floor(baseDamage * 3);
                    break;
                case 'pack_call':
                    finalDamage = Math.floor(baseDamage * 1.4);
                    break;
                case 'flame':
                    finalDamage = Math.floor(baseDamage * 1.6);
                    break;
                case 'bite':
                    finalDamage = Math.floor(baseDamage * 1.5);
                    break;
                default:
                    finalDamage = baseDamage;
            }
        }
        
        finalDamage = Math.max(1, finalDamage);
        
        // Обновляем статистику участника
        await RaidParticipant.updateOne(
            { _id: participant._id },
            {
                $inc: { totalDamage: finalDamage, attacksCount: 1 },
                $set: { attackedInCurrentTurn: true }
            }
        );
        
        // Получаем обновлённого участника для ответа
        const updatedParticipant = await RaidParticipant.findById(participant._id);
        
        // Рассылаем обновление всем через WebSocket
        io.emit('raid_attack', {
            raidId: raid._id,
            attackerName: user.username || user.firstName || 'Игрок',
            damage: finalDamage,
            isCrit,
            skillTriggered,
            skillName,
            totalDamage: updatedParticipant.totalDamage,
            currentTurn: raid.currentTurn
        });
        
        res.json({
            success: true,
            damage: finalDamage,
            isCrit,
            skillTriggered,
            skillName,
            totalDamage: updatedParticipant.totalDamage,
            attacksCount: updatedParticipant.attacksCount,
            currentTurn: raid.currentTurn,
            turnEndsAt: raid.turnEndsAt,
            message: `Вы нанесли ${finalDamage} урона!${isCrit ? ' КРИТ!' : ''}${skillTriggered ? ` Сработал навык: ${skillName}!` : ''}`
        });
        
    } catch (e) {
        console.error('raid attack error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// История рейдов
app.get('/api/raid/history', authMiddleware, async (req, res) => {
    try {
        const history = await RaidHistory.find()
            .sort({ defeatedAt: -1 })
            .limit(20)
            .lean();
        
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// STAKING ENDPOINTS
// ============================================
// server.js — полная версия STAKING_PLANS

const STAKING_PLANS = {
    // старые планы
    10: { days: 10, rate: 0.10, minAmount: 300000, rewardItem: 'capybara_r', rewardItemName: 'Capybara Rare' },
    30: { days: 30, rate: 0.20, minAmount: 50000, rewardItem: null },
    
    // НОВЫЕ ПЛАНЫ (все 14 дней, 10%)
    14: { 
        days: 14, 
        rate: 0.10, 
        minAmount: 200000, 
        rewardSkin: true, 
        skinName: 'Кросс',
        skinDuration: '1 месяц'
    },
    28: { 
        days: 14, 
        rate: 0.10, 
        minAmount: 500000, 
        rewardSkin: true, 
        skinName: 'Ниндзя',
        skinDuration: '3 месяца'
    },
    56: { 
        days: 14, 
        rate: 0.10, 
        minAmount: 1000000, 
        rewardSkin: true, 
        skinName: 'Любой скин',
        skinDuration: '12 месяцев'
    }
};
app.get('/api/staking/status', authMiddleware, async (req, res) => {
    try {
        const stakings = await Staking.find({ userId: req.user._id, claimed: false }).sort({ createdAt: -1 });
        res.json({ success: true, stakings: stakings || [] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/staking/start', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const { days, amount } = req.body;
        const plan = STAKING_PLANS[Number(days)];
        if (!plan) return res.status(400).json({ success: false, message: 'Неверный план' });

        const amt = Math.floor(Number(amount));
        if (!amt || amt < (plan.minAmount || 1))
            return res.status(400).json({ success: false, message: `Минимум ${(plan.minAmount || 1).toLocaleString()} MMO` });

        const updated = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: amt } },
            {
                $inc: { balance: -amt },
                $push: { transactions: { $each: [{ name: `Стейкинг ${plan.days}д. (+${plan.rate * 100}%${plan.capybara ? ' + Capybara' : ''})`, amount: -amt, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );
        if (!updated) return res.status(400).json({ success: false, message: 'Недостаточно MMO' });

        const reward = Math.floor(amt * plan.rate);
        const endsAt = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);
        let staking;
try {
    staking = await Staking.create({ 
        userId: user._id, 
        amount: amt, 
        days: plan.days, 
        rate: plan.rate, 
        reward, 
        endsAt,
        skinName: plan.skinName || null,
        skinDuration: plan.skinDuration || null
    });
} catch (createErr) {
    // Rollback: вернуть баланс и удалить транзакцию
    await User.findByIdAndUpdate(user._id, {
        $inc: { balance: amt },
        $push: { transactions: { $each: [{ name: `Отмена стейкинга (ошибка)`, amount: amt, time: new Date() }], $position: 0, $slice: 30 } }
    });
    console.error('staking create error (rollback done):', createErr);
    return res.status(500).json({ success: false, message: 'Ошибка создания стейкинга, средства возвращены' });
}

        invalidateInventoryCache(user.telegramId);
        res.json({ success: true, staking, user: formatUser(updated) });
    } catch (e) {
        console.error('staking start error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/staking/claim', authMiddleware, async (req, res) => {
    try {
        const { stakingId } = req.body;
        const user = req.user;
        
        const staking = await Staking.findOneAndUpdate(
            { _id: stakingId, userId: user._id, claimed: false, endsAt: { $lte: new Date() } },
            { $set: { claimed: true } },
            { new: false }
        );
        
        if (!staking) {
            return res.status(400).json({ success: false, message: 'Стейкинг не найден или ещё не завершён' });
        }

        const total = staking.amount + staking.reward;
        const plan = STAKING_PLANS[staking.days];
        
        const updated = await User.findByIdAndUpdate(
            user._id,
            {
                $inc: { balance: total },
                $push: { transactions: { $each: [{ name: `Стейкинг ${staking.days}д. завершён +${staking.reward.toLocaleString()} MMO`, amount: total, time: new Date() }], $position: 0, $slice: 30 } }
            },
            { new: true }
        );

        if (plan && plan.rewardItem === 'capybara_r') {
            await Inventory.findOneAndUpdate(
                { telegramId: user.telegramId, creatureId: 'capybara_r' },
                { $inc: { count: 1 }, $setOnInsert: { userId: user._id, telegramId: user.telegramId, creatureId: 'capybara_r' } },
                { upsert: true }
            );
            await User.findByIdAndUpdate(user._id, { $addToSet: { discovered: 'capybara_r' } });
        }

        invalidateInventoryCache(user.telegramId);
        res.json({ success: true, total, reward: staking.reward, capybara: !!(plan && plan.rewardItem === 'capybara_r'), user: formatUser(updated) });
    } catch (e) {
        console.error('staking claim error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============================================
// WALLET ENDPOINTS
// ============================================
app.post('/api/wallet/get-payment-details', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        const user = req.user;
        
        if (!amount || amount < MIN_TRANSACTION_AMOUNT) {
            return res.status(400).json({ success: false, message: `Минимальная сумма ${MIN_TRANSACTION_AMOUNT} MMO` });
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
        
        if (!amount || amount < MIN_TRANSACTION_AMOUNT || !Number.isInteger(amount)) {
            return res.status(400).json({ success: false, message: `Минимальная сумма ${MIN_TRANSACTION_AMOUNT} MMO (целое число)` });
        }
        
        const WALLET_ADDR_RE = /^[UE]Q[A-Za-z0-9_-]{46}$/;
        if (!wallet || !WALLET_ADDR_RE.test(wallet.trim())) {
            return res.status(400).json({ success: false, message: 'Неверный адрес кошелька (формат: UQ... или EQ..., 48 символов)' });
        }
        
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: 'Недостаточно средств' });
        }
        
        const activeRequestsCount = await TransactionRequest.countDocuments({
            userId: user._id,
            status: 'pending'
        });
        
        if (activeRequestsCount >= MAX_ACTIVE_REQUESTS) {
            return res.status(400).json({ success: false, message: `У вас уже ${MAX_ACTIVE_REQUESTS} активных заявок` });
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
        const user = req.user;
        
        const requests = await TransactionRequest.find({
            userId: user._id,
            status: 'pending'
        }).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            requests: requests.map(req => ({
                id: req._id,
                type: req.type,
                amount: req.amount,
                wallet: req.wallet,
                memo: req.memo,
                status: req.status,
                createdAt: req.createdAt
            }))
        });
    } catch (e) {
        console.error('get wallet requests error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/history', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        
        const requests = await TransactionRequest.find({
            userId: user._id
        }).sort({ createdAt: -1 }).limit(50);
        
        res.json({
            success: true,
            history: requests.map(req => ({
                id: req._id,
                type: req.type,
                amount: req.amount,
                status: req.status,
                createdAt: req.createdAt,
                processedAt: req.processedAt
            }))
        });
    } catch (e) {
        console.error('get wallet history error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// RAID BOSS ФУНКЦИИ И ПЛАНИРОВЩИК
// ============================================

function getRaidTime() {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    const minutes = next.getMinutes();
    const nextSlot = Math.ceil((minutes + 1) / 5) * 5;
    if (nextSlot >= 60) {
        next.setHours(next.getHours() + 1);
        next.setMinutes(0);
    } else {
        next.setMinutes(nextSlot);
    }
    return next;
}

function getTodayRaidId() {
    const raidTime = getRaidTime();
    return `raid_${raidTime.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-')}`;
}
async function ensureRaidForToday() {
    // Сначала ищем активный рейд
    let raid = await Raid.findOne({ phase: { $in: ['registration', 'fighting'] } }).sort({ scheduledAt: 1 });
    if (raid) return raid;

    // Нет активного — создаём новый
    const raidTime = getRaidTime();
    const raidId = `raid_${raidTime.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-')}`;
    raid = await Raid.findOne({ raidId });
    if (!raid) {
        raid = await Raid.create({
            raidId,
            phase: 'registration',
            entryFee: 100,
            totalPrizePool: 0,
            commission: 0,
            playersPrizePool: 0,
            scheduledAt: raidTime
        });
        console.log(`🎮 Создан рейд на ${raidId}`);
    }
    return raid;
}

async function startRaidFight(raidId) {
    const raid = await Raid.findByIdAndUpdate(raidId, {
        $set: { phase: 'fighting', startTime: new Date() }
    }, { new: true });
    if (!raid) return;
    
    console.log(`⚔️ Рейд ${raid.raidId} начал бой!`);
    
    // Рассылаем уведомление всем онлайн
    io.emit('raid_phase_update', {
        phase: 'fighting',
        raidId: raid._id,
        message: '⚔️ БИТВА НАЧАЛАСЬ! Атакуйте босса!'
    });
}

async function startRaidTurns(raidId) {
    const raid = await Raid.findById(raidId);
    if (!raid || raid.phase !== 'fighting') return;
    
    // Сбрасываем флаги атаки у всех участников
    await RaidParticipant.updateMany(
        { raidId: raid._id },
        { $set: { attackedInCurrentTurn: false } }
    );
    
    const turnEndsAt = new Date(Date.now() + 20 * 1000);
    await Raid.findByIdAndUpdate(raidId, {
        $set: { currentTurn: 1, turnEndsAt, endTime: null }
    });
    
    io.emit('raid_turn_start', {
        raidId: String(raid._id),
        turn: 1,
        turnEndsAt: turnEndsAt.getTime()
    });
}

async function nextRaidTurn(raidId) {
    const raid = await Raid.findById(raidId);
    if (!raid || raid.phase !== 'fighting') return;
    
    const nextTurn = raid.currentTurn + 1;
    
    if (nextTurn > 15) {
        await finishRaid(raidId);
        return;
    }
    
    // Сбрасываем флаги атаки для следующего хода
    await RaidParticipant.updateMany(
        { raidId: raid._id },
        { $set: { attackedInCurrentTurn: false } }
    );
    
    const turnEndsAt = new Date(Date.now() + 20 * 1000);
    await Raid.findByIdAndUpdate(raidId, {
        $set: { currentTurn: nextTurn, turnEndsAt }
    });
    
    io.emit('raid_turn_start', {
        raidId: String(raid._id),
        turn: nextTurn,
        turnEndsAt: turnEndsAt.getTime()
    });
}

async function finishRaid(raidId) {
    const raid = await Raid.findById(raidId);
    if (!raid || raid.phase !== 'fighting') return;
    
    const participants = await RaidParticipant.find({ raidId: raid._id })
        .sort({ totalDamage: -1 })
        .populate('userId', 'username firstName telegramId');
    
    if (participants.length === 0) {
        await Raid.findByIdAndUpdate(raidId, { $set: { phase: 'finished', endTime: new Date() } });
        return;
    }
    
    const totalDamage = participants.reduce((sum, p) => sum + p.totalDamage, 0);
    const playersPrizePool = Math.floor(raid.totalPrizePool * 0.9);
    const commission = raid.totalPrizePool - playersPrizePool;
    
    await Raid.findByIdAndUpdate(raidId, {
        $set: {
            playersPrizePool,
            commission,
            phase: 'finished',
            endTime: new Date()
        }
    });
    
    const topDamageList = [];
    
    for (const p of participants) {
        let reward = 0;
        if (p.totalDamage > 0 && totalDamage > 0) {
            reward = Math.floor(playersPrizePool * (p.totalDamage / totalDamage));
            if (reward < 10) reward = 10;
        }
        
        if (reward > 0) {
            await User.findByIdAndUpdate(p.userId._id, {
                $inc: { balance: reward },
                $push: {
                    transactions: {
                        $each: [{ name: `Raid Reward: ${raid.raidId}`, amount: reward, time: new Date() }],
                        $position: 0,
                        $slice: 30
                    }
                }
            });
            
            await RaidParticipant.updateOne(
                { _id: p._id },
                { $set: { reward, claimed: true } }
            );
            
            sendNotificationToUser(p.userId.telegramId,
                `🏆 <b>Рейд завершён!</b>\n\n` +
                `Вы нанесли ${p.totalDamage.toLocaleString()} урона\n` +
                `💰 Ваша награда: +${reward.toLocaleString()} MMO`
            ).catch(() => {});
        }
        
        topDamageList.push({
            username: p.username || p.userId?.username || p.userId?.firstName || 'Anonymous',
            telegramId: p.telegramId,
            damage: p.totalDamage,
            reward
        });
    }
    
    await RaidHistory.create({
        raidId: raid.raidId,
        totalParticipants: participants.length,
        totalPrizePool: raid.totalPrizePool,
        commissionEarned: commission,
        playersPrizePool,
        defeatedAt: new Date(),
        topDamage: topDamageList.slice(0, 10)
    });
    
    io.emit('raid_end', {
        raidId: String(raid._id),
        results: {
            totalParticipants: participants.length,
            totalPrizePool: raid.totalPrizePool,
            topDamage: topDamageList.slice(0, 10).map(p => ({
                username: p.username,
                telegramId: p.telegramId,
                damage: p.damage,
                reward: p.reward
            }))
        }
    });
}

async function processRaidScheduler() {
    const now = new Date();

    // Ищем любой активный рейд
    const raid = await Raid.findOne({ phase: { $in: ['registration', 'fighting'] } }).sort({ scheduledAt: 1 });
    if (!raid) return;

    // Парсим время из raidId если scheduledAt не задан
    let raidTime = raid.scheduledAt;
    if (!raidTime) {
        const parts = raid.raidId.replace('raid_', '').split('_');
        const dateStr = parts[0];
        const timeParts = parts[1].split('-');
        raidTime = new Date(`${dateStr}T${timeParts[0]}:${timeParts[1]}:00Z`);
        await Raid.findByIdAndUpdate(raid._id, { $set: { scheduledAt: raidTime } });
    }

    const fightEndTime = new Date(raidTime.getTime() + 15 * 20 * 1000); // 15 ходов * 20 сек

    console.log(`🕐 ${raid.raidId} | ${raid.phase} | diff: ${Math.round((raidTime-now)/1000)}с`);

    if (raid.phase === 'registration' && now >= raidTime && now < fightEndTime) {
        console.log(`⚔️ Стартуем бой для ${raid.raidId}`);
        await startRaidFight(raid._id);
    }

    if (raid.phase === 'fighting') {
        if (now >= fightEndTime) {
            await finishRaid(raid._id);
        }
        if (raid.turnEndsAt && now >= raid.turnEndsAt && raid.currentTurn < 15) {
            await nextRaidTurn(raid._id);
        }
        if (!raid.turnEndsAt && now >= raidTime) {
            await startRaidTurns(raid._id);
        }
    }
}

// ============================================
// АДМИН: ОБРАБОТКА ЗАЯВОК
// ============================================
app.post('/api/admin/transaction-request/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { action, note } = req.body;
        
        const request = await TransactionRequest.findOneAndUpdate(
            { _id: id, status: 'pending' },
            { $set: { status: action === 'approve' ? 'approved' : 'rejected',
                       adminNote: note || '',
                       processedAt: new Date() } },
            { new: false }
        );
        if (!request) {
            return res.status(400).json({ success: false, message: 'Заявка не найдена или уже обработана' });
        }

        const user = await User.findById(request.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        if (action === 'approve') {
            if (request.type === 'deposit') {
                const updatedUser = await User.findByIdAndUpdate(
                    user._id,
                    {
                        $inc: { balance: request.amount },
                        $push: { transactions: { $each: [{ name: 'Deposit (Подтвержден)', amount: request.amount, time: new Date() }], $position: 0, $slice: 30 } }
                    },
                    { new: true }
                );
                if (user.referredBy && (user.level || 1) >= 5) {
                    const referrer = await User.findOne({ telegramId: user.referredBy });
                    if (referrer) {
                        const referralBonus = Math.floor(request.amount * REFERRAL_BONUS_PERCENT / 100);
                        if (referralBonus > 0) {
                            await User.findByIdAndUpdate(referrer._id, {
                                $inc: { balance: referralBonus, totalReferralBonus: referralBonus },
                                $push: { transactions: { $each: [{ name: `Referral bonus from ${user.username || user.firstName || user.telegramId} (${REFERRAL_BONUS_PERCENT}% of deposit)`, amount: referralBonus, time: new Date() }], $position: 0, $slice: 30 } }
                            });
                            const freshReferrer = await User.findById(referrer._id).select('balance totalReferralBonus telegramId');
                            sendNotificationToUser(referrer.telegramId,
                                `🎉 <b>Реферальный бонус!</b>\n\n` +
                                `Ваш друг ${user.username || user.firstName || 'игрок'} пополнил баланс на ${request.amount.toLocaleString()} MMO\n` +
                                `Вы получили ${REFERRAL_BONUS_PERCENT}%: +${referralBonus.toLocaleString()} MMO\n\n` +
                                `💰 Ваш баланс: ${(freshReferrer?.balance || 0).toLocaleString()} MMO\n` +
                                `🏆 Всего получено бонусов: ${(freshReferrer?.totalReferralBonus || 0).toLocaleString()} MMO`
                            ).catch(() => {});
                        }
                    }
                }
                const newBalance = updatedUser?.balance ?? (user.balance + request.amount);
                sendNotificationToUser(user.telegramId,
                    `✅ <b>Депозит подтвержден!</b>\n\n` +
                    `💰 Сумма: +${request.amount.toLocaleString()} MMO\n` +
                    `💳 Баланс: ${newBalance.toLocaleString()} MMO\n\n` +
                    `Спасибо за пополнение! 🎉`
                ).catch(() => {});
            } else if (request.type === 'withdraw') {
                sendNotificationToUser(user.telegramId,
                    `✅ <b>Вывод подтвержден!</b>\n\n` +
                    `💰 Сумма: -${request.amount.toLocaleString()} MMO\n` +
                    `🏦 Кошелек: ${request.wallet}\n\n` +
                    `⏱ Средства поступят в течение 1-30 минут.`
                ).catch(() => {});
            }
        } else if (action === 'reject') {
            if (request.type === 'withdraw') {
                await User.findByIdAndUpdate(user._id, {
                    $inc: { balance: request.amount },
                    $push: { transactions: { $each: [{ name: `Withdraw rejected: refund ${request.amount} MMO`, amount: request.amount, time: new Date() }], $position: 0, $slice: 30 } }
                });
                sendNotificationToUser(user.telegramId, `❌ <b>Вывод отклонен</b>\n\nСредства возвращены на баланс.`).catch(() => {});
            } else if (request.type === 'deposit') {
                sendNotificationToUser(user.telegramId,
                    `❌ Депозит отклонен\n\n` +
                    `💰 Сумма: ${request.amount.toLocaleString()} MMO\n` +
                    `📝 Причина: ${note || 'Свяжитесь с администратором'}\n\n` +
                    `Если вы отправляли средства, обратитесь к администратору.`
                ).catch(() => {});
            }
        }
        
        await notifyAdmins(`🔄 <b>ЗАЯВКА ОБРАБОТАНА</b>\n\n` +
            `🆔 #${request._id.toString().slice(-8)}\n` +
            `👤 ${user.username || user.firstName || user.telegramId}\n` +
            `💰 Сумма: ${request.amount.toLocaleString()} MMO\n` +
            `📊 Статус: ${action === 'approve' ? '✅ ПОДТВЕРЖДЕНА' : '❌ ОТКЛОНЕНА'}\n` +
            `🕐 ${new Date().toLocaleString()}`);
        
        res.json({ success: true, request, message: `Заявка ${action === 'approve' ? 'подтверждена' : 'отклонена'}` });
        
    } catch (e) {
        console.error('admin transaction request error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// АДМИН: ОБЩИЕ МЕТРИКИ И ПОЛЬЗОВАТЕЛИ
// ============================================
app.get('/api/admin/stats', adminAuthMiddleware, async (req, res) => {
    try {
        if (cachedAdminStats.expiresAt > Date.now() && cachedAdminStats.data) {
            return res.json({ success: true, stats: cachedAdminStats.data });
        }
        
        const totalUsers = await User.countDocuments();
        const bannedUsers = await User.countDocuments({ isBanned: true });
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const newUsersLast7Days = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        const activeToday = await User.countDocuments({ lastLogin: { $gte: oneDayAgo } });
        
        const aggregated = await User.aggregate([{
            $group: {
                _id: null,
                totalBalance: { $sum: "$balance" },
                avgLevel: { $avg: "$level" },
                totalMerges: { $sum: "$mergeCount" },
                totalCapsules: { $sum: "$capsulesOpened" }
            }
        }]);
        
        const agg = aggregated[0] || { totalBalance: 0, avgLevel: 1, totalMerges: 0, totalCapsules: 0 };
        
        const stats = {
            totalUsers,
            bannedUsers,
            activeToday,
            newUsersLast7Days,
            totalBalance: agg.totalBalance,
            avgLevel: agg.avgLevel,
            totalMerges: agg.totalMerges,
            totalCapsules: agg.totalCapsules
        };
        
        cachedAdminStats = { data: stats, expiresAt: Date.now() + ADMIN_STATS_CACHE_TTL };
        res.json({ success: true, stats });
    } catch (e) {
        console.error('admin stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
    try {
        const { search, limit = 50, skip = 0 } = req.query;
        let query = {};
        if (search) {
            const escapedSearch = escapeRegex(search);
            query = {
                $or: [
                    { telegramId: { $regex: escapedSearch, $options: 'i' } },
                    { username: { $regex: escapedSearch, $options: 'i' } },
                    { firstName: { $regex: escapedSearch, $options: 'i' } }
                ]
            };
        }
        const users = await User.find(query).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)).select('-transactions');
        const total = await User.countDocuments(query);
        res.json({ success: true, users, total });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        let inventory = await Inventory.find({ telegramId: user.telegramId }).lean();
        inventory = await Promise.all(inventory.map(async (item) => {
            const creature = await getCreature(item.creatureId);
            return { ...item, name: creature?.name || item.creatureId, icon: creature?.icon || '🧬', incomeBase: creature?.incomeBase || 1 };
        }));
        
        const referrals = await User.find({ referredBy: user.telegramId }).select('username firstName balance createdAt');
        
        const adsWatched = user.adsWatchedTotal || 0;
        const adsEarned = user.transactions
            .filter(tx => tx.name === 'Watch Ad Reward')
            .reduce((sum, tx) => sum + tx.amount, 0);
        
        res.json({ 
            success: true, 
            user: formatUser(user), 
            inventory, 
            referrals,
            adsWatched,
            adsEarned
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/users/:id/balance', adminAuthMiddleware, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        if (typeof amount !== 'number' || isNaN(amount)) {
            return res.status(400).json({ success: false, message: 'Неверная сумма' });
        }
        if (Math.abs(amount) > 1000000) {
            return res.status(400).json({ success: false, message: 'Слишком большая сумма' });
        }
        if (user.balance + amount < 0) {
            return res.status(400).json({ success: false, message: 'Баланс не может быть отрицательным' });
        }
        
        user.balance += amount;
        addTransaction(user, `Admin: ${reason || 'Изменение баланса'} (${amount > 0 ? '+' : ''}${amount})`, amount);
        await user.save();
        
        leaderboardCache = { data: null, expiresAt: 0 };
        res.json({ success: true, newBalance: user.balance });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/users/:id/give-item', adminAuthMiddleware, async (req, res) => {
    try {
        const { creatureId, count = 1 } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        const creature = await getCreature(creatureId);
        if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });
        
        const inventory = await Inventory.find({ telegramId: user.telegramId });
        const usedSlots = inventory.reduce((sum, i) => sum + i.count, 0);
        if (usedSlots + count > user.inventorySlots) {
            return res.status(400).json({ success: false, message: 'У пользователя недостаточно места в инвентаре' });
        }
        
        let invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId });
        if (invItem) {
            invItem.count += count;
            await invItem.save();
        } else {
            await Inventory.create({ userId: user._id, telegramId: user.telegramId, creatureId, count });
        }
        
        if (!user.discovered.includes(creatureId)) {
            user.discovered.push(creatureId);
            await user.save();
        }
        
        invalidateInventoryCache(user.telegramId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/admin/users/:id/item', adminAuthMiddleware, async (req, res) => {
    try {
        const { creatureId, count = 1 } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        const invItem = await Inventory.findOne({ telegramId: user.telegramId, creatureId });
        if (!invItem || invItem.count < count) {
            return res.status(400).json({ success: false, message: 'У пользователя нет столько существ' });
        }
        
        invItem.count -= count;
        if (invItem.count <= 0) {
            await invItem.deleteOne();
        } else {
            await invItem.save();
        }
        
        invalidateInventoryCache(user.telegramId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/users/:id/ban', adminAuthMiddleware, async (req, res) => {
    try {
        const { isBanned, reason } = req.body;
        const userToBan = await User.findById(req.params.id);
        if (!userToBan) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        userToBan.isBanned = isBanned;
        userToBan.banReason = reason || '';
        await userToBan.save();
        
        leaderboardCache = { data: null, expiresAt: 0 };
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/users/:id/reset', adminAuthMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        await Inventory.deleteMany({ telegramId: user.telegramId });
        user.balance = 4000;
        user.xp = 0;
        user.level = 1;
        user.mergeCount = 0;
        user.capsulesOpened = 0;
        user.discovered = [];
        user.completedSpecialQuests = [];
        await user.save();
        
        leaderboardCache = { data: null, expiresAt: 0 };
        invalidateInventoryCache(user.telegramId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/creatures', adminAuthMiddleware, async (req, res) => {
    try {
        const creatures = await Creature.find().sort({ rarity: 1, name: 1 });
        res.json({ success: true, creatures });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/creatures', adminAuthMiddleware, async (req, res) => {
    try {
        const { id, name, rarity, icon, incomeBase, desc } = req.body;
        if (!id || !name || !rarity || !incomeBase) {
            return res.status(400).json({ success: false, message: 'Не все поля заполнены' });
        }
        const existing = await Creature.findOne({ $or: [{ id }, { name }] });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Существо с таким id или именем уже существует' });
        }
        const creature = await Creature.create({ id, name, rarity, icon: icon || '🧬', incomeBase, desc: desc || '' });
        await loadCreaturesToCache();
        res.json({ success: true, creature });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/creatures/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, rarity, icon, incomeBase, desc, isActive } = req.body;
        const creature = await Creature.findOne({ id: req.params.id });
        if (!creature) return res.status(404).json({ success: false, message: 'Существо не найдено' });
        
        if (name) creature.name = name;
        if (rarity) creature.rarity = rarity;
        if (icon) creature.icon = icon;
        if (incomeBase) creature.incomeBase = incomeBase;
        if (desc !== undefined) creature.desc = desc;
        if (isActive !== undefined) creature.isActive = isActive;
        await creature.save();
        await loadCreaturesToCache();
        
        res.json({ success: true, creature });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/admin/creatures/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const creature = await Creature.findOne({ id: req.params.id });
        if (!creature) return res.status(404).json({ success: false, message: 'Существо не найдено' });
        
        const inInventory = await Inventory.findOne({ creatureId: creature.id });
        if (inInventory) {
            return res.status(400).json({ success: false, message: 'Нельзя удалить существо, оно есть у игроков' });
        }
        
        await creature.deleteOne();
        await loadCreaturesToCache();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/config', adminAuthMiddleware, async (req, res) => {
    try {
        const config = await getGameConfig();
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/config', adminAuthMiddleware, async (req, res) => {
    try {
        let config = await GameConfig.findOne();
        if (!config) config = new GameConfig();
        
        if (req.body.capsuleCosts) config.capsuleCosts = { ...config.capsuleCosts, ...req.body.capsuleCosts };
        if (req.body.capsuleRarities) config.capsuleRarities = req.body.capsuleRarities;
        if (req.body.adReward !== undefined) config.adReward = req.body.adReward;
        if (req.body.adCooldown !== undefined) config.adCooldown = req.body.adCooldown;
        if (req.body.upgradeBaseCost !== undefined) config.upgradeBaseCost = req.body.upgradeBaseCost;
        if (req.body.upgradeMultiplier !== undefined) config.upgradeMultiplier = req.body.upgradeMultiplier;
        if (req.body.limits) config.limits = { ...config.limits, ...req.body.limits };
        if (req.body.specialQuests) config.specialQuests = req.body.specialQuests;
        config.updatedAt = new Date();
        await config.save();
        
        await invalidateConfigCache();
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ADMIN: SPECIAL QUESTS CRUD
app.get('/api/admin/special-quests', adminAuthMiddleware, async (req, res) => {
    try {
        const specialQuests = await getSpecialQuestsRaw();
        res.json({ success: true, specialQuests });
    } catch (e) {
        console.error('GET /special-quests error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/special-quests', adminAuthMiddleware, async (req, res) => {
    try {
        const { title, description, icon, reward, type, link, required_count, isActive } = req.body;
        
        console.log('📝 Создание квеста:', { title, reward, type });
        
        if (!title || !reward || !type) {
            return res.status(400).json({ success: false, message: 'title, reward, type обязательны' });
        }
        
        const newQuest = {
            id: Date.now().toString(),
            title,
            description: description || '',
            icon: icon || '🎯',
            reward: Number(reward),
            type,
            link: link || '',
            required_count: Number(required_count) || 1,
            isActive: isActive !== false
        };
        
        const col = GameConfig.collection;
        await col.updateOne(
            {},
            { $push: { specialQuests: newQuest }, $set: { updatedAt: new Date() } },
            { upsert: true }
        );
        
        await invalidateConfigCache();
        
        console.log('✅ Квест создан:', newQuest.id);
        res.json({ success: true, quest: newQuest });
    } catch (e) {
        console.error('❌ POST /special-quests error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/special-quests/:questId', adminAuthMiddleware, async (req, res) => {
    try {
        const { questId } = req.params;
        const { title, description, icon, reward, type, link, required_count, isActive } = req.body;
        
        const col = GameConfig.collection;
        const config = await col.findOne({});
        if (!config) {
            return res.status(404).json({ success: false, message: 'Config not found' });
        }
        
        const quests = config.specialQuests || [];
        const idx = quests.findIndex(q => q.id === questId);
        if (idx === -1) {
            return res.status(404).json({ success: false, message: 'Квест не найден' });
        }
        
        const q = quests[idx];
        if (title !== undefined) q.title = title;
        if (description !== undefined) q.description = description;
        if (icon !== undefined) q.icon = icon;
        if (reward !== undefined) q.reward = Number(reward);
        if (type !== undefined) q.type = type;
        if (link !== undefined) q.link = link;
        if (required_count !== undefined) q.required_count = Number(required_count);
        if (isActive !== undefined) q.isActive = isActive;
        
        await col.updateOne({}, { $set: { specialQuests: quests, updatedAt: new Date() } });
        
        await invalidateConfigCache();
        res.json({ success: true, quest: q });
    } catch (e) {
        console.error('PUT /special-quests error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/admin/special-quests/:questId', adminAuthMiddleware, async (req, res) => {
    try {
        const { questId } = req.params;
        
        const col = GameConfig.collection;
        const result = await col.updateOne(
            {},
            { $pull: { specialQuests: { id: questId } } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Config not found' });
        }
        
        await invalidateConfigCache();
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /special-quests error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// АДМИН: АРЕНА — МОНИТОРИНГ
// ============================================

app.get('/api/admin/arena/battles', adminAuthMiddleware, async (req, res) => {
    try {
        const { status = 'all', limit = 50 } = req.query;

        const [activeCount, waitingCount, pendingCount, finishedCount, totalRated] = await Promise.all([
            ArenaBattle.countDocuments({ status: 'active' }),
            ArenaBattle.countDocuments({ status: 'waiting' }),
            ArenaBattle.countDocuments({ status: 'pending_confirmation' }),
            ArenaBattle.countDocuments({ status: 'finished' }),
            ArenaStats.countDocuments()
        ]);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayCount = await ArenaBattle.countDocuments({ createdAt: { $gte: todayStart } });

        const paidAgg = await ArenaBattle.aggregate([
            { $match: { status: 'finished' } },
            { $group: { _id: null, total: { $sum: '$prizePool' }, avgTurns: { $avg: '$turnCount' } } }
        ]);
        const totalPaid = paidAgg[0]?.total || 0;
        const avgTurns = Math.round(paidAgg[0]?.avgTurns || 0);

        const query = (status !== 'all') ? { status } : {};
        const battles = await ArenaBattle.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .populate('player1Id', 'username firstName telegramId level')
            .populate('player2Id', 'username firstName telegramId level')
            .populate('winnerId', 'username firstName telegramId')
            .lean();

        const formatted = battles.map(b => ({
            _id: b._id,
            status: b.status,
            league: b.league,
            entryFee: b.entryFee,
            prizePool: b.prizePool,
            turnCount: b.turnCount || 0,
            currentTurn: b.currentTurn,
            createdAt: b.createdAt,
            lastMoveAt: b.lastMoveAt,
            player1Id: b.player1Id?._id?.toString(),
            player2Id: b.player2Id?._id?.toString(),
            winnerId: b.winnerId?._id?.toString(),
            player1: b.player1Id ? {
                telegramId: b.player1Id.telegramId,
                username: b.player1Id.username,
                firstName: b.player1Id.firstName,
                level: b.player1Id.level
            } : null,
            player2: b.player2Id ? {
                telegramId: b.player2Id.telegramId,
                username: b.player2Id.username,
                firstName: b.player2Id.firstName,
                level: b.player2Id.level
            } : null,
            winner: b.winnerId ? {
                telegramId: b.winnerId.telegramId,
                username: b.winnerId.username,
                firstName: b.winnerId.firstName
            } : null,
            player1Team: (b.player1Team || []).map(p => ({
                name: p.name, icon: p.icon, rarity: p.rarity,
                currentHp: p.currentHp, maxHp: p.maxHp, isAlive: p.isAlive
            })),
            player2Team: (b.player2Team || []).map(p => ({
                name: p.name, icon: p.icon, rarity: p.rarity,
                currentHp: p.currentHp, maxHp: p.maxHp, isAlive: p.isAlive
            }))
        }));

        res.json({
            success: true,
            stats: { active: activeCount, waiting: waitingCount, pending: pendingCount,
                     finished: finishedCount, today: todayCount, totalRated, totalPaid, avgTurns },
            battles: formatted
        });
    } catch (e) {
        console.error('admin arena battles error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/arena/leaderboard', adminAuthMiddleware, async (req, res) => {
    try {
        const { limit = 100 } = req.query;
        const leaders = await ArenaStats.find()
            .sort({ rating: -1 })
            .limit(parseInt(limit))
            .populate('userId', 'username firstName telegramId level')
            .lean();

        const leaderboard = leaders.map((s, i) => ({
            rank: i + 1,
            name: s.userId?.username || s.userId?.firstName || 'Unknown',
            telegramId: s.userId?.telegramId,
            level: s.userId?.level || 1,
            rating: s.rating,
            league: s.league || 'bronze',
            peakRating: s.peakRating || s.rating,
            wins: s.wins || 0,
            losses: s.losses || 0,
            streak: s.streak || 0,
            bestStreak: s.bestStreak || 0,
            totalBattles: s.totalBattles || 0,
            totalEarned: s.totalEarned || 0,
            totalLost: s.totalLost || 0,
            lastBattleAt: s.lastBattleAt
        }));

        res.json({ success: true, leaderboard });
    } catch (e) {
        console.error('admin arena leaderboard error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/refresh-cache', adminAuthMiddleware, async (req, res) => {
    try {
        await invalidateConfigCache();
        await loadCreaturesToCache();
        inventoryCache.clear();
        userIncomeCache.clear();
        cachedAdminStats = { data: null, expiresAt: 0 };
        res.json({ success: true, message: 'Кэш обновлён' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/arena/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const [
            totalBattles,
            activeBattles,
            waitingBattles,
            finishedToday,
            totalPlayers
        ] = await Promise.all([
            ArenaBattle.countDocuments(),
            ArenaBattle.countDocuments({ status: 'active' }),
            ArenaBattle.countDocuments({ status: 'waiting' }),
            ArenaBattle.countDocuments({
                status: 'finished',
                updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }),
            ArenaStats.countDocuments()
        ]);

        const leagueBreakdown = await ArenaStats.aggregate([
            { $group: { _id: '$league', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
            { $sort: { avgRating: -1 } }
        ]);

        const topPlayers = await ArenaStats.find()
            .sort({ rating: -1 })
            .limit(5)
            .populate('userId', 'username firstName telegramId')
            .lean();

        res.json({
            success: true,
            stats: { totalBattles, activeBattles, waitingBattles, finishedToday, totalPlayers },
            leagueBreakdown,
            topPlayers: topPlayers.map(p => ({
                name: p.userId?.username || p.userId?.firstName || '?',
                telegramId: p.userId?.telegramId,
                rating: p.rating,
                league: p.league,
                wins: p.wins,
                losses: p.losses,
                streak: p.streak
            }))
        });
    } catch (e) {
        console.error('admin arena stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/arena/reset-player/:telegramId', adminAuthMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

        await ArenaStats.findOneAndUpdate(
            { userId: user._id },
            { $set: { rating: 1000, league: 'bronze', wins: 0, losses: 0, streak: 0, totalEarned: 0, totalLost: 0 } }
        );

        res.json({ success: true, message: `Рейтинг ${user.username || user.firstName} сброшен` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// АДМИН: РАССЫЛКА
// ============================================
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

app.post('/api/admin/broadcast/create', adminAuthMiddleware, async (req, res) => {
    try {
        const { message, imageUrl, buttons, parseMode = 'HTML', testMode = false } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Введите текст сообщения' });
        }

        if (imageUrl) {
            try {
                const parsed = new URL(imageUrl);
                if (parsed.protocol !== 'https:') {
                    return res.status(400).json({ success: false, message: 'imageUrl должен быть https://' });
                }
                const host = parsed.hostname.toLowerCase();
                if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') ||
                    host.startsWith('10.') || host.startsWith('172.') || host.endsWith('.internal') ||
                    host.endsWith('.local')) {
                    return res.status(400).json({ success: false, message: 'Недопустимый imageUrl' });
                }
            } catch {
                return res.status(400).json({ success: false, message: 'Неверный формат imageUrl' });
            }
        }
        
        let users;
        if (testMode) {
            const adminIds = ADMIN_IDS;
            users = await User.find({ telegramId: { $in: adminIds } }).select('telegramId username firstName');
        } else {
            users = await User.find({ isBanned: false }).select('telegramId username firstName');
        }
        
        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Нет получателей' });
        }
        
        const broadcast = new Broadcast({
            message,
            imageUrl: imageUrl || null,
            buttons: buttons || [],
            parseMode,
            totalUsers: users.length,
            createdBy: req.adminLogin,
            status: 'pending'
        });
        
        await broadcast.save();
        
        sendBroadcastAsync(broadcast._id, users, testMode);
        
        res.json({ 
            success: true, 
            message: `Рассылка запущена! Будет отправлено ${users.length} сообщений${testMode ? ' (ТЕСТОВЫЙ РЕЖИМ)' : ''}`,
            broadcastId: broadcast._id
        });
        
    } catch (e) {
        console.error('broadcast create error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/broadcast/history', adminAuthMiddleware, async (req, res) => {
    try {
        const broadcasts = await Broadcast.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        
        res.json({ success: true, broadcasts });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/broadcast/cancel/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const broadcast = await Broadcast.findById(req.params.id);
        if (!broadcast) {
            return res.status(404).json({ success: false, message: 'Рассылка не найдена' });
        }
        
        if (broadcast.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Рассылка уже завершена или отменена' });
        }
        
        broadcast.status = 'cancelled';
        await broadcast.save();
        
        res.json({ success: true, message: 'Рассылка отменена' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/broadcast/status/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const broadcast = await Broadcast.findById(req.params.id);
        if (!broadcast) {
            return res.status(404).json({ success: false, message: 'Рассылка не найдена' });
        }
        
        res.json({ success: true, broadcast });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/arena/force-expire', adminAuthMiddleware, async (req, res) => {
    try {
        let expiredCount = 0;

        const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
        const staleBattles = await ArenaBattle.find({
            status: 'active',
            lastMoveAt: { $lt: staleThreshold }
        });

        for (const battle of staleBattles) {
            battle.winnerId = battle.currentTurn === 'player1' ? battle.player2Id : battle.player1Id;
            battle.status = 'finished';
            if (arenaManager) {
                await arenaManager.finishBattle(battle);
            } else {
                await battle.save();
            }
            expiredCount++;
        }

        if (arenaManager) {
            const extra = await arenaManager.expireOldBattles();
            expiredCount += extra;
        }

        res.json({ success: true, expiredCount });
    } catch (e) {
        console.error('admin arena/force-expire error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

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

setInterval(() => {
    const now = Date.now();
    for (const [id, time] of lastOpenTimes) {
        if (now - time > RECORD_TTL) lastOpenTimes.delete(id);
    }
    for (const [id, time] of lastMergeTimes) {
        if (now - time > RECORD_TTL) lastMergeTimes.delete(id);
    }
}, CLEANUP_INTERVAL);

// ============================================
// ИНИЦИАЛИЗАЦИЯ СУЩЕСТВ
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
        { id: 'panther_mythic', name: 'Black Panther', rarity: 'mythic', icon: 'https://ndammo.github.io/Mmodna/pm.png', incomeBase: 2000, desc: 'TOP 1 SEASON.' },
        { id: 'monkey_r', name: 'Monkey', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/mr.png', incomeBase: 30, desc: 'Warrior with twin axes. Premium capsule only.', premiumOnly: true },
        { id: 'capybara_r', name: 'Capybara', rarity: 'rare', icon: 'https://ndammo.github.io/Mmodna/cr.png', incomeBase: 25, desc: 'Zen master. Disables enemy skill for 3 turns. Staking reward only.', stakingOnly: true },
        { id: 'kangaroo_u', name: 'Kangaroo', rarity: 'uncommon', icon: 'https://ndammo.github.io/Mmodna/ku.png', incomeBase: 15, desc: 'Poisons all enemies for 3 turns (-10% HP/turn). Reward for 200 ads watched.', stakingOnly: true }
    ];

    for (const creature of staticCreatures) {
        const exists = await Creature.findOne({ id: creature.id });
        if (!exists) {
            await Creature.create(creature);
            console.log(`✅ Добавлено существо: ${creature.name}`);
        } else {
            await Creature.updateOne({ id: creature.id }, {
                $set: {
                    stakingOnly: creature.stakingOnly || false,
                    premiumOnly: creature.premiumOnly || false
                }
            });
        }
    }
    await loadCreaturesToCache();
    console.log('✅ Существа инициализированы');
}

// ============================================
// СОЗДАНИЕ HTTP И WEBSOCKET СЕРВЕРА
// ============================================
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    allowUpgrades: true,
    cookie: false,
    transports: ['websocket', 'polling'],
    path: '/socket.io/'
});

// ============================================
// WEBSOCKET АУТЕНТИФИКАЦИЯ
// ============================================
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
            return next(new Error('Authentication error: no token'));
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || user.isBanned) {
            return next(new Error('Authentication error: invalid user'));
        }
        
        socket.user = user;
        next();
    } catch (err) {
        console.error('Socket auth error:', err.message);
        next(new Error('Authentication error: ' + err.message));
    }
});

// ============================================
// WEBSOCKET СОЕДИНЕНИЯ
// ============================================
io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`🔌 Новое WebSocket соединение: ${user.telegramId} (${socket.id})`);

    // Усиленный rate limiter: 10 событий за 10 секунд
    let wsEventCount = 0;
    const wsRateLimitReset = setInterval(() => { wsEventCount = 0; }, 10000);
    
    const wsRateCheck = () => {
        wsEventCount++;
        if (wsEventCount > 10) {
            console.warn(`⚠️ WS rate limit exceeded for ${user.telegramId}`);
            return false;
        }
        return true;
    };
    
    socket.emit('connected', { ok: true, timestamp: Date.now() });
    
    // Проверка бана при подключении
    (async () => {
        try {
            const freshUser = await User.findById(user._id).select('isBanned').lean();
            if (freshUser?.isBanned) {
                console.log(`🚫 Забаненный пользователь отключён при подключении: ${user.telegramId}`);
                socket.disconnect(true);
                return;
            }
        } catch (e) {}
    })();
    
    if (arenaSocketManager) {
        arenaSocketManager.add(user._id, socket.id);
    } else {
        const onDbOpen = () => {
            if (arenaSocketManager) arenaSocketManager.add(user._id, socket.id);
        };
        mongoose.connection.once('open', onDbOpen);
        socket.once('disconnect', () => mongoose.connection.removeListener('open', onDbOpen));
    }
    
    socket.on('check_battle_status', async (data) => {
        if (!wsRateCheck()) return;
        try {
            // Если battleId не передан, проверяем по user.currentBattleId
            let battleId = data?.battleId;
            if (!battleId && user.currentBattleId) {
                battleId = user.currentBattleId;
            }
            
            if (!battleId || !mongoose.Types.ObjectId.isValid(battleId)) {
                if (user.currentBattleId) {
                    await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
                }
                socket.emit('battle_status', { hasBattle: false });
                return;
            }

            const battle = await ArenaBattle.findById(battleId);
            if (!battle) {
                await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
                socket.emit('battle_status', { hasBattle: false });
                return;
            }
            
            // ── ОБРАБОТКА waiting СТАТУСА ──
            if (battle.status === 'waiting') {
                const isPlayer1 = battle.player1Id.toString() === user._id.toString();
                if (isPlayer1) {
                    socket.emit('battle_status', {
                        hasBattle: true,
                        battleId: battle._id,
                        status: battle.status,
                        isPlayer1: true,
                        entryFee: battle.entryFee,
                        prizePool: battle.prizePool,
                        expiresAt: battle.expiresAt
                    });
                }
                return;
            }
            
            // ── ОБРАБОТКА pending_confirmation ──
            if (battle.status === 'pending_confirmation') {
                const isPlayer1 = battle.player1Id.toString() === user._id.toString();
                socket.emit('battle_status', {
                    hasBattle: true,
                    battleId: battle._id,
                    status: battle.status,
                    isPlayer1: isPlayer1,
                    player1Confirmed: battle.player1Confirmed,
                    player2Confirmed: battle.player2Confirmed,
                    entryFee: battle.entryFee,
                    prizePool: battle.prizePool
                });
                return;
            }
            
            // ── ОБРАБОТКА active ──
            if (battle.status !== 'active') {
                socket.emit('battle_status', { hasBattle: false });
                return;
            }

            const isPlayer1 = battle.player1Id.toString() === user._id.toString();
            const isPlayer2 = battle.player2Id?.toString() === user._id.toString();
            if (!isPlayer1 && !isPlayer2) return;

            const timeSinceLastMove = (Date.now() - new Date(battle.lastMoveAt).getTime()) / 1000;
            const timeLeft = Math.max(0, 30 - Math.floor(timeSinceLastMove));
            
            socket.emit('battle_status', {
                hasBattle: true,
                battleId: battle._id,
                status: battle.status,
                isPlayer1: isPlayer1,
                currentTurn: battle.currentTurn,
                myTeam: isPlayer1 ? battle.player1Team : battle.player2Team,
                opponentTeam: isPlayer1 ? battle.player2Team : battle.player1Team,
                battleLog: battle.battleLog.slice(-20),
                timeLeft: timeLeft,
                serverTimestamp: Date.now()
            });
        } catch (err) {
            console.error('check_battle_status error:', err);
        }
    });

    // Периодическая проверка бана (раз в 5 минут)
    const banCheckInterval = setInterval(async () => {
        try {
            const freshUser = await User.findById(user._id).select('isBanned').lean();
            if (freshUser?.isBanned) {
                console.log(`🚫 Забаненный пользователь отключён: ${user.telegramId}`);
                socket.disconnect(true);
            }
        } catch (e) { /* ignore */ }
    }, 5 * 60 * 1000);

    socket.on('disconnect', (reason) => {
        console.log(`🔌 WebSocket отключён: ${user.telegramId}, причина: ${reason}`);
        clearInterval(banCheckInterval);
        clearInterval(wsRateLimitReset);
        if (arenaSocketManager) {
            arenaSocketManager.remove(user._id, socket.id);
        }
    });
});

// ============================================
// ЗАПУСК
// ============================================
mongoose.connection.once('open', async () => {
    await initCreatures();
    
    const currentConfig = await GameConfig.findOne();
    if (currentConfig) {
        let needSave = false;
        if (currentConfig.capsuleRarities.basic.common !== 100) {
            currentConfig.capsuleRarities.basic = { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
            needSave = true;
        }
        if (currentConfig.capsuleRarities.premium.common !== 70 || 
            currentConfig.capsuleRarities.premium.uncommon !== 20 || 
            currentConfig.capsuleRarities.premium.rare !== 10) {
            currentConfig.capsuleRarities.premium = { common: 70, uncommon: 20, rare: 10, epic: 0, legendary: 0 };
            needSave = true;
        }
        if (needSave) {
            await currentConfig.save();
            console.log('✅ Настройки капсул обновлены: Basic только Common, Premium 70/20/10');
            await invalidateConfigCache();
        }
    }
    
    await getGameConfig();
    
    if (!arenaSocketManager) {
        arenaSocketManager = new ArenaModule.ArenaSocketManager(io);
    }
    if (!arenaManager) {
        arenaManager = new ArenaModule.ArenaBattleManager(
            ArenaBattle, User, ArenaStats, getCreature, 
            sendNotificationToUser, arenaSocketManager
        );
    }
    
    setInterval(async () => {
        if (arenaManager) {
            await arenaManager.expireOldBattles();
        }
    }, 10000);
    
    // Планировщик рейда (каждые 10 секунд)
setInterval(async () => {
    await processRaidScheduler();
}, 10000);

// Создаём рейд на сегодня при старте
await ensureRaidForToday();

    // ============================================
    // УВЕДОМЛЕНИЯ ОБ АРЕНЕ (UTC+3)
    // ============================================
    async function sendArenaNotificationToAll(message) {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (!BOT_TOKEN) return;
        try {
            const users = await User.find({ isBanned: false }, { telegramId: 1 }).lean();
            console.log(`📢 Арена-рассылка: ${users.length} пользователей`);
            let sent = 0, failed = 0;
            for (const user of users) {
                if (!user.telegramId) continue;
                try {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: user.telegramId,
                            text: message,
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        })
                    });
                    sent++;
                    if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
                } catch (e) { failed++; }
            }
            console.log(`✅ Арена-рассылка завершена: ${sent} отправлено, ${failed} ошибок`);
        } catch (e) {
            console.error('Arena broadcast error:', e);
        }
    }

    let lastArenaNotiMinute = -1;
    setInterval(async () => {
        const now = new Date();
        const utc3Hour = (now.getUTCHours() + 3) % 24;
        const utc3Min  = now.getUTCMinutes();
        const minuteKey = utc3Hour * 60 + utc3Min;

        if (minuteKey === lastArenaNotiMinute) return;

        if ((utc3Hour === 9 && utc3Min === 30) || (utc3Hour === 19 && utc3Min === 30)) {
            lastArenaNotiMinute = minuteKey;
            const openTime = utc3Hour === 9 ? '10:00' : '20:00';
            await sendArenaNotificationToAll(
                `⚔️ <b>Через 30 минут — Арена!</b>\n\n` +
                `Готовься к бою! Арена откроется в ${openTime} (МСК).\n` +
                `Собери команду и жди сигнала! 🏆`
            );
        }

        if ((utc3Hour === 10 && utc3Min === 0) || (utc3Hour === 20 && utc3Min === 0)) {
            lastArenaNotiMinute = minuteKey;
            const closeTime = utc3Hour === 10 ? '12:00' : '22:00';
            await sendArenaNotificationToAll(
                `🏟️ <b>Арена открыта!</b>\n\n` +
                `⚔️ Сражайся с другими игроками прямо сейчас!\n` +
                `🏆 Побеждай и поднимайся в рейтинге!\n\n` +
                `⏳ Арена работает до ${closeTime} (МСК)`
            );
        }
    }, 60 * 1000);

    console.log('🔔 Уведомления об арене: активны (9:30, 10:00, 19:30, 20:00 МСК)');
    
    console.log('✅ Сервер готов');
    console.log('👥 Telegram Админы: ' + (ADMIN_IDS.join(', ') || 'не заданы'));
    console.log('🔐 Web Админ: ' + ADMIN_LOGIN);
    console.log('💰 Мин. сумма транзакции: ' + MIN_TRANSACTION_AMOUNT + ' MMO');
    console.log('📋 Макс. активных заявок: ' + MAX_ACTIVE_REQUESTS);
    console.log('📺 Новая система рекламы: макс. ' + MAX_ADS_AVAILABLE + ', восстановление +1/час');
    console.log('🎁 Реферальный бонус: ' + REFERRAL_BONUS_PERCENT + '% от депозита друга');
    console.log('🏪 Маркет: мин. цена ' + MIN_MARKETPLACE_PRICE + ' MMO, макс. лотов ' + MAX_ACTIVE_LISTINGS);
    console.log('🛡️ Защита от фарма: common существа макс. цена ' + MAX_COMMON_PRICE + ' MMO');
    console.log('⚔️ PvP Арена: активна (WebSocket для Railway)!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📌 Режим: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🌐 WebSocket путь: /socket.io/`);
});