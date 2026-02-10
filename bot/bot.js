// bot.js - ФИНАЛЬНАЯ версия с атомарной блокировкой
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

// Глобальная блокировка на уровне процесса
const processingLocks = new Set();

/**
 * Генерирует уникальный ключ для блокировки
 */
function generateLockKey(notificationId, scheduledMinute) {
  return `${notificationId}_${scheduledMinute}`;
}

/**
 * АТОМАРНАЯ попытка заблокировать отправку уведомления
 * Использует INSERT с уникальным индексом в БД
 */
async function tryAcquireLock(notificationId, scheduledMinute) {
  const lockKey = generateLockKey(notificationId, scheduledMinute);
  
  // 1. Проверка in-memory блокировки (мгновенно)
  if (processingLocks.has(lockKey)) {
    console.log(`🔒 Process lock exists: ${lockKey}`);
    return false;
  }
  
  // 2. Устанавливаем локальную блокировку
  processingLocks.add(lockKey);
  
  // 3. Пытаемся вставить запись в БД (атомарная операция)
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
      // Ошибка уникальности = уже отправлено другим процессом
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

/**
 * Освобождает блокировку
 */
function releaseLock(notificationId, scheduledMinute) {
  const lockKey = generateLockKey(notificationId, scheduledMinute);
  processingLocks.delete(lockKey);
  
  // Автоочистка из кеша через 2 минуты
  setTimeout(() => {
    processingLocks.delete(lockKey);
  }, 120000);
}

/**
 * Отправляет уведомление с атомарной защитой
 */
async function sendNotificationSafe(chatId, notification, scheduledMinute) {
  const lockKey = generateLockKey(notification.id, scheduledMinute);
  
  try {
    // Пытаемся получить блокировку
    const acquired = await tryAcquireLock(notification.id, scheduledMinute);
    
    if (!acquired) {
      console.log(`⏭️ Уведомление ${notification.id} уже отправляется/отправлено`);
      return false;
    }
    
    // Отправляем сообщение
    const activityLabel = getActivityLabel(notification.activity_type);
    const message = `
🔔 Напоминание: ${notification.title || 'Уведомление'}

${activityLabel}
${notification.comment ? `\n💬 ${notification.comment}` : ''}
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
    
    // Освобождаем блокировку
    releaseLock(notification.id, scheduledMinute);
    
    return true;
    
  } catch (error) {
    console.error(`Error sending notification ${notification.id}:`, error);
    releaseLock(notification.id, scheduledMinute);
    return false;
  }
}

/**
 * Получает название активности по типу
 */
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

/**
 * Проверяет и отправляет уведомления
 */
let lastCheckedMinute = null;
let isChecking = false; // Флаг выполнения проверки

async function checkAndSendNotifications() {
  // Защита от параллельного выполнения
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
    
    // Проверка: уже проверяли эту минуту?
    if (lastCheckedMinute === currentMinute) {
      return;
    }
    
    lastCheckedMinute = currentMinute;
    
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const currentDay = now.getDay(); // 0-6
    
    console.log(`🔍 Проверка уведомлений: ${currentTime}, день ${currentDay}`);
    
    // Получаем активные уведомления
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('enabled', true)
      .eq('notification_type', 'time_based');
    
    if (error) {
      console.error('Error fetching notifications:', error);
      return;
    }
    
    if (!notifications || notifications.length === 0) {
      return;
    }
    
    console.log(`📬 Найдено ${notifications.length} уведомлений`);
    
    // Обрабатываем уведомления ПОСЛЕДОВАТЕЛЬНО
    for (const notification of notifications) {
      try {
        const notificationTime = notification.notification_time?.slice(0, 5);
        const repeatDays = notification.repeat_days || [];
        
        // Проверяем время и день
        if (notificationTime !== currentTime || !repeatDays.includes(currentDay)) {
          continue;
        }
        
        console.log(`⏰ Нужно отправить: ${notification.title} (ID: ${notification.id})`);
        
        // Получаем user_id
        const userId = notification.user_id;
        
        // Получаем chat_id из user_telegram_mapping
        const { data: mapping, error: mappingError } = await supabase
          .from('user_telegram_mapping')
          .select('chat_id')
          .eq('user_id', userId)
          .single();
        
        if (mappingError || !mapping) {
          console.log(`❌ Не найден chat_id для пользователя ${userId}`);
          continue;
        }
        
        const chatId = mapping.chat_id;
        
        // Отправляем с атомарной защитой
        await sendNotificationSafe(chatId, notification, currentMinute);
        
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

  // Сохраняем в user_telegram_mapping
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
• Получать напоминания и уведомления (без дублей!)
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
Настраивайте напоминания (гарантированно без дублей!)

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
• Умными напоминаниями (без дублей!)
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
      message: 'Bot with atomic lock protection',
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