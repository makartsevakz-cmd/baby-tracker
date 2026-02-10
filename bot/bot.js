// bot.js - ИСПРАВЛЕННАЯ версия с поддержкой интервальных уведомлений
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app-url.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Инициализация
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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
    
    // ИСПРАВЛЕНО: используем activity_type вместо type
    const { data: lastActivity, error: activityError } = await supabase
      .from('activities')
      .select('*')
      .eq('baby_id', baby.id)
      .eq('activity_type', notification.activity_type)
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

    const lastTime = new Date(lastActivity.end_time || lastActivity.start_time);
    const diffMinutes = (now - lastTime) / (1000 * 60);

    console.log(`📊 Интервал для ${notification.activity_type}: прошло ${diffMinutes.toFixed(1)} мин из ${intervalMinutes} мин`);

    // Отправляем когда интервал пройден
    const shouldSend = diffMinutes >= intervalMinutes;
    const intervalWindow = shouldSend ? Math.floor(diffMinutes / intervalMinutes) : null;

    return { shouldSend, intervalWindow, diffMinutes: diffMinutes.toFixed(1) };
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
            
            const intervalKey = `${currentMinute}-window-${result.intervalWindow}`;
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

  // 1) Прямое соответствие auth user id -> chat_id
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
// Обработчики команд бота
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'друг';
  const telegramUserId = msg.from.id;

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

  const welcomeMessage = `
👶 Привет, ${firstName}!

Добро пожаловать в **Трекер малыша** — удобное приложение для отслеживания активностей вашего ребенка.

📊 С помощью этого бота вы сможете:
• Отслеживать кормление, сон и прогулки
• Вести учет смены подгузников
• Записывать прием лекарств и купания
• Следить за ростом и весом малыша
• Получать напоминания (время + интервалы!)
• Просматривать статистику и историю

Нажмите кнопку ниже, чтобы открыть приложение! 👇
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🚀 Открыть приложение',
          web_app: { url: WEB_APP_URL }
        }
      ],
      [
        {
          text: '❓ Помощь',
          callback_data: 'help'
        },
        {
          text: '📖 О приложении',
          callback_data: 'about'
        }
      ]
    ]
  };

  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
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
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }
      ]]
    }
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  
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

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Все функции доступны в приложении! 👇', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }
      ]]
    }
  });
});

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