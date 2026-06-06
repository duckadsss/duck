// ============================================
// bot.js - ПОЛНЫЙ ФАЙЛ (С ОБНОВЛЕНИЕМ РЕФЕРАЛОВ 5+ УРОВНЯ)
// ============================================

process.env.NTBA_FIX_319 = 1;
process.env.NTBA_FIX_350 = 1;

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Dnammobot';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://ndammo.github.io/Mmodna';
const CHAT_LINK = 'https://t.me/+PYDJcgmaaU05ZGU6';
const CHANNEL_LINK = 'https://t.me/mmoDNA';
const API_URL = process.env.API_URL || 'https://serv-production-dbf3.up.railway.app';

// ============================================
// ПРОВЕРКА АДМИНСКИХ КЛЮЧЕЙ
// ============================================
const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не задан в .env');
    process.exit(1);
}

if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    console.error('❌ ADMIN_LOGIN и ADMIN_PASSWORD не заданы в .env');
    process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI не задан в .env');
    process.exit(1);
}

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB подключена (bot)'))
    .catch(err => console.error('❌ MongoDB ошибка:', err));

// ============================================
// СХЕМА ПОЛЬЗОВАТЕЛЯ
// ============================================
const UserSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    balance: { type: Number, default: 4000 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    mergeCount: { type: Number, default: 0 },
    capsulesOpened: { type: Number, default: 0 },
    inventorySlots: { type: Number, default: 10 },
    inventoryUpgrades: { type: Number, default: 0 },
    discovered: [{ type: String }],
    completedSpecialQuests: [{ type: String }],
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    lastDailyBonus: { type: Date, default: null },
    lastLogin: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    notifiedLostIncome: { type: Boolean, default: false }
}, { collection: 'users' });

const User = mongoose.model('User', UserSchema);

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];

// ============================================
// КЭШ АДМИНСКИХ ТОКЕНОВ
// ============================================
let cachedAdminToken = null;
let tokenExpiresAt = 0;

async function getAdminToken() {
    const now = Date.now();
    if (cachedAdminToken && now < tokenExpiresAt) {
        return cachedAdminToken;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: ADMIN_LOGIN, password: ADMIN_PASSWORD })
        });
        
        const data = await response.json();
        
        if (data.success) {
            cachedAdminToken = data.token;
            tokenExpiresAt = now + 23 * 60 * 60 * 1000;
            console.log('✅ Админ-токен получен для бота');
            return cachedAdminToken;
        } else {
            console.error('❌ Ошибка получения админ-токена:', data.message);
            return null;
        }
    } catch (e) {
        console.error('❌ Ошибка при логине админа:', e);
        return null;
    }
}

// ============================================
// ОТПРАВКА УВЕДОМЛЕНИЙ
// ============================================
async function sendNotificationToUser(telegramId, message, replyMarkup = null) {
    if (!BOT_TOKEN) return;
    try {
        const body = {
            chat_id: telegramId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        console.log(`✅ Уведомление отправлено пользователю ${telegramId}`);
    } catch (e) {
        console.error('Failed to send user notification:', e);
    }
}

async function notifyAdmins(message, replyMarkup = null) {
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
// ОБРАБОТКА ТРАНЗАКЦИЙ
// ============================================
async function processTransaction(chatId, callbackId, requestId, action, bot, callbackQuery) {
    const adminId = String(callbackQuery.from.id);
    
    if (!ADMIN_IDS.includes(adminId)) {
        await bot.answerCallbackQuery(callbackId, { 
            text: '❌ У вас нет прав администратора!', 
            show_alert: true 
        });
        return;
    }
    
    try {
        const adminToken = await getAdminToken();
        if (!adminToken) {
            await bot.answerCallbackQuery(callbackId, { 
                text: '❌ Ошибка авторизации на сервере. Попробуйте позже.', 
                show_alert: true 
            });
            return;
        }
        
        console.log(`📤 Отправка запроса на ${API_URL}/api/admin/transaction-request/${requestId} с action: ${action}`);
        
        const response = await fetch(`${API_URL}/api/admin/transaction-request/${requestId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': adminToken
            },
            body: JSON.stringify({ action, note: '' })
        });
        
        console.log(`📥 Ответ статус: ${response.status}`);
        const result = await response.json();
        console.log(`📥 Ответ данные:`, result);
        
        if (result.success) {
            await bot.answerCallbackQuery(callbackId, { 
                text: `✅ Заявка ${action === 'approve' ? 'ПОДТВЕРЖДЕНА' : 'ОТКЛОНЕНА'}!`,
                show_alert: false 
            });
            
            const originalText = callbackQuery.message.text;
            const newText = originalText + `\n\n${action === 'approve' ? '✅ ПОДТВЕРЖДЕНА' : '❌ ОТКЛОНЕНА'}`;
            
            await bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'HTML'
            });
            
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });
        } else {
            await bot.answerCallbackQuery(callbackId, { 
                text: `❌ Ошибка: ${result.message}`,
                show_alert: true 
            });
        }
    } catch (e) {
        console.error('processTransaction error:', e);
        await bot.answerCallbackQuery(callbackId, { 
            text: `❌ Ошибка соединения: ${e.message}`,
            show_alert: true 
        });
    }
}

// ============================================
// ПРОВЕРКА ДАВНО НЕ ЗАХОДИВШИХ
// ============================================
async function checkInactivePlayers() {
    try {
        const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
        
        const inactiveUsers = await User.find({
            lastLogin: { $lt: eightHoursAgo },
            notifiedLostIncome: { $ne: true }
        }).select('telegramId firstName username lastLogin');
        
        for (const user of inactiveUsers) {
            const message = `⏰ <b>Фарм остановлен!</b>\n\n` +
                `┌──────────────────────\n` +
                `│ ⚠️ Вы отсутствовали >8ч\n` +
                `│ 💰 Пассивный доход приостановлен\n` +
                `└──────────────────────\n\n` +
                `🎮 Зайдите в игру, чтобы продолжить фармить MMO!`;
            
            await sendNotificationToUser(user.telegramId, message);
            await User.updateOne({ _id: user._id }, { notifiedLostIncome: true });
        }
        
        await User.updateMany(
            { lastLogin: { $gte: eightHoursAgo }, notifiedLostIncome: true },
            { notifiedLostIncome: false }
        );
        
    } catch (e) {
        console.error('checkInactivePlayers error:', e);
    }
}

// ============================================
// ЗАПУСК БОТА
// ============================================
async function startBot() {
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drop_pending_updates: true })
        });
        const result = await response.json();
        console.log('Webhook deleted:', result);
        
        await new Promise(r => setTimeout(r, 1000));
        
        const bot = new TelegramBot(BOT_TOKEN, { polling: true });
        
        bot.on('polling_error', (err) => {
            console.log('Polling error:', err.message);
            if (err.message.includes('409')) {
                console.log('Conflict! Another bot instance is running.');
                process.exit(1);
            }
        });
        
        // ============================================
        // ОБРАБОТЧИК /start (ОБНОВЛЕН)
        // ============================================
        bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const telegramId = String(msg.from.id);
            const username = msg.from.username || '';
            const firstName = msg.from.first_name || '';
            const referralCode = match ? match[1] : null;
            
            try {
                let user = await User.findOne({ telegramId });
                
                if (!user) {
                    const newReferralCode = 'REF' + telegramId + Math.random().toString(36).slice(2, 7).toUpperCase();
                    const newUserData = {
                        telegramId,
                        username,
                        firstName,
                        referralCode: newReferralCode,
                        balance: 4000
                    };
                    
                    let referrerInfo = null;
                    
                    if (referralCode && referralCode !== newReferralCode) {
                        const referrer = await User.findOne({ referralCode });
                        if (referrer && referrer.telegramId !== telegramId) {
                            newUserData.referredBy = referrer.telegramId;
                            // Атомарно увеличиваем счётчик рефералов
                            await User.findByIdAndUpdate(referrer._id, { $inc: { referralCount: 1 } });
                            referrerInfo = referrer;
                            console.log(`✅ Реферал: ${firstName} приглашен ${referrer.username || referrer.firstName}`);
                        }
                    }
                    
                    // Используем upsert для защиты от race condition (двойной /start)
                    user = await User.findOneAndUpdate(
                        { telegramId },
                        { $setOnInsert: newUserData },
                        { upsert: true, new: true }
                    );
                    
                    const inviterName = referrerInfo 
                        ? (referrerInfo.username || referrerInfo.firstName || referrerInfo.telegramId)
                        : (referralCode ? 'неизвестный код' : 'самостоятельно');
                    
                    const notificationMessage = `🆕 <b>НОВЫЙ ИГРОК!</b>\n\n` +
                        `👤 ID: <code>${telegramId}</code>\n` +
                        `📛 Имя: ${firstName} ${msg.from.last_name || ''}\n` +
                        `🔗 Username: ${username ? '@' + username : 'нет'}\n` +
                        `🎁 Пригласил: ${inviterName}\n` +
                        `💰 Баланс: ${user.balance} MMO\n` +
                        `🕐 Время: ${new Date().toLocaleString()}`;
                    
                    await notifyAdmins(notificationMessage);
                } else {
                    user.username = username || user.username;
                    user.firstName = firstName || user.firstName;
                    user.lastLogin = new Date();
                    await user.save();
                }
                
                let webappUrl = WEBAPP_URL;
                if (referralCode) {
                    webappUrl += `?startapp=${referralCode}`;
                }
                
                // ОБНОВЛЕННОЕ СООБЩЕНИЕ с информацией о рефералах 5+ уровня
                const message = `🧬 <b>DNA MMO</b>\n\n` +
                    `Открывай капсулы, собирай существ,\n` +
                    `сливай их для эволюции и зарабатывай MMO!\n\n` +
                    `🔥 <b>Реферальная система:</b>\n` +
                    `• 2% от депозитов друга — НАВСЕГДА!\n` +
                    `• <b>ВАЖНО:</b> Для получения наград друзья должны достичь <b>5 уровня</b>!\n` +
                    `• 10 друзей 5+ уровня → 🐺 Rare Wolf (25 MMO/час)\n` +
                    `• 50 друзей 5+ уровня → 🐺 Epic Wolf (80 MMO/час)\n` +
                    `• 150 друзей 5+ уровня → 🐺 Legendary Wolf (250 MMO/час)\n\n` +
                    `🎮 Погнали!`;
                
                await bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎮 Начать игру', web_app: { url: webappUrl } }],
                            [{ text: '💬 Наш чат', url: CHAT_LINK }],
                            [{ text: '📢 Наш канал', url: CHANNEL_LINK }]
                        ]
                    }
                });
            } catch (err) {
                console.error('Start error:', err);
                await bot.sendMessage(chatId, 'Ошибка. Пожалуйста, попробуйте позже.');
            }
        });
        
        // ============================================
        // ОБРАБОТЧИК callback_query (КНОПКИ АДМИНОВ)
        // ============================================
        bot.on('callback_query', async (callbackQuery) => {
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            const adminId = String(callbackQuery.from.id);
            
            console.log(`🔔 Получен callback: ${data} от админа ${adminId}`);
            
            if (!ADMIN_IDS.includes(adminId)) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: '❌ У вас нет прав администратора!', 
                    show_alert: true 
                });
                return;
            }
            
            if (data.startsWith('approve_')) {
                const requestId = data.replace('approve_', '');
                console.log(`✅ Подтверждение заявки ${requestId}`);
                await processTransaction(chatId, callbackQuery.id, requestId, 'approve', bot, callbackQuery);
            } else if (data.startsWith('reject_')) {
                const requestId = data.replace('reject_', '');
                console.log(`❌ Отклонение заявки ${requestId}`);
                await processTransaction(chatId, callbackQuery.id, requestId, 'reject', bot, callbackQuery);
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: '❌ Неизвестная команда', 
                    show_alert: false 
                });
            }
        });
        
        // ============================================
        // ОБЫЧНЫЕ СООБЩЕНИЯ
        // ============================================
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            if (text && text.startsWith('/')) return;
            
            // ОБНОВЛЕННОЕ СООБЩЕНИЕ
            await bot.sendMessage(chatId, '🧬 <b>DNA MMO</b>\n\n' +
                'Открывай капсулы, собирай существ,\n' +
                'сливай их для эволюции и зарабатывай MMO!\n\n' +
                '🔥 <b>Реферальная система:</b>\n' +
                '• 2% от депозитов друга — НАВСЕГДА!\n' +
                '• <b>ВАЖНО:</b> Для получения наград друзья должны достичь <b>5 уровня</b>!\n' +
                '• 10 друзей 5+ уровня → 🐺 Rare Wolf (25/час)\n' +
                '• 50 друзей 5+ уровня → 🐺 Epic Wolf (80/час)\n' +
                '• 150 друзей 5+ уровня → 🐺 Legendary Wolf (250/час)\n\n' +
                '🎮 Нажми начать игру!', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎮 Начать игру', web_app: { url: WEBAPP_URL } }],
                        [{ text: '💬 Наш чат', url: CHAT_LINK }],
                        [{ text: '📢 Наш канал', url: CHANNEL_LINK }]
                    ]
                }
            });
        });
        
        // Запускаем проверку каждый час
        setInterval(checkInactivePlayers, 60 * 60 * 1000);
        
        console.log(`✅ Бот @${BOT_USERNAME} успешно запущен`);
        console.log(`👥 Администраторы: ${ADMIN_IDS.join(', ') || 'не заданы'}`);
        console.log(`🔐 Админ-логин: ${ADMIN_LOGIN}`);
        console.log(`🔥 Реферальная система: для наград нужно ${5}+ уровень друзей`);
        return bot;
        
    } catch (err) {
        console.error('Ошибка запуска бота:', err.message);
        process.exit(1);
    }
}

startBot();

mongoose.connection.once('open', async () => {
    const userCount = await User.countDocuments();
    console.log(`📊 В базе данных ${userCount} пользователей`);
    console.log(`🎮 Игра: ${WEBAPP_URL}`);
});

console.log('🤖 Бот инициализируется...');