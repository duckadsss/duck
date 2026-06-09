// ============================================================
// guild-ui.js — Клиентская часть гильдий
// ============================================================

let guildState = { myGuild: null, guildList: [], levelRewards: null };

// ── Загрузка ─────────────────────────────────────────────────
async function loadGuildTab() {
    const data = await apiRequest('GET', '/api/guild/my');
    if (data?.success) guildState.myGuild = data.guild;
    renderGuildTab();
}

async function loadGuildList(search = '') {
    const data = await apiRequest('GET', `/api/guild/list${search ? '?search=' + encodeURIComponent(search) : ''}`);
    if (data?.success) guildState.guildList = data.guilds;
    renderGuildList();
}

async function loadLevelRewards() {
    if (guildState.levelRewards) return guildState.levelRewards;
    const data = await apiRequest('GET', '/api/guild/levels');
    if (data?.success) guildState.levelRewards = data.levels;
    return guildState.levelRewards;
}

// ── Главный рендер ────────────────────────────────────────────
function renderGuildTab() {
    const container = document.getElementById('tab-guild');
    if (!container) return;
    if (guildState.myGuild) renderMyGuild(container);
    else renderGuildLobby(container);
}

// ── Лобби ────────────────────────────────────────────────────
function renderGuildLobby(container) {
    container.innerHTML = `
        <div class="guild-lobby">
            <div class="guild-lobby-icon">⚔️</div>
            <div class="guild-lobby-title">Гильдии</div>
            <div class="guild-lobby-sub">Вступи в гильдию и получи бонусы к бою</div>
            <div class="guild-lobby-bonuses">
                <div class="guild-bonus-item"><span>⚔️ Атака</span><span class="guild-bonus-val">до +20%</span></div>
                <div class="guild-bonus-item"><span>🛡️ Защита</span><span class="guild-bonus-val">до +20%</span></div>
                <div class="guild-bonus-item"><span>❤️ HP</span><span class="guild-bonus-val">до +20%</span></div>
            </div>
            <button class="guild-btn-primary" onclick="showCreateGuild()">
                <i class="fa-solid fa-plus"></i> Создать гильдию <span class="guild-cost">100 000 MMO</span>
            </button>
            <button class="guild-btn-secondary" style="width:100%" onclick="showGuildList()">
                <i class="fa-solid fa-list"></i> Найти гильдию
            </button>
            <button class="guild-btn-secondary" style="width:100%;margin-top:4px" onclick="showLevelRewards()">
                <i class="fa-solid fa-table-list"></i> Уровни гильдий
            </button>
        </div>
    `;
}

// ── Моя гильдия ───────────────────────────────────────────────
function renderMyGuild(container) {
    const g = guildState.myGuild;
    const isLeader = g.myRole === 'leader';
    const isOfficer = ['leader','officer'].includes(g.myRole);
    const now = Date.now();
    const canContribute = !g.joinCooldownHours && (!g.myLastContribution || (now - new Date(g.myLastContribution).getTime()) >= 86400000);
    const nextContrib = g.myLastContribution
        ? Math.ceil((86400000 - (now - new Date(g.myLastContribution).getTime())) / 3600000)
        : 0;
    const gxpPct = Math.min(100, Math.round((g.gxp / g.gxpToNext) * 100));

    container.innerHTML = `
        <div class="guild-card">
            <div class="guild-card-header">
                <div>
                    <div class="guild-name">[${g.tag}] ${g.name}</div>
                    <div class="guild-meta">Уровень ${g.level} · ${g.memberCount}/${g.maxMembers} участников</div>
                </div>
                <div class="guild-level-badge" onclick="showLevelRewards()" style="cursor:pointer" title="Посмотреть уровни">Lv${g.level} ℹ️</div>
            </div>

            ${g.description ? `<div class="guild-desc">${g.description}</div>` : ''}

            <div class="guild-bonus-row">
                <i class="fa-solid fa-bolt"></i>
                Бонус к существам: <span class="guild-bonus-highlight">+${g.bonusPercent}%</span> атака / защита / HP
            </div>

            <div class="guild-progress-wrap">
                <div class="guild-progress-label">
                    <span>GXP: ${formatNum(g.gxp)} / ${formatNum(g.gxpToNext)}</span>
                    <span>${g.level < 10 ? `до Lv${g.level+1}` : 'МАКС'}</span>
                </div>
                <div class="guild-progress-bar"><div class="guild-progress-fill" style="width:${gxpPct}%"></div></div>
            </div>

            ${g.joinCooldownHours > 0
                ? `<div class="guild-contrib-cooldown">🕐 Вклад доступен через ${g.joinCooldownHours}ч. после вступления</div>`
                : canContribute
                    ? `<button class="guild-contribute-btn" onclick="guildContribute()">
                        <i class="fa-solid fa-coins"></i> Внести взнос <span class="guild-cost">300 MMO → +100 GXP</span>
                       </button>`
                    : `<div class="guild-contrib-cooldown">⏳ Следующий взнос через ${nextContrib}ч.</div>`
            }

            ${isLeader && g.treasury !== undefined ? `
            <div class="guild-treasury">
                <div class="guild-treasury-label"><i class="fa-solid fa-vault"></i> Казна гильдии</div>
                <div class="guild-treasury-amount">${formatNum(g.treasury)} MMO</div>
                <button class="guild-btn-secondary" style="margin-top:8px;width:100%" onclick="showTreasuryModal()">
                    <i class="fa-solid fa-hand-holding-dollar"></i> Распределить
                </button>
            </div>` : ''}
        </div>

        <div class="guild-section-title">Участники (${g.memberCount})</div>
        <div class="guild-members-list">
            ${g.members.sort((a,b)=>({leader:0,officer:1,member:2}[a.role]-{leader:0,officer:1,member:2}[b.role]))
              .map(m => `
                <div class="guild-member-item ${m.isMe?'me':''}">
                    <div class="guild-member-avatar">${(m.username||'?')[0].toUpperCase()}</div>
                    <div class="guild-member-info">
                        <div class="guild-member-name">${m.username||'Игрок'} ${m.isMe?'<span class="guild-me-badge">Вы</span>':''}</div>
                        <div class="guild-member-role">${roleLabel(m.role)} · взносов: ${formatNum(m.totalContributed)}</div>
                    </div>
                    ${isOfficer && !m.isMe && m.role !== 'leader'
                        ? `<button class="guild-kick-btn" onclick="guildKick('${m.userId}','${m.username||'игрока'}')">✕</button>`
                        : ''}
                </div>`).join('')}
        </div>

        <div class="guild-actions-row">
            ${isLeader
                ? `<button class="guild-btn-secondary" onclick="showGuildEdit()"><i class="fa-solid fa-pen"></i> Настройки</button>
                   <button class="guild-btn-danger" onclick="confirmDisband()"><i class="fa-solid fa-trash"></i> Распустить</button>`
                : `<button class="guild-btn-danger" onclick="confirmLeaveGuild()"><i class="fa-solid fa-door-open"></i> Выйти из гильдии</button>`}
        </div>
    `;
}

// ── Таблица уровней ───────────────────────────────────────────
async function showLevelRewards() {
    const rewards = await loadLevelRewards();
    if (!rewards) { showToast('Ошибка загрузки', '❌'); return; }
    const currentLevel = guildState.myGuild?.level || 0;

    const modal = document.createElement('div');
    modal.className = 'guild-modal-overlay';
    modal.innerHTML = `
        <div class="guild-modal-box guild-levels-box">
            <div class="guild-modal-title">📊 Уровни гильдии</div>
            <div class="guild-levels-list">
                ${rewards.slice(1).map((r, i) => {
                    const lv = i + 1;
                    const isCurrent = lv === currentLevel;
                    const isDone = lv < currentLevel;
                    return `
                    <div class="guild-level-row ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}">
                        <div class="guild-level-num">Lv${lv}</div>
                        <div class="guild-level-info">
                            <div class="guild-level-bonus">${r.bonus} к существам · ${r.members} участников</div>
                            <div class="guild-level-desc">${r.desc}</div>
                            ${r.gxpNeeded ? `<div class="guild-level-gxp">Нужно GXP: ${formatNum(r.gxpNeeded)}</div>` : ''}
                        </div>
                        <div class="guild-level-status">${isDone ? '✅' : isCurrent ? '⬅️' : '🔒'}</div>
                    </div>`;
                }).join('')}
            </div>
            <button class="guild-btn-secondary" style="width:100%;margin-top:12px" onclick="this.closest('.guild-modal-overlay').remove()">Закрыть</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── Казна — распределить ──────────────────────────────────────
function showTreasuryModal() {
    const g = guildState.myGuild;
    if (!g) return;

    const modal = document.createElement('div');
    modal.className = 'guild-modal-overlay';
    modal.innerHTML = `
        <div class="guild-modal-box">
            <div class="guild-modal-title"><i class="fa-solid fa-vault"></i> Казна: ${formatNum(g.treasury)} MMO</div>
            <div class="guild-input-label">Получатель</div>
            <select id="treasuryTarget" class="guild-input">
                ${g.members.map(m => `<option value="${m.userId}">${m.username||'Игрок'} ${m.isMe?'(Вы)':''} (${roleLabel(m.role)})</option>`).join('')}
            </select>
            <div class="guild-input-label" style="margin-top:10px">Сумма MMO</div>
            <input type="number" id="treasuryAmount" class="guild-input" placeholder="Сумма" max="${g.treasury}">
            <div id="treasuryPreview" style="font-size:11px;color:var(--text3);margin-top:6px"></div>
            <div style="display:flex;gap:10px;margin-top:16px">
                <button class="guild-btn-secondary" onclick="this.closest('.guild-modal-overlay').remove()">Отмена</button>
                <button class="guild-btn-primary" style="flex:1" onclick="submitTreasury()">Выдать</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('treasuryAmount').oninput = function() {
        const v = Math.floor(Number(this.value));
        const sel = document.getElementById('treasuryTarget');
        const name = sel.options[sel.selectedIndex]?.text || '';
        document.getElementById('treasuryPreview').textContent =
            v > 0 ? `${name} получит ${formatNum(v)} MMO` : '';
    };
}

async function submitTreasury() {
    const targetUserId = document.getElementById('treasuryTarget')?.value;
    const amount = Math.floor(Number(document.getElementById('treasuryAmount')?.value));
    if (!amount || amount <= 0) { showToast('Укажите сумму', '⚠️'); return; }

    const data = await apiRequest('POST', '/api/guild/treasury/distribute', { targetUserId, amount });
    if (data?.success) {
        document.querySelector('.guild-modal-overlay')?.remove();
        guildState.myGuild = data.guild;
        if (data.toUser) showToast(`${data.toUser} получил ${formatNum(data.distributed)} MMO из казны`, '💰');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

// ── Вступление с предупреждением ─────────────────────────────
function showJoinWarning(guildId, guildTag) {
    const modal = document.createElement('div');
    modal.className = 'guild-modal-overlay';
    modal.innerHTML = `
        <div class="guild-modal-box">
            <div class="guild-modal-title">⚠️ Внимание</div>
            <div class="guild-join-warning">
                <p>После вступления в гильдию <b>[${guildTag}]</b>:</p>
                <ul class="guild-warning-list">
                    <li>🕐 Вносить вклад нельзя <b>24 часа</b></li>
                    <li>💸 Взносы за этот период не засчитываются</li>
                </ul>
                <p>Вы уверены что хотите вступить?</p>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px">
                <button class="guild-btn-secondary" onclick="this.closest('.guild-modal-overlay').remove()">Отмена</button>
                <button class="guild-btn-primary" style="flex:1" onclick="joinGuildConfirmed('${guildId}')">Вступить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function joinGuildConfirmed(guildId) {
    document.querySelector('.guild-modal-overlay')?.remove();
    const data = await apiRequest('POST', `/api/guild/join/${guildId}`);
    if (data?.success) {
        guildState.myGuild = data.guild;
        if (state.user) state.user.guildId = data.guild._id;
        showToast(`Вы вступили в [${data.guild.tag}]! Вклад доступен через 24ч.`, '⚔️');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

// ── Список гильдий ────────────────────────────────────────────
function showGuildList() {
    const container = document.getElementById('tab-guild');
    container.innerHTML = `
        <div class="guild-search-header">
            <button class="guild-back-btn" onclick="loadGuildTab()"><i class="fa-solid fa-arrow-left"></i></button>
            <input id="guildSearchInput" class="guild-search-input" placeholder="Поиск по названию или тегу..."
                oninput="loadGuildList(this.value)">
        </div>
        <div id="guildListContainer"><div class="guild-loading">Загрузка...</div></div>
    `;
    loadGuildList();
}

function renderGuildList() {
    const container = document.getElementById('guildListContainer');
    if (!container) return;
    if (!guildState.guildList.length) {
        container.innerHTML = '<div class="guild-empty">Гильдии не найдены</div>';
        return;
    }
    container.innerHTML = guildState.guildList.map(g => `
        <div class="guild-list-item" onclick="showGuildDetail('${g._id}')">
            <div class="guild-list-header">
                <span class="guild-list-tag">[${g.tag}]</span>
                <span class="guild-list-name">${g.name}</span>
                <span class="guild-list-level">Lv${g.level}</span>
            </div>
            <div class="guild-list-meta">
                ${g.memberCount}/${g.maxMembers} · +${g.bonusPercent}% бонус · ${g.isOpen ? '🔓 Открытая' : '🔒 Закрытая'}
            </div>
            ${g.description ? `<div class="guild-list-desc">${g.description}</div>` : ''}
        </div>
    `).join('');
}

async function showGuildDetail(guildId) {
    const data = await apiRequest('GET', `/api/guild/${guildId}`);
    if (!data?.success) { showToast('Ошибка загрузки', '❌'); return; }
    const g = data.guild;
    const container = document.getElementById('tab-guild');
    const gxpPct = Math.min(100, Math.round((g.gxp / g.gxpToNext) * 100));
    const canJoin = !state.user?.guildId && g.isOpen;
    container.innerHTML = `
        <div class="guild-search-header">
            <button class="guild-back-btn" onclick="showGuildList()"><i class="fa-solid fa-arrow-left"></i></button>
            <span style="font-weight:700;color:var(--text)">[${g.tag}] ${g.name}</span>
        </div>
        <div class="guild-card">
            <div class="guild-bonus-row">
                <i class="fa-solid fa-bolt"></i>
                Бонус: <span class="guild-bonus-highlight">+${g.bonusPercent}%</span> атака / защита / HP
            </div>
            <div class="guild-progress-wrap">
                <div class="guild-progress-label"><span>GXP: ${formatNum(g.gxp)}/${formatNum(g.gxpToNext)}</span><span>Lv${g.level}</span></div>
                <div class="guild-progress-bar"><div class="guild-progress-fill" style="width:${gxpPct}%"></div></div>
            </div>
            ${g.description ? `<div class="guild-desc">${g.description}</div>` : ''}
            <div class="guild-meta" style="margin-top:8px">Лидер: ${g.leaderName} · ${g.memberCount}/${g.maxMembers} · ${g.isOpen ? '🔓 Открытая' : '🔒 Закрытая'}</div>
            ${canJoin ? `
                <div class="guild-join-notice">⚠️ После вступления вклад будет недоступен 24ч.</div>
                <button class="guild-btn-primary" style="margin-top:10px" onclick="showJoinWarning('${g._id}','${g.tag}')">
                    <i class="fa-solid fa-right-to-bracket"></i> Вступить
                </button>` : ''}
        </div>
        <div class="guild-section-title">Участники (${g.memberCount})</div>
        <div class="guild-members-list">
            ${g.members.sort((a,b)=>({leader:0,officer:1,member:2}[a.role]-{leader:0,officer:1,member:2}[b.role]))
              .map(m => `
                <div class="guild-member-item">
                    <div class="guild-member-avatar">${(m.username||'?')[0].toUpperCase()}</div>
                    <div class="guild-member-info">
                        <div class="guild-member-name">${m.username||'Игрок'}</div>
                        <div class="guild-member-role">${roleLabel(m.role)}</div>
                    </div>
                </div>`).join('')}
        </div>
    `;
}

// ── Создание гильдии ──────────────────────────────────────────
function showCreateGuild() {
    const container = document.getElementById('tab-guild');
    container.innerHTML = `
        <div class="guild-search-header">
            <button class="guild-back-btn" onclick="loadGuildTab()"><i class="fa-solid fa-arrow-left"></i></button>
            <span style="font-weight:700;color:var(--text)">Создать гильдию</span>
        </div>
        <div class="guild-create-form">
            <div class="guild-create-cost">Стоимость: <b>100 000 MMO</b></div>
            <label class="guild-input-label">Название (3–30 символов)</label>
            <input id="guildNameInput" class="guild-input" maxlength="30" placeholder="Название гильдии">
            <label class="guild-input-label">Тег [2–5 символов, латиница]</label>
            <input id="guildTagInput" class="guild-input guild-tag-input" maxlength="5" placeholder="TAG"
                oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
            <label class="guild-input-label">Описание (необязательно)</label>
            <textarea id="guildDescInput" class="guild-input guild-textarea" maxlength="200" placeholder="О вашей гильдии..."></textarea>
            <div class="guild-toggle-row">
                <span>Открытая гильдия</span>
                <label class="guild-toggle">
                    <input type="checkbox" id="guildIsOpen" checked>
                    <span class="guild-toggle-slider"></span>
                </label>
            </div>
            <div class="guild-input-hint">Открытая — вступают без одобрения лидера</div>
            <button class="guild-btn-primary" style="margin-top:16px" onclick="submitCreateGuild()">
                <i class="fa-solid fa-plus"></i> Создать гильдию
            </button>
        </div>
    `;
}

async function submitCreateGuild() {
    const name  = document.getElementById('guildNameInput')?.value?.trim();
    const tag   = document.getElementById('guildTagInput')?.value?.trim();
    const description = document.getElementById('guildDescInput')?.value?.trim() || '';
    const isOpen = document.getElementById('guildIsOpen')?.checked ?? true;
    if (!name || name.length < 3) { showToast('Название: минимум 3 символа', '⚠️'); return; }
    if (!tag  || tag.length  < 2) { showToast('Тег: минимум 2 символа', '⚠️'); return; }

    const data = await apiRequest('POST', '/api/guild/create', { name, tag, description, isOpen });
    if (data?.success) {
        guildState.myGuild = data.guild;
        if (state.user) state.user.guildId = data.guild._id;
        showToast(`Гильдия [${tag}] создана!`, '⚔️');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

// ── Редактирование ────────────────────────────────────────────
function showGuildEdit() {
    const g = guildState.myGuild;
    if (!g) return;
    const container = document.getElementById('tab-guild');
    container.innerHTML = `
        <div class="guild-search-header">
            <button class="guild-back-btn" onclick="loadGuildTab()"><i class="fa-solid fa-arrow-left"></i></button>
            <span style="font-weight:700;color:var(--text)">Настройки гильдии</span>
        </div>
        <div class="guild-create-form">
            <label class="guild-input-label">Описание</label>
            <textarea id="guildEditDesc" class="guild-input guild-textarea" maxlength="200">${g.description||''}</textarea>
            <div class="guild-toggle-row" style="margin-top:12px">
                <span>Открытая гильдия</span>
                <label class="guild-toggle">
                    <input type="checkbox" id="guildEditOpen" ${g.isOpen?'checked':''}>
                    <span class="guild-toggle-slider"></span>
                </label>
            </div>
            <button class="guild-btn-primary" style="margin-top:16px" onclick="submitGuildEdit()">
                <i class="fa-solid fa-floppy-disk"></i> Сохранить
            </button>
            <div class="guild-section-title" style="margin-top:20px">Передать лидерство</div>
            <select id="guildTransferSelect" class="guild-input">
                <option value="">— выберите участника —</option>
                ${(g.members||[]).filter(m=>!m.isMe).map(m =>
                    `<option value="${m.userId}">${m.username||'Игрок'} (${roleLabel(m.role)})</option>`
                ).join('')}
            </select>
            <button class="guild-btn-secondary" style="margin-top:8px" onclick="submitTransferLeader()">
                Передать лидерство
            </button>
        </div>
    `;
}

async function submitGuildEdit() {
    const description = document.getElementById('guildEditDesc')?.value?.trim() || '';
    const isOpen = document.getElementById('guildEditOpen')?.checked ?? true;
    const data = await apiRequest('POST', '/api/guild/update', { description, isOpen });
    if (data?.success) {
        guildState.myGuild = data.guild;
        showToast('Настройки сохранены', '✅');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

async function submitTransferLeader() {
    const targetUserId = document.getElementById('guildTransferSelect')?.value;
    if (!targetUserId) { showToast('Выберите участника', '⚠️'); return; }
    if (!confirm('Передать лидерство?')) return;
    const data = await apiRequest('POST', '/api/guild/transfer-leader', { targetUserId });
    if (data?.success) {
        guildState.myGuild = data.guild;
        showToast('Лидерство передано', '✅');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

// ── Действия ──────────────────────────────────────────────────
async function guildContribute() {
    const data = await apiRequest('POST', '/api/guild/contribute');
    if (data?.success) {
        guildState.myGuild = data.guild;
        if (data.user && state.user) { state.user.balance = data.user.balance; updateHeader(); }
        if (data.leveled) showToast(`🎉 Гильдия достигла уровня ${data.guild.level}!`, '⬆️');
        else showToast(`+100 GXP! В казну: +${data.treasuryCut} MMO`, '⚔️');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

async function guildKick(userId, username) {
    if (!confirm(`Исключить ${username}?`)) return;
    const data = await apiRequest('POST', '/api/guild/kick', { targetUserId: userId });
    if (data?.success) {
        guildState.myGuild = data.guild;
        showToast(`${username} исключён`, '✅');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

async function confirmLeaveGuild() {
    if (!confirm('Выйти из гильдии?')) return;
    const data = await apiRequest('POST', '/api/guild/leave');
    if (data?.success) {
        guildState.myGuild = null;
        if (state.user) state.user.guildId = null;
        showToast('Вы вышли из гильдии', '👋');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

async function confirmDisband() {
    if (!confirm('Распустить гильдию? Это нельзя отменить.')) return;
    const data = await apiRequest('POST', '/api/guild/disband');
    if (data?.success) {
        guildState.myGuild = null;
        if (state.user) state.user.guildId = null;
        showToast('Гильдия распущена', '💔');
        renderGuildTab();
    } else {
        showToast(data?.message || 'Ошибка', '❌');
    }
}

function roleLabel(role) {
    return {leader:'👑 Лидер', officer:'⚔️ Офицер', member:'🧑 Участник'}[role] || role;
}

// Экспорт
window.loadGuildTab = loadGuildTab;
window.showGuildList = showGuildList;
window.showCreateGuild = showCreateGuild;
window.submitCreateGuild = submitCreateGuild;
window.showGuildDetail = showGuildDetail;
window.showJoinWarning = showJoinWarning;
window.joinGuildConfirmed = joinGuildConfirmed;
window.showGuildEdit = showGuildEdit;
window.submitGuildEdit = submitGuildEdit;
window.submitTransferLeader = submitTransferLeader;
window.guildContribute = guildContribute;
window.guildKick = guildKick;
window.confirmLeaveGuild = confirmLeaveGuild;
window.confirmDisband = confirmDisband;
window.showLevelRewards = showLevelRewards;
window.showTreasuryModal = showTreasuryModal;
window.submitTreasury = submitTreasury;
