// bot.js - ИСПРАВЛЕННАЯ версия с поддержкой интервальных уведомлений
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app-url.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;

// Инициализация
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;
const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

console.log('🤖 Бот запущен!');
console.log('📊 Supabase:', supabase ? '✅ Подключен' : '❌ Не настроен');

// ============================================
// АТОМАРНАЯ ЗАЩИТА ОТ ДУБЛЕЙ
// ============================================

const processingLocks = new Set();

function generateLockKey(notificationId, scheduledMinute) {
  return `${notificationId}_${scheduledMinute}`;
}

async function tryAcquireLock(notificationId, scheduledMinute) {
  const lockKey = generateLockKey(notificationId, scheduledMinute);
  
  if (processingLocks.has(lockKey)) {
    console.log(`🔒 Process lock exists: ${lockKey}`);
    return false;
  }
  
  processingLocks.add(lockKey);
  
  try {
    const { data, error } = await supabase
      .from('sent_notifications')
      .insert({
        dedupe_key: lockKey,
        notification_id: notificationId,
        sent_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        console.log(`⚠️ Database lock exists (unique constraint): ${lockKey}`);
        processingLocks.delete(lockKey);
        return false;
      }
      throw error;
    }
    
    console.log(`✅ Lock acquired: ${lockKey}`);
    return true;
    
  } catch (error) {
    console.error('Error acquiring lock:', error);
    processingLocks.delete(lockKey);
    return false;
  }
}

function releaseLock(notificationId, scheduledMinute) {
  const lockKey = generateLockKey(notificationId, scheduledMinute);
  processingLocks.delete(lockKey);
  
  setTimeout(() => {
    processingLocks.delete(lockKey);
  }, 120000);
}

// ========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РЕГИСТРАЦИИ
// ========================================

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

async function isUserRegistered(telegramUserId) {
  if (!supabase) return { registered: false, authUserId: null };
  
  try {
    const { data, error } = await supabase
      .from('user_telegram_mapping')
      .select('auth_user_id')
      .eq('user_id', telegramUserId)
      .single();

    if (error || !data?.auth_user_id) {
      return { registered: false, authUserId: null };
    }

    return { registered: true, authUserId: data.auth_user_id };
  } catch (error) {
    console.error('Error checking registration:', error);
    return { registered: false, authUserId: null };
  }
}

// Состояние регистрации (в памяти)
const registrationStates = new Map();

function getStartInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📝 Создать аккаунт', web_app: { url: WEB_APP_URL } }],
      [{ text: 'ℹ️ Что умеют приложение и бот', callback_data: 'show_features' }],
    ],
  };
}

function getRegistrationInlineKeyboard() {
  return getStartInlineKeyboard();
}

async function sendFeaturesMessage(chatId) {
  return bot.sendMessage(chatId, `
📖 *Что умеют приложение и бот*

📱 *В приложении:*
• создание аккаунта и профиль малыша
• карточка малыша и журнал активностей
• статистика, графики и история
• настройка напоминаний

🤖 *В боте:*
• быстрый запуск/остановка активностей
• удобное меню активных таймеров
• переход в приложение в один тап
• напоминания из приложения

Создайте аккаунт в приложении, затем возвращайтесь в бот для быстрых действий.
  `.trim(), {
    parse_mode: 'Markdown',
    reply_markup: getStartInlineKeyboard(),
  });
}

async function startRegistrationFlow(chatId, telegramUserId, username) {
  registrationStates.set(telegramUserId, {
    flow: 'register',
    step: 'awaiting_email',
    username,
  });

  await bot.sendMessage(chatId,
    '📱 Регистрация\n\n' +
    'Шаг 1/3: Введите ваш email\n' +
    'Формат: name@example.com\n\n' +
    'Или отмените: /cancel'
  );
}

async function startLinkFlow(chatId, telegramUserId, username) {
  registrationStates.set(telegramUserId, {
    flow: 'link_existing',
    step: 'awaiting_link_email',
    username,
  });

  await bot.sendMessage(chatId,
    '🔗 Привязка существующего аккаунта\n\n' +
    'Шаг 1/2: Введите email, который использовали в приложении.\n\n' +
    'Или отмените: /cancel'
  );
}

async function sendNotificationSafe(chatId, notification, scheduledMinute, customMessage = null) {
  try {
    const acquired = await tryAcquireLock(notification.id, scheduledMinute);
    
    if (!acquired) {
      console.log(`⏭️ Уведомление ${notification.id} уже отправляется/отправлено`);
      return false;
    }
    
    const activityLabel = getActivityLabel(notification.activity_type);
    const message = customMessage || `
🔔 Напоминание: ${notification.title || 'Уведомление'}

${activityLabel}
${notification.message ? `\n💬 ${notification.message}` : ''}
    `.trim();
    
    await bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📊 Открыть приложение',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    });
    
    console.log(`✅ Уведомление ${notification.id} отправлено пользователю ${chatId}`);
    
    releaseLock(notification.id, scheduledMinute);
    
    return true;
    
  } catch (error) {
    console.error(`Error sending notification ${notification.id}:`, error);
    releaseLock(notification.id, scheduledMinute);
    return false;
  }
}

function getActivityLabel(activityType) {
  const labels = {
    breastfeeding: '🍼 Кормление грудью',
    bottle: '🍼 Бутылочка',
    sleep: '😴 Сон',
    bath: '🛁 Купание',
    walk: '🚶 Прогулка',
    diaper: '🧷 Подгузник',
    medicine: '💊 Лекарство'
  };
  return labels[activityType] || activityType;
}

function formatInterval(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return mins > 0 ? `${hours}ч ${mins}м` : `${hours}ч`;
  }
  return `${mins}м`;
}

// ============================================
// ПРОВЕРКА ИНТЕРВАЛЬНЫХ УВЕДОМЛЕНИЙ
// ============================================

async function checkIntervalNotification(notification, now, userId) {
  try {
    // Получить baby_id для этого пользователя
    const { data: baby, error: babyError } = await supabase
      .from('babies')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (babyError || !baby) {
      console.log(`❌ Не найден малыш для пользователя ${userId}`);
      return { shouldSend: false };
    }
    
    // В таблице activities колонка типа называется `type`
    const { data: lastActivity, error: activityError } = await supabase
      .from('activities')
      .select('*')
      .eq('baby_id', baby.id)
      .eq('type', notification.activity_type)
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (activityError) {
      console.error('Error fetching last activity:', activityError);
      return { shouldSend: false };
    }
    
    if (!lastActivity) {
      console.log(`ℹ️ Нет активностей типа ${notification.activity_type} для проверки интервала`);
      return { shouldSend: false };
    }

    const intervalMinutes = Number(notification.interval_minutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      console.log(`⚠️ Некорректный интервал: ${notification.interval_minutes}`);
      return { shouldSend: false };
    }

    const lastActivityTime = lastActivity.end_time || lastActivity.start_time;
    const lastTime = new Date(lastActivityTime);
    const diffMinutes = (now - lastTime) / (1000 * 60);

    console.log(`📊 Интервал для ${notification.activity_type}: прошло ${diffMinutes.toFixed(1)} мин из ${intervalMinutes} мин`);

    // Отправляем когда интервал пройден.
    // ВАЖНО: уведомление должно уйти только 1 раз для конкретной последней активности,
    // поэтому ключ дедупликации привязываем к самой активности, а не к каждой минуте проверки.
    const shouldSend = diffMinutes >= intervalMinutes;
    const triggerKey = shouldSend
      ? `activity-${lastActivity.id || String(lastActivityTime)}`
      : null;

    return { shouldSend, triggerKey, diffMinutes: diffMinutes.toFixed(1) };
  } catch (error) {
    console.error('Error checking interval notification:', error);
    return { shouldSend: false };
  }
}

// ============================================
// ОСНОВНАЯ ПРОВЕРКА УВЕДОМЛЕНИЙ
// ============================================

let lastCheckedMinute = null;
let isChecking = false;

async function checkAndSendNotifications() {
  if (isChecking) {
    console.log('⏳ Предыдущая проверка ещё выполняется, пропускаем');
    return;
  }
  
  if (!supabase) {
    console.log('⚠️ Supabase не настроен');
    return;
  }
  
  isChecking = true;
  
  try {
    const now = new Date();
    const currentMinute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    
    if (lastCheckedMinute === currentMinute) {
      return;
    }
    
    lastCheckedMinute = currentMinute;
    
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const currentDay = now.getDay(); // 0-6
    
    console.log(`🔍 Проверка уведомлений: ${currentTime}, день ${currentDay}`);
    
    // ИСПРАВЛЕНО: загружаем ВСЕ типы уведомлений включая 'interval'
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('enabled', true);
    
    if (error) {
      console.error('Error fetching notifications:', error);
      return;
    }
    
    if (!notifications || notifications.length === 0) {
      console.log('ℹ️ Нет активных уведомлений');
      return;
    }
    
    console.log(`📬 Найдено ${notifications.length} активных уведомлений`);
    
    // Группируем по типу для статистики
    const byType = notifications.reduce((acc, n) => {
      acc[n.notification_type] = (acc[n.notification_type] || 0) + 1;
      return acc;
    }, {});
    console.log(`📊 Типы уведомлений:`, byType);
    
    // Обрабатываем уведомления ПОСЛЕДОВАТЕЛЬНО
    for (const notification of notifications) {
      try {
        const userId = notification.user_id;
        const chatId = await resolveChatId(userId);
        
        if (!chatId) {
          console.log(`❌ Не найден chat_id для пользователя ${userId}`);
          continue;
        }
        
        // ========== TIME-BASED УВЕДОМЛЕНИЯ ==========
        if (notification.notification_type === 'time') {
          const notificationTime = notification.notification_time?.slice(0, 5);
          const repeatDays = notification.repeat_days || [];
          
          if (notificationTime === currentTime && repeatDays.includes(currentDay)) {
            console.log(`⏰ TIME: Отправка уведомления "${notification.title}" (ID: ${notification.id})`);
            
            await sendNotificationSafe(chatId, notification, currentMinute);
          }
        }
        
        // ========== INTERVAL-BASED УВЕДОМЛЕНИЯ ==========
        if (notification.notification_type === 'interval') {
          const result = await checkIntervalNotification(notification, now, userId);
          
          if (result.shouldSend) {
            console.log(`⏱️ INTERVAL: Отправка уведомления "${notification.title}" (ID: ${notification.id})`);
            console.log(`   Прошло ${result.diffMinutes} мин из ${notification.interval_minutes} мин`);
            
            const intervalKey = result.triggerKey;
            const customMessage = `
🔔 Напоминание: ${notification.title || 'Уведомление'}

⏱️ Прошло ${formatInterval(notification.interval_minutes)} с последней активности
${getActivityLabel(notification.activity_type)}
${notification.message ? `\n💬 ${notification.message}` : ''}
            `.trim();
            
            await sendNotificationSafe(chatId, notification, intervalKey, customMessage);
          }
        }
        
      } catch (notifError) {
        console.error(`Error processing notification ${notification.id}:`, notifError);
      }
    }
    
  } catch (error) {
    console.error('Error in checkAndSendNotifications:', error);
  } finally {
    isChecking = false;
  }
}

async function resolveChatId(userId) {
  if (!supabase) return null;

  // 1) Основной сценарий: auth_user_id -> chat_id
  const { data: directMapping } = await supabase
    .from('user_telegram_mapping')
    .select('chat_id')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (directMapping?.chat_id) {
    return directMapping.chat_id;
  }

  // 2) Получаем telegram_id из метаданных auth пользователя
  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
  if (authUserError) {
    console.error(`Failed to get auth user ${userId}:`, authUserError);
    return null;
  }

  const telegramId = authUserData?.user?.user_metadata?.telegram_id;
  if (!telegramId) {
    return null;
  }

  // 3) Legacy таблица: user_id хранит telegram id
  const { data: legacyMapping } = await supabase
    .from('user_telegram_mapping')
    .select('chat_id')
    .eq('user_id', telegramId)
    .maybeSingle();

  if (legacyMapping?.chat_id) {
    return legacyMapping.chat_id;
  }

  // 4) Для личных чатов Telegram chat_id == telegram user id
  return telegramId;
}

// Запускаем проверку каждую минуту
if (supabase) {
  setInterval(checkAndSendNotifications, 60000);
  console.log('⏰ Проверка уведомлений запущена (каждую минуту)');
  
  // Первая проверка через 10 секунд
  setTimeout(checkAndSendNotifications, 10000);
}

// ============================================
// Быстрое добавление активностей (FSM + синхронизация с вебом)
// ============================================

const MAIN_MENU_BUTTON = '➕ Добавить активность';
const HOME_MENU_BUTTON = '🏠 Главное меню';
const ACTIVE_TIMERS_BUTTON = '⏱ Запущенные активности';
const OPEN_APP_BUTTON = '📊 Открыть приложение';
const QUICK_ACTIVITIES = {
  breastfeeding: '🤱 Кормление грудью',
  bottle: '🍼 Бутылочка',
  sleep: '😴 Сон',
  diaper: '👶 Подгузник',
  medicine: '💊 Лекарство',
  bath: '🛁 Купание',
};

const FSM_STATE = {
  IDLE: 'idle',
  WAIT_BREAST_SIDE: 'wait_breast_side',
  WAIT_BOTTLE_AMOUNT: 'wait_bottle_amount',
  WAIT_DIAPER_TYPE: 'wait_diaper_type',
  WAIT_MEDICINE_NAME: 'wait_medicine_name',
  WAIT_STOP_CONFIRM: 'wait_stop_confirm',
};

const userSessions = new Map();
const botActiveTimers = new Map();
const trackedChats = new Set();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function getSession(chatId) {
  if (!userSessions.has(chatId)) {
    userSessions.set(chatId, { state: FSM_STATE.IDLE, draft: {} });
  }
  return userSessions.get(chatId);
}

function setSessionState(chatId, state, draft = {}) {
  userSessions.set(chatId, { state, draft });
}

function getMainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: MAIN_MENU_BUTTON }, { text: ACTIVE_TIMERS_BUTTON }],
      [{ text: HOME_MENU_BUTTON }, { text: OPEN_APP_BUTTON, web_app: { url: WEB_APP_URL } }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function quickActivitiesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: QUICK_ACTIVITIES.breastfeeding, callback_data: 'qa:breastfeeding' }],
      [{ text: QUICK_ACTIVITIES.bottle, callback_data: 'qa:bottle' }],
      [{ text: QUICK_ACTIVITIES.sleep, callback_data: 'qa:sleep' }],
      [{ text: QUICK_ACTIVITIES.diaper, callback_data: 'qa:diaper' }],
      [{ text: QUICK_ACTIVITIES.medicine, callback_data: 'qa:medicine' }],
      [{ text: QUICK_ACTIVITIES.bath, callback_data: 'qa:bath' }],
    ],
  };
}

async function sendMainMenuMessage(chatId) {
  return bot.sendMessage(chatId, `👶 Трекер малыша

Используйте нижнее меню для быстрых действий.`, {
    reply_markup: getMainMenuKeyboard(),
  });
}

function timerKey(timer) {
  return timer.type === 'breastfeeding' ? `breastfeeding:${timer.side || 'unknown'}` : timer.type;
}

function toDurationSec(startIso, endIso = new Date().toISOString()) {
  return Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 1000));
}

function formatTimersForMenu(timers) {
  if (!timers.length) return 'Активных таймеров нет.';
  const lines = timers.map((timer) => {
    const sec = toDurationSec(timer.start_time || timer.startTime);
    const min = Math.max(1, Math.floor(sec / 60));
    if (timer.type === 'breastfeeding') {
      const side = timer.side === 'left' ? 'левая' : 'правая';
      return `• 🤱 ${side} (${min} мин)`;
    }
    if (timer.type === 'sleep') return `• 😴 сон (${min} мин)`;
    return `• ${timer.type} (${min} мин)`;
  });
  return `Активные таймеры:\n${lines.join('\n')}`;
}

function timerDisplayLabel(timer) {
  const sec = toDurationSec(timer.start_time || timer.startTime);
  const min = Math.max(1, Math.floor(sec / 60));

  if (timer.type === 'breastfeeding') {
    const side = timer.side === 'right' ? 'правая грудь' : 'левая грудь';
    return `🤱 ${side} (${min} мин)`;
  }

  if (timer.type === 'sleep') {
    return `😴 сон (${min} мин)`;
  }

  return `⏱ ${timer.type} (${min} мин)`;
}

function stopCallbackForTimer(timer) {
  if (timer.type === 'breastfeeding') {
    return `qa:stop:breastfeeding_${timer.side || 'left'}`;
  }
  return `qa:stop:${timer.type}`;
}

async function resolveAppUserIdByChat(chatId, telegramUserId) {
  if (!supabase) return null;

  const { data: mapping } = await supabase
    .from('user_telegram_mapping')
    .select('auth_user_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (mapping?.auth_user_id && isUuid(mapping.auth_user_id)) {
    return mapping.auth_user_id;
  }

  if (!telegramUserId) return null;

  try {
    const { data: usersData, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
      console.error('Ошибка listUsers:', error);
      return null;
    }
    const user = usersData.users.find((u) => String(u.user_metadata?.telegram_id) === String(telegramUserId));
    if (!user) return null;

    await supabase
      .from('user_telegram_mapping')
      .upsert(
        {
          user_id: telegramUserId,
          chat_id: chatId,
          auth_user_id: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    return user.id;
  } catch (error) {
    console.error('Ошибка поиска пользователя по telegram_id:', error);
    return null;
  }
}

async function getBabyIdByUser(userId) {
  const { data: baby } = await supabase
    .from('babies')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return baby?.id || null;
}

async function getContext(msgOrQuery) {
  if (!supabase) return null;

  const isQuery = !!msgOrQuery.from && !!msgOrQuery.message;
  const chatId = isQuery ? msgOrQuery.message.chat.id : msgOrQuery.chat.id;
  const telegramUserId = msgOrQuery.from.id;

  const appUserId = await resolveAppUserIdByChat(chatId, telegramUserId);
  if (!appUserId) return { chatId, telegramUserId, appUserId: null, babyId: null };

  const babyId = await getBabyIdByUser(appUserId);
  return { chatId, telegramUserId, appUserId, babyId };
}

async function createActivityRow(babyId, payload) {
  const { data, error } = await supabase
    .from('activities')
    .insert([{ baby_id: babyId, ...payload }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateActivityRow(id, payload) {
  const { data, error } = await supabase
    .from('activities')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function refreshActiveTimersFromWeb(context) {
  if (!context?.babyId) return [];
  const { data, error } = await supabase
    .from('activities')
    .select('id, type, start_time, end_time, comment')
    .eq('baby_id', context.babyId)
    .in('type', ['breastfeeding', 'sleep'])
    .is('end_time', null)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Ошибка sync таймеров:', error);
    return [];
  }

  const normalized = (data || []).map((row) => ({
    ...row,
    side: row.type === 'breastfeeding' && row.comment?.includes('side:right') ? 'right' : 'left',
    source: 'web',
  }));

  const local = new Map();
  for (const timer of normalized) {
    local.set(timerKey(timer), timer);
  }
  botActiveTimers.set(context.chatId, local);
  trackedChats.add(context.chatId);
  return normalized;
}

async function showQuickMenu(chatId, context) {
  const timers = await refreshActiveTimersFromWeb(context);
  await bot.sendMessage(chatId, `Выберите активность.\n${formatTimersForMenu(timers)}`, {
    reply_markup: quickActivitiesKeyboard(),
  });
}

async function showActiveTimersMenu(chatId, context) {
  const timers = await refreshActiveTimersFromWeb(context);

  if (!timers.length) {
    return bot.sendMessage(chatId, 'Сейчас нет запущенных активностей.', {
      reply_markup: quickActivitiesKeyboard(),
    });
  }

  const inline_keyboard = timers.map((timer) => ([{
    text: `⏹ Остановить: ${timerDisplayLabel(timer)}`,
    callback_data: stopCallbackForTimer(timer),
  }]));

  return bot.sendMessage(chatId, 'Выберите активность для остановки:', {
    reply_markup: { inline_keyboard },
  });
}

async function ensureContextOrHelp(chatId, context) {
  if (!supabase) {
    await bot.sendMessage(chatId, 'База данных не настроена.');
    return false;
  }
  if (!context?.appUserId || !context?.babyId) {
    await bot.sendMessage(chatId, 'Не нашёл профиль малыша. Откройте веб-приложение и войдите в аккаунт.', {
      reply_markup: { inline_keyboard: [[{ text: '📊 Открыть приложение', web_app: { url: WEB_APP_URL } }]] },
    });
    return false;
  }
  return true;
}

async function startTimer(context, type, side = null) {
  const chatTimers = botActiveTimers.get(context.chatId) || new Map();
  if (type === 'sleep' && chatTimers.get('sleep')) {
    return { alreadyRunning: true, runningType: 'sleep' };
  }

  if (type === 'breastfeeding') {
    const otherSide = side === 'left' ? 'right' : 'left';
    const other = chatTimers.get(`breastfeeding:${otherSide}`);
    if (other) {
      await stopTimer(context, other, true);
    }
    const same = chatTimers.get(`breastfeeding:${side}`);
    if (same) {
      return { alreadyRunning: true, runningType: `breastfeeding:${side}` };
    }
  }

  const startedAt = new Date().toISOString();
  const payload = {
    type,
    start_time: startedAt,
    end_time: null,
    comment: type === 'breastfeeding' ? `side:${side}` : 'started_from:telegram',
    left_duration: type === 'breastfeeding' ? 0 : undefined,
    right_duration: type === 'breastfeeding' ? 0 : undefined,
  };
  const row = await createActivityRow(context.babyId, payload);
  const timer = { ...row, side, source: 'bot' };
  chatTimers.set(timerKey({ type, side }), timer);
  botActiveTimers.set(context.chatId, chatTimers);
  trackedChats.add(context.chatId);
  return { alreadyRunning: false, timer };
}

async function stopTimer(context, timer, silent = false) {
  const end = new Date().toISOString();
  const durationSec = toDurationSec(timer.start_time, end);
  const payload = { end_time: end };

  if (timer.type === 'breastfeeding') {
    payload.left_duration = timer.side === 'left' ? durationSec : 0;
    payload.right_duration = timer.side === 'right' ? durationSec : 0;
  }

  await updateActivityRow(timer.id, payload);
  const chatTimers = botActiveTimers.get(context.chatId) || new Map();
  chatTimers.delete(timerKey(timer));
  botActiveTimers.set(context.chatId, chatTimers);

  if (!silent) {
    await bot.sendMessage(context.chatId, `Готово: ${timer.type === 'sleep' ? 'сон' : 'кормление'} сохранён (${Math.max(1, Math.floor(durationSec / 60))} мин).`, {
      reply_markup: getMainMenuKeyboard(),
    });
  }
}

async function syncTrackedTimers() {
  if (!supabase || trackedChats.size === 0) return;

  for (const chatId of trackedChats) {
    try {
      const session = getSession(chatId);
      const context = session.context;
      if (!context?.babyId) continue;

      const remoteTimers = await refreshActiveTimersFromWeb(context);
      if (session.state !== FSM_STATE.IDLE) continue;

      const map = new Map(remoteTimers.map((t) => [timerKey(t), t]));
      botActiveTimers.set(chatId, map);
    } catch (error) {
      console.error('Ошибка фоновой синхронизации:', error);
    }
  }
}

setInterval(syncTrackedTimers, 20000);

async function handleQuickActivitySelect(query, activity) {
  const context = await getContext(query);
  const chatId = query.message.chat.id;

  if (!(await ensureContextOrHelp(chatId, context))) return;

  const session = getSession(chatId);
  session.context = context;

  await refreshActiveTimersFromWeb(context);

  if (activity === 'breastfeeding') {
    setSessionState(chatId, FSM_STATE.WAIT_BREAST_SIDE, { context });
    return bot.sendMessage(chatId, 'Выберите грудь:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '⬅️ Левая', callback_data: 'qa:breast:left' },
          { text: '➡️ Правая', callback_data: 'qa:breast:right' },
        ]],
      },
    });
  }

  if (activity === 'sleep') {
    const started = await startTimer(context, 'sleep');
    if (started.alreadyRunning) {
      setSessionState(chatId, FSM_STATE.WAIT_STOP_CONFIRM, { context, type: 'sleep' });
      return bot.sendMessage(chatId, 'Сон уже идёт. Остановить текущий?', {
        reply_markup: {
          inline_keyboard: [[
            { text: '⏹ Остановить текущую', callback_data: 'qa:stop:sleep' },
            { text: 'Отмена', callback_data: 'qa:cancel' },
          ]],
        },
      });
    }
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return bot.sendMessage(chatId, 'Сон запущен.', { reply_markup: getMainMenuKeyboard() });
  }

  if (activity === 'bottle') {
    setSessionState(chatId, FSM_STATE.WAIT_BOTTLE_AMOUNT, { context });
    return bot.sendMessage(chatId, 'Введите объём в мл (например, 120):');
  }

  if (activity === 'diaper') {
    setSessionState(chatId, FSM_STATE.WAIT_DIAPER_TYPE, { context });
    return bot.sendMessage(chatId, 'Какой подгузник?', {
      reply_markup: {
        keyboard: [[{ text: 'Мокрый' }, { text: 'Грязный' }], [{ text: MAIN_MENU_BUTTON }]],
        resize_keyboard: true,
      },
    });
  }

  if (activity === 'medicine') {
    setSessionState(chatId, FSM_STATE.WAIT_MEDICINE_NAME, { context });
    return bot.sendMessage(chatId, 'Введите название лекарства:');
  }

  if (activity === 'bath') {
    await createActivityRow(context.babyId, {
      type: 'bath',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      comment: 'quick_add:telegram',
    });
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return bot.sendMessage(chatId, 'Купание сохранено.', { reply_markup: getMainMenuKeyboard() });
  }
}

// ============================================
// Обработчики команд бота
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;

  console.log('📱 /start from:', telegramUserId);

  if (!supabase) {
    await bot.sendMessage(chatId, 
      '👋 Добро пожаловать!\n\n' +
      'Откройте приложение:',
      {
        reply_markup: getStartInlineKeyboard()
      }
    );
    return;
  }

  // Проверка регистрации
  const { registered } = await isUserRegistered(telegramUserId);

  if (!registered) {
    await bot.sendMessage(chatId, 
      '👋 Добро пожаловать в «Дневник малыша»!\n\n' +
      'Этот бот помогает быстро вести дневник прямо в Telegram:\n' +
      '• запуск и остановка таймеров\n' +
      '• быстрые записи (кормление, сон, подгузник и др.)\n' +
      '• напоминания из приложения\n\n' +
      '📱 В приложении доступны полный журнал, карточка малыша, статистика и настройки.\n\n' +
      'Чтобы начать, создайте аккаунт (сразу откроется шаг добавления малыша):',
      {
        reply_markup: getStartInlineKeyboard()
      }
    );
    return;
  }

  await bot.sendMessage(chatId,
    '👶 Дневник малыша\n\n' +
    'Готово! Используйте меню быстрых действий ниже или откройте приложение.'
  );

  // СУЩЕСТВУЮЩАЯ ЛОГИКА: Сохранение chat_id
  if (supabase) {
    try {
      await supabase
        .from('user_telegram_mapping')
        .upsert(
          { 
            user_id: telegramUserId, 
            chat_id: chatId, 
            username: msg.from.username,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );
      
      console.log(`💾 Сохранен chat_id ${chatId} для пользователя ${telegramUserId}`);
    } catch (err) {
      console.error('Error saving chat_id:', err);
    }
  }

  await sendMainMenuMessage(chatId);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
📖 **Помощь по использованию**

**Основные функции:**

🍼 **Кормление**
Отслеживайте грудное вскармливание и кормление из бутылочки

😴 **Сон**
Записывайте время сна с помощью таймера

🚶 **Прогулки**
Отмечайте время прогулок

🧷 **Подгузники**
Ведите учет смены подгузников

💊 **Лекарства**
Записывайте прием лекарств

🛁 **Купание**
Отмечайте время купания

📈 **Статистика**
Просматривайте тепловую карту активностей

🔔 **Уведомления**
• По времени (например, каждый день в 12:00)
• По интервалу (например, каждые 3 часа после кормления)

**Команды:**
/start - Открыть приложение
/help - Эта справка


Есть вопросы? Напишите нам!
  `.trim();

  bot.sendMessage(chatId, helpMessage, {
    parse_mode: 'Markdown',
    reply_markup: getStartInlineKeyboard()
  });
});

// ========================================
// КОМАНДА РЕГИСТРАЦИИ
// ========================================

bot.onText(/\/register/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId,
    'Создание аккаунта доступно в приложении.\n\n' +
    'Нажмите кнопку ниже:',
    { reply_markup: getStartInlineKeyboard() }
  );
});

bot.onText(/\/check_registration/, async (msg) => {
  const chatId = msg.chat.id;
  const { registered } = await isUserRegistered(msg.from.id);
  if (registered) {
    await bot.sendMessage(chatId, '✅ Аккаунт найден. Можно пользоваться ботом.', {
      reply_markup: getMainMenuKeyboard(),
    });
    await sendMainMenuMessage(chatId);
    return;
  }

  await bot.sendMessage(chatId,
    '⚠️ Аккаунт пока не найден.\n\n' +
    'Сначала создайте аккаунт в приложении, затем вернитесь в бот.',
    { reply_markup: getStartInlineKeyboard() }
  );
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'ℹ️ Регистрация через бота отключена.', {
    reply_markup: getStartInlineKeyboard(),
  });
});

bot.onText(/\/skip/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'ℹ️ Регистрация через бота отключена.', {
    reply_markup: getStartInlineKeyboard(),
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  const telegramUserId = query.from.id;

  if (query.data === 'show_features') {
    await bot.answerCallbackQuery(query.id);
    await sendFeaturesMessage(chatId);
    return;
  }

  if (query.data === 'start_registration') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      'Создание аккаунта доступно только в приложении.',
      { reply_markup: getStartInlineKeyboard() }
    );
    return;
  }

  if (query.data === 'check_registration') {
    await bot.answerCallbackQuery(query.id);

    const { registered } = await isUserRegistered(telegramUserId);
    if (registered) {
      await bot.sendMessage(chatId, '✅ Аккаунт найден. Продолжаем 👇', {
        reply_markup: getMainMenuKeyboard(),
      });
      await sendMainMenuMessage(chatId);
      return;
    }

    await bot.sendMessage(chatId,
      'Аккаунт пока не найден.\n' +
      'Откройте приложение и создайте аккаунт.', {
        reply_markup: getStartInlineKeyboard(),
      }
    );
    return;
  }

  const { registered } = await isUserRegistered(telegramUserId);

  if (!registered && query.data?.startsWith('qa:')) {
    await bot.answerCallbackQuery(query.id, {
      text: '⚠️ Сначала создайте аккаунт в приложении.',
      show_alert: true
    });

    await bot.sendMessage(chatId,
      'Чтобы продолжить, откройте приложение:', {
        reply_markup: getStartInlineKeyboard(),
      }
    );
    return;
  }

  // ДАЛЬШЕ ВАШ СУЩЕСТВУЮЩИЙ КОД

  if (query.data?.startsWith('qa:')) {
    await bot.answerCallbackQuery(query.id);
    const [, action, value] = query.data.split(':');

    if (action === 'cancel') {
      setSessionState(chatId, FSM_STATE.IDLE);
      return bot.sendMessage(chatId, 'Отменено.', { reply_markup: getMainMenuKeyboard() });
    }

    if (action === 'home') {
      setSessionState(chatId, FSM_STATE.IDLE);
      return sendMainMenuMessage(chatId);
    }

    if (action === 'list_active') {
      const context = await getContext(query);
      if (!(await ensureContextOrHelp(chatId, context))) return;
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      return showActiveTimersMenu(chatId, context);
    }

    if (['breastfeeding', 'bottle', 'sleep', 'diaper', 'medicine', 'bath'].includes(action)) {
      return handleQuickActivitySelect(query, action);
    }

    if (action === 'breast') {
      const context = await getContext(query);
      if (!(await ensureContextOrHelp(chatId, context))) return;

      const side = value;
      const started = await startTimer(context, 'breastfeeding', side);
      if (started.alreadyRunning) {
        return bot.sendMessage(chatId, 'Кормление уже идёт. Остановить текущее?', {
          reply_markup: {
            inline_keyboard: [[
              { text: '⏹ Остановить текущую', callback_data: `qa:stop:breastfeeding_${side}` },
              { text: 'Отмена', callback_data: 'qa:cancel' },
            ]],
          },
        });
      }

      setSessionState(chatId, FSM_STATE.IDLE, { context });
      return bot.sendMessage(chatId, `Кормление (${side === 'left' ? 'левая' : 'правая'} грудь) запущено.`, {
        reply_markup: getMainMenuKeyboard(),
      });
    }

    if (action === 'stop') {
      const context = await getContext(query);
      if (!(await ensureContextOrHelp(chatId, context))) return;
      await refreshActiveTimersFromWeb(context);
      const chatTimers = botActiveTimers.get(chatId) || new Map();
      const key = value?.startsWith('breastfeeding_')
        ? `breastfeeding:${value.split('_')[1]}`
        : value;
      const timer = chatTimers.get(key);
      if (!timer) {
        return bot.sendMessage(chatId, 'Таймер уже остановлен в веб-приложении.', { reply_markup: getMainMenuKeyboard() });
      }
      await stopTimer(context, timer);
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      return showQuickMenu(chatId, context);
    }

    return;
  }
  
  if (query.data === 'help') {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `
📖 **Быстрая помощь**

Используйте приложение для отслеживания активностей малыша.

Все функции доступны в приложении! 👇
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }
        ]]
      }
    });
  } else if (query.data === 'about') {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `
👶 **Трекер малыша v2.0**

Современное приложение для родителей с:
• Отслеживанием активностей
• Статистикой и графиками
• Умными напоминаниями (время + интервалы!)
• Облачным хранением данных

Сделано с ❤️
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }
        ]]
      }
    });
  }
});

bot.on('message', async (msg) => {
  // ДАЛЬШЕ ВАШ СУЩЕСТВУЮЩИЙ КОД bot.on('message')
  if (msg.text && msg.text.startsWith('/')) return;
  

  const session = getSession(chatId);
  const context = session.context || await getContext(msg);
  session.context = context;

  if (msg.text === MAIN_MENU_BUTTON) {
    if (!(await ensureContextOrHelp(chatId, context))) return;
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return showQuickMenu(chatId, context);
  }

  if (msg.text === ACTIVE_TIMERS_BUTTON) {
    if (!(await ensureContextOrHelp(chatId, context))) return;
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return showActiveTimersMenu(chatId, context);
  }

  if (msg.text === HOME_MENU_BUTTON) {
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return sendMainMenuMessage(chatId);
  }

  try {
    if (session.state === FSM_STATE.WAIT_BOTTLE_AMOUNT) {
      const amount = Number(msg.text?.trim());
      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(chatId, 'Введите объём числом, например 90.');
      }
      await createActivityRow(context.babyId, {
        type: 'bottle',
        amount,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `Бутылочка сохранена: ${amount} мл.`, { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }

    if (session.state === FSM_STATE.WAIT_DIAPER_TYPE) {
      const normalized = String(msg.text || '').toLowerCase();
      const diaperType = normalized.includes('гр') ? 'dirty' : normalized.includes('мок') ? 'wet' : null;
      if (!diaperType) {
        return bot.sendMessage(chatId, 'Выберите: Мокрый или Грязный.');
      }
      await createActivityRow(context.babyId, {
        type: 'diaper',
        diaper_type: diaperType,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, 'Подгузник сохранён.', { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }

    if (session.state === FSM_STATE.WAIT_MEDICINE_NAME) {
      const name = String(msg.text || '').trim();
      if (!name) {
        return bot.sendMessage(chatId, 'Введите название лекарства.');
      }
      await createActivityRow(context.babyId, {
        type: 'medicine',
        medicine_name: name,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `Лекарство «${name}» сохранено.`, { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }
  } catch (error) {
    console.error('Ошибка сохранения активности через FSM:', error);
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return bot.sendMessage(chatId, 'Не получилось сохранить. Повторите ещё раз.', { reply_markup: getMainMenuKeyboard() });
  }

  return bot.sendMessage(chatId, 'Нажмите «➕ Добавить активность».', {
    reply_markup: getMainMenuKeyboard(),
  });
});

// ========================================
// ФУНКЦИЯ ЗАВЕРШЕНИЯ РЕГИСТРАЦИИ
// ========================================

async function completeRegistration(chatId, telegramUserId, state) {
  if (!supabase) {
    await bot.sendMessage(chatId, '❌ Supabase не настроен. Регистрация невозможна.');
    registrationStates.delete(telegramUserId);
    return;
  }

  try {
    await bot.sendMessage(chatId, '⏳ Создаём ваш аккаунт...');

    const { email, password, fullName = '', username } = state;

    console.log('📱 Регистрация:', { email });

    // Создаём пользователя через Supabase Auth (service key!)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        auth_method: 'email',
      }
    });

    if (authError) {
      console.error('Auth error:', authError);
      
      if (authError.message.includes('already registered')) {
        await bot.sendMessage(chatId, 
          '❌ Этот email уже зарегистрирован.\n\n' +
          'Используйте приложение для входа.'
        );
      } else {
        await bot.sendMessage(chatId, '❌ Ошибка регистрации: ' + authError.message);
      }
      
      registrationStates.delete(telegramUserId);
      return;
    }

    const authUserId = authData.user.id;

    // Создаём профиль в user_profiles
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: authUserId,
        full_name: fullName,
      });

    if (profileError) {
      console.error('Profile error:', profileError);
    }

    // Связываем Telegram аккаунт
    const { error: mappingError } = await supabase
      .from('user_telegram_mapping')
      .upsert(
        {
          user_id: telegramUserId,
          chat_id: chatId,
          username: username,
          auth_user_id: authUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (mappingError) {
      console.error('Mapping error:', mappingError);
    }

    registrationStates.delete(telegramUserId);

    await bot.sendMessage(chatId,
      '✅ Регистрация завершена!\n\n' +
      '📱 Теперь откройте приложение и добавьте профиль малыша:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }]
          ]
        }
      }
    );

  } catch (error) {
    console.error('Registration error:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    registrationStates.delete(telegramUserId);
  }
}


async function completeLinkExistingAccount(chatId, telegramUserId, state) {
  if (!supabase || !supabaseAuth) {
    await bot.sendMessage(chatId, '❌ Интеграция с базой не настроена. Попробуйте позже.');
    registrationStates.delete(telegramUserId);
    return;
  }

  try {
    await bot.sendMessage(chatId, '⏳ Проверяю данные аккаунта...');

    const { email, password, username } = state;

    const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData?.user?.id) {
      await bot.sendMessage(chatId,
        '❌ Не удалось войти. Проверьте email/пароль и попробуйте снова через /check_registration.'
      );
      registrationStates.delete(telegramUserId);
      return;
    }

    const authUserId = signInData.user.id;

    const { error: mappingError } = await supabase
      .from('user_telegram_mapping')
      .upsert(
        {
          user_id: telegramUserId,
          chat_id: chatId,
          username,
          auth_user_id: authUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (mappingError) {
      console.error('Mapping error:', mappingError);
      await bot.sendMessage(chatId, '❌ Не удалось привязать Telegram к аккаунту. Попробуйте позже.');
      registrationStates.delete(telegramUserId);
      return;
    }

    await supabaseAuth.auth.signOut();
    registrationStates.delete(telegramUserId);

    await bot.sendMessage(chatId,
      '✅ Готово! Ваш Telegram привязан к существующему аккаунту.\n\nТеперь в боте доступно дальнейшее меню.',
      { reply_markup: getMainMenuKeyboard() }
    );

    await sendMainMenuMessage(chatId);
  } catch (error) {
    console.error('Link existing account error:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка привязки. Попробуйте позже.');
    registrationStates.delete(telegramUserId);
  }
}

// ============================================
// Health Check
// ============================================

const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      bot: 'Baby Tracker Bot',
      message: 'Bot with interval notifications support',
      active_locks: processingLocks.size
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server on port ${PORT}`);
});

// ============================================
// Обработка ошибок
// ============================================

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Остановка бота...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Остановка бота...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
