// ============================================
// server.js - ПОЛНАЯ ВЕРСИЯ С ИСПРАВЛЕНИЯМИ
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

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
const MAX_COMMON_PRICE = 1100;  // Common существ нельзя продавать дороже 500 MMO
setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;
    for (const [ip, record] of rateLimit.entries()) {
        if (now > record.resetAt) {
            rateLimit.delete(ip);
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
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
            return res.status(429).json({ 
                success: false, 
                message: 'Слишком много попыток. Попробуйте через 15 минут.' 
            });
        }
        
        if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
            attempts.count++;
            adminLoginAttempts.set(ip, attempts);
            return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        adminLoginAttempts.delete(ip);
        
        const token = crypto.randomBytes(32).toString('hex');
        
        adminSessions.set(token, {
            login: login,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000
        });
        
        res.json({ success: true, token: token });
        
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/logout', async (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) {
        adminSessions.delete(token);
    }
    res.json({ success: true });
});

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (session.expiresAt < now) {
            adminSessions.delete(token);
        }
    }
}, 60 * 60 * 1000);

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
// Добавь это после других Schema, примерно на строке 350-400

// ============================================
// РАССЫЛКА (BROADCAST)
// ============================================
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
    arenaTeam: [{ type: String }],
    arenaCooldownUntil: { type: Date, default: null },
    currentBattleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaBattle', default: null }
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

const ArenaBattleSchema = new mongoose.Schema({
    player1Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    player2Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    player1Team: [{ creatureId: String, name: String, icon: String, rarity: String,
        maxHp: Number, currentHp: Number, attack: Number, defense: Number, critChance: Number, isAlive: Boolean,
        stunned: Boolean, shielded: Boolean,
        skill: { id: String, name: String, chance: Number, description: String } }],
    player2Team: [{ creatureId: String, name: String, icon: String, rarity: String,
        maxHp: Number, currentHp: Number, attack: Number, defense: Number, critChance: Number, isAlive: Boolean,
        stunned: Boolean, shielded: Boolean,
        skill: { id: String, name: String, chance: Number, description: String } }],
    currentTurn: { type: String, enum: ['player1', 'player2'], default: 'player1' },
    turnCount: { type: Number, default: 0 },
    battleLog: [{ turn: Number, player: String, attackerName: String, attackerIndex: Number,
        targetName: String, targetIndex: Number, damage: Number, isCrit: Boolean,
        remainingHp: Number, timestamp: { type: Date, default: Date.now } }],
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
    createdAt: { type: Date, default: Date.now }
});
ArenaBattleSchema.index({ status: 1, league: 1, expiresAt: 1 });
ArenaBattleSchema.index({ player1Id: 1, player2Id: 1 });
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
    lastBattleAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now }
});
const ArenaStats = mongoose.model('ArenaStats', ArenaStatsSchema);

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

// Добавь после функции notifyAdmins()

// ============================================
// ФУНКЦИЯ РАССЫЛКИ
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

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ С КЭШИРОВАНИЕМ
// ============================================

function escapeRegex(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let creaturesCache = null;

// ============================================
// FORMAT INVENTORY - БЕЗ КЭША (ПРЯМОЕ ЧТЕНИЕ ИЗ БД)
// ============================================
// ============================================
// FORMAT INVENTORY - С ПРОВЕРКОЙ КЭША
// ============================================
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
    let deletedOpen = 0, deletedMerge = 0;
    
    for (const [id, time] of lastOpenTimes) {
        if (now - time > RECORD_TTL) {
            lastOpenTimes.delete(id);
            deletedOpen++;
        }
    }
    
    for (const [id, time] of lastMergeTimes) {
        if (now - time > RECORD_TTL) {
            lastMergeTimes.delete(id);
            deletedMerge++;
        }
    }
    
    if (deletedOpen > 0 || deletedMerge > 0) {
    }
}

setInterval(cleanupOldRecords, CLEANUP_INTERVAL);

// ============================================
// ХРАНИЛИЩЕ ДЛЯ РЕАЛЬНЫХ МЕТРИК
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
// SUSPICIOUS EVENTS
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
// LOGS ПОЛЬЗОВАТЕЛЯ
// ============================================
app.get('/api/admin/users/:id/logs', adminAuthMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('transactions');
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }
        res.json({ success: true, logs: user.transactions || [] });
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
// АДМИН: УПРАВЛЕНИЕ РЕКЛАМОЙ
// ============================================

app.get('/api/admin/ads-stats', adminAuthMiddleware, async (req, res) => {
    try {
        const { limit = 100, sortBy = 'adsWatched' } = req.query;
        
        // Исправленная агрегация - обрабатываем null и отсутствующие поля
        const adsStats = await User.aggregate([
            {
                $addFields: {
                    // Преобразуем transactions в массив, если это null или не массив
                    transactionsArray: {
                        $cond: {
                            if: { $isArray: "$transactions" },
                            then: "$transactions",
                            else: []
                        }
                    }
                }
            },
            {
                $project: {
                    telegramId: 1,
                    username: 1,
                    firstName: 1,
                    level: 1,
                    adsAvailable: 1,
                    adsLastRegen: 1,
                    adsWatched: {
                        $size: {
                            $filter: {
                                input: "$transactionsArray",
                                as: "tx",
                                cond: { $eq: ["$$tx.name", "Watch Ad Reward"] }
                            }
                        }
                    }
                }
            },
            { $sort: { [sortBy]: -1 } },
            { $limit: parseInt(limit) }
        ]);
        
        // Исправленная агрегация для общей статистики
        const totalStats = await User.aggregate([
            {
                $addFields: {
                    transactionsArray: {
                        $cond: {
                            if: { $isArray: "$transactions" },
                            then: "$transactions",
                            else: []
                        }
                    }
                }
            },
            {
                $project: {
                    adsWatched: {
                        $size: {
                            $filter: {
                                input: "$transactionsArray",
                                as: "tx",
                                cond: { $eq: ["$$tx.name", "Watch Ad Reward"] }
                            }
                        }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    totalAdsWatched: { $sum: "$adsWatched" },
                    avgAdsPerUser: { $avg: "$adsWatched" }
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
// MIDDLEWARE (ОСНОВНОЙ API) - ОПРЕДЕЛЕНИЕ
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
// ПОЛУЧИТЬ СТАТИСТИКУ ПОЛЬЗОВАТЕЛЯ
// ============================================
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

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
    res.json({ success: true, message: '🚀 DNA MMO Backend работает!', version: '5.0.7' });
});

// ============================================
// ПУБЛИЧНЫЕ ЭНДПОИНТЫ
// ============================================
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

// ============================================
// AUTH (ИСПРАВЛЕННЫЙ)
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
            user = new User({
                telegramId: String(userData.id),
                username: userData.username || '',
                firstName: userData.first_name || '',
                lastName: userData.last_name || '',
                photoUrl: userData.photo_url || '',
                balance: 4000,
                adsAvailable: MAX_ADS_AVAILABLE,
                adsLastRegen: new Date()
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

// ============================================
// ДЕПОЗИТЫ
// ============================================
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
// ВЫВОДЫ
// ============================================
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

// ============================================
// АДМИН ОБРАБОТКА ЗАЯВОК
// ============================================
app.post('/api/admin/transaction-request/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { action, note } = req.body;
        
        const request = await TransactionRequest.findById(id);
        if (!request) {
            return res.status(404).json({ success: false, message: 'Заявка не найдена' });
        }
        
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Заявка уже обработана' });
        }
        
        const user = await User.findById(request.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }
        
        if (action === 'approve') {
            if (request.type === 'deposit') {
                user.balance += request.amount;
                addTransaction(user, `Deposit (Подтвержден)`, request.amount);
                await user.save();
                
                if (user.referredBy) {
                    const referrer = await User.findOne({ telegramId: user.referredBy });
                    if (referrer) {
                        const referralBonus = Math.floor(request.amount * REFERRAL_BONUS_PERCENT / 100);
                        if (referralBonus > 0) {
                            referrer.balance += referralBonus;
                            referrer.totalReferralBonus = (referrer.totalReferralBonus || 0) + referralBonus;
                            addTransaction(referrer, `Referral bonus from ${user.username || user.firstName || user.telegramId} (${REFERRAL_BONUS_PERCENT}% of deposit)`, referralBonus);
                            await referrer.save();
                            
                            await sendNotificationToUser(referrer.telegramId, 
                                `🎉 <b>Реферальный бонус!</b>\n\n` +
                                `Ваш друг ${user.username || user.firstName || 'игрок'} пополнил баланс на ${request.amount.toLocaleString()} MMO\n` +
                                `Вы получили ${REFERRAL_BONUS_PERCENT}%: +${referralBonus.toLocaleString()} MMO\n\n` +
                                `💰 Ваш баланс: ${referrer.balance.toLocaleString()} MMO\n` +
                                `🏆 Всего получено бонусов: ${referrer.totalReferralBonus.toLocaleString()} MMO`
                            );
                            
                            console.log(`✅ Реферальный бонус: ${referrer.username || referrer.firstName} получил +${referralBonus} MMO за депозит ${user.telegramId}`);
                        }
                    }
                }
                
                const successMessage = `✅ <b>Депозит подтвержден!</b>\n\n` +
                    `┌─────────────────────┐\n` +
                    `│ 💰 Сумма: +${request.amount.toLocaleString()} MMO\n` +
                    `│ 💳 Баланс: ${user.balance.toLocaleString()} MMO\n` +
                    `└─────────────────────┘\n\n` +
                    `Спасибо за пополнение! 🎉`;
                await sendNotificationToUser(user.telegramId, successMessage);
                
            } else if (request.type === 'withdraw') {
                const successMessage = `✅ <b>Вывод подтвержден!</b>\n\n` +
                    `┌─────────────────────────┐\n` +
                    `│ 💰 Сумма: -${request.amount.toLocaleString()} MMO\n` +
                    `│ 💳 Баланс: ${user.balance.toLocaleString()} MMO\n` +
                    `│ 🏦 Кошелек: ${request.wallet}\n` +
                    `└─────────────────────────┘\n\n` +
                    `⏱ Средства поступят в течение 1-30 минут.`;
                await sendNotificationToUser(user.telegramId, successMessage);
            }
            
            request.status = 'approved';
            
        } else if (action === 'reject') {
            
            if (request.type === 'withdraw') {
                await User.findByIdAndUpdate(user._id, {
                    $inc: { balance: request.amount },
                    $push: {
                        transactions: {
                            $each: [{ 
                                name: `Withdraw rejected: refund ${request.amount} MMO`, 
                                amount: request.amount, 
                                time: new Date() 
                            }],
                            $position: 0,
                            $slice: 30
                        }
                    }
                });
                
                const rejectMessage = `❌ <b>Вывод отклонен</b>\n\n` +
                    `Средства возвращены на баланс.`;
                await sendNotificationToUser(user.telegramId, rejectMessage);
                
            } else if (request.type === 'deposit') {
                const rejectMessage = `❌ Депозит отклонен\n\n` +
                    `💰 Сумма: ${request.amount.toLocaleString()} MMO\n` +
                    `📝 Причина: ${note || 'Свяжитесь с администратором'}\n\n` +
                    `Если вы отправляли средства, обратитесь к администратору.`;
                await sendNotificationToUser(user.telegramId, rejectMessage);
            }
            
            request.status = 'rejected';
        }
        
        request.adminNote = note || request.adminNote;
        request.processedAt = new Date();
        await request.save();
        
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
// РЕФЕРАЛЬНАЯ ИНФОРМАЦИЯ
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

// ============================================
// НАГРАДЫ ЗА ДРУЗЕЙ
// ============================================
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

// ============================================
// GAME: MERGE
// ============================================
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

// ============================================
// GAME: WATCH AD (НОВАЯ ВЕРСИЯ)
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

// ============================================
// GAME: GET ADS STATUS (НОВАЯ ВЕРСИЯ)
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
// ФОНОВАЯ РЕГЕНЕРАЦИЯ РЕКЛАМЫ (каждые 5 минут)
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
        
        if (users.length > 0) {
        }
    } catch (e) {
        console.error('Фоновая регенерация ошибка:', e);
    }
}, 5 * 60 * 1000);

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

// ============================================
// MARKETPLACE
// ============================================
app.post('/api/marketplace/list', authMiddleware, async (req, res) => {
    try {
        const { creatureId, price } = req.body;
        const user = req.user;
        
        const config = await getGameConfig();
        const limits = config.limits;

        // Проверка на Common
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

// ============================================
// АДМИН-ПАНЕЛЬ API (КОРОТКАЯ ВЕРСИЯ)
// ============================================
app.get('/api/admin/special-quests', adminAuthMiddleware, async (req, res) => {
    try {
        const config = await getGameConfig();
        res.json({ success: true, specialQuests: config.specialQuests });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/special-quests', adminAuthMiddleware, async (req, res) => {
    try {
        const { id, title, description, icon, reward, type, link, required_count, isActive } = req.body;
        
        if (!id || !title || !reward || !type) {
            return res.status(400).json({ success: false, message: 'Не все обязательные поля заполнены' });
        }
        
        const config = await getGameConfig();
        
        if (config.specialQuests.some(q => q.id === id)) {
            return res.status(400).json({ success: false, message: 'Квест с таким ID уже существует' });
        }
        
        config.specialQuests.push({
            id, title, description: description || '', icon: icon || '🎯', reward, type,
            link: link || '', required_count: required_count || 1, isActive: isActive !== false
        });
        
        await config.save();
        await invalidateConfigCache();
        
        res.json({ success: true, specialQuests: config.specialQuests });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/admin/special-quests/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, icon, reward, type, link, required_count, isActive } = req.body;
        
        const config = await getGameConfig();
        const quest = config.specialQuests.find(q => q.id === id);
        
        if (!quest) {
            return res.status(404).json({ success: false, message: 'Квест не найден' });
        }
        
        if (title) quest.title = title;
        if (description !== undefined) quest.description = description;
        if (icon) quest.icon = icon;
        if (reward) quest.reward = reward;
        if (type) quest.type = type;
        if (link !== undefined) quest.link = link;
        if (required_count) quest.required_count = required_count;
        if (isActive !== undefined) quest.isActive = isActive;
        
        await config.save();
        await invalidateConfigCache();
        
        res.json({ success: true, specialQuests: config.specialQuests });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/admin/special-quests/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const config = await getGameConfig();
        
        const questIndex = config.specialQuests.findIndex(q => q.id === id);
        if (questIndex === -1) {
            return res.status(404).json({ success: false, message: 'Квест не найден' });
        }
        
        config.specialQuests.splice(questIndex, 1);
        await config.save();
        await invalidateConfigCache();
        
        res.json({ success: true });
    } catch (e) {
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
        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit))
            .select('-transactions');
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
        
        const adsWatched = user.transactions.filter(tx => tx.name === 'Watch Ad Reward').length;
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
        
        cachedAdminStats = {
            data: stats,
            expiresAt: Date.now() + ADMIN_STATS_CACHE_TTL
        };
        
        res.json({ success: true, stats });
    } catch (e) {
        console.error('admin stats error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/give-to-all', adminAuthMiddleware, async (req, res) => {
    try {
        const { type, amount, creatureId } = req.body;
        
        if (type === 'coins' && amount) {
            if (Math.abs(amount) > 1000000) {
                return res.status(400).json({ success: false, message: 'Слишком большая сумма' });
            }
            const result = await User.updateMany({}, { $inc: { balance: amount } });
            leaderboardCache = { data: null, expiresAt: 0 };
            res.json({ success: true, message: `Выдано ${amount} MMO ${result.modifiedCount} игрокам` });
        } 
        else if (type === 'creature' && creatureId) {
            const creature = await getCreature(creatureId);
            if (!creature) return res.status(400).json({ success: false, message: 'Существо не найдено' });
            
            let count = 0;
            const batchSize = 100;
            let skip = 0;
            let hasMore = true;
            
            while (hasMore) {
                const users = await User.find({})
                    .select('_id telegramId inventorySlots')
                    .skip(skip)
                    .limit(batchSize)
                    .lean();
                
                if (users.length === 0) {
                    hasMore = false;
                    break;
                }
                
                const bulkOps = [];
                for (const user of users) {
                    const inventory = await Inventory.find({ telegramId: user.telegramId });
                    const usedSlots = inventory.reduce((sum, i) => sum + i.count, 0);
                    if (usedSlots >= user.inventorySlots) continue;
                    
                    bulkOps.push({
                        updateOne: {
                            filter: { telegramId: user.telegramId, creatureId },
                            update: { $inc: { count: 1 } },
                            upsert: true
                        }
                    });
                    
                    if (!user.discovered?.includes(creatureId)) {
                        await User.updateOne(
                            { _id: user._id },
                            { $addToSet: { discovered: creatureId } }
                        );
                    }
                    count++;
                }
                
                if (bulkOps.length > 0) {
                    await Inventory.bulkWrite(bulkOps);
                }
                
                skip += batchSize;
            }
            
            inventoryCache.clear();
            userIncomeCache.clear();
            
            res.json({ success: true, message: `Выдано существо ${creature.name} ${count} игрокам` });
        }
        else {
            res.status(400).json({ success: false, message: 'Неверные параметры' });
        }
    } catch (e) {
        console.error('give-to-all error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// РАССЫЛКА (API)
// ============================================

app.post('/api/admin/broadcast/create', adminAuthMiddleware, async (req, res) => {
    try {
        const { message, imageUrl, buttons, parseMode = 'HTML', testMode = false } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Введите текст сообщения' });
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

// ============================================

// ============================================================
// ARENA — добавляется перед разделом ЗАПУСК
// ============================================================

// ============================================================
// ИМПОРТ МОДУЛЕЙ АРЕНЫ
// ============================================================
const http = require('http');
const socketIo = require('socket.io');
const ArenaModule = require('./arena-socket');

// Переопределяем app в http-сервер
const arenaServer = http.createServer(app);
const io = socketIo(arenaServer, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    path: '/socket.io/'
});

let arenaSocketManager = null;
let arenaManager = null;

// ============================================================
// WEBSOCKET AUTH
// ============================================================
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('No token'));
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || user.isBanned) return next(new Error('Invalid user'));
        socket.user = user;
        next();
    } catch (err) {
        next(new Error('Auth error: ' + err.message));
    }
});

io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`🔌 WS connected: ${user.telegramId}`);
    socket.emit('connected', { ok: true });

    if (arenaSocketManager) arenaSocketManager.add(user._id, socket.id);

    const pingInterval = setInterval(() => { if (socket.connected) socket.emit('ping'); }, 20000);
    socket.on('pong', () => {});

    socket.on('disconnect', () => {
        clearInterval(pingInterval);
        if (arenaSocketManager) arenaSocketManager.remove(user._id);
    });
});

// ============================================================
// ARENA ENDPOINTS
// ============================================================

app.get('/api/arena/team', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const arenaTeam = user.arenaTeam || [];
        const teamWithStats = [];
        for (const creatureId of arenaTeam) {
            const creature = await getCreature(creatureId);
            if (creature) {
                const stats = ArenaModule.calculateCreatureStats(creature, user.level);
                teamWithStats.push({ creatureId: creature.id, name: creature.name, icon: creature.icon, rarity: creature.rarity, ...stats });
            }
        }
        res.json({ success: true, team: teamWithStats, teamIds: arenaTeam });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/team', authMiddleware, async (req, res) => {
    try {
        const { team } = req.body;
        const user = req.user;
        if (!Array.isArray(team) || team.length !== 3)
            return res.status(400).json({ success: false, message: 'Нужно выбрать ровно 3 питомца' });
        const uniqueIds = new Set(team);
        if (uniqueIds.size !== 3)
            return res.status(400).json({ success: false, message: 'Питомцы не должны повторяться' });
        const inventory = await Inventory.find({ telegramId: user.telegramId }).lean();
        const inventoryMap = new Map(inventory.map(i => [i.creatureId, i.count]));
        for (const creatureId of team) {
            if (!inventoryMap.has(creatureId))
                return res.status(400).json({ success: false, message: `У вас нет питомца ${creatureId}` });
        }
        await User.updateOne({ _id: user._id }, { $set: { arenaTeam: team } });
        res.json({ success: true, team });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/cancel-search', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (user.currentBattleId) {
            const battle = await ArenaBattle.findById(user.currentBattleId);
            if (battle && battle.status === 'waiting') {
                await User.findByIdAndUpdate(user._id, { $inc: { balance: battle.entryFee }, $set: { currentBattleId: null } });
                battle.status = 'expired';
                await battle.save();
            } else {
                await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/find-match', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const arenaTeam = user.arenaTeam || [];
        if (arenaTeam.length !== 3)
            return res.status(400).json({ success: false, message: 'Сначала выберите команду из 3 питомцев' });
        if (user.currentBattleId) {
            const existingBattle = await ArenaBattle.findById(user.currentBattleId);
            if (existingBattle && ['waiting', 'pending_confirmation', 'active'].includes(existingBattle.status))
                return res.status(400).json({ success: false, message: 'У вас уже есть активный бой или поиск' });
        }
        if (user.arenaCooldownUntil && new Date(user.arenaCooldownUntil) > new Date()) {
            const secondsLeft = Math.ceil((new Date(user.arenaCooldownUntil) - new Date()) / 1000);
            return res.status(400).json({ success: false, message: `Подождите ${secondsLeft} секунд` });
        }
        const result = await arenaManager.findMatch(user, arenaTeam);
        if (!result.success) return res.status(400).json(result);

        const player1 = await User.findById(result.battle.player1Id).select('username firstName level');
        const player2 = result.battle.player2Id ? await User.findById(result.battle.player2Id).select('username firstName level') : null;

        if (!result.isNew) {
            arenaSocketManager.send(result.battle.player1Id, 'match_found', {
                battleId: result.battle._id, status: 'pending_confirmation', isPlayer1: true,
                opponent: { name: player2?.username || player2?.firstName || 'Игрок', level: player2?.level },
                prizePool: result.battle.prizePool, entryFee: result.entryFee,
                myTeam: result.battle.player1Team, opponentTeam: result.battle.player2Team
            });
            arenaSocketManager.send(result.battle.player2Id, 'match_found', {
                battleId: result.battle._id, status: 'pending_confirmation', isPlayer1: false,
                opponent: { name: player1?.username || player1?.firstName || 'Игрок', level: player1?.level },
                prizePool: result.battle.prizePool, entryFee: result.entryFee,
                myTeam: result.battle.player2Team, opponentTeam: result.battle.player1Team
            });
        }
        res.json({ success: true, battle: result.battle, isNew: result.isNew, message: result.isNew ? 'Поиск...' : 'Соперник найден!' });
    } catch (e) { console.error('find-match error:', e); res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/arena/battle/status', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const user = req.user;
        if (!user.currentBattleId) return res.json({ success: true, hasBattle: false });
        const battle = await ArenaBattle.findById(user.currentBattleId);
        if (!battle) {
            await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
            return res.json({ success: true, hasBattle: false });
        }
        if (['waiting', 'pending_confirmation'].includes(battle.status) && battle.expiresAt < new Date()) {
            battle.status = 'expired';
            await battle.save();
            await User.updateOne({ _id: user._id }, { $set: { currentBattleId: null } });
            return res.json({ success: true, hasBattle: false, expired: true });
        }
        const isPlayer1 = battle.player1Id.toString() === user._id.toString();
        const response = {
            success: true, hasBattle: true, battleId: battle._id, status: battle.status,
            isPlayer1, player1Confirmed: battle.player1Confirmed, player2Confirmed: battle.player2Confirmed,
            league: battle.league, entryFee: battle.entryFee, prizePool: battle.prizePool,
            currentTurn: battle.currentTurn, turnCount: battle.turnCount, lastMoveAt: battle.lastMoveAt,
            myTeam: isPlayer1 ? battle.player1Team : battle.player2Team,
            opponentTeam: isPlayer1 ? battle.player2Team : battle.player1Team,
            battleLog: (battle.battleLog || []).slice(-20)
        };
        if (battle.status === 'active') {
            const timeSince = (Date.now() - new Date(battle.lastMoveAt).getTime()) / 1000;
            response.timeLeft = Math.max(0, 30 - Math.floor(timeSince));
        }
        return res.json(response);
    } catch (e) { return res.status(200).json({ success: false, hasBattle: false, message: e.message }); }
});

app.post('/api/arena/accept-match', authMiddleware, async (req, res) => {
    try {
        const { battleId } = req.body;
        const result = await arenaManager.acceptMatch(battleId, req.user._id);
        if (!result.success) return res.status(400).json(result);
        if (result.bothConfirmed) {
            const battle = result.battle;
            const p1 = await User.findById(battle.player1Id).select('username firstName level');
            const p2 = await User.findById(battle.player2Id).select('username firstName level');
            arenaSocketManager.send(battle.player1Id, 'battle_start', {
                battleId: battle._id, status: 'active', isPlayer1: true, currentTurn: battle.currentTurn,
                myTeam: battle.player1Team, opponentTeam: battle.player2Team,
                opponent: { name: p2?.username || p2?.firstName, level: p2?.level },
                prizePool: battle.prizePool, entryFee: battle.entryFee, battleLog: battle.battleLog, timeLeft: 30
            });
            arenaSocketManager.send(battle.player2Id, 'battle_start', {
                battleId: battle._id, status: 'active', isPlayer1: false, currentTurn: battle.currentTurn,
                myTeam: battle.player2Team, opponentTeam: battle.player1Team,
                opponent: { name: p1?.username || p1?.firstName, level: p1?.level },
                prizePool: battle.prizePool, entryFee: battle.entryFee, battleLog: battle.battleLog, timeLeft: 30
            });
        } else {
            arenaSocketManager.send(result.battle.player1Id, 'confirmation_update', { player1Confirmed: result.battle.player1Confirmed, player2Confirmed: result.battle.player2Confirmed });
            arenaSocketManager.send(result.battle.player2Id, 'confirmation_update', { player1Confirmed: result.battle.player1Confirmed, player2Confirmed: result.battle.player2Confirmed });
        }
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/reject-match', authMiddleware, async (req, res) => {
    try {
        const { battleId } = req.body;
        const battleBefore = await ArenaBattle.findById(battleId);
        const result = await arenaManager.rejectMatch(battleId, req.user._id);
        if (!result.success) return res.status(400).json(result);
        if (battleBefore && arenaSocketManager) {
            const rejecterId = req.user._id.toString();
            const otherId = battleBefore.player1Id.toString() === rejecterId ? battleBefore.player2Id : battleBefore.player1Id;
            if (otherId) arenaSocketManager.send(otherId, 'match_rejected', { battleId, message: 'Соперник отклонил бой. Ставка возвращена.' });
        }
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/move', authMiddleware, async (req, res) => {
    try {
        const { battleId, targetIndex } = req.body;
        const result = await arenaManager.processMove(battleId, req.user._id, targetIndex);
        if (!result.success) return res.status(400).json(result);
        if (result.finished) {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) arenaSocketManager.sendBoth(battle, 'battle_end', { battleId: battle._id, winnerId: result.winnerId?.toString(), lastMove: result.lastMove, prizePool: battle.prizePool });
        } else {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) {
                const isP1 = battle.player1Id.toString() === req.user._id.toString();
                arenaSocketManager.send(isP1 ? battle.player2Id : battle.player1Id, 'move_update', {
                    battleId: battle._id, lastMove: result.lastMove, currentTurn: result.currentTurn,
                    turnCount: result.turnCount, player1Team: battle.player1Team, player2Team: battle.player2Team,
                    skillResult: result.skillResult || null
                });
            }
        }
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/arena/surrender', authMiddleware, async (req, res) => {
    try {
        const { battleId } = req.body;
        const result = await arenaManager.surrenderBattle(battleId, req.user._id);
        if (result.success) {
            const battle = await ArenaBattle.findById(battleId);
            if (battle) arenaSocketManager.sendBoth(battle, 'battle_end', { battleId: battle._id, winnerId: battle.winnerId?.toString(), surrendered: true });
        }
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/arena/leaderboard', authMiddleware, async (req, res) => {
    try {
        const leaders = await arenaManager.getLeaderboard();
        const myStats = await arenaManager.getUserStats(req.user._id);
        const myRank = await ArenaStats.countDocuments({ rating: { $gt: myStats?.rating || 1000 } }) + 1;
        const leagues = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
        const currentIdx = leagues.indexOf(myStats?.league || 'bronze');
        const nextLeague = currentIdx < leagues.length - 1 ? leagues[currentIdx + 1] : null;
        const nextRatingRequired = nextLeague ? (ArenaModule.LEAGUE_CONFIG?.[nextLeague]?.minRating || null) : null;
        res.json({
            success: true,
            leaders: leaders.map(l => ({ ...l, league: l.league || 'bronze' })),
            myRank,
            myStats: { rating: myStats?.rating || 1000, league: myStats?.league || 'bronze', wins: myStats?.wins || 0, losses: myStats?.losses || 0, streak: myStats?.streak || 0 },
            nextLeague, nextRatingRequired
        });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/arena/history', authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id;
        const battles = await ArenaBattle.find({ $or: [{ player1Id: userId }, { player2Id: userId }], status: 'finished' })
            .sort({ createdAt: -1 }).limit(50)
            .populate('player1Id', 'username firstName').populate('player2Id', 'username firstName').lean();
        const history = battles.map(battle => {
            const isPlayer1 = battle.player1Id._id.toString() === userId.toString();
            const opponent = isPlayer1 ? battle.player2Id : battle.player1Id;
            const isWin = battle.winnerId && battle.winnerId.toString() === userId.toString();
            return { id: battle._id, opponent: opponent?.username || opponent?.firstName || 'Unknown', isWin, league: battle.league, prizePool: battle.prizePool, createdAt: battle.createdAt };
        });
        res.json({ success: true, history });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


// ============================================================
// ЗАПУСК С WEBSOCKET
// ============================================================
mongoose.connection.once('open', async () => {
    await initCreatures();
    await getGameConfig();

    arenaSocketManager = new ArenaModule.ArenaSocketManager(io);
    arenaManager = new ArenaModule.ArenaBattleManager(
        ArenaBattle, User, ArenaStats, getCreature, sendNotificationToUser, arenaSocketManager
    );

    setInterval(async () => {
        if (arenaManager) await arenaManager.expireOldBattles();
    }, 10000);

    console.log('✅ Сервер готов');
    console.log('⚔️ Арена активна (WebSocket)');
});

const PORT = process.env.PORT || 3000;
arenaServer.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📌 Режим: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🌐 WebSocket: /socket.io/`);
});
