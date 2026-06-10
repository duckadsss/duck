// ============================================
// guild-api.js — API эндпоинты гильдий
// ============================================
const { Guild, GuildInvite, gxpForLevel, maxMembersByLevel, GUILD_CREATE_COST, GUILD_DAILY_CONTRIBUTION, GUILD_DAILY_GXP, GUILD_MAX_LEVEL } = require('./guild-models');

module.exports = function registerGuildRoutes(app, authMiddleware, User) {

    // ── GET /api/guild/my — моя гильдия ──────────────────────────────
    app.get('/api/guild/my', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (!user.guildId) return res.json({ success: true, guild: null });
            const guild = await Guild.findById(user.guildId);
            if (!guild) {
                await User.updateOne({ _id: user._id }, { $unset: { guildId: 1, guildRole: 1 } });
                return res.json({ success: true, guild: null });
            }
            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── GET /api/guild/list — список гильдий ─────────────────────────
    app.get('/api/guild/list', authMiddleware, async (req, res) => {
        try {
            const { search = '' } = req.query;
            const query = { isActive: true };
            if (search) query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { tag: { $regex: search, $options: 'i' } }
            ];
            const guilds = await Guild.find(query)
                .select('name tag description level gxp gxpToNext members leaderId leaderName isOpen createdAt')
                .sort({ level: -1, totalGxpEarned: -1 })
                .limit(30)
                .lean();
            res.json({ success: true, guilds: guilds.map(g => ({
                _id: g._id,
                name: g.name,
                tag: g.tag,
                description: g.description,
                level: g.level,
                gxp: g.gxp,
                gxpToNext: g.gxpToNext,
                memberCount: g.members.length,
                maxMembers: maxMembersByLevel(g.level),
                leaderName: g.leaderName,
                isOpen: g.isOpen,
                bonusPercent: Math.round(g.level * 2)
            })) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/create — создать гильдию ─────────────────────
    app.post('/api/guild/create', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (user.guildId) return res.status(400).json({ success: false, message: 'Вы уже состоите в гильдии' });
            if (user.balance < GUILD_CREATE_COST) return res.status(400).json({ success: false, message: `Нужно ${GUILD_CREATE_COST.toLocaleString()} MMO` });

            const { name, tag, description = '' } = req.body;
            if (!name || name.trim().length < 3 || name.trim().length > 30)
                return res.status(400).json({ success: false, message: 'Название: 3–30 символов' });
            if (!tag || tag.trim().length < 2 || tag.trim().length > 5)
                return res.status(400).json({ success: false, message: 'Тег: 2–5 символов' });

            const tagClean = tag.trim().toUpperCase();
            const nameClean = name.trim();

            const exists = await Guild.findOne({ $or: [{ name: nameClean }, { tag: tagClean }] });
            if (exists) return res.status(400).json({ success: false, message: 'Название или тег уже заняты' });

            const guild = await Guild.create({
                name: nameClean,
                tag: tagClean,
                description: description.trim().slice(0, 200),
                leaderId: user._id,
                leaderName: user.username || user.firstName || `User${user.telegramId.slice(-4)}`,
                members: [{
                    userId: user._id,
                    telegramId: user.telegramId,
                    username: user.username || user.firstName,
                    role: 'leader'
                }]
            });

            await User.updateOne({ _id: user._id }, {
                $inc: { balance: -GUILD_CREATE_COST },
                $set: { guildId: guild._id, guildRole: 'leader' }
            });

            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            if (e.code === 11000) return res.status(400).json({ success: false, message: 'Название или тег уже заняты' });
            console.error('guild create error:', e);
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/join/:guildId — вступить ─────────────────────
    app.post('/api/guild/join/:guildId', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (user.guildId) return res.status(400).json({ success: false, message: 'Вы уже в гильдии' });

            const guild = await Guild.findById(req.params.guildId);
            if (!guild || !guild.isActive) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });

            const maxM = maxMembersByLevel(guild.level);
            if (guild.members.length >= maxM) return res.status(400).json({ success: false, message: 'Гильдия заполнена' });

            if (!guild.isOpen) return res.status(400).json({ success: false, message: 'Гильдия закрыта. Запросите приглашение.' });

            guild.members.push({
                userId: user._id,
                telegramId: user.telegramId,
                username: user.username || user.firstName,
                role: 'member'
            });
            await guild.save();
            await User.updateOne({ _id: user._id }, { $set: { guildId: guild._id, guildRole: 'member' } });

            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/leave — выйти ────────────────────────────────
    app.post('/api/guild/leave', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });

            const guild = await Guild.findById(user.guildId);
            if (!guild) {
                await User.updateOne({ _id: user._id }, { $unset: { guildId: 1, guildRole: 1 } });
                return res.json({ success: true });
            }

            const member = guild.members.find(m => m.userId.toString() === user._id.toString());
            if (!member) return res.status(400).json({ success: false, message: 'Вы не в этой гильдии' });

            if (member.role === 'leader') {
                return res.status(400).json({ success: false, message: 'Лидер не может выйти. Передайте лидерство или распустите гильдию.' });
            }

            guild.members = guild.members.filter(m => m.userId.toString() !== user._id.toString());
            await guild.save();
            await User.updateOne({ _id: user._id }, { $unset: { guildId: 1, guildRole: 1 } });

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/disband — распустить (лидер) ─────────────────
    app.post('/api/guild/disband', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });

            const guild = await Guild.findById(user.guildId);
            if (!guild) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });
            if (guild.leaderId.toString() !== user._id.toString())
                return res.status(403).json({ success: false, message: 'Только лидер может распустить гильдию' });

            // Снимаем гильдию у всех участников
            const memberIds = guild.members.map(m => m.userId);
            await User.updateMany({ _id: { $in: memberIds } }, { $unset: { guildId: 1, guildRole: 1 } });
            await Guild.findByIdAndDelete(guild._id);

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/transfer-leader — передать лидерство ─────────
    app.post('/api/guild/transfer-leader', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const { targetUserId } = req.body;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });

            const guild = await Guild.findById(user.guildId);
            if (!guild || guild.leaderId.toString() !== user._id.toString())
                return res.status(403).json({ success: false, message: 'Только лидер может передать лидерство' });

            const target = guild.members.find(m => m.userId.toString() === targetUserId);
            if (!target) return res.status(400).json({ success: false, message: 'Игрок не найден в гильдии' });

            guild.members.forEach(m => {
                if (m.userId.toString() === user._id.toString()) m.role = 'member';
                if (m.userId.toString() === targetUserId) m.role = 'leader';
            });
            guild.leaderId = target.userId;
            guild.leaderName = target.username;
            guild.markModified('members');
            await guild.save();

            await User.updateOne({ _id: user._id }, { $set: { guildRole: 'member' } });
            await User.updateOne({ _id: targetUserId }, { $set: { guildRole: 'leader' } });

            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/kick — исключить участника ───────────────────
    app.post('/api/guild/kick', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const { targetUserId } = req.body;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });

            const guild = await Guild.findById(user.guildId);
            if (!guild) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });

            const myMember = guild.members.find(m => m.userId.toString() === user._id.toString());
            if (!myMember || !['leader', 'officer'].includes(myMember.role))
                return res.status(403).json({ success: false, message: 'Нет прав' });

            const target = guild.members.find(m => m.userId.toString() === targetUserId);
            if (!target) return res.status(400).json({ success: false, message: 'Участник не найден' });
            if (target.role === 'leader') return res.status(400).json({ success: false, message: 'Нельзя исключить лидера' });

            guild.members = guild.members.filter(m => m.userId.toString() !== targetUserId);
            guild.markModified('members');
            await guild.save();
            await User.updateOne({ _id: targetUserId }, { $unset: { guildId: 1, guildRole: 1 } });

            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/update — изменить описание/открытость ────────
    app.post('/api/guild/update', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });

            const guild = await Guild.findById(user.guildId);
            if (!guild) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });
            if (guild.leaderId.toString() !== user._id.toString())
                return res.status(403).json({ success: false, message: 'Только лидер может редактировать гильдию' });

            const { description, isOpen } = req.body;
            if (description !== undefined) guild.description = description.trim().slice(0, 200);
            if (isOpen !== undefined) guild.isOpen = !!isOpen;
            await guild.save();

            res.json({ success: true, guild: formatGuild(guild, user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── POST /api/guild/contribute — ежедневный взнос ────────────────
    app.post('/api/guild/contribute', authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (!user.guildId) return res.status(400).json({ success: false, message: 'Вы не в гильдии' });
            if (user.balance < GUILD_DAILY_CONTRIBUTION)
                return res.status(400).json({ success: false, message: `Нужно ${GUILD_DAILY_CONTRIBUTION} MMO` });

            const guild = await Guild.findById(user.guildId);
            if (!guild) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });

            const member = guild.members.find(m => m.userId.toString() === user._id.toString());
            if (!member) return res.status(400).json({ success: false, message: 'Вы не в этой гильдии' });

            // Проверка раз в день
            const now = new Date();
            if (member.lastContribution) {
                const last = new Date(member.lastContribution);
                const diffMs = now - last;
                if (diffMs < 24 * 60 * 60 * 1000) {
                    const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - diffMs) / 3600000);
                    return res.status(400).json({ success: false, message: `Следующий взнос через ${hoursLeft}ч.` });
                }
            }

            member.lastContribution = now;
            member.totalContributed = (member.totalContributed || 0) + GUILD_DAILY_CONTRIBUTION;
            guild.gxp += GUILD_DAILY_GXP;
            guild.totalGxpEarned = (guild.totalGxpEarned || 0) + GUILD_DAILY_GXP;
            guild.markModified('members');

            // Проверяем повышение уровня
            let leveled = false;
            while (guild.level < GUILD_MAX_LEVEL && guild.gxp >= guild.gxpToNext) {
                guild.gxp -= guild.gxpToNext;
                guild.level++;
                guild.gxpToNext = Math.round(100 * Math.pow(guild.level, 2));
                leveled = true;
            }
            await guild.save();

            await User.updateOne({ _id: user._id }, { $inc: { balance: -GUILD_DAILY_CONTRIBUTION } });

            const updatedUser = await User.findById(user._id);
            res.json({ success: true, guild: formatGuild(guild, user._id), leveled, user: { balance: updatedUser.balance } });
        } catch (e) {
            console.error('guild contribute error:', e);
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    // ── GET /api/guild/:id — публичная страница гильдии ──────────────
    app.get('/api/guild/:id', authMiddleware, async (req, res) => {
        try {
            const guild = await Guild.findById(req.params.id);
            if (!guild || !guild.isActive) return res.status(404).json({ success: false, message: 'Гильдия не найдена' });
            res.json({ success: true, guild: formatGuild(guild, req.user._id) });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка сервера' });
        }
    });

    function formatGuild(guild, myUserId) {
        const myIdStr = myUserId?.toString();
        return {
            _id: guild._id,
            name: guild.name,
            tag: guild.tag,
            description: guild.description,
            level: guild.level,
            gxp: guild.gxp,
            gxpToNext: guild.gxpToNext,
            bonusPercent: Math.round(guild.level * 2),
            memberCount: guild.members.length,
            maxMembers: maxMembersByLevel(guild.level),
            leaderName: guild.leaderName,
            isOpen: guild.isOpen,
            createdAt: guild.createdAt,
            members: guild.members.map(m => ({
                userId: m.userId,
                username: m.username,
                role: m.role,
                joinedAt: m.joinedAt,
                lastContribution: m.lastContribution,
                totalContributed: m.totalContributed || 0,
                isMe: m.userId.toString() === myIdStr
            })),
            myRole: guild.members.find(m => m.userId.toString() === myIdStr)?.role || null,
            myLastContribution: guild.members.find(m => m.userId.toString() === myIdStr)?.lastContribution || null
        };
    }
};
