require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const crypto      = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
const PORT          = process.env.PORT || 3000;
const ADMIN_CHAT_ID  = process.env.ADMIN_CHAT_ID;
const BOT_TOKEN      = '8985217513:AAGOOfxAypZ-d6VlFf7bjGvxFWtwQX5MsYQ';
const APP_URL = (process.env.APP_URL || 'https://tr-production-d035.up.railway.app').replace(/\/+$/, '');
const FRONTEND_URL   = 'https://tradetonn.github.io/Tr';
const BOT_USERNAME   = 'Tradeetonbot';
const REFERRAL_PCT   = 5;

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Временное хранилище реф.кодов: telegramId → referralCode
const pendingReferrals = new Map();
// ── PENDING PROMO ACTIVATION ──
const pendingPromoActivations = new Map();
// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-admin-key'] }));
app.options('*', cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════

// ── User ────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  telegramId:   { type: Number, required: true, unique: true, index: true },
  username:     { type: String, default: '' },
  firstName:    { type: String, default: '' },
  balance:      { type: Number, default: 0, min: 0 },
  totalEarned:  { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt:    { type: Date, default: Date.now },
  lastSeen:     { type: Date, default: Date.now },
});

UserSchema.pre('save', function (next) {
  if (!this.referralCode) {
    this.referralCode = 'TB' + this.telegramId.toString(36).toUpperCase();
  }
  next();
});

const User = mongoose.model('User', UserSchema);

// ── Bot ─────────────────────────────────────────────────────────
const TradeSchema = new mongoose.Schema({
  type:     { type: String, enum: ['open', 'closed'], default: 'open' },
  pair:     { type: String, required: true },
  pnl:      { type: Number, default: null },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
}, { _id: false });

const BotSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:         { type: String, required: true },
  tier:         { type: String, enum: ['basic', 'pro', 'elite'], required: true },
  pair:         { type: String, required: true },
  days:         { type: Number, required: true },
  price:        { type: Number, required: true },
  actualPct:    { type: Number, required: true },
  targetProfit: { type: Number, required: true },
  totalTicks:   { type: Number, required: true },
  ticksDone:    { type: Number, default: 0 },
  lastTickAt:   { type: Date, default: null },
  earned:       { type: Number, default: 0 },
  trades:       { type: [TradeSchema], default: [] },
  startedAt:    { type: Date, default: Date.now },
  endsAt:       { type: Date, required: true },
  done:         { type: Boolean, default: false },
  claimed:      { type: Boolean, default: false },
  createdAt:    { type: Date, default: Date.now },
});

BotSchema.index({ done: 1, claimed: 1 });
BotSchema.index({ userId: 1, done: 1 });

const Bot = mongoose.model('Bot', BotSchema);

// ── Transaction ─────────────────────────────────────────────────
const TransactionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:      { type: String, enum: ['deposit', 'withdraw', 'bot_start', 'bot_claim', 'referral'], required: true },
  amount:    { type: Number, required: true },
  status:    { type: String, enum: ['pending','done','rejected'], default: 'done' },
  meta:      { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

TransactionSchema.index({ userId: 1, createdAt: -1 });

const Transaction = mongoose.model('Transaction', TransactionSchema);

// ── PromoCode ────────────────────────────────────────────────────────
const PromoCodeSchema = new mongoose.Schema({
  code:         { type: String, required: true, unique: true, uppercase: true, trim: true },
  reward:       { type: Number, required: true, min: 0.1 },
  maxUses:      { type: Number, default: 1 },
  usedCount:    { type: Number, default: 0 },
  expiresAt:    { type: Date, default: null },
  isActive:     { type: Boolean, default: true },
  createdBy:    { type: String, default: 'admin' },
  createdAt:    { type: Date, default: Date.now },
  activatedBy:  { type: Map, of: Date, default: new Map() },
});

PromoCodeSchema.index({ code: 1 }, { unique: true });
PromoCodeSchema.index({ isActive: 1, expiresAt: 1 });

const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const BOT_NAMES = { basic: 'Scout Bot', pro: 'Alpha Bot', elite: 'Quantum Bot' };

const PRICES = {
  basic:  { 7: 29,  14: 49,  30: 89  },
  pro:    { 7: 79,  14: 139, 30: 249 },
  elite:  { 7: 199, 14: 349, 30: 599 },
};

const YIELD_RANGE = {
  basic:  [3.5, 5.5],
  pro:    [4.5, 7.5],
  elite:  [6.0, 10.0],
};

const VALID_PAIRS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN',
  'XAU/USD', 'XAG/USD', 'GBP/JPY',
];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function rnd(a, b) { return a + Math.random() * (b - a); }

function rollPct(tier, days) {
  const [lo, hi] = YIELD_RANGE[tier] || [3.5, 5.5];
  return (lo + Math.random() * (hi - lo)) * (days / 7);
}

function formatBot(bot) {
  const msLeft  = Math.max(0, new Date(bot.endsAt) - Date.now());
  const daysLeft = Math.ceil(msLeft / 86400000);
  return {
    id:           bot._id,
    name:         bot.name,
    tier:         bot.tier,
    pair:         bot.pair,
    days:         bot.days,
    price:        bot.price,
    actualPct:    +bot.actualPct.toFixed(2),
    targetProfit: +bot.targetProfit.toFixed(4),
    earned:       +bot.earned.toFixed(6),
    ticksDone:    bot.ticksDone,
    totalTicks:   bot.totalTicks,
    progressPct:  +(bot.ticksDone / bot.totalTicks * 100).toFixed(1),
    startedAt:    bot.startedAt,
    endsAt:       bot.endsAt,
    daysLeft,
    done:         bot.done,
    claimed:      bot.claimed,
    trades:       bot.trades.slice(-5).map(t => ({
      type:     t.type,
      pair:     t.pair,
      pnl:      t.pnl != null ? +t.pnl.toFixed(6) : null,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    })),
  };
}

function formatTx(tx) {
  return { id:tx._id, type:tx.type, amount:+tx.amount.toFixed(4), status:tx.status||'done', meta:tx.meta, createdAt:tx.createdAt };
}

// ═══════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

function verifyTelegramData(raw, token) {
  try {
    const params = new URLSearchParams(raw);
    const hash   = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataStr = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calc   = crypto.createHmac('sha256', secret).update(dataStr).digest('hex');

    if (calc !== hash) return null;
    const u = params.get('user');
    return u ? JSON.parse(u) : null;
  } catch { return null; }
}

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';

    // DEV: Authorization: dev <telegramId>
    if (h.startsWith('dev ') && process.env.ALLOW_DEV !== 'false') {
      const id = parseInt(h.slice(4));
      if (!id || id <= 0) return res.status(401).json({ error: 'Bad dev token' });
      let u = await User.findOne({ telegramId: id });
      if (!u) { 
        u = new User({ telegramId: id, firstName: 'Dev', balance: 1000 }); 
        await u.save(); 
      }
      req.user = u;
      return next();
    }

    // PROD: Authorization: tma <initData>
    if (!h.startsWith('tma ')) return res.status(401).json({ error: 'Authorization required' });

    const tgUser = verifyTelegramData(h.slice(4), BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ error: 'Invalid Telegram data' });

    let user = await User.findOne({ telegramId: tgUser.id });
    if (!user) {
      let referrer = null;
      const pendingRef = pendingReferrals.get(String(tgUser.id));
      if (pendingRef) {
        referrer = await User.findOne({ referralCode: pendingRef });
        pendingReferrals.delete(String(tgUser.id));
        console.log(`[ref] ${tgUser.id} referred by ${pendingRef} → ${referrer?.telegramId}`);
      }
      
      user = new User({
        telegramId: tgUser.id,
        username:   tgUser.username   || '',
        firstName:  tgUser.first_name || '',
        referredBy: referrer?._id || null,
      });
      await user.save();
      
      // ─── УВЕДОМЛЕНИЕ АДМИНУ ───────────────────────────────
      if (ADMIN_CHAT_ID && BOT_TOKEN) {
        const adminMsg = 
          `🆕 <b>Новый пользователь!</b>\n\n` +
          `👤 Имя: <b>${tgUser.first_name || 'Без имени'}</b>\n` +
          `🆔 ID: <code>${tgUser.id}</code>\n` +
          `${tgUser.username ? `🔹 Username: @${tgUser.username}\n` : ''}` +
          `${referrer ? `🔗 Пришёл по ссылке от: <b>${referrer.firstName || 'пользователь'}</b>\n` : ''}` +
          `📅 ${new Date().toLocaleString('ru-RU')}`;
        
        await tgSend(ADMIN_CHAT_ID, adminMsg);
      }
      // ─── КОНЕЦ УВЕДОМЛЕНИЯ ──────────────────────────────
      
      if (referrer) {
        tgSend(referrer.telegramId,
          `👤 Ваш друг <b>${tgUser.first_name||'Пользователь'}</b> присоединился к TradeEton по вашей ссылке!\n` +
          `Вы будете получать <b>${REFERRAL_PCT}%</b> от его дохода автоматически.`
        );
      }
    } else {
      user.firstName = tgUser.first_name || user.firstName;
      user.username  = tgUser.username   || user.username;
      user.lastSeen  = new Date();
      await user.save();
    }
    req.user = user;
    next();
  } catch (e) {
    console.error('[auth]', e.message);
    res.status(500).json({ error: 'Auth error' });
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// Root route
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    name: 'TradeEton API',
    endpoints: ['/health', '/api/me', '/api/bots/:id', '/api/bots/start', '/api/bots/:id/claim', '/api/wallet/deposit', '/api/wallet/withdraw', '/api/leaderboard', '/api/transactions', '/api/referrals', '/webhook']
  });
});

// Health
app.get('/health', (req, res) => res.json({
  status: 'ok',
  time:   new Date().toISOString(),
  db:     mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
}));

async function tgSend(chatId, text, opts = {}) {
  if (!chatId || !BOT_TOKEN) return null;
  try { return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts }); }
  catch (e) { console.error('[bot.send]', e.message); return null; }
}

async function tgEdit(chatId, msgId, text, opts = {}) {
  if (!chatId || !msgId) return;
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...opts }); }
  catch (e) { console.error('[bot.edit]', e.message); }
}

// Request model
const RequestSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  txId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  type:       { type: String, enum: ['deposit','withdraw'], required: true },
  amount:     { type: Number, required: true },
  toAddress:  { type: String, default: '' },
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  adminMsgId: { type: Number, default: null },
  createdAt:  { type: Date, default: Date.now },
});
const Request = mongoose.model('Request', RequestSchema);

async function notifyAdmin(request, user) {
  if (!ADMIN_CHAT_ID) return null;
  const name      = `${user.firstName||'User'} (ID: <code>${user.telegramId}</code>)`;
  const typeLabel = request.type === 'deposit' ? '💰 Пополнение' : '📤 Вывод';
  const extra     = request.type === 'withdraw'
    ? `\n📍 Адрес: <code>${request.toAddress}</code>`
    : `\n📝 Memo: <code>${user.telegramId}</code>`;
  const text = `${typeLabel}\n👤 ${name}\n💎 Сумма: <b>${request.amount} TON</b>${extra}`;
  const kb   = { inline_keyboard: [[
    { text: '✅ Принять', callback_data: `approve_${request._id}` },
    { text: '❌ Отклонить', callback_data: `reject_${request._id}` },
  ]]};
  const msg = await tgSend(ADMIN_CHAT_ID, text, { reply_markup: kb });
  return msg?.message_id || null;
}

// Webhook
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;

    if (update.message?.text?.startsWith('/start')) {
      const msg      = update.message;
      const chatId   = msg.chat.id;
      const name     = msg.from?.first_name || 'Трейдер';
      const refCode  = msg.text.split(' ')[1] || '';

      if (refCode && refCode !== '') {
        pendingReferrals.set(String(chatId), refCode);
        console.log(`[ref] Saved pending referral: ${chatId} → ${refCode}`);
      }

      const text =
        `👋 Привет, <b>${name}</b>!\n\n` +
        `⚡ <b>TradeTON</b> — торговые боты на TON.\n\n` +
        `🤖 <b>Как работает:</b>\n` +
        `• Запускаешь бота — он торгует за тебя\n` +
        `• Зарабатываешь <b>3–47%</b> сверх вложенного\n` +
        `• Депозит + доход возвращаются в конце срока\n\n` +
        `👥 <b>Рефералы:</b> получай <b>5%</b> от дохода каждого друга\n\n` +
        `💎 Минимальный вход: <b>29 TON</b>`;

      await tgSend(chatId, text, { reply_markup: { inline_keyboard: [
        [
          { text: '🚀 Открыть TradeTON', web_app: { url: FRONTEND_URL } }
        ],
        [
          { text: '📞 Поддержка', url: 'https://t.me/Tradeesupport' }
        ],
        [
          { text: '💰 Как мы зарабатываем', callback_data: 'how_we_earn' }
        ]
      ]}});
      return;
    }

    if (update.callback_query) {
      const cb      = update.callback_query;
      const chatId  = cb.message?.chat?.id;
      const msgId   = cb.message?.message_id;
      const origTxt = cb.message?.text || '';
      await bot.answerCallbackQuery(cb.id).catch(() => {});

      // Новая кнопка "Как мы зарабатываем"
      if (cb.data === 'how_we_earn') {
        const earnText =
          `📊 <b>Экономика TradeTON</b>\n\n` +
          `Бот зарабатывает на бирже, допустим, <b>+8%</b> за 7 дней.\n\n` +
          `• В приложении вы видите, например, <b>+5%</b> → это <b>ваша гарантия</b>\n` +
          `• Оставшиеся <b>3%</b> — <b>доход платформы</b>\n\n` +
          `<b>На что идут эти 3%?</b>\n` +
          `🤖 Разработка и улучшение ботов\n` +
          `🖥 Аренда серверов и API\n` +
          `👥 Реферальные выплаты (5% вам!)\n` +
          `🛡 Резерв для гарантий выплат\n\n` +
          `<b>Почему это честно?</b>\n` +
          `✅ Вы получаете ровно столько, сколько обещано\n` +
          `✅ Если бот заработал меньше — <b>убыток на себе несём мы</b>`;

        await tgSend(chatId, earnText);
        return;
      }

      if (cb.data === 'how_deposit') {
        await tgSend(chatId,
          `💰 <b>Как пополнить баланс:</b>\n\n` +
          `1. Открой приложение → Кошелёк → Пополнить\n` +
          `2. Скопируй TON-адрес\n` +
          `3. Укажи в комментарии (Memo) свой <b>Telegram ID</b>\n` +
          `4. Отправь TON и нажми "Отправить заявку"\n\n` +
          `⏱ Зачисление после подтверждения администратором`,
          { reply_markup: { inline_keyboard: [[
            { text: '🚀 Открыть TradeTON', web_app: { url: FRONTEND_URL } },
          ]]}}
        );
        return;
      }

      if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

      const parts  = (cb.data || '').split('_');
      const action = parts[0];
      const reqId  = parts[1];
      if (!['approve','reject'].includes(action) || !reqId) return;

      const request = await Request.findById(reqId);
      if (!request || request.status !== 'pending') {
        return tgEdit(chatId, msgId, origTxt + '\n\n⚠️ Уже обработана', { reply_markup: { inline_keyboard: [] } });
      }
      const user = await User.findById(request.userId);
      if (!user) return;

      if (action === 'approve') {
        request.status = 'approved'; await request.save();
        if (request.type === 'deposit') {
          await User.findByIdAndUpdate(user._id, { $inc: { balance: request.amount } });
          if (request.txId) await Transaction.findByIdAndUpdate(request.txId, { status: 'done' });
          tgSend(user.telegramId, `✅ Пополнение <b>${request.amount} TON</b> зачислено на баланс.`);
        } else {
          if (request.txId) await Transaction.findByIdAndUpdate(request.txId, { status: 'done' });
          tgSend(user.telegramId, `✅ Вывод <b>${request.amount} TON</b> выполнен.\nАдрес: <code>${request.toAddress}</code>`);
        }
        tgEdit(chatId, msgId, origTxt + '\n\n✅ <b>ПРИНЯТО</b>', { reply_markup: { inline_keyboard: [] } });
      } else {
        request.status = 'rejected'; await request.save();
        if (request.type === 'withdraw') await User.findByIdAndUpdate(user._id, { $inc: { balance: request.amount } });
        if (request.txId) await Transaction.findByIdAndUpdate(request.txId, { status: 'rejected' });
        tgSend(user.telegramId, `❌ Заявка на ${request.type==='deposit'?'пополнение':'вывод'} <b>${request.amount} TON</b> отклонена.`);
        tgEdit(chatId, msgId, origTxt + '\n\n❌ <b>ОТКЛОНЕНО</b>', { reply_markup: { inline_keyboard: [] } });
      }
    }
  } catch (e) { console.error('[webhook]', e.message); }
});

// GET /api/me
app.get('/api/me', auth, async (req, res) => {
  try {
    const [bots, txs, refCount] = await Promise.all([
      Bot.find({ userId: req.user._id, claimed: false }).sort({ createdAt: -1 }),
      Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(30),
      User.countDocuments({ referredBy: req.user._id }),
    ]);
    res.json({
      user: {
        id:            req.user._id,
        telegramId:    req.user.telegramId,
        firstName:     req.user.firstName,
        username:      req.user.username,
        balance:       req.user.balance,
        totalEarned:   req.user.totalEarned,
        referralCode:  req.user.referralCode,
        referralCount: refCount,
        referralLink: `https://t.me/${BOT_USERNAME}?start=${req.user.referralCode}`,
      },
      bots:         bots.map(formatBot),
      transactions: txs.map(formatTx),
    });
  } catch (e) {
    console.error('[GET /api/me]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/bots/:id
app.get('/api/bots/:id', auth, async (req, res) => {
  try {
    const bot = await Bot.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({ bot: formatBot(bot) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bots/start
app.post('/api/bots/start', auth, async (req, res) => {
  try {
    const { tier, pair } = req.body;
    const days = parseInt(req.body.days);

    if (!['basic','pro','elite'].includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
    if (![7,14,30].includes(days))               return res.status(400).json({ error: 'Invalid days' });
    if (!VALID_PAIRS.includes(pair))             return res.status(400).json({ error: 'Invalid pair' });

    const price = PRICES[tier][days];

    const updated = await User.findOneAndUpdate(
      { _id: req.user._id, balance: { $gte: price } },
      { $inc: { balance: -price } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'Недостаточно TON' });

    const actualPct    = rollPct(tier, days);
    const targetProfit = price * actualPct / 100;
    const totalTicks   = days * 24 * 60;
    const startedAt    = new Date();
    const endsAt       = new Date(+startedAt + days * 86400000);

    const bot = await Bot.create({
      userId: req.user._id,
      name:   BOT_NAMES[tier],
      tier, pair, days, price,
      actualPct, targetProfit, totalTicks,
      startedAt, endsAt,
      lastTickAt: startedAt,
      trades: [{ type: 'open', pair, openedAt: startedAt }],
    });

    await Transaction.create({
      userId: req.user._id, type: 'bot_start', amount: -price,
      meta: { botId: bot._id, tier, pair, days, targetProfit: +targetProfit.toFixed(4) },
    });

    res.json({ bot: formatBot(bot), balance: updated.balance });
  } catch (e) {
    console.error('[POST /api/bots/start]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bots/:id/claim
app.post('/api/bots/:id/claim', auth, async (req, res) => {
  try {
    const bot = await Bot.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bot)        return res.status(404).json({ error: 'Bot not found' });
    if (!bot.done)   return res.status(400).json({ error: 'Bot still running' });
    if (bot.claimed) return res.status(400).json({ error: 'Already claimed' });

    const earned = Math.max(bot.earned, 0);
    const payout = bot.price + earned;

    const [, user] = await Promise.all([
      Bot.findByIdAndUpdate(bot._id, { claimed: true }),
      User.findByIdAndUpdate(req.user._id, { $inc: { balance: payout, totalEarned: earned } }, { new: true }),
    ]);

    await Transaction.create({
      userId: req.user._id, type: 'bot_claim', amount: payout, status: 'done',
      meta: { botId: bot._id, tier: bot.tier, pair: bot.pair, earned: +earned.toFixed(6) },
    });

    if (earned > 0 && req.user.referredBy) {
      const referrer = await User.findById(req.user.referredBy);
      if (referrer) {
        const reward = parseFloat((earned * REFERRAL_PCT / 100).toFixed(6));
        await User.findByIdAndUpdate(referrer._id, { $inc: { balance: reward, totalEarned: reward } });
        await Transaction.create({
          userId: referrer._id, type: 'referral', amount: reward, status: 'done',
          meta: { fromUser: req.user.telegramId, fromName: req.user.firstName, botName: bot.name },
        });
        if (BOT_TOKEN) tgSend(referrer.telegramId,
          `💸 Реферальный доход!\n👤 ${req.user.firstName||'Пользователь'} забрал доход с бота\n💰 Ваш бонус: <b>+${reward.toFixed(4)} TON</b>`);
      }
    }

    if (BOT_TOKEN) tgSend(req.user.telegramId,
      `✅ Доход получен!\n🤖 ${bot.name} · ${bot.pair}\n💰 Заработано: <b>+${earned.toFixed(4)} TON</b>\n💎 На баланс: <b>${payout.toFixed(4)} TON</b>`);

    res.json({ payout: +payout.toFixed(4), balance: user.balance });
  } catch (e) {
    console.error('[POST /api/bots/claim]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wallet/deposit
app.post('/api/wallet/deposit', auth, async (req, res) => {
  try {
    const amt = parseFloat(req.body.amount);
    const memo = req.body.memo || String(req.user.telegramId);
    
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    const tx = await Transaction.create({
      userId: req.user._id, type: 'deposit', amount: amt, status: 'pending',
      meta: { memo: memo },
    });
    const request = await Request.create({ 
      userId: req.user._id, 
      txId: tx._id, 
      type: 'deposit', 
      amount: amt,
      toAddress: '',
    });
    const msgId = await notifyAdmin(request, req.user);
    if (msgId) await Request.findByIdAndUpdate(request._id, { adminMsgId: msgId });
    
    tgSend(req.user.telegramId, 
      `📨 <b>Заявка на пополнение</b>\nСумма: <b>${amt} TON</b>\nMemo: <code>${memo}</code>\n\n⏳ Статус: <i>Ожидает подтверждения администратора</i>\n\n❗ Убедитесь, что вы указали верный MEMO в комментарии к переводу.`
    );
    
    res.json({ status: 'pending', tx: formatTx(tx), balance: req.user.balance });
  } catch (e) { 
    console.error('[deposit]', e.message); 
    res.status(500).json({ error: 'Server error' }); 
  }
});

// POST /api/wallet/withdraw
app.post('/api/wallet/withdraw', auth, async (req, res) => {
  try {
    const amt  = parseFloat(req.body.amount);
    const addr = (req.body.toAddress || '').trim();

    if (!amt || amt <= 0)  return res.status(400).json({ error: 'Invalid amount' });
    if (!addr)             return res.status(400).json({ error: 'Address required' });

    const updated = await User.findOneAndUpdate(
      { _id: req.user._id, balance: { $gte: amt } },
      { $inc: { balance: -amt } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'Недостаточно TON' });

    const tx = await Transaction.create({
      userId: req.user._id, type: 'withdraw', amount: -amt, status: 'pending',
      meta: { toAddress: addr },
    });
    const request = await Request.create({
      userId: req.user._id,
      txId:   tx._id,
      type:   'withdraw',
      amount: amt,
      toAddress: addr,
    });
    const msgId = await notifyAdmin(request, req.user);
    if (msgId) await Request.findByIdAndUpdate(request._id, { adminMsgId: msgId });

    tgSend(req.user.telegramId,
      `📤 <b>Заявка на вывод</b>\nСумма: <b>${amt} TON</b>\nАдрес: <code>${addr}</code>\n\n⏳ Статус: <i>Ожидает подтверждения администратора</i>`
    );

    res.json({ status: 'pending', tx: formatTx(tx), balance: updated.balance });
  } catch (e) {
    console.error('[withdraw]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leaderboard
app.get('/api/leaderboard', auth, async (req, res) => {
  try {
    const [leaders, myRankCount] = await Promise.all([
      User.find({ totalEarned: { $gt: 0 } }).sort({ totalEarned: -1 }).limit(20).select('firstName totalEarned'),
      User.countDocuments({ totalEarned: { $gt: req.user.totalEarned } }),
    ]);
    res.json({
      leaders: leaders.map((u, i) => ({
        rank:        i + 1,
        firstName:   u.firstName || 'Трейдер',
        initial:     (u.firstName || 'T')[0].toUpperCase(),
        totalEarned: +u.totalEarned.toFixed(4),
      })),
      myRank:   myRankCount + 1,
      myEarned: +req.user.totalEarned.toFixed(4),
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/transactions
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const txs = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ transactions: txs.map(formatTx) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/referrals
app.get('/api/referrals', auth, async (req, res) => {
  try {
    const [refs, earnings] = await Promise.all([
      User.find({ referredBy: req.user._id }).select('firstName createdAt').sort({ createdAt: -1 }),
      Transaction.aggregate([
        { $match: { userId: req.user._id, type: 'referral' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    res.json({
      referrals:    refs.map(r => ({ name: r.firstName||'Трейдер', joinedAt: r.createdAt })),
      totalEarned:  earnings[0]?.total || 0,
      referralCode: req.user.referralCode,
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

const ADMIN_LOGIN_VAL    = process.env.ADMIN_LOGIN    || 'admin';
const ADMIN_PASSWORD_VAL = process.env.ADMIN_PASSWORD || 'tradeadmin2024';

function adminAuth(req, res, next) {
  const h = req.headers['x-admin-key'] || '';
  const [l, p] = h.split(':');
  if (l === ADMIN_LOGIN_VAL && p === ADMIN_PASSWORD_VAL) return next();
  const basic = req.headers.authorization || '';
  if (basic.startsWith('Basic ')) {
    const decoded = Buffer.from(basic.slice(6), 'base64').toString();
    const [bl, bp] = decoded.split(':');
    if (bl === ADMIN_LOGIN_VAL && bp === ADMIN_PASSWORD_VAL) return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [totalUsers, totalBots, pendingCount] = await Promise.all([
      User.countDocuments(),
      Bot.countDocuments({ done: false, claimed: false }),
      Request.countDocuments({ status: 'pending' }),
    ]);
    const balAgg  = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
    const earnAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$totalEarned' } } }]);
    res.json({
      totalUsers,
      totalBots,
      pendingRequests: pendingCount,
      totalBalance:    balAgg[0]?.total  || 0,
      totalEarned:     earnAgg[0]?.total || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const users = await User.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('telegramId username firstName balance totalEarned referralCode createdAt lastSeen');
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const [bots, txs, refs] = await Promise.all([
      Bot.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20),
      Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50),
      User.find({ referredBy: user._id }).select('firstName createdAt').sort({ createdAt: -1 }),
    ]);

    res.json({
      user,
      bots:         bots.map(formatBot),
      transactions: txs.map(formatTx),
      referrals:    refs.map(r => ({ name: r.firstName || 'Трейдер', joinedAt: r.createdAt })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/balance', adminAuth, async (req, res) => {
  try {
    const delta = parseFloat(req.body.delta);
    if (isNaN(delta)) return res.status(400).json({ error: 'Invalid delta' });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $inc: { balance: delta } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Not found' });

    await Transaction.create({
      userId: user._id,
      type:   delta > 0 ? 'deposit' : 'withdraw',
      amount: delta,
      status: 'done',
      meta:   { admin: true, note: 'Admin balance adjustment' },
    });

    console.log(`[admin] Balance adjusted for ${user.telegramId}: ${delta > 0 ? '+' : ''}${delta}`);
    res.json({ balance: user.balance });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    await Promise.all([
      Bot.deleteMany({ userId: user._id }),
      Transaction.deleteMany({ userId: user._id }),
      Request.deleteMany({ userId: user._id }),
      User.findByIdAndDelete(user._id),
    ]);

    console.log(`[admin] User deleted: ${user.telegramId}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/requests', adminAuth, async (req, res) => {
  try {
    const requests = await Request.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('userId', 'firstName username telegramId');

    res.json({
      requests: requests.map(r => ({
        _id:       r._id,
        type:      r.type,
        amount:    r.amount,
        status:    r.status,
        toAddress: r.toAddress,
        createdAt: r.createdAt,
        userName:  r.userId
          ? `${r.userId.firstName || ''} @${r.userId.username || ''} (${r.userId.telegramId})`
          : '—',
        userId: r.userId?._id,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/requests/:id/approve', adminAuth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request || request.status !== 'pending')
      return res.status(400).json({ error: 'Not pending' });

    const user = await User.findById(request.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    request.status = 'approved';
    await request.save();

    if (request.type === 'deposit') {
      await User.findByIdAndUpdate(user._id, { $inc: { balance: request.amount } });
      if (request.txId) await Transaction.findByIdAndUpdate(request.txId, { status: 'done' });
      tgSend(user.telegramId, `✅ Пополнение <b>${request.amount} TON</b> зачислено на баланс.`);
    } else {
      if (request.txId) await Transaction.findByIdAndUpdate(request.txId, { status: 'done' });
      tgSend(user.telegramId,
        `✅ Вывод <b>${request.amount} TON</b> выполнен.\nАдрес: <code>${request.toAddress}</code>`);
    }

    console.log(`[admin] Request approved: ${request._id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/requests/:id/reject', adminAuth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request || request.status !== 'pending')
      return res.status(400).json({ error: 'Not pending' });

    const user = await User.findById(request.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    request.status = 'rejected';
    await request.save();

    if (request.type === 'withdraw')
      await User.findByIdAndUpdate(user._id, { $inc: { balance: request.amount } });
    if (request.txId)
      await Transaction.findByIdAndUpdate(request.txId, { status: 'rejected' });

    tgSend(user.telegramId,
      `❌ Заявка на ${request.type === 'deposit' ? 'пополнение' : 'вывод'} <b>${request.amount} TON</b> отклонена.`);

    console.log(`[admin] Request rejected: ${request._id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  try {
    const { text, target } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    let targets;
    if (target && target !== 'all' && target.length === 24) {
      const u = await User.findById(target).select('telegramId');
      targets = u ? [u] : [];
    } else {
      targets = await User.find().select('telegramId').limit(5000);
    }

    let sent = 0;
    for (const u of targets) {
      const result = await tgSend(u.telegramId, text);
      if (result) sent++;
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[admin] Broadcast: ${sent}/${targets.length}`);
    res.json({ ok: true, sent, total: targets.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PROMOCODE ROUTES
// ═══════════════════════════════════════════════════════════════

app.post('/api/promo/activate', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Введите промокод' });
    }

    const normalizedCode = code.trim().toUpperCase();
    const userId = req.user._id.toString();
    const userTelegramId = req.user.telegramId;

    // Защита от флуда
    const lastTry = pendingPromoActivations.get(userId);
    if (lastTry && Date.now() - lastTry < 5000) {
      return res.status(429).json({ error: 'Подождите несколько секунд' });
    }
    pendingPromoActivations.set(userId, Date.now());
    setTimeout(() => pendingPromoActivations.delete(userId), 5000);

    const promo = await PromoCode.findOne({ 
      code: normalizedCode,
      isActive: true,
    });

    if (!promo) {
      return res.status(404).json({ error: 'Промокод не найден или неактивен' });
    }

    if (promo.expiresAt && new Date() > promo.expiresAt) {
      await PromoCode.updateOne({ _id: promo._id }, { isActive: false });
      return res.status(400).json({ error: 'Срок действия промокода истёк' });
    }

    if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
      await PromoCode.updateOne({ _id: promo._id }, { isActive: false });
      return res.status(400).json({ error: 'Промокод уже использован максимальное количество раз' });
    }

    if (promo.activatedBy && promo.activatedBy.has(userTelegramId.toString())) {
      return res.status(400).json({ error: 'Вы уже активировали этот промокод' });
    }

    const reward = promo.reward;
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { balance: reward } },
      { new: true }
    );

    promo.usedCount += 1;
    promo.activatedBy.set(userTelegramId.toString(), new Date());
    await promo.save();

    await Transaction.create({
      userId: req.user._id,
      type: 'deposit',
      amount: reward,
      status: 'done',
      meta: { promoCode: normalizedCode, promoId: promo._id },
    });

    if (BOT_TOKEN) {
      tgSend(req.user.telegramId, 
        `🎁 <b>Промокод активирован!</b>\n\nКод: <code>${normalizedCode}</code>\nНаграда: <b>+${reward.toFixed(4)} TON</b>\n\n💰 Новый баланс: ${updatedUser.balance.toFixed(4)} TON`
      );
    }

    console.log(`[promo] ${userTelegramId} activated ${normalizedCode} +${reward} TON`);

    res.json({
      success: true,
      reward: reward,
      balance: updatedUser.balance,
      message: `Промокод активирован! +${reward.toFixed(4)} TON`
    });

  } catch (e) {
    console.error('[POST /api/promo/activate]', e.message);
    res.status(500).json({ error: 'Ошибка активации промокода' });
  }
});

// ── ADMIN CRUD ──

app.get('/api/admin/promos', adminAuth, async (req, res) => {
  try {
    const promos = await PromoCode.find().sort({ createdAt: -1 });
    res.json({ promos: promos.map(p => ({
      _id: p._id,
      code: p.code,
      reward: p.reward,
      maxUses: p.maxUses,
      usedCount: p.usedCount,
      expiresAt: p.expiresAt,
      isActive: p.isActive,
      createdAt: p.createdAt,
      activatedCount: p.activatedBy?.size || 0,
    })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/promos', adminAuth, async (req, res) => {
  try {
    const { code, reward, maxUses, expiresInDays } = req.body;
    
    if (!code || !reward || reward <= 0) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }

    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const promo = await PromoCode.create({
      code: code.toUpperCase(),
      reward: parseFloat(reward),
      maxUses: maxUses || 1,
      expiresAt,
      createdBy: 'admin',
    });

    res.json({ promo });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(400).json({ error: 'Промокод с таким именем уже существует' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/promos/:id', adminAuth, async (req, res) => {
  try {
    const result = await PromoCode.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/promos/:id/toggle', adminAuth, async (req, res) => {
  try {
    const promo = await PromoCode.findById(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Не найден' });
    promo.isActive = !promo.isActive;
    await promo.save();
    res.json({ isActive: promo.isActive });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ═══════════════════════════════════════════════════════════════
// WORKER
// ═══════════════════════════════════════════════════════════════

function simulateTick(bot) {
  const base      = bot.targetProfit / bot.totalTicks;
  const remaining = bot.targetProfit - bot.earned;
  const win       = Math.random() > 0.15;
  let pnl;

  if (win) {
    pnl = parseFloat((base * rnd(0.80, 1.20)).toFixed(6));
    if (remaining > 0 && pnl > remaining * 1.5) {
      pnl = parseFloat((remaining * rnd(0.40, 0.70)).toFixed(6));
    }
    if (pnl < 0.000001) pnl = 0.000001;
  } else {
    pnl = -parseFloat((base * rnd(0.15, 0.30)).toFixed(6));
  }
  return pnl;
}

async function processBotTicks(bot) {
  const now     = new Date();
  const TICK_MS = 60000;

  const from       = bot.lastTickAt ? new Date(bot.lastTickAt) : new Date(bot.startedAt);
  const ticksDue   = Math.max(0, Math.floor((now - from) / TICK_MS));
  if (ticksDue === 0) return;

  const ticksLeft  = bot.totalTicks - bot.ticksDone;
  const toRun      = Math.min(ticksDue, ticksLeft);

  if (toRun === 0) {
    if (!bot.done) { bot.done = true; bot.lastTickAt = now; await bot.save(); }
    return;
  }

  let earned = 0;
  for (let i = 0; i < toRun; i++) {
    const pnl       = simulateTick(bot);
    const tradeTime = new Date(+from + (i + 1) * TICK_MS);

    const idx = bot.trades.findIndex(t => t.type === 'open');
    if (idx !== -1) {
      bot.trades[idx].type     = 'closed';
      bot.trades[idx].pnl      = pnl;
      bot.trades[idx].closedAt = tradeTime;
    }
    earned += pnl;

    if ((bot.ticksDone + i + 1) < bot.totalTicks) {
      bot.trades.push({ type: 'open', pair: bot.pair, openedAt: tradeTime });
    }
  }

  if (bot.trades.length > 20) bot.trades = bot.trades.slice(-20);

  bot.earned    += earned;
  bot.ticksDone += toRun;
  bot.lastTickAt = new Date(+from + toRun * TICK_MS);

  if (bot.ticksDone >= bot.totalTicks || now >= bot.endsAt) {
    bot.done = true;
    const last = bot.trades[bot.trades.length - 1];
    if (last && last.type === 'open') { last.type = 'closed'; last.pnl = 0; last.closedAt = now; }
  }

  await bot.save();
  console.log(`[worker] ${bot.name} (${bot.pair}) +${toRun} ticks | earned=${bot.earned.toFixed(4)} TON | done=${bot.done}`);
}

async function runWorker() {
  try {
    const bots = await Bot.find({ claimed: false });
    if (bots.length) await Promise.allSettled(bots.map(processBotTicks));
  } catch (e) {
    console.error('[worker]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('[db] MongoDB connected');

    if (APP_URL && BOT_TOKEN) {
      const webhookUrl = APP_URL.replace(/\/+$/, '') + '/webhook';
      await bot.setWebHook(webhookUrl);
      console.log('[bot] Webhook:', webhookUrl);
    } else {
      console.warn('[bot] APP_URL or BOT_TOKEN missing');
    }

    await runWorker();
    setInterval(runWorker, 60000);
    console.log('[worker] Started');

    app.listen(PORT, () => console.log(`[server] Port ${PORT}`));
  } catch (e) {
    console.error('[startup]', e.message);
    process.exit(1);
  }
}

start();