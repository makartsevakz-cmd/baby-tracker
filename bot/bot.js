// bot.js - Telegram Bot Server (БЕЗ проверки уведомлений)
// Уведомления обрабатываются через Edge Function на Supabase
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
console.log('🔔 Уведомления обрабатываются через Edge Function');

// ============================================
// Обработчики команд бота
// ============================================

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'друг';
  const telegramUserId = msg.from.id;

  // Сохраняем telegram_id в user_metadata через Supabase Auth
  if (supabase) {
    try {
      // Получаем пользователя по telegram_id из user_metadata
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      
      if (error) throw error;
      
      // Ищем пользователя с таким telegram_id
      const user = users?.find(u => 
        u.user_metadata?.telegram_id === telegramUserId || 
        u.raw_user_meta_data?.telegram_id === telegramUserId
      );
      
      if (user) {
        // Обновляем user_metadata с chat_id
        await supabase.auth.admin.updateUserById(user.id, {
          user_metadata: {
            ...user.user_metadata,
            telegram_id: telegramUserId,
            telegram_chat_id: chatId,
            telegram_username: msg.from.username
          }
        });
        console.log(`💾 Обновлен user_metadata для пользователя ${user.id}: chat_id=${chatId}`);
      } else {
        console.log(`⚠️ Пользователь с telegram_id=${telegramUserId} не найден в Supabase Auth`);
      }
    } catch (err) {
      console.error('Error updating user_metadata:', err);
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
**Уведомления:** Edge Function (без дублей!)

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
      message: 'Bot is running (notifications via Edge Function)',
      notifications: 'handled by Edge Function'
    }));
    console.log(`Health check from: ${req.socket.remoteAddress}`);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
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