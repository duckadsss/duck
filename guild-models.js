// ============================================
// guild-models.js — Схемы гильдий DNA MMO
// ============================================
const mongoose = require('mongoose');

// GXP нужное для уровня L — тяжёлая прогрессия
// Lv1→2: 500, Lv2→3: 2000, Lv3→4: 5000, Lv4→5: 10000
// Lv5→6: 18000, Lv6→7: 30000, Lv7→8: 50000, Lv8→9: 80000, Lv9→10: 120000
const GXP_TABLE = [0, 500, 2000, 5000, 10000, 18000, 30000, 50000, 80000, 120000];
const gxpForLevel = (level) => GXP_TABLE[level] || 120000;

const guildBonus = (level) => (level * 0.02);
const GUILD_MAX_LEVEL = 10;
const GUILD_CREATE_COST = 100000;
const GUILD_DAILY_CONTRIBUTION = 300;
const GUILD_DAILY_GXP = 100;
const GUILD_TREASURY_CUT = 0.10; // 10% в казну лидера
const JOIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24ч кулдаун вклада после входа

const maxMembersByLevel = (level) => Math.min(20, 5 + (level * 3) - 3);

// Что даёт каждый уровень
const GUILD_LEVEL_REWARDS = [
    null, // 0 — не используется
    { bonus: '+2%', members: 5,  gxpNeeded: 500,    desc: 'Стартовый уровень' },
    { bonus: '+4%', members: 8,  gxpNeeded: 2000,   desc: '+3 слота участников' },
    { bonus: '+6%', members: 11, gxpNeeded: 5000,   desc: '+3 слота участников' },
    { bonus: '+8%', members: 14, gxpNeeded: 10000,  desc: '+3 слота участников' },
    { bonus: '+10%',members: 17, gxpNeeded: 18000,  desc: '+3 слота участников' },
    { bonus: '+12%',members: 20, gxpNeeded: 30000,  desc: 'Максимум участников' },
    { bonus: '+14%',members: 20, gxpNeeded: 50000,  desc: 'Бонус к арене растёт' },
    { bonus: '+16%',members: 20, gxpNeeded: 80000,  desc: 'Бонус к арене растёт' },
    { bonus: '+18%',members: 20, gxpNeeded: 120000, desc: 'Бонус к арене растёт' },
    { bonus: '+20%',members: 20, gxpNeeded: null,   desc: 'МАКСИМАЛЬНЫЙ УРОВЕНЬ' },
];

const GuildMemberSchema = new mongoose.Schema({
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId:      { type: String, required: true },
    username:        { type: String },
    role:            { type: String, enum: ['leader', 'officer', 'member'], default: 'member' },
    joinedAt:        { type: Date, default: Date.now },
    contributionUnlockedAt: { type: Date, default: null }, // когда можно вносить вклад (joinedAt + 24ч)
    lastContribution:{ type: Date, default: null },
    totalContributed:{ type: Number, default: 0 }
}, { _id: false });

const GuildSchema = new mongoose.Schema({
    name:        { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    tag:         { type: String, required: true, unique: true, trim: true, uppercase: true, minlength: 2, maxlength: 5 },
    description: { type: String, default: '', maxlength: 200 },
    leaderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leaderName:  { type: String },
    level:       { type: Number, default: 1, min: 1, max: GUILD_MAX_LEVEL },
    gxp:         { type: Number, default: 0 },
    gxpToNext:   { type: Number, default: gxpForLevel(1) },
    treasury:    { type: Number, default: 0 }, // казна гильдии (10% от взносов)
    members:     [GuildMemberSchema],
    isOpen:      { type: Boolean, default: true },
    isActive:    { type: Boolean, default: true },
    createdAt:   { type: Date, default: Date.now },
    totalGxpEarned: { type: Number, default: 0 }
});

const GuildInviteSchema = new mongoose.Schema({
    guildId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true },
    guildName:  { type: String },
    guildTag:   { type: String },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    toUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status:     { type: String, enum: ['pending', 'accepted', 'rejected', 'expired'], default: 'pending' },
    createdAt:  { type: Date, default: Date.now, expires: 86400 }
});

const Guild       = mongoose.model('Guild', GuildSchema);
const GuildInvite = mongoose.model('GuildInvite', GuildInviteSchema);

module.exports = {
    Guild, GuildInvite,
    gxpForLevel, guildBonus, maxMembersByLevel,
    GUILD_MAX_LEVEL, GUILD_CREATE_COST, GUILD_DAILY_CONTRIBUTION,
    GUILD_DAILY_GXP, GUILD_TREASURY_CUT, JOIN_COOLDOWN_MS,
    GUILD_LEVEL_REWARDS, GXP_TABLE
};
