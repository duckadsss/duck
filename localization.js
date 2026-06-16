// Полная локализация для TradeTON
const i18n = (() => {
const T = {
    ru: {
      // Главные
      balance: 'Баланс',
      trader_default: 'Трейдер',
      loading: 'Загрузка...',
      your_income_label: 'ваш доход',
      
      // Навигация
      nav_trade: 'Торги',
      nav_tasks: 'Задания',
      nav_ref: 'Рефералы',
      nav_guide: 'Инфо',
      nav_wallet: 'Кошелёк',
      
      // Активные боты
      active_bots: 'Активные боты',
      buy_bot: 'Купить бота',
      last_5_trades: 'последние 5 сделок',
      ends_on: 'завершится',
      position_open: 'позиция открыта',
      position_close_plus: 'закрыта в плюс',
      position_reentry: 'перезаход ниже',
      in_progress: 'в работе',
      completed: 'завершён',
      deposit_label: 'Депозит',
      income_label: 'доход',
      claim_btn: 'Забрать',
      
      // Кнопки запуска
      launch_btn_basic: 'Запустить — 29 TON',
      launch_btn_pro: 'Запустить — 79 TON',
      launch_btn_elite: 'Запустить — 199 TON',
      launch: 'Запустить',
      days_short: 'дней',
      per_days: 'за',
      
      // Длительности
      days_7: '7 дней',
      days_14: '14 дней',
      days_30: '30 дней',
      
            // Для ru:
promo_title: 'Промокод',
promo_activate: 'Активировать',
promo_placeholder: 'Введите промокод',
      
      // Задания
      tasks_title: 'Задания',
      tasks_sub: 'Выполняй задания — получай TON',
      tasks_referrals_title: 'Приглашения',
      task_invite_10: 'Пригласить 10 друзей',
      task_invite_20: 'Пригласить 20 друзей',
      task_invite_50: 'Пригласить 50 друзей',
      task_invite_100: 'Пригласить 100 друзей',
      tasks_bots_title: 'Боты',
      task_activate_bot: 'Запустить любого бота',
      tasks_earn_title: 'Заработок',
      task_earn_10: 'Заработать 10 TON',
      task_earn_50: 'Заработать 50 TON',
      task_reward: 'Награда:',
      task_progress: 'Прогресс:',
      task_done: 'Выполнено',
      task_claim: 'Забрать',
      task_locked: 'Недоступно',
      
      // Рефералы
      ref_team: 'Ваша команда',
      ref_earned_lbl: 'Заработано:',
      ref_referrals: 'рефералов',
      ref_how_title: 'Как работает программа',
      ref_step1: 'Поделись своей реферальной ссылкой с другом',
      ref_step2: 'Друг запускает торгового бота и зарабатывает',
      ref_step3_full: 'Ты получаешь 5% от его дохода автоматически на баланс — каждый раз когда он забирает доход с бота',
      ref_share: 'Поделиться',
      ref_copy: 'Копировать',
      ref_list_title: 'Рефералы',
      ref_empty: 'Пока никого нет',
      
      // Язык
      lang_label: 'Язык',
      lang_change: 'Изменить',
      lang_select_title: 'Выберите язык',
      lang_welcome_title: 'Добро пожаловать!',
      lang_welcome_sub: 'Выберите язык приложения',
      
      // Кошелёк
      wallet_balance: 'Баланс кошелька',
      wallet_available: 'Доступно',
      wallet_in_bots: 'В ботах',
      wallet_monthly: 'Доход за месяц',
      wallet_history: 'История',
      wallet_no_tx: 'Транзакций пока нет',
      wallet_deposit: 'Пополнить',
      wallet_withdraw: 'Вывести',
      
      // Пополнение/Вывод
      deposit_title: 'Пополнить баланс',
      deposit_addr_lbl: 'Ваш TON-адрес',
      deposit_hint: 'Отправь TON на этот адрес — средства зачислятся после подтверждения администратором.',
      deposit_copy_addr: 'Копировать',
      deposit_copy_memo: 'Копировать',
      deposit_amount_lbl: 'Сумма пополнения',
      deposit_btn: 'Пополнить',
      deposit_memo_lbl: 'Ваш MEMO (Telegram ID)',
      deposit_memo_hint: '⚠️ ОБЯЗАТЕЛЬНО укажите этот MEMO в комментарии к переводу! Без MEMO средства не будут зачислены.',
      withdraw_title: 'Вывести средства',
      withdraw_avail_lbl: 'Доступно:',
      withdraw_amount: 'Сумма вывода',
      withdraw_addr: 'TON-адрес получателя',
      withdraw_fee: 'Комиссия сети',
      withdraw_receive: 'Получите',
      withdraw_btn: 'Вывести',
      
      // Транзакции
      tx_deposit: 'Пополнение',
      tx_bot_claim: 'Доход бота',
      tx_referral: 'Реферальный бонус',
      tx_withdraw: 'Вывод',
      tx_bot_start: 'Запуск бота',
      tx_pending: 'Ожидание',
      tx_done: 'Выполнено',
      tx_rejected: 'Отклонено',
      
      // Месяцы
      month_jan: 'янв',
      month_feb: 'фев',
      month_mar: 'мар',
      month_apr: 'апр',
      month_may: 'май',
      month_jun: 'июн',
      month_jul: 'июл',
      month_aug: 'авг',
      month_sep: 'сен',
      month_oct: 'окт',
      month_nov: 'ноя',
      month_dec: 'дек',
      
      // Модальное окно бота
      modal_bot: 'Бот',
      modal_pair: 'Инструмент',
      modal_period: 'Период',
      modal_yield: 'Доход за период',
      modal_price: 'Стоимость',
      modal_after: 'Баланс после',
      modal_confirm: 'Подтвердить',
      modal_launch_title: 'Запустить',
      
      // Инфо страница
      info_tagline: 'Умные боты. Реальный доход.',
      info_version: 'Версия 1.0 · TON Blockchain',
      info_how_title: 'Как это работает',
      info_step1_title: 'Выбери бота',
      info_step1_text: 'Scout Bot, Alpha Bot или Quantum Bot — выбери бота, торговую пару и срок. Запусти за TON и следи за сделками в реальном времени.',
      info_step2_title: 'Бот торгует',
      info_step2_text: 'Алгоритм открывает и закрывает позиции по BUY и SELL. Иногда фиксирует небольшой минус — чтобы зайти ниже и заработать больше.',
      info_step3_title: 'Забери доход в конце',
      info_step3_text: 'По окончании периода появится кнопка «Забрать». Нажми — и весь депозит + заработанное вернётся на твой баланс.',
      info_step4_title: 'Приглашай друзей',
      info_step4_text: 'Делись реферальной ссылкой — получай % от дохода каждого приглашённого. Пассивный заработок без вложений.',
      info_step5_title: 'Вывод в TON',
      info_step5_text: 'Все средства хранятся на TON-кошельке. Вывод доступен в любой момент через раздел Кошелёк.',
      
      // FAQ
      faq_title: 'Частые вопросы',
      faq1_q: 'Могу ли я потерять вложенное?',
      faq1_a: 'Нет. Депозит за бота возвращается полностью в конце периода вместе с доходом. Бот несёт убыток только по отдельным сделкам внутри цикла — итоговый результат всегда плюсовой.',
      faq2_q: 'Сколько ботов можно запустить?',
      faq2_a: 'Столько, сколько позволяет баланс. Каждый бот работает независимо — запускай несколько, чтобы суммировать доход по разным инструментам.',
      faq3_q: 'Когда зачисляется доход?',
      faq3_a: 'По окончании срока работы бота. В карточке появится кнопка «Забрать» — нажми, и сумма сразу придёт на баланс.',
      faq4_q: 'Почему бот иногда продаёт в минус?',
      faq4_a: 'Это часть стратегии: зафиксировать небольшой убыток, чтобы войти по более выгодной цене ниже. Это позволяет заработать больше в рамках всего периода.',
      faq5_q: 'Как работает реферальная программа?',
      faq5_a: 'Поделись своей ссылкой. Когда приглашённый запустит бота и получит доход — ты автоматически получишь % от этой суммы на свой баланс.',
      
      // Уведомления
      toast_link_copied: 'Ссылка скопирована',
      toast_addr_copied: 'Адрес скопирован',
      toast_memo_copied: 'MEMO скопирован',
      toast_insufficient: 'Недостаточно TON',
      toast_enter_amount: 'Введите сумму',
      toast_enter_address: 'Введите адрес',
      toast_bot_started: 'запущен',
      toast_claimed: 'зачислено',
      toast_request_sent: 'Заявка отправлена. Ожидайте подтверждения администратором',
      toast_withdraw_sent: 'Заявка на вывод отправлена',
      toast_error_launch: 'Ошибка запуска',
      toast_error: 'Ошибка',
      toast_load_error: 'Ошибка загрузки:',
      toast_task_claimed: 'Награда зачислена!',
    },
    en: {
      // Main
      balance: 'Balance',
      trader_default: 'Trader',
      loading: 'Loading...',
      your_income_label: 'your income',
      
      // Navigation
      nav_trade: 'Trade',
      nav_tasks: 'Tasks',
      nav_ref: 'Referrals',
      nav_guide: 'Info',
      nav_wallet: 'Wallet',
      
      // Active bots
      active_bots: 'Active Bots',
      buy_bot: 'Launch a Bot',
      last_5_trades: 'last 5 trades',
      ends_on: 'ends on',
      position_open: 'position open',
      position_close_plus: 'closed in profit',
      position_reentry: 're-entry lower',
      in_progress: 'running',
      completed: 'completed',
      deposit_label: 'Deposit',
      income_label: 'income',
      claim_btn: 'Claim',
      
      // Launch buttons
      launch_btn_basic: 'Launch — 29 TON',
      launch_btn_pro: 'Launch — 79 TON',
      launch_btn_elite: 'Launch — 199 TON',
      launch: 'Launch',
      days_short: 'days',
      per_days: 'for',
      
      // Durations
      days_7: '7 days',
      days_14: '14 days',
      days_30: '30 days',
      
      // Tasks
      tasks_title: 'Tasks',
      tasks_sub: 'Complete tasks — earn TON',
      tasks_referrals_title: 'Referrals',
      task_invite_10: 'Invite 10 friends',
      task_invite_20: 'Invite 20 friends',
      task_invite_50: 'Invite 50 friends',
      task_invite_100: 'Invite 100 friends',
      tasks_bots_title: 'Bots',
      task_activate_bot: 'Launch any bot',
      tasks_earn_title: 'Earnings',
      task_earn_10: 'Earn 10 TON',
      task_earn_50: 'Earn 50 TON',
      task_reward: 'Reward:',
      task_progress: 'Progress:',
      task_done: 'Completed',
      task_claim: 'Claim',
      task_locked: 'Locked',
      
      // Referrals
      ref_team: 'Your Team',
      ref_earned_lbl: 'Earned:',
      ref_referrals: 'referrals',
      ref_how_title: 'How it works',
      ref_step1: 'Share your referral link with a friend',
      ref_step2: 'Your friend launches a trading bot and earns',
      ref_step3_full: "You receive 5% of their income automatically — every time they claim bot earnings",
      ref_share: 'Share',
      ref_copy: 'Copy',
      ref_list_title: 'Referrals',
      ref_empty: 'No one yet',
      
      // Language
      lang_label: 'Language',
      lang_change: 'Change',
      lang_select_title: 'Select Language',
      lang_welcome_title: 'Welcome!',
      lang_welcome_sub: 'Choose the app language',
      

// Для en:
promo_title: 'Promo Code',
promo_activate: 'Activate',
promo_placeholder: 'Enter promo code',
      
      // Wallet
      wallet_balance: 'Wallet Balance',
      wallet_available: 'Available',
      wallet_in_bots: 'In bots',
      wallet_monthly: 'Monthly income',
      wallet_history: 'History',
      wallet_no_tx: 'No transactions yet',
      wallet_deposit: 'Deposit',
      wallet_withdraw: 'Withdraw',
      
      // Deposit/Withdraw
      deposit_title: 'Deposit Funds',
      deposit_addr_lbl: 'Your TON address',
      deposit_hint: 'Send TON to this address — funds will be credited after admin approval.',
      deposit_copy_addr: 'Copy',
      deposit_copy_memo: 'Copy',
      deposit_amount_lbl: 'Deposit amount',
      deposit_btn: 'Deposit',
      deposit_memo_lbl: 'Your MEMO (Telegram ID)',
      deposit_memo_hint: '⚠️ MANDATORY: Include this MEMO in your transfer comment! Funds without MEMO will not be credited.',
      withdraw_title: 'Withdraw Funds',
      withdraw_avail_lbl: 'Available:',
      withdraw_amount: 'Amount to withdraw',
      withdraw_addr: 'Recipient TON address',
      withdraw_fee: 'Network fee',
      withdraw_receive: 'You receive',
      withdraw_btn: 'Withdraw',
      
      // Transactions
      tx_deposit: 'Deposit',
      tx_bot_claim: 'Bot income',
      tx_referral: 'Referral bonus',
      tx_withdraw: 'Withdrawal',
      tx_bot_start: 'Bot launch',
      tx_pending: 'Pending',
      tx_done: 'Completed',
      tx_rejected: 'Rejected',
      
      // Months
      month_jan: 'Jan',
      month_feb: 'Feb',
      month_mar: 'Mar',
      month_apr: 'Apr',
      month_may: 'May',
      month_jun: 'Jun',
      month_jul: 'Jul',
      month_aug: 'Aug',
      month_sep: 'Sep',
      month_oct: 'Oct',
      month_nov: 'Nov',
      month_dec: 'Dec',
      
      // Bot modal
      modal_bot: 'Bot',
      modal_pair: 'Instrument',
      modal_period: 'Period',
      modal_yield: 'Income for period',
      modal_price: 'Cost',
      modal_after: 'Balance after',
      modal_confirm: 'Confirm',
      modal_launch_title: 'Launch',
      
      // Info page
      info_tagline: 'Smart bots. Real income.',
      info_version: 'Version 1.0 · TON Blockchain',
      info_how_title: 'How it works',
      info_step1_title: 'Choose a bot',
      info_step1_text: 'Scout Bot, Alpha Bot or Quantum Bot — pick a bot, trading pair and duration. Launch for TON and watch trades in real time.',
      info_step2_title: 'The bot trades',
      info_step2_text: "The algorithm opens and closes BUY and SELL positions. Sometimes it takes a small loss to re-enter at a better price and earn more overall.",
      info_step3_title: 'Claim your income at the end',
      info_step3_text: "When the period ends a Claim button appears. Tap it — your full deposit plus earnings will be credited to your balance.",
      info_step4_title: 'Invite friends',
      info_step4_text: "Share your referral link — earn % of every friend's income. Passive earnings with no investment.",
      info_step5_title: 'Withdraw in TON',
      info_step5_text: 'All funds are stored in your TON wallet. Withdraw anytime via the Wallet section.',
      
      // FAQ
      faq_title: 'FAQ',
      faq1_q: 'Can I lose my deposit?',
      faq1_a: "No. Your deposit is returned in full at the end of the period along with earnings. The bot may lose on individual trades, but the overall result is always positive.",
      faq2_q: 'How many bots can I run?',
      faq2_a: "As many as your balance allows. Each bot runs independently — launch several to stack income across different instruments.",
      faq3_q: 'When is income credited?',
      faq3_a: "After the bot period ends. A Claim button appears in the card — tap it and the amount is instantly added to your balance.",
      faq4_q: 'Why does the bot sometimes sell at a loss?',
      faq4_a: "It is part of the strategy: take a small loss to re-enter at a better price. This allows earning more within the overall period.",
      faq5_q: 'How does the referral program work?',
      faq5_a: "Share your link. When someone you invited claims bot earnings — you automatically receive 5% of that amount to your balance.",
      
      // Toasts
      toast_link_copied: 'Link copied',
      toast_addr_copied: 'Address copied',
      toast_memo_copied: 'MEMO copied',
      toast_insufficient: 'Insufficient TON',
      toast_enter_amount: 'Enter amount',
      toast_enter_address: 'Enter address',
      toast_bot_started: 'launched',
      toast_claimed: 'credited',
      toast_request_sent: 'Request sent. Awaiting admin confirmation',
      toast_withdraw_sent: 'Withdrawal request sent',
      toast_error_launch: 'Launch error',
      toast_error: 'Error',
      toast_load_error: 'Load error:',
      toast_task_claimed: 'Reward credited!',
    },
  };
  
  let _lang = localStorage.getItem('tradetonLang') || null;
  
  function formatDate(date, lang) {
    const d = new Date(date);
    const day = d.getDate();
    const monthIndex = d.getMonth();
    const monthNames = [
      'month_jan', 'month_feb', 'month_mar', 'month_apr',
      'month_may', 'month_jun', 'month_jul', 'month_aug',
      'month_sep', 'month_oct', 'month_nov', 'month_dec'
    ];
    const monthKey = monthNames[monthIndex];
    const month = T[lang]?.[monthKey] || T.ru[monthKey] || ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][monthIndex];
    return `${day} ${month}`;
  }
  
  function formatTime(date) {
    const d = new Date(date);
    return d.toLocaleTimeString(_lang === 'en' ? 'en' : 'ru', { hour:'2-digit', minute:'2-digit' });
  }
  
  function t(key) {
    const d = T[_lang] || T.ru;
    const value = d[key];
    if (value === undefined) {
      console.warn(`[i18n] Missing key: ${key}`);
      return T.ru[key] || key;
    }
    return value;
  }
  
  function tHtml(key) {
    return t(key);
  }
  
  function setLang(lang) {
    if (!T[lang]) return;
    _lang = lang;
    localStorage.setItem('tradetonLang', lang);
    document.documentElement.lang = lang;
    applyTranslations();
    window.dispatchEvent(new CustomEvent('langChanged', { detail: lang }));
  }
  
  function getLang() { return _lang || 'ru'; }
  function isSet() { return !!_lang; }
  
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      el.innerHTML = t(key);
    });
    
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });
  }
  
  return { 
    t, 
    tHtml, 
    setLang, 
    getLang, 
    isSet, 
    apply: applyTranslations,
    formatDate,
    formatTime
  };
})();

function chooseLang(lang) {
  i18n.setLang(lang);
  
  const welcome = document.getElementById('langWelcome');
  if (welcome) welcome.classList.add('hidden');
  
  closeLangModal();
  
  const optRu = document.getElementById('lang-opt-ru');
  const optEn = document.getElementById('lang-opt-en');
  if (optRu) optRu.classList.toggle('active', lang === 'ru');
  if (optEn) optEn.classList.toggle('active', lang === 'en');
  
  const langLabel = document.getElementById('langCurrentLabel');
  if (langLabel) langLabel.textContent = lang === 'ru' ? 'Русский' : 'English';
  
  i18n.apply();
  
  if (typeof render === 'function') render();
  if (typeof renderTasks === 'function') renderTasks();
  if (typeof updateBal === 'function') updateBal();
  if (typeof renderRating === 'function') renderRating();
  if (typeof updateYieldBadge === 'function') {
    ['basic', 'pro', 'elite'].forEach(updateYieldBadge);
  }
  if (typeof updateDurationButtonsText === 'function') {
    updateDurationButtonsText();
  }
  if (typeof updateLaunchButtonsText === 'function') {
    updateLaunchButtonsText();
  }
  if (window._lastTxs && typeof renderTxList === 'function') {
    renderTxList(window._lastTxs);
  }
  if (typeof loadReferrals === 'function') {
    loadReferrals();
  }
}

function openLangModal() { 
  const modal = document.getElementById('langModal');
  if (modal) modal.classList.add('open'); 
}

function closeLangModal() { 
  const modal = document.getElementById('langModal');
  if (modal) modal.classList.remove('open'); 
}

window.addEventListener('langChanged', () => {
  i18n.apply();
  if (typeof render === 'function') render();
  if (typeof renderTasks === 'function') renderTasks();
  if (typeof updateBal === 'function') updateBal();
  if (typeof updateDurationButtonsText === 'function') updateDurationButtonsText();
  if (typeof updateLaunchButtonsText === 'function') updateLaunchButtonsText();
  if (window._lastTxs && typeof renderTxList === 'function') renderTxList(window._lastTxs);
  if (typeof loadReferrals === 'function') loadReferrals();
});