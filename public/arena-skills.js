// ============================================================
// arena-skills.js — Система навыков арены DNA MMO
// ============================================================

// ============================================================
// КАРТА СКИЛЛОВ: creatureId → скилл
// ============================================================
const SKILLS_MAP = {
    // ── DUCK ──────────────────────────────────────────────
    duck_c: {
        id: 'lucky_quack',
        name: '🍀 Lucky Quack',
        chance: 0.20,
        description: 'Враг промахивается — атака наносит 0 урона'
    },
    duck_u: {
        id: 'puddle_dodge',
        name: '💧 Puddle Dodge',
        chance: 0.25,
        description: 'Получает щит — следующая атака по нему отменяется'
    },
    duck_r: {
        id: 'ancient_wings',
        name: '🦅 Ancient Wings',
        chance: 0.20,
        description: 'Урон ×1.8'
    },
    duck_e: {
        id: 'eternal_splash',
        name: '🌊 Eternal Splash',
        chance: 0.25,
        description: 'Урон всем живым врагам'
    },
    duck_l: {
        id: 'divine_flood',
        name: '🌀 Divine Flood',
        chance: 0.30,
        description: 'Урон ×1.5 всем живым врагам'
    },

    // ── OWL ───────────────────────────────────────────────
    owl_c: {
        id: 'night_sight',
        name: '🌙 Night Sight',
        chance: 0.20,
        description: 'Игнорирует 30% защиты цели'
    },
    owl_u: {
        id: 'sharp_talons',
        name: '🦅 Sharp Talons',
        chance: 0.25,
        description: 'Урон ×1.5'
    },
    owl_r: {
        id: 'guardian_aura',
        name: '✨ Guardian Aura',
        chance: 0.20,
        description: 'Восстанавливает 20% maxHP союзнику с наименьшим HP'
    },
    owl_e: {
        id: 'mind_break',
        name: '🧠 Mind Break',
        chance: 0.25,
        description: 'Снижает атаку врага на 30% в этом ударе + базовый урон'
    },
    owl_l: {
        id: 'divine_sight',
        name: '👁️ Divine Sight',
        chance: 0.30,
        description: 'Урон ×2 + игнорирует всю защиту'
    },

    // ── SHARK ─────────────────────────────────────────────
    shark_c: {
        id: 'bite',
        name: '🦷 Bite',
        chance: 0.25,
        description: 'Урон +50%'
    },
    shark_u: {
        id: 'frenzy',
        name: '🩸 Frenzy',
        chance: 0.25,
        description: 'Восстанавливает 30% нанесённого урона как HP'
    },
    shark_r: {
        id: 'ocean_terror',
        name: '🌊 Ocean Terror',
        chance: 0.20,
        description: 'Враг оглушён — пропускает следующий ход'
    },
    shark_e: {
        id: 'apex_predator',
        name: '🦈 Apex Predator',
        chance: 0.30,
        description: 'Урон ×2 если у врага меньше 50% HP'
    },
    shark_l: {
        id: 'kraken_call',
        name: '🐙 Kraken Call',
        chance: 0.35,
        description: 'Урон всем живым врагам + восстанавливает 20% maxHP себе'
    },

    // ── WOLF ──────────────────────────────────────────────
    wolf_c: {
        id: 'pack_call',
        name: '🐺 Pack Call',
        chance: 0.20,
        description: 'Урон +40%'
    },
    wolf_u: {
        id: 'hunter_instinct',
        name: '🎯 Hunter Instinct',
        chance: 0.25,
        description: 'Игнорирует всю защиту цели'
    },
    wolf_r: {
        id: 'howl',
        name: '🌕 Howl',
        chance: 0.25,
        description: 'Урон ×1.5 + восстанавливает 10% maxHP себе'
    },
    wolf_e: {
        id: 'alpha_strike',
        name: '⚡ Alpha Strike',
        chance: 0.30,
        description: 'Урон ×2.5'
    },
    wolf_l: {
        id: 'legendary_fury',
        name: '🔥 Legendary Fury',
        chance: 0.35,
        description: 'Урон ×2 всем живым врагам'
    },

    // ── DRAGON ────────────────────────────────────────────
    dragon_c: {
        id: 'flame',
        name: '🔥 Flame',
        chance: 0.25,
        description: 'Урон +60%'
    },
    dragon_u: {
        id: 'fire_breath',
        name: '🐉 Fire Breath',
        chance: 0.25,
        description: 'Урон всем живым врагам'
    },
    dragon_r: {
        id: 'ancient_fire',
        name: '🌋 Ancient Fire',
        chance: 0.20,
        description: 'Урон ×2'
    },
    dragon_e: {
        id: 'eternal_flame',
        name: '♾️ Eternal Flame',
        chance: 0.30,
        description: 'Урон ×1.5 всем живым врагам + игнорирует защиту'
    },
    dragon_l: {
        id: 'divine_inferno',
        name: '☄️ Divine Inferno',
        chance: 0.35,
        description: 'Урон ×2 всем живым врагам'
    },

    // ── UNICORN ───────────────────────────────────────────
    unicorn_c: {
        id: 'magic_touch',
        name: '🦄 Magic Touch',
        chance: 0.20,
        description: 'Восстанавливает 15% maxHP себе'
    },
    unicorn_u: {
        id: 'fairy_dust',
        name: '✨ Fairy Dust',
        chance: 0.25,
        description: 'Враг оглушён — пропускает следующий ход'
    },
    unicorn_r: {
        id: 'rare_magic',
        name: '💫 Rare Magic',
        chance: 0.20,
        description: 'Восстанавливает 15% maxHP всем живым союзникам'
    },
    unicorn_e: {
        id: 'eternal_magic',
        name: '🌟 Eternal Magic',
        chance: 0.25,
        description: 'Урон ×2 + восстанавливает 20% maxHP себе'
    },
    unicorn_l: {
        id: 'divine_blessing',
        name: '🙏 Divine Blessing',
        chance: 0.30,
        description: 'Восстанавливает 30% maxHP всем живым союзникам'
    },

    // ── MYTHIC ────────────────────────────────────────────
    lion_mythic: {
        id: 'king_roar',
        name: '👑 King Roar',
        chance: 0.40,
        description: 'Урон ×2.5 + враг оглушён на следующий ход'
    },
    panther_mythic: {
        id: 'shadow_strike',
        name: '🐆 Shadow Strike',
        chance: 0.45,
        description: 'Игнорирует всю защиту + восстанавливает 40% урона как HP'
    }
};

// ============================================================
// ПОЛУЧИТЬ СКИЛЛ ПО creatureId
// ============================================================
function getSkillForCreature(creatureId) {
    return SKILLS_MAP[creatureId] || null;
}

// ============================================================
// ПРИМЕНИТЬ СКИЛЛ
// Принимает:
//   skillId     — id скилла
//   attacker    — объект атакующего питомца
//   target      — объект цели
//   myTeam      — массив питомцев атакующего
//   enemyTeam   — массив питомцев противника
//   baseDamage  — базовый урон уже рассчитанный (до скилла)
//
// Возвращает объект результата (см. ниже)
// ============================================================
function applySkill(skillId, attacker, target, myTeam, enemyTeam, baseDamage) {
    const result = {
        triggered: false,
        skillId: skillId,
        skillName: '',
        damage: baseDamage,           // итоговый урон по основной цели
        splashDamage: 0,              // урон по остальным врагам (если есть)
        splashTargets: [],            // индексы врагов получивших splash
        healAmount: 0,                // сколько HP восстановили атакующему
        allyHealAmount: 0,            // сколько HP восстановили союзникам
        allyHealTarget: null,         // 'all' | 'lowest'
        stunTarget: false,            // цель оглушена
        shieldSelf: false,            // атакующий получает щит
        missTarget: false,            // цель промахивается (0 урона входящего)
        ignoredDefense: false,        // для лога
        description: ''
    };

    const skill = Object.values(SKILLS_MAP).find(s => s.id === skillId);
    if (!skill) return result;

    // Бросаем кубик
    if (Math.random() > skill.chance) return result;

    result.triggered = true;
    result.skillName = skill.name;
    result.description = skill.description;

    switch (skillId) {

        // ── DUCK ────────────────────────────────────────
        case 'lucky_quack':
            // Враг промахивается — атака наносит 0 урона
            result.missTarget = true;
            result.damage = 0;
            break;

        case 'puddle_dodge':
            // Атакующий получает щит на следующую входящую атаку
            result.shieldSelf = true;
            break;

        case 'ancient_wings':
            result.damage = Math.floor(baseDamage * 1.8);
            break;

        case 'eternal_splash':
            // Урон всем живым врагам (без множителя)
            result.damage = baseDamage;
            result.splashDamage = baseDamage;
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            break;

        case 'divine_flood':
            // Урон ×1.5 всем живым врагам
            result.damage = Math.floor(baseDamage * 1.5);
            result.splashDamage = Math.floor(baseDamage * 1.5);
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            break;

        // ── OWL ─────────────────────────────────────────
        case 'night_sight':
            // Игнорирует 30% защиты — пересчитываем урон
            result.damage = _damageIgnoringDefensePercent(attacker, target, 0.30);
            result.ignoredDefense = true;
            break;

        case 'sharp_talons':
            result.damage = Math.floor(baseDamage * 1.5);
            break;

        case 'guardian_aura':
            // Восстанавливает 20% maxHP союзнику с наименьшим HP
            result.allyHealAmount = Math.floor(_getLowestAllyMaxHp(myTeam, attacker) * 0.20);
            result.allyHealTarget = 'lowest';
            break;

        case 'mind_break':
            // Снижает эффективную защиту цели на 30% для этого удара
            result.damage = Math.max(1, Math.floor(attacker.attack - target.defense * 0.7));
            break;

        case 'divine_sight':
            // Урон ×2 + игнорирует всю защиту
            result.damage = Math.floor(attacker.attack * 2);
            result.ignoredDefense = true;
            break;

        // ── SHARK ───────────────────────────────────────
        case 'bite':
            result.damage = Math.floor(baseDamage * 1.5);
            break;

        case 'frenzy':
            // Восстанавливает 30% нанесённого урона как HP
            result.healAmount = Math.floor(baseDamage * 0.30);
            break;

        case 'ocean_terror':
            // Оглушает врага
            result.stunTarget = true;
            break;

        case 'apex_predator':
            // Урон ×2 если у врага < 50% HP
            if (target.currentHp < target.maxHp * 0.5) {
                result.damage = Math.floor(baseDamage * 2);
            }
            break;

        case 'kraken_call':
            // Урон всем врагам + восстановить 20% maxHP себе
            result.splashDamage = baseDamage;
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            result.healAmount = Math.floor(attacker.maxHp * 0.20);
            break;

        // ── WOLF ────────────────────────────────────────
        case 'pack_call':
            result.damage = Math.floor(baseDamage * 1.4);
            break;

        case 'hunter_instinct':
            // Игнорирует всю защиту
            result.damage = attacker.attack;
            result.ignoredDefense = true;
            break;

        case 'howl':
            // Урон ×1.5 + восстановить 10% maxHP себе
            result.damage = Math.floor(baseDamage * 1.5);
            result.healAmount = Math.floor(attacker.maxHp * 0.10);
            break;

        case 'alpha_strike':
            result.damage = Math.floor(baseDamage * 2.5);
            break;

        case 'legendary_fury':
            // Урон ×2 всем живым врагам
            result.damage = Math.floor(baseDamage * 2);
            result.splashDamage = Math.floor(baseDamage * 2);
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            break;

        // ── DRAGON ──────────────────────────────────────
        case 'flame':
            result.damage = Math.floor(baseDamage * 1.6);
            break;

        case 'fire_breath':
            // Урон всем живым врагам
            result.splashDamage = baseDamage;
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            break;

        case 'ancient_fire':
            result.damage = Math.floor(baseDamage * 2);
            break;

        case 'eternal_flame':
            // Урон ×1.5 всем + игнорирует защиту
            result.damage = Math.floor(attacker.attack * 1.5);
            result.splashDamage = Math.floor(attacker.attack * 1.5);
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            result.ignoredDefense = true;
            break;

        case 'divine_inferno':
            // Урон ×2 всем живым врагам
            result.damage = Math.floor(baseDamage * 2);
            result.splashDamage = Math.floor(baseDamage * 2);
            result.splashTargets = _getOtherAliveIndices(enemyTeam, enemyTeam.indexOf(target));
            break;

        // ── UNICORN ─────────────────────────────────────
        case 'magic_touch':
            result.healAmount = Math.floor(attacker.maxHp * 0.15);
            break;

        case 'fairy_dust':
            result.stunTarget = true;
            break;

        case 'rare_magic':
            // Восстанавливает 15% maxHP всем живым союзникам
            result.allyHealAmount = Math.floor(attacker.maxHp * 0.15);
            result.allyHealTarget = 'all';
            break;

        case 'eternal_magic':
            result.damage = Math.floor(baseDamage * 2);
            result.healAmount = Math.floor(attacker.maxHp * 0.20);
            break;

        case 'divine_blessing':
            // Восстанавливает 30% maxHP всем живым союзникам
            result.allyHealAmount = Math.floor(attacker.maxHp * 0.30);
            result.allyHealTarget = 'all';
            break;

        // ── MYTHIC ──────────────────────────────────────
        case 'king_roar':
            result.damage = Math.floor(baseDamage * 2.5);
            result.stunTarget = true;
            break;

        case 'shadow_strike':
            // Игнорирует всю защиту + восстанавливает 40% урона как HP
            result.damage = attacker.attack;
            result.ignoredDefense = true;
            result.healAmount = Math.floor(result.damage * 0.40);
            break;

        default:
            result.triggered = false;
            break;
    }

    return result;
}

// ============================================================
// ПРИМЕНИТЬ РЕЗУЛЬТАТ СКИЛЛА К СОСТОЯНИЮ БОЯ
// Вызывается из processMove в arena-socket.js
// Мутирует myTeam и enemyTeam напрямую
// Возвращает сводку изменений для лога
// ============================================================
function applySkillResult(skillResult, attackerIndex, targetIndex, myTeam, enemyTeam) {
    const summary = {
        healedSelf: 0,
        healedAllies: [],   // [{ index, amount }]
        stunned: false,
        shielded: false,
        splashHits: [],     // [{ index, damage }]
        missed: false
    };

    if (!skillResult.triggered) return summary;

    const attacker = myTeam[attackerIndex];
    const target = enemyTeam[targetIndex];

    // Оглушение цели
    if (skillResult.stunTarget && target) {
        target.stunned = true;
        summary.stunned = true;
    }

    // Щит на атакующего
    if (skillResult.shieldSelf && attacker) {
        attacker.shielded = true;
        summary.shielded = true;
    }

    // Промах цели (lucky_quack)
    if (skillResult.missTarget) {
        summary.missed = true;
        // урон уже 0 в skillResult.damage — processMove применит его
    }

    // Восстановление HP атакующему
    if (skillResult.healAmount > 0 && attacker) {
        const healed = Math.min(skillResult.healAmount, attacker.maxHp - attacker.currentHp);
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healed);
        summary.healedSelf = healed;
    }

    // Восстановление HP союзникам
    if (skillResult.allyHealAmount > 0 && skillResult.allyHealTarget) {
        if (skillResult.allyHealTarget === 'all') {
            myTeam.forEach((ally, idx) => {
                if (ally.isAlive) {
                    const healed = Math.min(skillResult.allyHealAmount, ally.maxHp - ally.currentHp);
                    ally.currentHp = Math.min(ally.maxHp, ally.currentHp + healed);
                    if (healed > 0) summary.healedAllies.push({ index: idx, amount: healed });
                }
            });
        } else if (skillResult.allyHealTarget === 'lowest') {
            const lowestIdx = _getLowestAllyIndex(myTeam);
            if (lowestIdx !== -1) {
                const ally = myTeam[lowestIdx];
                const healed = Math.min(skillResult.allyHealAmount, ally.maxHp - ally.currentHp);
                ally.currentHp = Math.min(ally.maxHp, ally.currentHp + healed);
                if (healed > 0) summary.healedAllies.push({ index: lowestIdx, amount: healed });
            }
        }
    }

    // Сплеш-урон по остальным врагам
    if (skillResult.splashTargets.length > 0 && skillResult.splashDamage > 0) {
        skillResult.splashTargets.forEach(idx => {
            const enemy = enemyTeam[idx];
            if (enemy && enemy.isAlive) {
                const dmg = Math.min(skillResult.splashDamage, enemy.currentHp);
                enemy.currentHp = Math.max(0, enemy.currentHp - dmg);
                if (enemy.currentHp <= 0) enemy.isAlive = false;
                summary.splashHits.push({ index: idx, damage: dmg });
            }
        });
    }

    return summary;
}

// ============================================================
// ПРОВЕРИТЬ ОГЛУШЕНИЕ — вызывается в начале хода игрока
// Если питомец оглушён — пропускает ход, снимает флаг
// ============================================================
function checkAndClearStun(creature) {
    if (creature && creature.stunned) {
        creature.stunned = false;
        return true; // был оглушён
    }
    return false;
}

// ============================================================
// ПРОВЕРИТЬ ЩИТ — вызывается при получении урона
// Если питомец под щитом — отменяет входящий урон, снимает флаг
// ============================================================
function checkAndClearShield(creature) {
    if (creature && creature.shielded) {
        creature.shielded = false;
        return true; // щит сработал
    }
    return false;
}

// ============================================================
// ВНУТРЕННИЕ ХЕЛПЕРЫ
// ============================================================

// Индексы живых врагов кроме основной цели
function _getOtherAliveIndices(enemyTeam, excludeIndex) {
    return enemyTeam
        .map((e, i) => i)
        .filter(i => i !== excludeIndex && enemyTeam[i].isAlive);
}

// Пересчёт урона с игнорированием процента защиты
function _damageIgnoringDefensePercent(attacker, target, ignorePercent) {
    const effectiveDefense = Math.floor(target.defense * (1 - ignorePercent));
    return Math.max(1, attacker.attack - effectiveDefense);
}

// Индекс союзника с наименьшим текущим HP
function _getLowestAllyIndex(myTeam) {
    let lowestIdx = -1;
    let lowestHp = Infinity;
    myTeam.forEach((ally, idx) => {
        if (ally.isAlive && ally.currentHp < lowestHp) {
            lowestHp = ally.currentHp;
            lowestIdx = idx;
        }
    });
    return lowestIdx;
}

// maxHP союзника с наименьшим HP (для расчёта хила)
function _getLowestAllyMaxHp(myTeam, excludeAttacker) {
    const idx = _getLowestAllyIndex(myTeam);
    if (idx === -1) return excludeAttacker.maxHp;
    return myTeam[idx].maxHp;
}

// ============================================================
// ЭКСПОРТ
// ============================================================
module.exports = {
    SKILLS_MAP,
    getSkillForCreature,
    applySkill,
    applySkillResult,
    checkAndClearStun,
    checkAndClearShield
};
