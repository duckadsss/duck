// ============================================
// guild-models.js — Схемы гильдий DNA MMO
// ============================================
const mongoose = require('mongoose');

// GXP нужное для уровня L: 100 * L^2
const gxpForLevel = (level) => 100 * Math.pow(level, 2);

// Бонус гильдии: +2% за каждый уровень
const guildBonus = (level) => (level * 0.02);

const GUILD_MAX_LEVEL = 10;
const GUILD_CREATE_COST = 100;
const GUILD_DAILY_CONTRIBUTION = 300;
const GUILD_DAILY_GXP = 100;

// Максимум участников по уровню гильдии
const maxMembersByLevel = (level) => Math.min(20, 5 + (level * 3) - 3);
// Lv1=5, Lv2=8, Lv3=11 ... Lv6+=20

const GuildMemberSchema = new mongoose.Schema({
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    username: { type: String },
    role:     { type: String, enum: ['leader', 'officer', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastContribution: { type: Date, default: null },
    totalContributed: { type: Number, default: 0 }
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
    members:     [GuildMemberSchema],
    isOpen:      { type: Boolean, default: true }, // открытая = без одобрения лидера
    isActive:    { type: Boolean, default: true },
    createdAt:   { type: Date, default: Date.now },
    totalGxpEarned: { type: Number, default: 0 }
});

GuildSchema.virtual('memberCount').get(function() {
    return this.members.length;
});

GuildSchema.virtual('maxMembers').get(function() {
    return maxMembersByLevel(this.level);
});

GuildSchema.virtual('bonusPercent').get(function() {
    return guildBonus(this.level);
});

const GuildInviteSchema = new mongoose.Schema({
    guildId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true },
    guildName: { type: String },
    guildTag:  { type: String },
    fromUserId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    toUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status:    { type: String, enum: ['pending', 'accepted', 'rejected', 'expired'], default: 'pending' },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // TTL 24ч
});

const Guild       = mongoose.model('Guild', GuildSchema);
const GuildInvite = mongoose.model('GuildInvite', GuildInviteSchema);

module.exports = { Guild, GuildInvite, gxpForLevel, guildBonus, maxMembersByLevel, GUILD_MAX_LEVEL, GUILD_CREATE_COST, GUILD_DAILY_CONTRIBUTION, GUILD_DAILY_GXP };
