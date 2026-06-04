// ============================================
// ARENA PVP SERVER (Socket.IO)
// ============================================

const jwt = require('jsonwebtoken');
const User = require('./models/User'); // You'll need to export User model

// In-memory storage for matchmaking
let waitingPlayers = [];
let activeBattles = new Map();
let battleTimers = new Map();

// League configuration
const LEAGUES = {
    'BRONZE': { min: 0, max: 999, color: '#cd7c3a', reward: 100 },
    'SILVER': { min: 1000, max: 1999, color: '#94a3b8', reward: 150 },
    'GOLD': { min: 2000, max: 2999, color: '#f59e0b', reward: 250 },
    'PLATINUM': { min: 3000, max: 3999, color: '#06b6d4', reward: 400 },
    'DIAMOND': { min: 4000, max: 9999, color: '#a855f7', reward: 600 }
};

function getLeagueFromRating(rating) {
    for (const [league, data] of Object.entries(LEAGUES)) {
        if (rating >= data.min && rating <= data.max) return league;
    }
    return 'BRONZE';
}

function getRewardForLeague(league) {
    return LEAGUES[league]?.reward || 100;
}

// Calculate rating change
function calculateRatingChange(winnerRating, loserRating) {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const k = 32;
    return Math.floor(k * (1 - expected));
}

// Monster battle stats
function createBattleMonster(creature, multiplier = 1) {
    return {
        id: creature.id,
        name: creature.name,
        icon: creature.icon,
        rarity: creature.rarity,
        atk: Math.floor(creature.incomeBase * 2 * multiplier),
        def: Math.floor(creature.incomeBase * 1.5 * multiplier),
        hp: Math.floor(creature.incomeBase * 10 * multiplier),
        maxHp: Math.floor(creature.incomeBase * 10 * multiplier)
    };
}

// Calculate total health
function getTotalHealth(monsters) {
    return monsters.reduce((sum, m) => sum + (m.hp || 0), 0);
}

function getMaxHealth(monsters) {
    return monsters.reduce((sum, m) => sum + (m.maxHp || 0), 0);
}

// Process battle move
function processMove(battle, attackerId, targetIndex) {
    const isPlayerAttacking = attackerId === battle.player.id;
    const attacker = isPlayerAttacking ? battle.player : battle.opponent;
    const defender = isPlayerAttacking ? battle.opponent : battle.player;
    
    const attackerMonster = attacker.monsters.find(m => m.hp > 0);
    if (!attackerMonster) return { success: false, message: 'No alive monsters' };
    
    const targetMonster = defender.monsters[targetIndex];
    if (!targetMonster || targetMonster.hp <= 0) {
        return { success: false, message: 'Target already defeated' };
    }
    
    // Calculate damage with type advantage
    const { damage, multiplier, isCritical } = calculateDamageWithType(attackerMonster, targetMonster);
    
    targetMonster.hp = Math.max(0, targetMonster.hp - damage);
    
    const logMessage = `${isPlayerAttacking ? 'YOU' : battle.opponent.name} attacked ${targetMonster.name} for ${damage} damage${isCritical ? ' (CRITICAL!)' : ''}${multiplier !== 1 ? ` (${multiplier > 1 ? 'SUPER EFFECTIVE!' : 'NOT VERY EFFECTIVE...'})` : ''}`;
    
    // Check for monster defeat
    if (targetMonster.hp <= 0) {
        logMessage + ` 💀 ${targetMonster.name} defeated!`;
    }
    
    // Update total health
    const playerTotalHealth = getTotalHealth(battle.player.monsters);
    const opponentTotalHealth = getTotalHealth(battle.opponent.monsters);
    
    battle.player.totalHealth = playerTotalHealth;
    battle.opponent.totalHealth = opponentTotalHealth;
    
    // Check for battle end
    const playerDefeated = playerTotalHealth <= 0;
    const opponentDefeated = opponentTotalHealth <= 0;
    
    let winner = null;
    if (playerDefeated && opponentDefeated) winner = 'draw';
    else if (playerDefeated) winner = 'opponent';
    else if (opponentDefeated) winner = 'player';
    
    if (winner) {
        return { success: true, logMessage, winner, battleEnded: true };
    }
    
    // Switch turn
    battle.currentTurn = isPlayerAttacking ? 'opponent' : 'player';
    battle.turnStartTime = Date.now();
    
    return { success: true, logMessage, battleEnded: false, nextTurn: battle.currentTurn };
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
    
    function getCreatureType(creature) {
        const name = creature.name.toLowerCase();
        if (name.includes('dragon') || name.includes('fire')) return 'fire';
        if (name.includes('shark') || name.includes('water')) return 'water';
        if (name.includes('duck') || name.includes('owl')) return 'grass';
        if (name.includes('electric')) return 'electric';
        if (name.includes('dark')) return 'dark';
        return 'light';
    }
    
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

// Socket.IO setup
function setupArenaServer(io) {
    io.on('connection', (socket) => {
        let user = null;
        
        // Authenticate
        const token = socket.handshake.query.token;
        if (!token) {
            socket.disconnect();
            return;
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            user = decoded;
        } catch (e) {
            socket.disconnect();
            return;
        }
        
        console.log(`🏟️ Arena connected: ${user.userId}`);
        
        // Find match
        socket.on('find-match', async (data) => {
            if (!data.team || data.team.length !== 3) {
                socket.emit('error', { message: 'Need 3 monsters' });
                return;
            }
            
            const dbUser = await User.findById(user.userId);
            if (!dbUser) return;
            
            // Check arena tokens
            const pvpStats = dbUser.pvpStats || { tokens: 3, lastReset: new Date() };
            if (pvpStats.tokens <= 0) {
                socket.emit('error', { message: 'No arena tokens left' });
                return;
            }
            
            // Store player in waiting queue
            waitingPlayers.push({
                socketId: socket.id,
                userId: user.userId,
                name: dbUser.username || dbUser.firstName || 'Player',
                rating: pvpStats.rating || 500,
                league: pvpStats.league || 'BRONZE',
                team: data.team,
                joinedAt: Date.now()
            });
            
            socket.emit('searching', { status: true });
            
            // Try to find match
            setTimeout(() => tryFindMatch(io), 100);
        });
        
        // Cancel search
        socket.on('cancel-search', () => {
            const index = waitingPlayers.findIndex(p => p.socketId === socket.id);
            if (index !== -1) waitingPlayers.splice(index, 1);
            socket.emit('search-cancelled');
        });
        
        // Accept battle
        socket.on('accept-battle', async (data) => {
            const battle = activeBattles.get(data.matchId);
            if (!battle) return;
            
            if (battle.player.socketId === socket.id) {
                battle.player.accepted = true;
            } else if (battle.opponent.socketId === socket.id) {
                battle.opponent.accepted = true;
            }
            
            if (battle.player.accepted && battle.opponent.accepted) {
                // Start battle
                battle.status = 'active';
                battle.currentTurn = Math.random() < 0.5 ? 'player' : 'opponent';
                battle.turnStartTime = Date.now();
                
                // Create battle monsters with stats
                battle.player.monsters = battle.player.team.map(m => createBattleMonster(m));
                battle.opponent.monsters = battle.opponent.team.map(m => createBattleMonster(m));
                
                battle.player.totalHealth = getTotalHealth(battle.player.monsters);
                battle.player.maxHealth = getMaxHealth(battle.player.monsters);
                battle.opponent.totalHealth = getTotalHealth(battle.opponent.monsters);
                battle.opponent.maxHealth = getMaxHealth(battle.opponent.monsters);
                
                io.to(battle.player.socketId).emit('battle-start', formatBattleStart(battle, 'player'));
                io.to(battle.opponent.socketId).emit('battle-start', formatBattleStart(battle, 'opponent'));
                
                // Start turn timer
                startTurnTimer(io, battle);
            }
        });
        
        // Decline battle
        socket.on('decline-battle', (data) => {
            const battle = activeBattles.get(data.matchId);
            if (battle) {
                const decliner = battle.player.socketId === socket.id ? 'player' : 'opponent';
                const other = decliner === 'player' ? battle.opponent : battle.player;
                
                io.to(other.socketId).emit('match-cancelled', { reason: 'Opponent declined' });
                activeBattles.delete(data.matchId);
            }
        });
        
        // Make move
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
            
            // Clear turn timer
            if (battleTimers.has(data.battleId)) {
                clearTimeout(battleTimers.get(data.battleId));
                battleTimers.delete(data.battleId);
            }
            
            const result = processMove(battle, 
                battle.player.socketId === socket.id ? battle.player.id : battle.opponent.id,
                data.targetIndex
            );
            
            if (!result.success) {
                socket.emit('error', { message: result.message });
                return;
            }
            
            // Broadcast move to both players
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
                await endBattle(io, battle, result.winner);
            } else {
                // Start next turn timer
                startTurnTimer(io, battle);
            }
        });
        
        // Disconnect
        socket.on('disconnect', () => {
            // Remove from waiting queue
            const waitIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
            if (waitIndex !== -1) waitingPlayers.splice(waitIndex, 1);
            
            // Cancel active battles
            for (const [battleId, battle] of activeBattles) {
                if (battle.player.socketId === socket.id || battle.opponent.socketId === socket.id) {
                    const winner = battle.player.socketId === socket.id ? 'opponent' : 'player';
                    endBattle(io, battle, winner);
                }
            }
        });
    });
}

function tryFindMatch(io) {
    if (waitingPlayers.length < 2) return;
    
    // Sort by rating (close ratings match)
    waitingPlayers.sort((a, b) => a.rating - b.rating);
    
    for (let i = 0; i < waitingPlayers.length - 1; i++) {
        const player1 = waitingPlayers[i];
        const player2 = waitingPlayers[i + 1];
        
        // Rating difference limit (200 points)
        if (Math.abs(player1.rating - player2.rating) <= 200) {
            // Remove from queue
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
                    accepted: false
                },
                opponent: {
                    id: player2.userId,
                    socketId: player2.socketId,
                    name: player2.name,
                    rating: player2.rating,
                    league: player2.league,
                    team: player2.team,
                    accepted: false
                },
                createdAt: Date.now()
            };
            
            activeBattles.set(battleId, battle);
            
            // Notify both players
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
            
            // Auto-cancel after 30 seconds
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

function startTurnTimer(io, battle) {
    if (battleTimers.has(battle.battleId)) {
        clearTimeout(battleTimers.get(battle.battleId));
    }
    
    const timer = setTimeout(async () => {
        // Time's up - auto pass turn
        const currentPlayer = battle.currentTurn === 'player' ? battle.player : battle.opponent;
        const nextPlayer = battle.currentTurn === 'player' ? battle.opponent : battle.player;
        
        const moveData = {
            logMessage: `${currentPlayer.name} ran out of time! Turn passed.`,
            nextTurn: battle.currentTurn === 'player' ? 'opponent' : 'player'
        };
        
        battle.currentTurn = nextPlayer;
        battle.turnStartTime = Date.now();
        
        io.to(battle.player.socketId).emit('opponent-move', moveData);
        io.to(battle.opponent.socketId).emit('opponent-move', moveData);
        
        startTurnTimer(io, battle);
    }, 30000);
    
    battleTimers.set(battle.battleId, timer);
    
    // Update timer display
    const updateInterval = setInterval(() => {
        if (!activeBattles.has(battle.battleId)) {
            clearInterval(updateInterval);
            return;
        }
        const timeLeft = Math.max(0, 30 - Math.floor((Date.now() - battle.turnStartTime) / 1000));
        io.to(battle.player.socketId).emit('turn-update', { timeLeft });
        io.to(battle.opponent.socketId).emit('turn-update', { timeLeft });
        
        if (timeLeft <= 0) clearInterval(updateInterval);
    }, 1000);
}

async function endBattle(io, battle, winner) {
    // Clear timer
    if (battleTimers.has(battle.battleId)) {
        clearTimeout(battleTimers.get(battle.battleId));
        battleTimers.delete(battle.battleId);
    }
    
    const player = await User.findById(battle.player.id);
    const opponent = await User.findById(battle.opponent.id);
    
    if (!player || !opponent) return;
    
    // Get current PvP stats
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
        
        // Decrease tokens
        playerStats.tokens = Math.max(0, playerStats.tokens - 1);
        opponentStats.tokens = Math.max(0, opponentStats.tokens - 1);
        
        // Add MMO reward
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
    
    // Update ratings
    playerStats.rating = Math.max(0, playerStats.rating + playerRatingChange);
    opponentStats.rating = Math.max(0, opponentStats.rating + opponentRatingChange);
    
    // Update leagues
    playerStats.league = getLeagueFromRating(playerStats.rating);
    opponentStats.league = getLeagueFromRating(opponentStats.rating);
    
    // Save to database
    player.pvpStats = playerStats;
    opponent.pvpStats = opponentStats;
    
    await player.save();
    await opponent.save();
    
    // Add to battle history
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
    
    // Keep only last 50 battles
    if (player.battleHistory.length > 50) player.battleHistory = player.battleHistory.slice(0, 50);
    if (opponent.battleHistory.length > 50) opponent.battleHistory = opponent.battleHistory.slice(0, 50);
    
    await player.save();
    await opponent.save();
    
    // Notify players
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
    
    // Remove battle from active
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

module.exports = { setupArenaServer };