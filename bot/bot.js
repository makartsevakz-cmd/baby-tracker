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

async function tryAcquireLock(notificationId, scheduledMinute, userId) {
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
        user_id: userId,
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
      .select('user_id')
      .eq('chat_id', telegramUserId)
      .single();

    if (error || !data?.user_id) {
      return { registered: false, authUserId: null };
    }

    return { registered: true, authUserId: data.user_id };
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
      [{ text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }],
      [{ text: '🔄 Проверить статус', callback_data: 'check_registration' }],
      [{ text: 'ℹ️ Подробнее', callback_data: 'show_features' }],
    ],
  };
}

function getRegistrationInlineKeyboard() {
  return getStartInlineKeyboard();
}


function getStatusRetryInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }],
      [{ text: '🔄 Проверить статус', callback_data: 'check_registration' }],
    ],
  };
}

async function sendFeaturesMessage(chatId) {
  return bot.sendMessage(chatId, BOT_TEXTS.details, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: 'back_to_start' }],
      ],
    },
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


async function sendRegistrationStatus(chatId, telegramUserId) {
  const { registered } = await isUserRegistered(telegramUserId);

  if (registered) {
    await bot.sendMessage(chatId, BOT_TEXTS.registrationSuccess, {
      reply_markup: getMainMenuKeyboard(),
    });
    await sendBotInstruction(chatId);
    return true;
  }

  await bot.sendMessage(chatId, BOT_TEXTS.registrationMissing, { reply_markup: getStatusRetryInlineKeyboard() });
  return false;
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
    const acquired = await tryAcquireLock(notification.id, scheduledMinute, notification.user_id);
    
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
    } else {
      console.log(`📬 Найдено ${notifications.length} активных уведомлений`);
    }
    
    // Группируем по типу для статистики
    const byType = (notifications || []).reduce((acc, n) => {
      acc[n.notification_type] = (acc[n.notification_type] || 0) + 1;
      return acc;
    }, {});
    console.log(`📊 Типы уведомлений:`, byType);
    
    // Обрабатываем уведомления ПОСЛЕДОВАТЕЛЬНО
    for (const notification of (notifications || [])) {
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

    await checkWellbeingRoutines(now, currentMinute);
    
  } catch (error) {
    console.error('Error in checkAndSendNotifications:', error);
  } finally {
    isChecking = false;
  }
}

async function resolveChatId(userId) {
  if (!supabase) return null;

  // 1) Основной сценарий: user_id (auth.users.id) -> chat_id
  const { data: directMapping } = await supabase
    .from('user_telegram_mapping')
    .select('chat_id')
    .eq('user_id', userId)
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

  // 3) Резервный сценарий: chat_id совпадает с telegram user id в личных чатах
  const { data: legacyMapping } = await supabase
    .from('user_telegram_mapping')
    .select('chat_id')
    .eq('chat_id', telegramId)
    .maybeSingle();

  if (legacyMapping?.chat_id) {
    return legacyMapping.chat_id;
  }

  // 4) Для личных чатов Telegram chat_id == telegram user id
  return telegramId;
}

async function ensureMomMoodTable() {
  if (!supabase) return;
  try {
    await supabase.rpc('exec_sql', {
      sql: `
      create table if not exists mom_mood_logs (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users(id) on delete cascade,
        date date not null,
        mood text not null,
        created_at timestamptz not null default now(),
        unique(user_id, date)
      );
      `,
    });
  } catch (error) {
    // В большинстве проектов RPC для SQL отключен, поэтому просто продолжаем.
  }
}

async function saveMomMood(userId, mood) {
  if (!supabase || !userId || !mood) return;
  const date = new Date().toISOString().slice(0, 10);
  await supabase
    .from('mom_mood_logs')
    .upsert({ user_id: userId, date, mood, created_at: new Date().toISOString() }, { onConflict: 'user_id,date' });
}

async function getDailyEngagementScore(babyId, now) {
  if (!babyId) return null;
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const end = now.toISOString();

  const { data, error } = await supabase
    .from('activities')
    .select('start_time,end_time')
    .eq('baby_id', babyId)
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: true });

  if (error || !data?.length) return 0;

  let totalMs = 0;
  let hasGapOver4h = false;
  let prev = null;

  for (const row of data) {
    const rowStart = new Date(row.start_time);
    const rowEnd = new Date(row.end_time || row.start_time);
    totalMs += Math.max(0, rowEnd - rowStart);
    if (prev && rowStart - prev > 4 * 60 * 60 * 1000) {
      hasGapOver4h = true;
    }
    prev = rowStart;
  }

  const score = Math.max(0, Math.min(100, (totalMs / (24 * 60 * 60 * 1000)) * 100));
  return hasGapOver4h ? Math.min(score, 39) : score;
}

function engagementLabel(score) {
  if (score >= 80) return 'активное использование';
  if (score >= 40) return 'частичное использование';
  return 'почти не использовалось';
}

async function sendDailyMoodCheckin(now) {
  const { data: mappings } = await supabase.from('user_telegram_mapping').select('chat_id,user_id');
  for (const row of mappings || []) {
    const localKey = `${row.chat_id}:${now.toISOString().slice(0, 10)}`;
    if (moodPromptState.get(row.chat_id) === localKey) continue;
    await bot.sendMessage(row.chat_id, `💛 Как ты сегодня себя чувствуешь?\nВажно заботиться не только о малыше, но и о себе 🌷`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '😊 Спокойно', callback_data: 'mood:calm' }],
          [{ text: '😌 Нормально', callback_data: 'mood:normal' }],
          [{ text: '😴 Устала', callback_data: 'mood:tired' }],
          [{ text: '😔 Тревожно', callback_data: 'mood:anxious' }],
          [{ text: '😭 Очень тяжело', callback_data: 'mood:hard' }],
        ],
      },
    });
    moodPromptState.set(row.chat_id, localKey);
  }
}

async function sendWeeklyReport(now) {
  const { data: mappings } = await supabase.from('user_telegram_mapping').select('chat_id,user_id');
  for (const row of mappings || []) {
    const { data: baby } = await supabase.from('babies').select('id,weight,height').eq('user_id', row.user_id).maybeSingle();
    const { data: moods } = await supabase
      .from('mom_mood_logs')
      .select('mood')
      .eq('user_id', row.user_id)
      .gte('date', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

    const counts = (moods || []).reduce((acc, m) => ({ ...acc, [m.mood]: (acc[m.mood] || 0) + 1 }), {});
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const moodText = dominant
      ? `По вашим отметкам чаще всего было состояние: ${moodLabels[dominant] || dominant}. Помните, вы не обязаны быть идеальной — вы уже делаете очень много.`
      : 'За эту неделю мало отметок настроения, но это нормально. Можно начать с одного короткого чек-ина в день.';

    const score = await getDailyEngagementScore(baby?.id, now);
    const engagementText = typeof score === 'number'
      ? `Использование приложения: ${engagementLabel(score)} (${Math.round(score)}%). Даже короткие записи помогают видеть общую картину.`
      : 'По использованию пока мало данных, но вы можете продолжать в комфортном темпе.';

    const growthText = baby?.weight || baby?.height
      ? `Данные малыша: ${baby?.weight ? `вес ${baby.weight}` : 'вес пока не указан'}, ${baby?.height ? `рост ${baby.height}` : 'рост пока не указан'}.`
      : 'По росту и весу пока мало данных. Как только добавите измерения, я помогу видеть динамику.';

    await bot.sendMessage(row.chat_id, `🌿 Итоги недели. Ты проделала большую работу 💛

1) Настроение мамы:
${moodText}

2) Использование приложения:
${engagementText}

3) Достижения малыша:
${growthText}
Регулярность сна, кормлений и подгузников становится заметнее, когда записей чуть больше.

Ты делаешь всё возможное и даже больше 💛 Я рядом 🌷`);
  }
}

async function checkWellbeingRoutines(now, currentMinute) {
  const hhmm = now.toTimeString().slice(0,5);
  const day = now.getDay();
  if (hhmm !== '19:00') return;

  await ensureMomMoodTable();

  if (day === 0) {
    await sendWeeklyReport(now);
  }

  await sendDailyMoodCheckin(now);
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
const OPEN_APP_BUTTON = '📱 Открыть приложение';
const BOT_INSTRUCTION_BUTTON = '📖 Инструкция по боту';
const APP_REVIEW_BUTTON = '📱 Открыть приложение';
const FEEDBACK_BUTTON = '💌 Оставить обратную связь';

const BOT_TEXTS = {
  startUnregistered: `👋 Добро пожаловать в «Дневник малыша».

Я помогу бережно отслеживать режим малыша, а вам — чувствовать больше спокойствия и опоры каждый день 💛

Что сделать дальше:
1) Откройте приложение
2) Добавьте имя и дату рождения малыша
3) Вернитесь в Telegram и нажмите «Проверить статус»`,
  details: `🌿 Как это помогает каждый день:
• легче держать интервалы кормлений
• понятнее становится режим сна
• умные уведомления подсказывают вовремя
• удобно фиксировать рост и вес
• видеть статистику и сравнение с другими детьми
• меньше тревоги, больше уверенности у мамы

Роли разделены так:
Telegram — быстрые команды, таймеры, напоминания.
Приложение — статистика, история, настройки и профиль малыша.

🎥 В приложении есть видео-обзор, чтобы быстро разобраться в возможностях.`,
  registrationMissing: `Пока профиль малыша не найден 🌷

Сделайте три шага:
1) Откройте приложение
2) Заполните имя и дату рождения малыша
3) Вернитесь сюда и снова нажмите «Проверить статус»`,
  registrationSuccess: `🎉 Отлично, всё готово!

Профиль малыша успешно подключён.
Теперь в боте можно быстро добавлять активности, запускать и останавливать таймеры, а также получать напоминания 💛`,
  instruction: `📖 Инструкция по боту

➕ Добавить активность
Выберите нужную активность и сразу сохраните запись или запустите таймер.

⏱ Запущенные активности
Здесь видно таймеры, которые идут прямо сейчас, и их можно остановить.

🏠 Главное меню
Открывает полезные разделы: инструкцию, обзор приложения и обратную связь.

📱 Открыть приложение
Переход к полной истории, статистике, профилю малыша и настройкам.

🔔 Уведомления
Работают по времени и по интервалу между активностями.

⚠️ Про таймеры:
• Таймеры в Telegram и в приложении НЕЗАВИСИМЫ
• Таймер, запущенный в Telegram, виден только в боте
• Таймер, запущенный в приложении, виден только в приложении
• После остановки таймера запись сохраняется в приложении
• В приложении сохранённую активность можно отредактировать или удалить`,
  homeMenu: `🌸 Главное меню

Использую наше приложение, вы сможете легче выстроить спокойный ритм дня и не держать всё в голове 💛

В нашем приложение можно быстро отмечать кормления, сон, подгузники, лекарства, купание и даже свои события — всё в удобном формате, чтобы видеть полную картину развития малыша.

Обрати внимание: регулярные записи помогают замечать закономерности и принимать решения увереннее, особенно в насыщенные дни.

Используй меню под полем ввода сообщения — там есть быстрые кнопки для добавления активности, просмотра запущенных таймеров и перехода в главное меню.

Если у тебя возникли проблемы обратись к нам в поддержку — мы рядом и всегда поможем 🌷

Ты большая молодец. Я рядом 💛`,
};
const QUICK_ACTIVITIES = {
  breastfeeding: '🤱 Кормление грудью',
  bottle: '🍼 Бутылочка',
  sleep: '😴 Сон',
  diaper: '👶 Подгузник',
  medicine: '💊 Лекарство',
  bath: '🛁 Купание',
  custom: '✨ Свое событие',
};

const FSM_STATE = {
  IDLE: 'idle',
  WAIT_BREAST_SIDE: 'wait_breast_side',
  WAIT_BOTTLE_AMOUNT: 'wait_bottle_amount',
  WAIT_DIAPER_TYPE: 'wait_diaper_type',
  WAIT_MEDICINE_NAME: 'wait_medicine_name',
  WAIT_CUSTOM_EVENT_NAME: 'wait_custom_event_name',
  WAIT_CUSTOM_EVENT_COMMENT: 'wait_custom_event_comment',
  WAIT_STOP_CONFIRM: 'wait_stop_confirm',
};

const userSessions = new Map();
const botActiveTimers = new Map();
const trackedChats = new Set();
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null;
const moodPromptState = new Map();
const moodLabels = { calm: '😊 Спокойно', normal: '😌 Нормально', tired: '😴 Устала', anxious: '😔 Тревожно', hard: '😭 Очень тяжело' };
const feedbackState = new Set();
const firstActivityCache = new Set();


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
      [{ text: QUICK_ACTIVITIES.custom, callback_data: 'qa:custom' }],
    ],
  };
}

function getHomeMenuInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ Добавить активность', callback_data: 'qa:add_activity' }],
      [{ text: '⏱ Запущенные активности', callback_data: 'qa:list_active' }],
      [{ text: BOT_INSTRUCTION_BUTTON, callback_data: 'home:instruction' }],
      [{ text: APP_REVIEW_BUTTON, callback_data: 'home:review' }],
      [{ text: FEEDBACK_BUTTON, callback_data: 'home:feedback' }],
    ],
  };
}

async function sendMainMenuMessage(chatId) {
  await bot.sendMessage(chatId, BOT_TEXTS.homeMenu, {
    reply_markup: getMainMenuKeyboard(),
  });
  return bot.sendMessage(chatId, 'Выберите нужный раздел 👇', {
    reply_markup: getHomeMenuInlineKeyboard(),
  });
}

async function sendBotInstruction(chatId) {
  return bot.sendMessage(chatId, BOT_TEXTS.instruction, {
    reply_markup: getMainMenuKeyboard(),
  });
}

async function hasAnyActivity(babyId) {
  const { count, error } = await supabase
    .from('activities')
    .select('id', { head: true, count: 'exact' })
    .eq('baby_id', babyId);
  if (error) {
    console.error('Ошибка проверки первой активности:', error);
    return false;
  }
  return (count || 0) > 0;
}

async function getFirstActivityState(context) {
  if (!context?.babyId) return false;
  if (firstActivityCache.has(context.babyId)) return false;

  const exists = await hasAnyActivity(context.babyId);
  if (exists) {
    firstActivityCache.add(context.babyId);
    return false;
  }

  // Резервируем «первую активность» сразу, чтобы при параллельных действиях
  // поздравление не отправлялось несколько раз.
  firstActivityCache.add(context.babyId);
  return true;
}

function getTimerReminderText(type) {
  if (type === 'sleep') {
    return '😴 Таймер сна запущен. Когда малыш проснётся, остановите таймер именно в Telegram, чтобы запись сохранилась корректно.';
  }
  return '🤱 Таймер кормления запущен. Когда закончите, остановите таймер именно в Telegram, чтобы всё сохранилось корректно.';
}

function timerKey(timer) {
  return timer.type === 'breastfeeding' ? `breastfeeding:${timer.side || 'unknown'}` : timer.type;
}

function toDurationSec(startIso, endIso = new Date().toISOString()) {
  return Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 1000));
}

function formatTimersForMenu(timers) {
  if (!timers.length) return 'Сейчас запущенных таймеров нет.';
  const lines = timers.map((timer) => {
    const sec = toDurationSec(timer.start_time || timer.startTime);
    const min = Math.max(1, Math.floor(sec / 60));
    if (timer.type === 'breastfeeding') {
      const side = timer.side === 'left' ? 'левая' : 'правая';
      return `🤱 ${side === 'левая' ? 'Левая грудь' : 'Правая грудь'} — ${min} мин`;
    }
    if (timer.type === 'sleep') return `😴 Сон — ${min} мин`;
    return `⏱ ${timer.type} — ${min} мин`;
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
    .select('user_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (mapping?.user_id && isUuid(mapping.user_id)) {
    return mapping.user_id;
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
          user_id: user.id,
          chat_id: chatId,
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
  await bot.sendMessage(chatId, `Выберите активность 👇\n\n${formatTimersForMenu(timers)}`, {
    reply_markup: quickActivitiesKeyboard(),
  });
}

async function showActiveTimersMenu(chatId, context) {
  const timers = await refreshActiveTimersFromWeb(context);

  if (!timers.length) {
    return bot.sendMessage(chatId, 'Сейчас нет запущенных активностей. Вы можете запустить новую через «➕ Добавить активность».', {
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
      reply_markup: { inline_keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }]] },
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
    return bot.sendMessage(chatId, 'Выберите сторону для кормления 👇', {
      reply_markup: {
        inline_keyboard: [[
          { text: '⬅️ Левая', callback_data: 'qa:breast:left' },
          { text: '➡️ Правая', callback_data: 'qa:breast:right' },
        ]],
      },
    });
  }

  if (activity === 'sleep') {
    const isFirst = await getFirstActivityState(context);
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
    return bot.sendMessage(chatId, `${getTimerReminderText('sleep')}\n\n${isFirst ? '🎉 Поздравляю с первой активностью! Все запущенные таймеры вы всегда увидите в разделе «⏱ Запущенные активности».': ''}`.trim(), { reply_markup: getMainMenuKeyboard() });
  }

  if (activity === 'bottle') {
    setSessionState(chatId, FSM_STATE.WAIT_BOTTLE_AMOUNT, { context });
    return bot.sendMessage(chatId, 'Введите объём бутылочки в мл (например, 120):');
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

  if (activity === 'custom') {
    setSessionState(chatId, FSM_STATE.WAIT_CUSTOM_EVENT_NAME, { context });
    return bot.sendMessage(chatId, `✨ Давайте добавим своё событие.

Шаг 1/2: введите название события (например, «Массаж» или «Игры на коврике»).`);
  }

  if (activity === 'bath') {
    const isFirst = await getFirstActivityState(context);
    await createActivityRow(context.babyId, {
      type: 'bath',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      comment: 'quick_add:telegram',
    });
    setSessionState(chatId, FSM_STATE.IDLE, { context });
    return bot.sendMessage(chatId, `${isFirst ? '🎉 Поздравляю с первой активностью! Историю и статистику можно посмотреть в приложении.\n\n' : ''}Купание успешно добавлено 💛`, { reply_markup: getMainMenuKeyboard() });
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
      BOT_TEXTS.startUnregistered,
      { reply_markup: getStartInlineKeyboard() }
    );
    return;
  }

  // Обновляем chat_id для уже привязанных Telegram аккаунтов
  if (supabase) {
    try {
      await supabase
        .from('user_telegram_mapping')
        .update({
          chat_id: chatId,
          username: msg.from.username,
          updated_at: new Date().toISOString(),
        })
        .eq('chat_id', telegramUserId);
      
      console.log(`💾 Сохранен chat_id ${chatId} для пользователя ${telegramUserId}`);
    } catch (err) {
      console.error('Error saving chat_id:', err);
    }
  }

  const { registered } = await isUserRegistered(telegramUserId);

  if (!registered) {
    await bot.sendMessage(chatId,
      BOT_TEXTS.startUnregistered,
      { reply_markup: getStartInlineKeyboard() }
    );
    return;
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
  await sendRegistrationStatus(chatId, msg.from.id);
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

  if (query.data === 'back_to_start') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, BOT_TEXTS.startUnregistered, { reply_markup: getStartInlineKeyboard() });
    return;
  }

  if (query.data === 'check_registration') {
    await bot.answerCallbackQuery(query.id);
    await sendRegistrationStatus(chatId, telegramUserId);
    return;
  }

  if (query.data?.startsWith('home:')) {
    await bot.answerCallbackQuery(query.id);
    const action = query.data.split(':')[1];

    if (action === 'instruction') {
      await sendBotInstruction(chatId);
      return;
    }

    if (action === 'review') {
      await bot.sendMessage(chatId, '📱 Открою приложение — там доступен обзор, полная история, статистика и все настройки малыша.', {
        reply_markup: { inline_keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }]] },
      });
      return;
    }

    if (action === 'feedback') {
      feedbackState.add(chatId);
      await bot.sendMessage(chatId, '💌 Введите текстом своё предложение. Я обязательно передам его команде.', {
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }
  }

  if (query.data?.startsWith('mood:')) {
    await bot.answerCallbackQuery(query.id);
    const mood = query.data.split(':')[1];
    const context = await getContext(query);
    if (!context?.appUserId) {
      await bot.sendMessage(chatId, 'Спасибо за ответ 💛 Чтобы сохранять чек-ин, сначала подключите профиль через приложение.', {
        reply_markup: getStartInlineKeyboard(),
      });
      return;
    }
    await saveMomMood(context.appUserId, mood);
    moodPromptState.set(chatId, `${chatId}:${new Date().toISOString().slice(0, 10)}`);
    await bot.sendMessage(chatId, 'Спасибо, что поделились состоянием. Вы очень важны 💛');
    return;
  }

  const { registered } = await isUserRegistered(telegramUserId);

  if (!registered && query.data?.startsWith('qa:')) {
    await bot.answerCallbackQuery(query.id, {
      text: '⚠️ Сначала создайте аккаунт в приложении.',
      show_alert: true,
    });

    await bot.sendMessage(chatId, 'Чтобы продолжить, откройте приложение:', {
      reply_markup: getStartInlineKeyboard(),
    });
    return;
  }

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

    if (action === 'add_activity') {
      const context = await getContext(query);
      if (!(await ensureContextOrHelp(chatId, context))) return;
      setSessionState(chatId, FSM_STATE.IDLE, { context });
      return showQuickMenu(chatId, context);
    }

    if (['breastfeeding', 'bottle', 'sleep', 'diaper', 'medicine', 'bath', 'custom'].includes(action)) {
      return handleQuickActivitySelect(query, action);
    }

    if (action === 'breast') {
      const context = await getContext(query);
      if (!(await ensureContextOrHelp(chatId, context))) return;

      const side = value;
      const isFirst = await getFirstActivityState(context);
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
        return bot.sendMessage(chatId, `${getTimerReminderText('breastfeeding')}

${isFirst ? '🎉 Поздравляю с первой активностью! Все запущенные таймеры видны в разделе «⏱ Запущенные активности».': `Запустила: ${side === 'left' ? 'левая' : 'правая'} грудь.`}`.trim(), {
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
  }
});

bot.on('message', async (msg) => {
  // ДАЛЬШЕ ВАШ СУЩЕСТВУЮЩИЙ КОД bot.on('message')
  if (msg.text && msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;

  if (msg.text === '✅ Проверить аккаунт' || msg.text === '🔄 Обновить статус' || msg.text === '🔄 Проверить статус') {
    await sendRegistrationStatus(chatId, telegramUserId);
    return;
  }


  if (feedbackState.has(chatId) && msg.text) {
    feedbackState.delete(chatId);
    if (ADMIN_CHAT_ID) {
      await bot.sendMessage(ADMIN_CHAT_ID, `💌 Новая обратная связь от @${msg.from.username || 'без username'} (chat_id: ${chatId}):

${msg.text}`);
    }
    await bot.sendMessage(chatId, 'Спасибо, передали 💛', { reply_markup: getMainMenuKeyboard() });
    return;
  }

  const { registered } = await isUserRegistered(telegramUserId);
  if (!registered) {
    await bot.sendMessage(chatId,
      BOT_TEXTS.registrationMissing,
      { reply_markup: getStatusRetryInlineKeyboard() }
    );
    return;
  }

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
      const isFirst = await getFirstActivityState(context);
      await createActivityRow(context.babyId, {
        type: 'bottle',
        amount,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
        setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `${isFirst ? '🎉 Поздравляю с первой активностью! Историю и статистику можно посмотреть в приложении.\n\n' : ''}Бутылочка успешно добавлена 💛`, { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }

    if (session.state === FSM_STATE.WAIT_DIAPER_TYPE) {
      const normalized = String(msg.text || '').toLowerCase();
      const diaperType = normalized.includes('гр') ? 'dirty' : normalized.includes('мок') ? 'wet' : null;
      if (!diaperType) {
        return bot.sendMessage(chatId, 'Выберите: Мокрый или Грязный.');
      }
      const isFirst = await getFirstActivityState(context);
      await createActivityRow(context.babyId, {
        type: 'diaper',
        diaper_type: diaperType,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
        setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `${isFirst ? '🎉 Поздравляю с первой активностью! Историю и статистику можно посмотреть в приложении.\n\n' : ''}Подгузник успешно добавлен 💛`, { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }

    if (session.state === FSM_STATE.WAIT_MEDICINE_NAME) {
      const name = String(msg.text || '').trim();
      if (!name) {
        return bot.sendMessage(chatId, 'Введите название лекарства.');
      }
      const isFirst = await getFirstActivityState(context);
      await createActivityRow(context.babyId, {
        type: 'medicine',
        medicine_name: name,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: 'quick_add:telegram',
      });
        setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `${isFirst ? '🎉 Поздравляю с первой активностью! Историю и статистику можно посмотреть в приложении.\n\n' : ''}Лекарство успешно добавлено 💛`, { reply_markup: getMainMenuKeyboard() });
      return showQuickMenu(chatId, context);
    }

    if (session.state === FSM_STATE.WAIT_CUSTOM_EVENT_NAME) {
      const eventName = String(msg.text || '').trim();
      if (!eventName) {
        return bot.sendMessage(chatId, 'Введите название события, чтобы продолжить.');
      }
      setSessionState(chatId, FSM_STATE.WAIT_CUSTOM_EVENT_COMMENT, { context, customEventName: eventName });
      return bot.sendMessage(chatId, 'Шаг 2/2: добавьте комментарий к событию (что произошло, детали, настроение и т.д.).');
    }

    if (session.state === FSM_STATE.WAIT_CUSTOM_EVENT_COMMENT) {
      const comment = String(msg.text || '').trim();
      if (!comment) {
        return bot.sendMessage(chatId, 'Добавьте комментарий, чтобы событие сохранилось полностью.');
      }
      const customEventName = String(session.draft?.customEventName || '').trim();
      if (!customEventName) {
        setSessionState(chatId, FSM_STATE.IDLE, { context });
        return bot.sendMessage(chatId, 'Не удалось восстановить название события. Давайте начнём заново через «➕ Добавить активность».', {
          reply_markup: getMainMenuKeyboard(),
        });
      }

      const isFirst = await getFirstActivityState(context);
      await createActivityRow(context.babyId, {
        type: 'custom',
        custom_type: customEventName,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        comment: `quick_add:telegram\n${comment}`,
      });

      setSessionState(chatId, FSM_STATE.IDLE, { context });
      await bot.sendMessage(chatId, `${isFirst ? '🎉 Поздравляю с первой активностью! Историю и статистику можно посмотреть в приложении.\n\n' : ''}Своё событие «${customEventName}» успешно добавлено 💛`, {
        reply_markup: getMainMenuKeyboard(),
      });
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
          user_id: authUserId,
          chat_id: chatId,
          username: username,
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
          user_id: authUserId,
          chat_id: chatId,
          username,
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
