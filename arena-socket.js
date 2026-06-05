// ============================================================
// arena-socket.js - Серверная логика PvP арены с WebSocket
// ============================================================

// arena-socket.js - НОВАЯ КОНФИГУРАЦИЯ ЛИГ

const LEAGUE_CONFIG = {
    bronze: {
        minRating: 0,
        maxRating: 1299,
        entryFee: 200,
        prizePool: 350,
        color: '#cd7c3a',
        name: '🥉 Бронзовая'
    },
    silver: {
        minRating: 1300,
        maxRating: 1599,
        entryFee: 500,
        prizePool: 800,
        color: '#94a3b8',
        name: '🥈 Серебряная'
    },
    gold: {
        minRating: 1600,
        maxRating: 1899,
        entryFee: 1000,
        prizePool: 1600,
        color: '#f59e0b',
        name: '🥇 Золотая'
    },
    platinum: {
        minRating: 1900,
        maxRating: 2199,
        entryFee: 2000,
        prizePool: 3200,
        color: '#a855f7',
        name: '💎 Платиновая'
    },
    diamond: {
        minRating: 2200,
        maxRating: 9999,
        entryFee: 5000,
        prizePool: 8000,
        color: '#06b6d4',
        name: '🏆 Алмазная'
    }
};

// Вспомогательная функция для определения лиги по рейтингу
function getLeagueByRating(rating) {
    for (const [league, config] of Object.entries(LEAGUE_CONFIG)) {
        if (rating >= config.minRating && rating <= config.maxRating) {
            return league;
        }
    }
    return 'bronze'; // fallback
}

// Функция проверки, может ли игрок перейти в лигу выше
function canPromoteToLeague(currentRating, targetLeague) {
    const targetConfig = LEAGUE_CONFIG[targetLeague];
    return currentRating >= targetConfig.minRating;
}

// Функция проверки, должен ли игрок вылететь из лиги
function shouldDemote(currentRating, currentLeague) {
    const config = LEAGUE_CONFIG[currentLeague];
    const demoteThreshold = config.minRating - 150; // Защита от падения: нужно упасть на 150 ниже порога
    return currentRating < demoteThreshold;
}

// ОБНОВЛЁННЫЙ РАСЧЁТ ИЗМЕНЕНИЯ РЕЙТИНГА (Elo с учётом разницы в рейтинге)
function calculateEloChange(winnerRating, loserRating, k = 32) {
    const expectedScore = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    let change = Math.round(k * (1 - expectedScore));
    
    // Ограничиваем изменение
    change = Math.min(change, 40);
    change = Math.max(change, 10);
    
    // Бонус за андердога (если победил слабый против сильного)
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

function getLeagueByLevel(level) {
    for (const [league, config] of Object.entries(LEAGUE_CONFIG)) {
        if (level >= config.minLevel && level <= config.maxLevel) {
            return league;
        }
    }
    return 'bronze';
}

function calculateCreatureStats(creature, userLevel) {
    const multiplier = RARITY_MULTIPLIERS[creature.rarity] || 1;
    const baseHP = Math.ceil((50 + (creature.incomeBase * 2) + (userLevel * 5)) * multiplier);
    const baseATK = Math.ceil((10 + (creature.incomeBase / 2) + (userLevel * 2)) * multiplier);
    const baseDEF = Math.ceil((5 + (creature.incomeBase / 3) + (userLevel * 1)) * multiplier);
    const baseCRIT = 0.10;
    
    return { maxHp: baseHP, attack: baseATK, defense: baseDEF, critChance: baseCRIT };
}

function calculateEloChange(winnerRating, loserRating, k = 32) {
    const expectedScore = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const change = Math.round(k * (1 - expectedScore));
    return Math.min(change, 40);
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
                isAlive: true
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
        this.connectedUsers.set(userIdStr, socketId);
        console.log(`🔌 WebSocket подключён: ${userIdStr} (всего: ${this.connectedUsers.size})`);
    }

    remove(userId) {
        this.connectedUsers.delete(userId.toString());
        console.log(`🔌 WebSocket отключён: ${userId} (всего: ${this.connectedUsers.size})`);
    }

    send(userId, event, data) {
        const socketId = this.connectedUsers.get(userId.toString());
        if (!socketId) return false;
        
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) return false;
        
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
        this.activeBattles = new Map();
        this.searchQueue = [];
    }

    getLeagueByLevel(level) {
        return getLeagueByLevel(level);
    }

    // arena-socket.js - ДОБАВЛЯЕМ ПАРАМЕТР ЛИГИ

async createBattle(player1Id, teamIds, userLevel, league) {
    // league теперь передаётся из findMatch, а не вычисляется по уровню!
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

    // arena-socket.js - ПОИСК СОПЕРНИКА ТОЛЬКО В СВОЕЙ ЛИГЕ

async findMatch(user, teamIds) {
    const userLevel = user.level;
    const userStats = await this.ArenaStats.findOne({ userId: user._id });
    
    if (!userStats) {
        // Создаём статистику, если её нет
        const newStats = await this.ArenaStats.create({ userId: user._id });
        userStats = newStats;
    }
    
    const userLeague = userStats.league;
    const leagueConfig = LEAGUE_CONFIG[userLeague];
    
    // Проверяем баланс для оплаты входа
    if (user.balance < leagueConfig.entryFee) {
        return { success: false, message: `Недостаточно MMO. Нужно ${leagueConfig.entryFee} MMO для участия в ${leagueConfig.name} лиге` };
    }
    
    // Списание средств
    const updatedUser = await this.User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: leagueConfig.entryFee } },
        { $inc: { balance: -leagueConfig.entryFee } },
        { new: true }
    );
    
    if (!updatedUser) {
        return { success: false, message: 'Не удалось списать средства' };
    }
    
    // ИЩЕМ СОПЕРНИКА ТОЛЬКО В ТАКОЙ ЖЕ ЛИГЕ!
    const waitingBattle = await this.Battle.findOne({
        status: 'waiting',
        league: userLeague,  // <- КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: ищем в своей лиге
        player1Id: { $ne: user._id },
        expiresAt: { $gt: new Date() }
    }).sort({ createdAt: 1 });
    
    if (waitingBattle) {
        const player2Team = await buildTeamFromIds(teamIds, userLevel, user._id, this.getCreature);
        
        waitingBattle.player2Id = user._id;
        waitingBattle.player2Team = player2Team;
        waitingBattle.status = 'pending_confirmation';
        waitingBattle.expiresAt = new Date(Date.now() + 60 * 1000);
        
        waitingBattle.markModified('player2Team');
        await waitingBattle.save();
        
        await this.User.updateOne(
            { _id: user._id },
            { $set: { currentBattleId: waitingBattle._id } }
        );
        
        return { success: true, battle: waitingBattle, isNew: false, entryFee: leagueConfig.entryFee };
    } else {
        const newBattle = await this.createBattle(user._id, teamIds, userLevel, userLeague);
        
        await this.User.updateOne(
            { _id: user._id },
            { $set: { currentBattleId: newBattle._id } }
        );
        
        return { success: true, battle: newBattle, isNew: true, entryFee: leagueConfig.entryFee };
    }
}

    async acceptMatch(battleId, userId) {
        const battle = await this.Battle.findById(battleId);
        if (!battle) {
            return { success: false, message: 'Бой не найден' };
        }
        
        if (!['active', 'pending_confirmation'].includes(battle.status)) {
            return { success: false, message: 'Бой уже не активен' };
        }
        
        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        const isPlayer2 = battle.player2Id && battle.player2Id.toString() === userId.toString();
        
        if (!isPlayer1 && !isPlayer2) {
            return { success: false, message: 'Вы не участник этого боя' };
        }
        
        if (isPlayer1) {
            if (battle.player1Confirmed) {
                return { success: false, message: 'Вы уже подтвердили' };
            }
            battle.player1Confirmed = true;
        } else {
            if (battle.player2Confirmed) {
                return { success: false, message: 'Вы уже подтвердили' };
            }
            battle.player2Confirmed = true;
        }
        
        if (battle.player1Confirmed && battle.player2Confirmed) {
            battle.status = 'active';
            battle.currentTurn = Math.random() < 0.5 ? 'player1' : 'player2';
            battle.lastMoveAt = new Date();
            battle.expiresAt = null;
        }
        
        await battle.save();
        
        return { success: true, battle, bothConfirmed: battle.status === 'active' };
    }

    async rejectMatch(battleId, userId) {
        const battle = await this.Battle.findById(battleId);
        if (!battle) {
            return { success: false, message: 'Бой не найден' };
        }
        
        if (!['active', 'pending_confirmation'].includes(battle.status)) {
            return { success: false, message: 'Бой уже не активен' };
        }
        
        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        const isPlayer2 = battle.player2Id && battle.player2Id.toString() === userId.toString();
        
        if (!isPlayer1 && !isPlayer2) {
            return { success: false, message: 'Вы не участник этого боя' };
        }
        
        battle.status = 'finished';
        battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
        
        await this.finishBattle(battle);
        
        await this.User.updateMany(
            { _id: { $in: [battle.player1Id, battle.player2Id] } },
            { $set: { currentBattleId: null, arenaCooldownUntil: null } }
        );
        
        return { success: true, message: 'Бой отклонён' };
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
        
        const myTeam = isPlayer1 ? battle.player1Team : battle.player2Team;
        const enemyTeam = isPlayer1 ? battle.player2Team : battle.player1Team;
        
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
            await this.finishBattle(battle);
            return { success: true, finished: true, winnerId: battle.winnerId };
        }
        
        let targetIndex = -1;
        if (requestedTargetIndex !== undefined && requestedTargetIndex >= 0 && requestedTargetIndex < enemyTeam.length && enemyTeam[requestedTargetIndex]?.isAlive) {
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
            return { success: true, finished: true, winnerId: battle.winnerId };
        }
        
        const target = enemyTeam[targetIndex];
        const isCrit = Math.random() < attacker.critChance;
        let damage = Math.max(1, attacker.attack - target.defense);
        if (isCrit) damage = Math.floor(damage * 1.5);
        
        target.currentHp = Math.max(0, target.currentHp - damage);
        
        if (target.currentHp <= 0) {
            target.isAlive = false;
        }
        
        battle.battleLog.push({
            turn: battle.turnCount + 1,
            player: battle.currentTurn,
            attackerName: attacker.name,
            attackerIndex: attackerIndex,
            targetName: target.name,
            targetIndex: targetIndex,
            damage: damage,
            isCrit: isCrit,
            remainingHp: target.currentHp,
            timestamp: new Date()
        });
        
        const allEnemyDead = enemyTeam.every(p => !p.isAlive);
        
        if (allEnemyDead) {
            battle.status = 'finished';
            battle.winnerId = isPlayer1 ? battle.player1Id : battle.player2Id;
            battle.turnCount++;
            await this.finishBattle(battle);
            
            return {
                success: true,
                finished: true,
                winnerId: battle.winnerId,
                lastMove: { damage, isCrit, targetIndex, targetHp: target.currentHp, targetDead: true }
            };
        }
        
        battle.currentTurn = battle.currentTurn === 'player1' ? 'player2' : 'player1';
        battle.turnCount++;
        battle.lastMoveAt = new Date();
        
        if (isPlayer1) {
            battle.player1LastMoveAt = new Date();
        } else {
            battle.player2LastMoveAt = new Date();
        }
        
        if (isPlayer1) {
            battle.markModified('player1Team');
            battle.markModified('player2Team');
        } else {
            battle.markModified('player2Team');
            battle.markModified('player1Team');
        }
        
        await battle.save();
        
        // В processMove, при возврате результата:
return {
    success: true,
    finished: false,
    lastMove: { 
        damage, 
        isCrit, 
        targetIndex: targetIndex,  // Убедитесь, что это правильный индекс
        targetHp: target.currentHp, 
        targetDead: false 
    },
    currentTurn: battle.currentTurn,
    turnCount: battle.turnCount,
    myTeam: myTeam,
    enemyTeam: enemyTeam,
    battleLog: battle.battleLog.slice(-1)
};

    // arena-socket.js - НОВАЯ ВЕРСИЯ finishBattle

async finishBattle(battle) {
    const winnerId = battle.winnerId;
    const loserId = winnerId?.toString() === battle.player1Id.toString() ? battle.player2Id : battle.player1Id;
    
    if (winnerId && loserId) {
        // Начисляем призовые победителю
        await this.User.findByIdAndUpdate(winnerId, { $inc: { balance: battle.prizePool } });
        
        let winnerStats = await this.ArenaStats.findOne({ userId: winnerId });
        let loserStats = await this.ArenaStats.findOne({ userId: loserId });
        
        if (!winnerStats) winnerStats = await this.ArenaStats.create({ userId: winnerId });
        if (!loserStats) loserStats = await this.ArenaStats.create({ userId: loserId });
        
        // РАСЧЁТ ИЗМЕНЕНИЯ РЕЙТИНГА
        const ratingChange = calculateEloChange(winnerStats.rating, loserStats.rating);
        
        // Обновляем рейтинг победителя
        let newWinnerRating = winnerStats.rating + ratingChange;
        let oldWinnerLeague = winnerStats.league;
        let newWinnerLeague = getLeagueByRating(newWinnerRating);
        
        // Обновляем рейтинг проигравшего
        let newLoserRating = Math.max(0, loserStats.rating - ratingChange);
        let oldLoserLeague = loserStats.league;
        let newLoserLeague = getLeagueByRating(newLoserRating);
        
        // ПРОВЕРКА НА ПОВЫШЕНИЕ/ПОНИЖЕНИЕ
        let promotionMessage = null;
        let demotionMessage = null;
        
        // Проверка повышения для победителя
        if (newWinnerLeague !== oldWinnerLeague && newWinnerRating >= LEAGUE_CONFIG[newWinnerLeague].minRating) {
            promotionMessage = `🎉 ПОВЫШЕНИЕ! Вы перешли в ${LEAGUE_CONFIG[newWinnerLeague].name} лигу!`;
            winnerStats.promotions += 1;
            winnerStats.promotionProtection = true; // Включаем защиту от падения
            
            // Уведомляем админов о повышении
            const user = await this.User.findById(winnerId);
            await this.sendNotification(user.telegramId, promotionMessage);
        }
        
        // Проверка понижения для проигравшего (с защитой)
        if (newLoserLeague !== oldLoserLeague && !loserStats.promotionProtection) {
            // Проверяем, действительно ли он упал ниже порога с защитой
            const shouldDemote = newLoserRating < (LEAGUE_CONFIG[oldLoserLeague].minRating - 100);
            if (shouldDemote) {
                demotionMessage = `⚠️ ПОНИЖЕНИЕ! Вы вылетели в ${LEAGUE_CONFIG[newLoserLeague].name} лигу. Вернитесь, побеждая сильных!`;
                loserStats.demotions += 1;
                
                const user = await this.User.findById(loserId);
                await this.sendNotification(user.telegramId, demotionMessage);
            } else {
                // Если защита активна, оставляем в старой лиге
                newLoserLeague = oldLoserLeague;
                newLoserRating = LEAGUE_CONFIG[oldLoserLeague].minRating - 50;
            }
        }
        
        // Снимаем защиту после одного боя
        if (winnerStats.promotionProtection) {
            winnerStats.promotionProtection = false;
        }
        
        // Обновляем статистику победителя
        winnerStats.rating = newWinnerRating;
        winnerStats.league = newWinnerLeague;
        winnerStats.peakRating = Math.max(winnerStats.peakRating, newWinnerRating);
        winnerStats.wins += 1;
        winnerStats.streak += 1;
        winnerStats.bestStreak = Math.max(winnerStats.bestStreak, winnerStats.streak);
        winnerStats.totalBattles += 1;
        winnerStats.totalEarned += battle.prizePool;
        winnerStats.lastBattleAt = new Date();
        
        // Обновляем статистику проигравшего
        loserStats.rating = newLoserRating;
        loserStats.league = newLoserLeague;
        loserStats.losses += 1;
        loserStats.streak = 0;
        loserStats.totalBattles += 1;
        loserStats.lastBattleAt = new Date();
        
        await winnerStats.save();
        await loserStats.save();
        
        // Формируем детальное сообщение о результате
        const leagueChangeText = promotionMessage || demotionMessage || '';
        
        // Отправляем уведомления
        if (this.sendNotification) {
            const winner = await this.User.findById(winnerId);
            const loser = await this.User.findById(loserId);
            
            if (winner) {
                await this.sendNotification(winner.telegramId,
                    `🏆 <b>ПОБЕДА В АРЕНЕ!</b>\n\n` +
                    `Вы победили ${loser?.username || loser?.firstName || 'игрока'}!\n` +
                    `💰 Выигрыш: +${battle.prizePool.toLocaleString()} MMO\n` +
                    `📊 Рейтинг: ${winnerStats.rating} ${ratingChange > 0 ? `(+${ratingChange})` : `(${ratingChange})`}\n` +
                    `🔥 Серия побед: ${winnerStats.streak}\n` +
                    `${leagueChangeText ? `\n${leagueChangeText}` : ''}\n` +
                    `🏅 Лига: ${LEAGUE_CONFIG[winnerStats.league].name}`
                );
            }
            
            if (loser) {
                await this.sendNotification(loser.telegramId,
                    `💀 <b>ПОРАЖЕНИЕ В АРЕНЕ</b>\n\n` +
                    `Вы проиграли ${winner?.username || winner?.firstName || 'игроку'}.\n` +
                    `📊 Рейтинг: ${loserStats.rating} (${ratingChange > 0 ? `-${ratingChange}` : `-${Math.abs(ratingChange)}`})\n` +
                    `${demotionMessage ? `\n${demotionMessage}` : ''}\n` +
                    `💪 Следующий бой будет лучше!`
                );
            }
        }
    }
    
    // Очищаем текущий бой у игроков
    await this.User.updateMany(
        { _id: { $in: [battle.player1Id, battle.player2Id] } },
        { $set: { currentBattleId: null, arenaCooldownUntil: new Date(Date.now() + 30 * 1000) } }
    );
    
    await battle.save();
    return { winnerId, loserId };
}

    async surrenderBattle(battleId, userId) {
        const battle = await this.Battle.findById(battleId);
        if (!battle) {
            return { success: false, message: 'Бой не найден' };
        }
        
        if (battle.status !== 'active') {
            return { success: false, message: 'Бой не активен' };
        }
        
        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        
        battle.status = 'finished';
        battle.winnerId = isPlayer1 ? battle.player2Id : battle.player1Id;
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
            const entryFee = battle.entryFee;
            const player1Id = battle.player1Id;
            const player2Id = battle.player2Id;
            
            battle.status = 'expired';
            await battle.save();
            expiredCount++;
            
            if (battle.status === 'waiting' && player1Id) {
                await this.User.findByIdAndUpdate(player1Id, {
                    $inc: { balance: entryFee },
                    $set: { currentBattleId: null }
                });
            }
            
            if (player1Id) {
                await this.User.updateOne({ _id: player1Id }, { $set: { currentBattleId: null } });
            }
            if (player2Id) {
                await this.User.updateOne({ _id: player2Id }, { $set: { currentBattleId: null } });
            }
        }
        
        const timeoutSeconds = 30;
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
        
        // Проверка просрочки
        if (['waiting', 'pending_confirmation'].includes(battle.status) && battle.expiresAt < new Date()) {
            battle.status = 'expired';
            await battle.save();
            await this.User.updateOne({ _id: userId }, { $set: { currentBattleId: null } });
            return { hasBattle: false, expired: true };
        }
        
        const isPlayer1 = battle.player1Id.toString() === userId.toString();
        
        return {
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
            opponentTeam: isPlayer1 ? battle.player2Team : battle.player1Team,
            battleLog: battle.battleLog ? battle.battleLog.slice(-20) : []
        };
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
            losses: s.losses
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
    getLeagueByLevel,
    calculateCreatureStats,
    calculateEloChange,
    buildTeamFromIds,
    ArenaBattleManager,
    ArenaSocketManager
};