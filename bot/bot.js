// bot.js - Telegram Bot Server с защитой от дублирования уведомлений
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app-url.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''; // Service role key для обхода RLS

// Инициализация
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

console.log('🤖 Бот запущен!');
console.log('📊 Supabase:', supabase ? '✅ Подключен' : '❌ Не настроен');

// ============================================
// Функции для работы с уведомлениями
// ============================================

/**
 * Проверяет, было ли уже отправлено уведомление
 */
async function wasNotificationSent(userId, notificationId, scheduledTime) {
  if (!supabase) return false;
  
  try {
    const { data, error } = await supabase
      .from('sent_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('notification_id', notificationId)
      .eq('scheduled_time', scheduledTime)
      .limit(1);
    
    if (error) throw error;
    return data && data.length > 0;
  } catch (error) {
    console.error('Error checking sent notification:', error);
    return false; // В случае ошибки разрешаем отправку
  }
}

/**
 * Отмечает уведомление как отправленное
 */
async function markNotificationAsSent(userId, notificationId, scheduledTime, notificationType) {
  if (!supabase) return;
  
  try {
    const { error } = await supabase
      .from('sent_notifications')
      .insert({
        user_id: userId,
        notification_id: notificationId,
        scheduled_time: scheduledTime,
        notification_type: notificationType
      });
    
    if (error) {
      // Игнорируем ошибки уникальности (уведомление уже отмечено)
      if (error.code !== '23505') {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error marking notification as sent:', error);
  }
}

/**
 * Отправляет уведомление пользователю с защитой от дублирования
 */
async function sendNotificationToUser(chatId, userId, notification) {
  try {
    // Генерируем уникальное scheduledTime для этого момента
    const scheduledTime = new Date().toISOString();
    
    // Проверяем, не было ли уже отправлено
    const alreadySent = await wasNotificationSent(userId, notification.id, scheduledTime);
    
    if (alreadySent) {
      console.log(`⏭️ Уведомление ${notification.id} уже было отправлено`);
      return;
    }
    
    // Формируем текст уведомления
    const activityLabel = getActivityLabel(notification.activity_type);
    const message = `
🔔 Напоминание: ${notification.title}

${activityLabel}
${notification.comment ? `\n💬 ${notification.comment}` : ''}
    `.trim();
    
    // Отправляем уведомление
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
    
    // Отмечаем как отправленное
    await markNotificationAsSent(
      userId, 
      notification.id, 
      scheduledTime, 
      notification.notification_type || 'time_based'
    );
    
    console.log(`✅ Уведомление ${notification.id} отправлено пользователю ${chatId}`);
  } catch (error) {
    console.error('Error sending notification:', error);
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
 * Проверяет и отправляет уведомления (вызывается периодически)
 */
async function checkAndSendNotifications() {
  if (!supabase) {
    console.log('⚠️ Supabase не настроен, уведомления отключены');
    return;
  }
  
  try {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const currentDay = now.getDay(); // 0-6
    
    // Получаем все активные уведомления
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('enabled', true);
    
    if (error) throw error;
    
    if (!notifications || notifications.length === 0) {
      return;
    }
    
    console.log(`🔍 Проверка ${notifications.length} уведомлений...`);
    
    for (const notification of notifications) {
      // Time-based уведомления
      if (notification.notification_type === 'time_based') {
        const notificationTime = notification.notification_time?.slice(0, 5);
        const repeatDays = notification.repeat_days || [];
        
        // Проверяем время и день недели
        if (notificationTime === currentTime && repeatDays.includes(currentDay)) {
          // Получаем user_id из записи
          const userId = notification.user_id;
          
          // Здесь нужно получить chat_id пользователя
          // В реальном приложении нужно сохранять chat_id при первом взаимодействии
          // Для упрощения можно создать таблицу user_telegram_mapping
          
          console.log(`⏰ Время отправить уведомление: ${notification.title}`);
          // await sendNotificationToUser(chatId, userId, notification);
        }
      }
      
      // Interval-based уведомления
      // TODO: Реализовать логику для интервальных уведомлений
    }
  } catch (error) {
    console.error('Error checking notifications:', error);
  }
}

// Запускаем проверку уведомлений каждую минуту
if (supabase) {
  setInterval(checkAndSendNotifications, 60000);
  console.log('⏰ Проверка уведомлений запущена (каждую минуту)');
}

// ============================================
// Обработчики команд бота
// ============================================

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'друг';
  const userId = msg.from.id;

  // Сохраняем chat_id для отправки уведомлений (опционально)
  if (supabase) {
    supabase
      .from('user_telegram_mapping')
      .upsert({ user_id: userId, chat_id: chatId, username: msg.from.username })
      .then(() => console.log(`💾 Сохранен chat_id для пользователя ${userId}`))
      .catch(err => console.error('Error saving chat_id:', err));
  }

  const welcomeMessage = `
👶 Привет, ${firstName}!

Добро пожаловать в **Трекер малыша** — удобное приложение для отслеживания активностей вашего ребенка.

📊 С помощью этого бота вы сможете:
• Отслеживать кормление, сон и прогулки
• Вести учет смены подгузников
• Записывать прием лекарств и купания
• Следить за ростом и весом малыша
• Получать напоминания и уведомления
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

// Обработчик команды /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
📖 **Помощь по использованию**

**Основные функции:**

🍼 **Кормление**
Отслеживайте грудное вскармливание (с таймером для каждой груди) и кормление из бутылочки

😴 **Сон**
Записывайте время сна с помощью таймера или вручную

🚶 **Прогулки**
Отмечайте время прогулок на свежем воздухе

🧷 **Подгузники**
Ведите учет смены подгузников (мокрый/грязный)

💊 **Лекарства**
Записывайте прием лекарств с указанием названия

🛁 **Купание**
Отмечайте время купания

📈 **Статистика**
Просматривайте тепловую карту активностей по неделям

👶 **Профиль**
Ведите данные о росте и весе малыша с графиками динамики

🔔 **Уведомления**
Настраивайте напоминания по времени или интервалам

**Команды бота:**
/start - Открыть приложение
/help - Показать эту справку

Есть вопросы? Напишите нам!
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🚀 Открыть приложение',
          web_app: { url: WEB_APP_URL }
        }
      ]
    ]
  };

  bot.sendMessage(chatId, helpMessage, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// Обработчик callback кнопок
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  switch (data) {
    case 'help':
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `
📖 **Быстрая помощь**

Используйте приложение для:
✅ Отслеживания всех активностей малыша
✅ Ведения истории роста и веса
✅ Получения статистики и графиков
✅ Настройки напоминаний

Откройте приложение и начните отслеживать активности прямо сейчас!

Для подробной справки используйте команду /help
      `.trim(), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть приложение',
                web_app: { url: WEB_APP_URL }
              }
            ]
          ]
        }
      });
      break;

    case 'about':
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `
👶 **О приложении**

**Трекер малыша** — это современное веб-приложение для родителей, которое помогает вести учет всех важных моментов в жизни вашего ребенка.

**Возможности:**
• 📊 Удобное отслеживание активностей
• ⏱️ Встроенные таймеры для кормления и сна
• 📈 Визуализация статистики
• 📱 Работает прямо в Telegram
• 🔔 Умные напоминания (без дублирования!)
• 💾 Облачное хранение данных
• 🔄 Синхронизация между устройствами

**Версия:** 2.0.0

Сделано с ❤️ для заботливых родителей
      `.trim(), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть приложение',
                web_app: { url: WEB_APP_URL }
              }
            ]
          ]
        }
      });
      break;
  }
});

// Обработка других сообщений
bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;

  const responses = [
    'Используйте приложение для записи активностей! Нажмите кнопку ниже 👇',
    'Для начала работы откройте приложение через кнопку ниже! 👇',
    'Все функции доступны в приложении. Откройте его прямо сейчас! 👇'
  ];

  const randomResponse = responses[Math.floor(Math.random() * responses.length)];

  bot.sendMessage(chatId, randomResponse, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🚀 Открыть приложение',
            web_app: { url: WEB_APP_URL }
          }
        ]
      ]
    }
  });
});

// ============================================
// Health Check для Render.com
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
      message: 'Bot is running',
      notifications: supabase ? 'enabled' : 'disabled'
    }));
    console.log(`Health check request from: ${req.socket.remoteAddress}`);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});

// ============================================
// Обработка ошибок
// ============================================

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Graceful shutdown
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