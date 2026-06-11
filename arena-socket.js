// ============================================================
// arena-socket.js - Серверная логика PvP арены с WebSocket
// ============================================================
const ArenaSkills = require('./arena-skills');
const LEAGUE_CONFIG = {
    bronze: {
        minRating: 0,
        maxRating: 1299,
        entryFee: 10,
        prizePool: 16,
        dustWin: 1,
        dustLose: 0,
        xpWin: 10,
        xpLose: 2,
        color: '#cd7c3a',
        name: '🥉 Бронзовая'
    },
    silver: {
        minRating: 1300,
        maxRating: 1599,
        entryFee: 50,
        prizePool: 80,
        dustWin: 5,
        dustLose: 1,
        xpWin: 30,
        xpLose: 5,
        color: '#94a3b8',
        name: '🥈 Серебряная'
    },
    gold: {
        minRating: 1600,
        maxRating: 1899,
        entryFee: 500,
        prizePool: 800,
        dustWin: 55,
        dustLose: 11,
        xpWin: 50,
        xpLose: 10,
        color: '#f59e0b',
        name: '🥇 Золотая'
    },
    platinum: {
        minRating: 1900,
        maxRating: 2199,
        entryFee: 25000,
        prizePool: 40000,
        dustWin: 3250,
        dustLose: 750,
        xpWin: 100,
        xpLose: 30,
        color: '#a855f7',
        name: '💎 Платиновая'
    },
    diamond: {
        minRating: 2200,
        maxRating: 9999,
        entryFee: 5000,
        prizePool: 8000,
        dustWin: 600,
        dustLose: 125,
        xpWin: 75,
        xpLose: 20,
        color: '#06b6d4',
        name: '🏆 Алмазная'
    }
};

function getLeagueByRating(rating) {
    for (const [league, config] of Object.entries(LEAGUE_CONFIG)) {
        if (rating >= config.minRating && rating <= config.maxRating) {
            return league;
        }
    }
    return 'bronze';
}

function calculateEloChange(winnerRating, loserRating, k = 32) {
    const expectedScore = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    let change = Math.round(k * (1 - expectedScore));
    change = Math.min(change, 40);
    change = Math.max(change, 10);
    if (winnerRating < loserRating) {
        change = Math.min(change + 5, 45);
    }
    return change;
}

const RARITY_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.05,
    rare: 1.10,
    epic: 1.15,
    legendary: 1.25,
    mythic: 1.40
};

function calculateCreatureStats(creature, userLevel) {
    const multiplier = RARITY_MULTIPLIERS[creature.rarity] || 1;
    const baseHP = Math.ceil((50 + (creature.incomeBase * 2) + (userLevel * 5)) * multiplier);
    const baseATK = Math.ceil((10 + (creature.incomeBase / 2) + (userLevel * 2)) * multiplier);
    const baseDEF = Math.ceil((5 + (creature.incomeBase / 3) + (userLevel * 1)) * multiplier);
    const baseCRIT = 0.10;
    
    return { maxHp: baseHP, attack: baseATK, defense: baseDEF, critChance: baseCRIT };
}

async function buildTeamFromIds(teamIds, userLevel, userId, getCreatureFn) {
    const teamData = [];
    for (const creatureId of teamIds) {
        const creature = await getCreatureFn(creatureId);
        if (creature) {
            const stats = calculateCreatureStats(creature, userLevel);
            teamData.push({
                creatureId: creature.id,
                name: creature.name,
                icon: creature.icon,
                rarity: creature.rarity,
                maxHp: stats.maxHp,
                currentHp: stats.maxHp,
                attack: stats.attack,
                defense: stats.defense,
                critChance: stats.critChance,
                isAlive: true,
                stunned: false,
                shielded: false,
                skillDisabledTurns: 0,
                poisonTurns: 0,
                skill: ArenaSkills.getSkillForCreature(creature.id) || null
            });
        }
    }
    return teamData;
}

class ArenaSocketManager {
    constructor(io) {
        this.io = io;
        this.connectedUsers = new Map();
    }

    add(userId, socketId) {
        const userIdStr = userId.toString();
        const oldSocketId = this.connectedUsers.get(userIdStr);
        if (oldSocketId && oldSocketId !== socketId) {
            const oldSocket = this.io.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
                oldSocket.disconnect(true);
            }
        }
        this.connectedUsers.set(userIdStr, socketId);
        console.log(`🔌 WebSocket подключён: ${userIdStr} (всего: ${this.connectedUsers.size})`);
    }

    remove(userId, socketId) {
        const userIdStr = userId.toString();
        const storedSocketId = this.connectedUsers.get(userIdStr);
        
        // Если socketId не передан (полный дисконнект сервера) — удаляем запись
        if (!socketId) {
            this.connectedUsers.delete(userIdStr);
            console.log(`🔌 WebSocket отключён: ${userId} (полный дисконнект)`);
            return;
        }
        
        // Удаляем только если socketId совпадает с зарегистрированным
        if (storedSocketId === socketId) {
            this.connectedUsers.delete(userIdStr);
            console.log(`🔌 WebSocket отключён: ${userId} (сокет ${socketId.slice(-5)})`);
        }
        // Иначе игнорируем — это старый дисконнект
    }

    send(userId, event, data) {
        const socketId = this.connectedUsers.get(userId.toString());
        if (!socketId) return false;
        
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) {
            this.connectedUsers.delete(userId.toString());
            return false;
        }
        
        socket.emit(event, data);
        return true;
    }

    sendBoth(battle, event, data) {
        this.send(battle.player1Id, event, data);
        if (battle.player2Id) this.send(battle.player2Id, event, data);
    }

    getClientsCount() {
        return this.connectedUsers.size;
    }
}

class ArenaBattleManager {
    constructor(battleModel, userModel, arenaStatsModel, getCreatureFn, sendNotificationFn, arenaSocketManager) {
        this.Battle = battleModel;
        this.User = userModel;
        this.ArenaStats = arenaStatsModel;
        this.getCreature = getCreatureFn;
        this.sendNotification = sendNotificationFn;
        this.socketManager = arenaSocketManager;
    }

    async createBattle(player1Id, teamIds, userLevel, league) {
        const leagueConfig = LEAGUE_CONFIG[league];
        const team = await buildTeamFromIds(teamIds, userLevel, player1Id, this.getCreature);
        
        const battle = await this.Battle.create({
            player1Id: player1Id,
            player1Team: team,
            league: league,
            entryFee: leagueConfig.entryFee,
            prizePool: leagueConfig.prizePool,
            status: 'waiting',
            expiresAt: new Date(Date.now() + 30 * 1000)
        });
        
        return battle;
    }

    async findMatch(user, teamIds) {
        const userLevel = user.level;
        let userStats = await this.ArenaStats.findOne({ userId: user._id });
        
        if (!userStats) {
            userStats = await this.ArenaStats.create({ userId: user._id });
        }
        
        const userLeague = userStats.league;
        const leagueConfig = LEAGUE_CONFIG[userLeague];
        
        if (leagueConfig.entryFee > 0) {
            if (user.balance < leagueConfig.entryFee) {
                return { success: false, message: `Недостаточно MMO. Нужно ${leagueConfig.entryFee} MMO для участия в ${leagueConfig.name} лиге` };
            }
            const updatedUser = await this.User.findOneAndUpdate(
                { _id: user._id, balance: { $gte: leagueConfig.entryFee } },
                { $inc: { balance: -leagueConfig.entryFee } },
                { new: true }
            );
            if (!updatedUser) {
                return { success: false, message: 'Не удалось списать средства' };
            }
        }

        const excludeIds = [user._id];
        if (user.lastOpponentId) excludeIds.push(user.lastOpponentId);

        const player2TeamData = await buildTeamFromIds(teamIds, userLevel, user._id, this.getCreature);
        const claimedBattle = await this.Battle.findOneAndUpdate(
            {
                status: 'waiting',
                league: userLeague,
                player1Id: { $nin: excludeIds },
                player2Id: null,
                expiresAt: { $gt: new Date() }
            },
            {
                $set: {
                    player2Id: user._id,
                    player2Team: player2TeamData,
                    status: 'pending_confirmation',
                    expiresAt: new Date(Date.now() + 60 * 1000)
                }
            },
            { new: true, sort: { createdAt: 1 } }
        );

        try {
            if (claimedBattle) {
                const waitingBattle = claimedBattle;
                await Promise.all([
                    this.User.updateOne({ _id: user._id }, { $set: { currentBattleId: waitingBattle._id } }),
                    this.User.updateOne({ _id: waitingBattle.player1Id }, { $set: { currentBattleId: waitingBattle._id } })
                ]);
                return { success: true, battle: waitingBattle, isNew: false, entryFee: leagueConfig.entryFee };
            } else {
                const alreadyWaiting = await this.Battle.findOne({
                    status: 'waiting',
                    player1Id: user._id,
                    expiresAt: { $gt: new Date() }
                });
                if (alreadyWaiting) {
                    return { success: true, battle: alreadyWaiting, isNew: true, entryFee: leagueConfig.entryFee };
                }

                const newBattle = await this.createBattle(user._id, teamIds, userLevel, userLeague);
                await this.User.updateOne({ _id: user._id }, { $set: { currentBattleId: newBattle._id } });
                return { success: true, battle: newBattle, isNew: true, entryFee: leagueConfig.entryFee };
            }
        } catch (err) {
            if (leagueConfig.entryFee > 0) {
                await this.User.findByIdAndUpdate(user._id, {
                    $inc: { balance: leagueConfig.entryFee },
                    $set: { currentBattleId: null }
                }).catch(() => {});
            }
            throw err;
        }
    }

    async acceptMatch(battleId, userId) {
        const battleCheck = await this.Battle.findById(battleId);
        if (!battleCheck) {
            return { success: false, message: 'Бой не найден' };
        }
        if (battleCheck.status !== 'pending_confirmation') {
            return { success: false, message: 'Бой уже не в статусе ожидания подтверждения' };
        }

        const isPlayer1 = battleCheck.player1Id.toString() === userId.toString();
        const isPlayer2 = battleCheck.player2Id && battleCheck.player2Id.toString() === userId.toString();
        if (!isPlayer1 && !isPlayer2) {
            return { success: false, message: 'Вы не участник этого боя' };
        }

        const confirmField = isPlayer1 ? 'player1Confirmed' : 'player2Confirmed';
        const updated = await this.Battle.findOneAndUpdate(
            { _id: battleId, status: 'pending_confirmation', [confirmField]: false },
            { $set: { [confirmField]: true } },
            { new: true }
        );
        if (!updated) {
            return { success: false, message: 'Вы уже подтвердили' };
        }

        if (updated.player1Confirmed && updated.player2Confirmed) {
            // Защита от двойной активации
            const alreadyActive = await this.Battle.findOne({
                _id: battleId,
                status: { $in: ['active', 'finished'] }
            });
            if (alreadyActive) {
                return { success: false, message: 'Бой уже активирован' };
            }
            
            const startTurn = Math.random() < 0.5 ? 'player1' : 'player2';
            const battle = await this.Battle.findOneAndUpdate(
                { _id: battleId, status: 'pending_confirmation' },
                { $set: { status: 'active', currentTurn: startTurn, lastMoveAt: new Date(), expiresAt: null } },
                { new: true }
            );
            return { success: true, battle, bothConfirmed: true };
        }

        return { success: true, battle: updated, bothConfirmed: false };
    }

    async rejectMatch(battleId, userId) {
        const battle = await this.Battle.findOneAndUpdate(
            { _id: battleId, status: 'pending_confirmation' },
            { $set: { status: 'expired' } },
            { new: false }
        );
        if (!battle) {
            return { success: false, message: 'Бой не найден или уже не ожидает подтверждения' };
        }

        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        const isPlayer2 = battle.player2Id && battle.player2Id.toString() === userId.toString();
        if (!isPlayer1 && !isPlayer2) {
            await this.Battle.updateOne({ _id: battleId }, { $set: { status: 'pending_confirmation' } });
            return { success: false, message: 'Вы не участник этого боя' };
        }

        await this.User.findByIdAndUpdate(battle.player1Id, {
            $inc: { balance: battle.entryFee },
            $set: { currentBattleId: null, arenaCooldownUntil: null }
        });
        if (battle.player2Id) {
            await this.User.findByIdAndUpdate(battle.player2Id, {
                $inc: { balance: battle.entryFee },
                $set: { currentBattleId: null, arenaCooldownUntil: null }
            });
        }

        return { success: true, message: 'Бой отклонён, взносы возвращены' };
    }

    async processMove(battleId, userId, requestedTargetIndex) {
        const battle = await this.Battle.findById(battleId);
        if (!battle) {
            return { success: false, message: 'Бой не найден' };
        }
        
        if (battle.status !== 'active') {
            return { success: false, message: 'Бой не активен' };
        }
        
        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        const isMyTurn = (battle.currentTurn === 'player1' && isPlayer1) || 
                         (battle.currentTurn === 'player2' && !isPlayer1);
        
        if (!isMyTurn) {
            return { success: false, message: 'Сейчас не ваш ход' };
        }

        const expectedTurn = battle.currentTurn;
        const locked = await this.Battle.findOneAndUpdate(
            { _id: battleId, status: 'active', currentTurn: expectedTurn },
            { $set: { currentTurn: '__processing__', processingStartedAt: new Date(), processingByPlayer: expectedTurn } }
        );
        if (!locked) {
            return { success: false, message: 'Ход уже обрабатывается, подождите' };
        }

        try {
            const myTeam = isPlayer1 ? battle.player1Team : battle.player2Team;
            const enemyTeam = isPlayer1 ? battle.player2Team : battle.player1Team;
            const leagueCfg = LEAGUE_CONFIG[battle.league] || LEAGUE_CONFIG.bronze;

            // ── ЯД: тик в начале хода ──────────────────────────────
            const poisonLog = [];
            myTeam.forEach(p => {
                if (p.isAlive && p.poisonTurns > 0) {
                    const dmg = Math.max(1, Math.floor(p.maxHp * 0.10));
                    p.currentHp = Math.max(0, p.currentHp - dmg);
                    p.poisonTurns--;
                    if (p.currentHp <= 0) p.isAlive = false;
                    poisonLog.push({ name: p.name, dmg });
                }
            });
            if (myTeam.every(p => !p.isAlive)) {
                battle.status = 'finished';
                battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
                battle.markModified('player1Team');
                battle.markModified('player2Team');
                await this.finishBattle(battle);
                return { success: true, finished: true, winnerId: battle.winnerId?.toString(), prizePool: battle.prizePool, dustWin: leagueCfg.dustWin || 0, dustLose: leagueCfg.dustLose || 0, xpWin: leagueCfg.xpWin || 0, xpLose: leagueCfg.xpLose || 0, poisonLog };
            }
            
            let attackerIndex = -1;
            let attacker = null;
            for (let i = 0; i < myTeam.length; i++) {
                if (myTeam[i].isAlive) {
                    attackerIndex = i;
                    attacker = myTeam[i];
                    break;
                }
            }
            
            if (!attacker) {
                battle.status = 'finished';
                battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
                battle.markModified('player1Team');
                battle.markModified('player2Team');
                await this.finishBattle(battle);
                return { success: true, finished: true, winnerId: battle.winnerId?.toString(), prizePool: battle.prizePool, dustWin: leagueCfg.dustWin || 0, dustLose: leagueCfg.dustLose || 0, xpWin: leagueCfg.xpWin || 0, xpLose: leagueCfg.xpLose || 0 };
            }
            
            let targetIndex = -1;
            if (requestedTargetIndex !== undefined && requestedTargetIndex >= 0 && requestedTargetIndex < enemyTeam.length && 
                enemyTeam[requestedTargetIndex]?.isAlive) {
                targetIndex = requestedTargetIndex;
            } else {
                for (let i = 0; i < enemyTeam.length; i++) {
                    if (enemyTeam[i].isAlive) { targetIndex = i; break; }
                }
            }
            
            if (targetIndex === -1) {
                battle.status = 'finished';
                battle.winnerId = isPlayer1 ? battle.player1Id : battle.player2Id;
                await this.finishBattle(battle);
                return { success: true, finished: true, winnerId: battle.winnerId?.toString(), prizePool: battle.prizePool, dustWin: leagueCfg.dustWin || 0, dustLose: leagueCfg.dustLose || 0, xpWin: leagueCfg.xpWin || 0, xpLose: leagueCfg.xpLose || 0 };
            }
            
            const target = enemyTeam[targetIndex];
            
            if (ArenaSkills.checkAndClearStun(attacker)) {
                battle.currentTurn = battle.currentTurn === 'player1' ? 'player2' : 'player1';
                battle.turnCount++;
                battle.lastMoveAt = new Date();
                if (isPlayer1) { battle.markModified('player1Team'); } else { battle.markModified('player2Team'); }
                await battle.save();
                return { success: true, finished: false, stunSkipped: true, currentTurn: battle.currentTurn, turnCount: battle.turnCount, myTeam, enemyTeam, timeLeft: 30, serverTimestamp: Date.now() };
            }

            const isCrit = Math.random() < attacker.critChance;
            let damage = Math.max(1, attacker.attack - target.defense);
            if (isCrit) damage = Math.floor(damage * 1.5);

            let skillResult = { triggered: false };
            if (attacker.skill) {
                if (attacker.skillDisabledTurns > 0) {
                    attacker.skillDisabledTurns--;
                } else {
                    skillResult = ArenaSkills.applySkill(attacker.skill.id, attacker, target, myTeam, enemyTeam, damage);
                    if (skillResult.triggered) damage = skillResult.damage;
                }
            }

            if (!skillResult.missTarget && ArenaSkills.checkAndClearShield(target)) {
                damage = 0;
            }

            target.currentHp = Math.max(0, target.currentHp - damage);
            if (target.currentHp <= 0) {
                target.isAlive = false;
            }

            const skillSummary = ArenaSkills.applySkillResult(skillResult, attackerIndex, targetIndex, myTeam, enemyTeam);

            // ── ЗАПИСЬ В BATTLE LOG ──────────────────────────────────
            const logEntry = {
                turn: battle.turnCount,
                player: isPlayer1 ? 'player1' : 'player2',
                attackerName: attacker.name,
                attackerIndex: attackerIndex,
                targetName: target.name,
                targetIndex: targetIndex,
                damage: damage,
                isCrit: isCrit,
                remainingHp: target.currentHp,
                timestamp: new Date()
            };
            battle.battleLog.push(logEntry);
            if (battle.battleLog.length > 50) {
                battle.battleLog = battle.battleLog.slice(-50);
            }

            myTeam.forEach(p => { if (p.currentHp <= 0) p.isAlive = false; });
            enemyTeam.forEach(p => { if (p.currentHp <= 0) p.isAlive = false; });

            const allEnemyDead = enemyTeam.every(p => !p.isAlive);
            const allMyDead    = myTeam.every(p => !p.isAlive);
            
            if (allMyDead && allEnemyDead) {
                battle.status = 'finished';
                battle.winnerId = null;
                battle.turnCount++;
                battle.markModified('player1Team');
                battle.markModified('player2Team');
                await this.finishBattle(battle);
                return { success: true, finished: true, draw: true, winnerId: null, prizePool: 0, dustWin: 0 };
            }

            if (allMyDead) {
                battle.status = 'finished';
                battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
                battle.turnCount++;
                battle.markModified('player1Team');
                battle.markModified('player2Team');
                await this.finishBattle(battle);
                return { success: true, finished: true, winnerId: battle.winnerId?.toString(), prizePool: battle.prizePool, dustWin: leagueCfg.dustWin || 0, dustLose: leagueCfg.dustLose || 0, xpWin: leagueCfg.xpWin || 0, xpLose: leagueCfg.xpLose || 0, lastMove: { damage, isCrit, targetIndex, targetHp: target.currentHp, targetDead: true } };
            }

            if (allEnemyDead) {
                battle.status = 'finished';
                battle.winnerId = isPlayer1 ? battle.player1Id : battle.player2Id;
                battle.turnCount++;
                battle.markModified('player1Team');
                battle.markModified('player2Team');
                await this.finishBattle(battle);
                
                return {
                    success: true,
                    finished: true,
                    winnerId: battle.winnerId?.toString(),
                    prizePool: battle.prizePool,
                    dustWin: leagueCfg.dustWin || 0,
                    dustLose: leagueCfg.dustLose || 0,
                    xpWin: leagueCfg.xpWin || 0,
                    xpLose: leagueCfg.xpLose || 0,
                    lastMove: { damage, isCrit, targetIndex, targetHp: target.currentHp, targetDead: true }
                };
            }
            
            battle.currentTurn = battle.currentTurn === 'player1' ? 'player2' : 'player1';
            battle.turnCount++;
            const moveTimestamp = Date.now();
            battle.lastMoveAt = new Date(moveTimestamp);
            
            if (isPlayer1) {
                battle.player1LastMoveAt = new Date(moveTimestamp);
            } else {
                battle.player2LastMoveAt = new Date(moveTimestamp);
            }
            
            if (isPlayer1) {
                battle.markModified('player1Team');
                battle.markModified('player2Team');
            } else {
                battle.markModified('player2Team');
                battle.markModified('player1Team');
            }
            
            await battle.save();
            
            const timeLeft = 30;
            
            return {
                success: true,
                finished: false,
                lastMove: { 
                    damage, 
                    isCrit, 
                    targetIndex: targetIndex,
                    targetHp: target.currentHp, 
                    targetDead: false,
                    attackerIndex: attackerIndex
                },
                skillResult: skillResult.triggered ? {
                    skillId: skillResult.skillId,
                    skillName: skillResult.skillName,
                    description: skillResult.description,
                    splashHits: skillSummary.splashHits,
                    healedSelf: skillSummary.healedSelf,
                    healedAllies: skillSummary.healedAllies,
                    stunned: skillSummary.stunned,
                    shielded: skillSummary.shielded,
                    missed: skillSummary.missed,
                    skillDisabled: skillSummary.skillDisabled,
                    poisoned: skillSummary.poisoned
                } : null,
                currentTurn: battle.currentTurn,
                turnCount: battle.turnCount,
                myTeam: myTeam,
                enemyTeam: enemyTeam,
                battleLog: battle.battleLog.slice(-1),
                timeLeft: timeLeft,
                serverTimestamp: moveTimestamp
            };
        } catch(err) {
            await this.Battle.findOneAndUpdate(
                { _id: battleId, currentTurn: '__processing__' },
                { $set: { currentTurn: expectedTurn } }
            );
            throw err;
        }
    }

    async finishBattle(battle) {
        const winnerId = battle.winnerId;
        const cooldown = new Date(Date.now() + 30 * 1000);
        const ids = [battle.player1Id, battle.player2Id].filter(Boolean);

        if (!winnerId) {
            await this.User.updateMany(
                { _id: { $in: ids } },
                { $inc: { balance: battle.entryFee }, $set: { currentBattleId: null, arenaCooldownUntil: cooldown } }
            );
            await battle.save();
            return { winnerId: null, loserId: null };
        }

        const loserId = winnerId.toString() === battle.player1Id.toString() ? battle.player2Id : battle.player1Id;
        const leagueCfg = LEAGUE_CONFIG[battle.league] || LEAGUE_CONFIG.bronze;
        const xpCalc = (level) => level <= 15 ? level * 100 : 1500 + (level - 15) * 1000;

        const xpWin  = leagueCfg.xpWin  || 0;
        const xpLose = leagueCfg.xpLose || 0;

        const balanceOps = [
            this.User.findByIdAndUpdate(winnerId, { $inc: { balance: battle.prizePool, dust: leagueCfg.dustWin || 0 } }, { new: true })
        ];
        if ((leagueCfg.dustLose || 0) > 0) {
            balanceOps.push(this.User.findByIdAndUpdate(loserId, { $inc: { dust: leagueCfg.dustLose } }, { new: true }));
        }

        let [winnerUser, loserUser, winnerStats, loserStats] = await Promise.all([
            this.User.findById(winnerId),
            this.User.findById(loserId),
            this.ArenaStats.findOne({ userId: winnerId }),
            this.ArenaStats.findOne({ userId: loserId }),
            ...balanceOps
        ]);

        if (!winnerStats) winnerStats = await this.ArenaStats.create({ userId: winnerId });
        if (!loserStats)  loserStats  = await this.ArenaStats.create({ userId: loserId });

        const ratingChange = calculateEloChange(winnerStats.rating, loserStats.rating);

        let newWinnerRating = winnerStats.rating + ratingChange;
        const oldWinnerLeague = winnerStats.league;
        let newWinnerLeague = getLeagueByRating(newWinnerRating);

        let newLoserRating = Math.max(0, loserStats.rating - ratingChange);
        const oldLoserLeague = loserStats.league;
        let newLoserLeague = getLeagueByRating(newLoserRating);

        let promotionMessage = null;
        let demotionMessage = null;

        if (newWinnerLeague !== oldWinnerLeague && newWinnerRating >= LEAGUE_CONFIG[newWinnerLeague].minRating) {
            promotionMessage = `🎉 ПОВЫШЕНИЕ! Вы перешли в ${LEAGUE_CONFIG[newWinnerLeague].name} лигу!`;
            winnerStats.promotions += 1;
            winnerStats.promotionProtection = true;
        }

        if (newLoserLeague !== oldLoserLeague && !loserStats.promotionProtection) {
            const shouldDemote = newLoserRating < (LEAGUE_CONFIG[oldLoserLeague].minRating - 100);
            if (shouldDemote) {
                demotionMessage = `⚠️ ПОНИЖЕНИЕ! Вы вылетели в ${LEAGUE_CONFIG[newLoserLeague].name} лигу. Вернитесь, побеждая сильных!`;
                loserStats.demotions += 1;
            } else {
                newLoserLeague = oldLoserLeague;
                newLoserRating = LEAGUE_CONFIG[oldLoserLeague].minRating - 50;
            }
        } else if (loserStats.promotionProtection && newLoserRating < LEAGUE_CONFIG[oldLoserLeague].minRating) {
            newLoserRating = LEAGUE_CONFIG[oldLoserLeague].minRating;
            loserStats.promotionProtection = false;
        }
        if (loserStats.promotionProtection && !(newLoserRating >= LEAGUE_CONFIG[oldLoserLeague].minRating)) {
            loserStats.promotionProtection = false;
        }

        winnerStats.rating = newWinnerRating;
        winnerStats.league = newWinnerLeague;
        winnerStats.peakRating = Math.max(winnerStats.peakRating, newWinnerRating);
        winnerStats.wins += 1;
        winnerStats.streak += 1;
        winnerStats.bestStreak = Math.max(winnerStats.bestStreak, winnerStats.streak);
        winnerStats.totalBattles += 1;
        winnerStats.totalEarned += battle.prizePool;
        winnerStats.lastBattleAt = new Date();

        loserStats.rating = newLoserRating;
        loserStats.league = newLoserLeague;
        loserStats.losses += 1;
        loserStats.streak = 0;
        loserStats.totalBattles += 1;
        loserStats.totalLost = (loserStats.totalLost || 0) + battle.entryFee;
        loserStats.lastBattleAt = new Date();

        const xpOps = [];
        if (xpWin > 0 && winnerUser) {
            const winXpNew = winnerUser.xp + xpWin;
            xpOps.push(winXpNew >= xpCalc(winnerUser.level)
                ? this.User.updateOne({ _id: winnerId }, { $inc: { level: 1 }, $set: { xp: winXpNew - xpCalc(winnerUser.level) } })
                : this.User.updateOne({ _id: winnerId }, { $inc: { xp: xpWin } }));
        }
        if (xpLose > 0 && loserUser) {
            const loseXpNew = loserUser.xp + xpLose;
            xpOps.push(loseXpNew >= xpCalc(loserUser.level)
                ? this.User.updateOne({ _id: loserId }, { $inc: { level: 1 }, $set: { xp: loseXpNew - xpCalc(loserUser.level) } })
                : this.User.updateOne({ _id: loserId }, { $inc: { xp: xpLose } }));
        }

        const lastOpOps = (battle.player1Id && battle.player2Id) ? [
            this.User.updateOne({ _id: battle.player1Id }, { $set: { lastOpponentId: battle.player2Id } }),
            this.User.updateOne({ _id: battle.player2Id }, { $set: { lastOpponentId: battle.player1Id } })
        ] : [];

        await Promise.all([
            winnerStats.save(),
            loserStats.save(),
            this.User.updateMany({ _id: { $in: ids } }, { $set: { currentBattleId: null, arenaCooldownUntil: cooldown } }),
            ...lastOpOps,
            ...xpOps
        ]);

        if (this.sendNotification) {
            const dustWinStr = (leagueCfg.dustWin || 0) > 0 ? `\n🌫️ Пыль: +${leagueCfg.dustWin}` : '';
            const xpWinStr   = xpWin  > 0 ? `\n⭐ Опыт: +${xpWin}`  : '';
            const dustLoseStr = (leagueCfg.dustLose || 0) > 0 ? `\n🌫️ Пыль: +${leagueCfg.dustLose}` : '';
            const xpLoseStr  = xpLose > 0 ? `\n⭐ Опыт: +${xpLose}` : '';
            if (winnerUser) {
                this.sendNotification(winnerUser.telegramId,
                    `🏆 <b>ПОБЕДА В АРЕНЕ!</b>\n\n` +
                    `Вы победили ${loserUser?.username || loserUser?.firstName || 'игрока'}!\n` +
                    `💰 Выигрыш: +${battle.prizePool.toLocaleString()} MMO${dustWinStr}${xpWinStr}\n` +
                    `📊 Рейтинг: ${winnerStats.rating} (+${ratingChange})\n` +
                    `🔥 Серия побед: ${winnerStats.streak}\n` +
                    `${promotionMessage ? `\n${promotionMessage}` : ''}\n` +
                    `🏅 Лига: ${LEAGUE_CONFIG[winnerStats.league].name}`
                ).catch(() => {});
            }
            if (loserUser) {
                this.sendNotification(loserUser.telegramId,
                    `💀 <b>ПОРАЖЕНИЕ В АРЕНЕ</b>\n\n` +
                    `Вы проиграли ${winnerUser?.username || winnerUser?.firstName || 'игроку'}.\n` +
                    `📊 Рейтинг: ${loserStats.rating} (-${ratingChange})${dustLoseStr}${xpLoseStr}\n` +
                    `${demotionMessage ? `\n${demotionMessage}` : ''}\n` +
                    `💪 Следующий бой будет лучше!`
                ).catch(() => {});
            }
        }

        await battle.save();
        return { winnerId, loserId, xpWin, xpLose };
    }

    async surrenderBattle(battleId, userId) {
        const battle = await this.Battle.findOneAndUpdate(
            { _id: battleId, status: 'active', winnerId: null },
            { $set: { status: 'finished' } },
            { new: false }
        );
        if (!battle) {
            return { success: false, message: 'Бой не найден или уже завершён' };
        }

        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        battle.status = 'finished';
        battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
        battle.markModified('player1Team');
        battle.markModified('player2Team');
        await this.finishBattle(battle);

        return { success: true, message: 'Вы сдались' };
    }

    async expireOldBattles() {
        const now = new Date();
        let expiredCount = 0;
        
        const expiredWaiting = await this.Battle.find({
            status: { $in: ['waiting', 'pending_confirmation'] },
            expiresAt: { $lt: now }
        });
        
        for (const battle of expiredWaiting) {
            const atomicExpire = await this.Battle.findOneAndUpdate(
                { _id: battle._id, status: { $in: ['waiting', 'pending_confirmation'] } },
                { $set: { status: 'expired' } },
                { new: false }
            );
            if (!atomicExpire) continue;

            const entryFee = atomicExpire.entryFee;
            const player1Id = atomicExpire.player1Id;
            const player2Id = atomicExpire.player2Id;
            const wasPendingConfirmation = atomicExpire.status === 'pending_confirmation';
            expiredCount++;
            
            if (player1Id) {
                await this.User.findByIdAndUpdate(player1Id, {
                    $inc: { balance: entryFee },
                    $set: { currentBattleId: null, arenaCooldownUntil: null }
                });
                await this.User.updateOne(
                    { _id: player1Id, arenaBattlesLeft: { $lt: 10 } },
                    { $inc: { arenaBattlesLeft: 1 } }
                );
            }
            
            if (player2Id && wasPendingConfirmation) {
                await this.User.findByIdAndUpdate(player2Id, {
                    $inc: { balance: entryFee },
                    $set: { currentBattleId: null, arenaCooldownUntil: null }
                });
                await this.User.updateOne(
                    { _id: player2Id, arenaBattlesLeft: { $lt: 10 } },
                    { $inc: { arenaBattlesLeft: 1 } }
                );
            } else if (player2Id) {
                await this.User.updateOne({ _id: player2Id }, { $set: { currentBattleId: null, arenaCooldownUntil: null } });
            }
        }
        
        const timeoutSeconds = 35;
        const timeoutAgo = new Date(now.getTime() - timeoutSeconds * 1000);
        
        const stalledBattles = await this.Battle.find({
            status: 'active',
            lastMoveAt: { $lt: timeoutAgo }
        });
        
        for (const battle of stalledBattles) {
            const lastMovePlayer = battle.currentTurn === 'player1' ? 'player1' : 'player2';
            battle.winnerId = lastMovePlayer === 'player1' ? battle.player2Id : battle.player1Id;
            battle.status = 'finished';
            await this.finishBattle(battle);
            this.socketManager.sendBoth(battle, 'battle_end', {
                battleId: battle._id,
                winnerId: battle.winnerId?.toString(),
                prizePool: battle.prizePool,
                reason: 'timeout'
            });
            expiredCount++;
        }

        // ── Восстановление зависших __processing__ ──
        const stuckProcessing = await this.Battle.find({
            status: 'active',
            currentTurn: '__processing__',
            processingStartedAt: { $lt: new Date(Date.now() - 15000) }
        });
        for (const battle of stuckProcessing) {
            console.log(`⚠️ Разблокировка зависшего боя ${battle._id}`);
            const expectedRestore = battle.processingByPlayer || 'player1';
            await this.Battle.updateOne(
                { _id: battle._id, currentTurn: '__processing__' },
                { $set: { currentTurn: expectedRestore, processingStartedAt: null } }
            );
            expiredCount++;
        }
        
        if (expiredCount > 0) {
            console.log(`🧹 Истекло ${expiredCount} боёв`);
        }
        
        return expiredCount;
    }

    async getBattleStatus(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user || !user.currentBattleId) {
                return { hasBattle: false };
            }
            
            const battle = await this.Battle.findById(user.currentBattleId);
            if (!battle) {
                await this.User.updateOne({ _id: userId }, { $set: { currentBattleId: null } });
                return { hasBattle: false };
            }
            
            if (['waiting', 'pending_confirmation'].includes(battle.status) && battle.expiresAt < new Date()) {
                battle.status = 'expired';
                await battle.save();
                await this.User.updateOne({ _id: userId }, { $set: { currentBattleId: null, arenaCooldownUntil: null } });
                return { hasBattle: false, expired: true };
            }
            
            const isPlayer1 = battle.player1Id.toString() === userId.toString();
            const isActive = battle.status === 'active';
            
            const response = {
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
                const opponentId = isPlayer1 ? battle.player2Id : battle.player1Id;
                if (opponentId) {
                    const opp = await this.User.findById(opponentId).select('username firstName level').lean();
                    response.opponent = { name: opp?.username || opp?.firstName || 'Соперник', level: opp?.level };
                }
            }
            
            return response;
        } catch (err) {
            console.error('getBattleStatus error:', err);
            return { hasBattle: false, error: err.message };
        }
    }

    async getLeaderboard(limit = 50) {
        const leaders = await this.ArenaStats.find()
            .sort({ rating: -1 })
            .limit(limit)
            .populate('userId', 'username firstName level telegramId')
            .lean();
        
        return leaders.map((s, i) => ({
            rank: i + 1,
            name: s.userId?.username || s.userId?.firstName || 'Unknown',
            level: s.userId?.level || 1,
            rating: s.rating,
            wins: s.wins,
            losses: s.losses,
            league: s.league || 'bronze'
        }));
    }

    async getUserStats(userId) {
        let stats = await this.ArenaStats.findOne({ userId: userId });
        if (!stats) {
            stats = await this.ArenaStats.create({ userId: userId });
        }
        return stats;
    }
}

module.exports = {
    LEAGUE_CONFIG,
    RARITY_MULTIPLIERS,
    getLeagueByRating,
    calculateCreatureStats,
    calculateEloChange,
    buildTeamFromIds,
    ArenaBattleManager,
    ArenaSocketManager
};