// test_registration.js - Скрипт для тестирования регистрации
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================

const formatPhone = (phone) => {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('8')) {
    cleaned = '+7' + cleaned.slice(1);
  }
  if (cleaned.startsWith('7') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+7' + cleaned;
  }
  return cleaned;
};

const phoneToEmail = (phone) => {
  const cleaned = formatPhone(phone).replace(/\+/g, '');
  return `${cleaned}@babydiary.local`;
};

// ========================================
// ТЕСТЫ
// ========================================

async function testRegistration() {
  console.log('🧪 ТЕСТ 1: Регистрация нового пользователя\n');

  const testPhone = '+79991234567';
  const testPassword = 'test123456';
  const testName = 'Тестовый Пользователь';

  try {
    const email = phoneToEmail(testPhone);
    console.log('📱 Телефон:', testPhone);
    console.log('📧 Email:', email);
    console.log('🔑 Пароль:', testPassword);
    console.log('👤 Имя:', testName);
    console.log('');

    console.log('⏳ Регистрация...');
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: testPassword,
      options: {
        data: {
          phone: testPhone,
          full_name: testName,
          auth_method: 'phone',
        },
      },
    });

    if (error) {
      console.error('❌ Ошибка:', error.message);
      return false;
    }

    console.log('✅ Регистрация успешна!');
    console.log('User ID:', data.user.id);
    console.log('Email:', data.user.email);
    console.log('Metadata:', data.user.user_metadata);
    console.log('');

    return data.user;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

async function testLogin() {
  console.log('🧪 ТЕСТ 2: Вход существующего пользователя\n');

  const testPhone = '+79991234567';
  const testPassword = 'test123456';

  try {
    const email = phoneToEmail(testPhone);
    console.log('📱 Телефон:', testPhone);
    console.log('📧 Email:', email);
    console.log('');

    console.log('⏳ Вход...');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: testPassword,
    });

    if (error) {
      console.error('❌ Ошибка:', error.message);
      return false;
    }

    console.log('✅ Вход успешен!');
    console.log('User ID:', data.user.id);
    console.log('Email:', data.user.email);
    console.log('Session expires:', data.session.expires_at);
    console.log('');

    return data.user;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

async function testUserProfile(userId) {
  console.log('🧪 ТЕСТ 3: Проверка профиля пользователя\n');

  try {
    console.log('⏳ Получение профиля...');
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('❌ Ошибка:', error.message);
      return false;
    }

    console.log('✅ Профиль найден!');
    console.log('ID:', data.id);
    console.log('Phone:', data.phone);
    console.log('Full Name:', data.full_name);
    console.log('Created:', data.created_at);
    console.log('');

    return data;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

async function testBabyProfile(userId) {
  console.log('🧪 ТЕСТ 4: Создание профиля ребёнка\n');

  try {
    console.log('⏳ Создание профиля ребёнка...');
    const { data, error } = await supabase
      .from('babies')
      .insert({
        user_id: userId,
        name: 'Тестовый Малыш',
        birth_date: '2024-01-01',
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Ошибка:', error.message);
      return false;
    }

    console.log('✅ Профиль ребёнка создан!');
    console.log('ID:', data.id);
    console.log('Name:', data.name);
    console.log('Birth Date:', data.birth_date);
    console.log('');

    return data;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

async function testActivity(babyId) {
  console.log('🧪 ТЕСТ 5: Создание активности\n');

  try {
    console.log('⏳ Создание активности...');
    const { data, error } = await supabase
      .from('activities')
      .insert({
        baby_id: babyId,
        type: 'breastfeeding',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Ошибка:', error.message);
      return false;
    }

    console.log('✅ Активность создана!');
    console.log('ID:', data.id);
    console.log('Type:', data.type);
    console.log('Start Time:', data.start_time);
    console.log('');

    return data;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

async function testCleanup(userId) {
  console.log('🧪 ТЕСТ 6: Очистка тестовых данных\n');

  try {
    console.log('⏳ Удаление активностей...');
    await supabase
      .from('activities')
      .delete()
      .eq('baby_id', (await supabase.from('babies').select('id').eq('user_id', userId).single()).data.id);

    console.log('⏳ Удаление профиля ребёнка...');
    await supabase
      .from('babies')
      .delete()
      .eq('user_id', userId);

    console.log('⏳ Удаление профиля пользователя...');
    await supabase
      .from('user_profiles')
      .delete()
      .eq('id', userId);

    console.log('✅ Очистка завершена!');
    console.log('ℹ️  Пользователя auth.users нужно удалить вручную в Supabase Dashboard');
    console.log('');

    return true;
  } catch (error) {
    console.error('❌ Исключение:', error);
    return false;
  }
}

// ========================================
// ЗАПУСК ТЕСТОВ
// ========================================

async function runTests() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   ТЕСТИРОВАНИЕ СИСТЕМЫ РЕГИСТРАЦИИ    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  let userId, babyId;

  // ТЕСТ 1: Регистрация
  const user = await testRegistration();
  if (!user) {
    console.log('⚠️  Пропускаем остальные тесты из-за ошибки регистрации');
    console.log('ℹ️  Возможно, пользователь уже существует. Попробуйте ТЕСТ 2.');
    return;
  }
  userId = user.id;

  // Ждём создания профиля триггером
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ТЕСТ 2: Вход (закомментирован, т.к. только что зарегистрировались)
  // await testLogin();

  // ТЕСТ 3: Профиль пользователя
  await testUserProfile(userId);

  // ТЕСТ 4: Профиль ребёнка
  const baby = await testBabyProfile(userId);
  if (baby) {
    babyId = baby.id;
  }

  // ТЕСТ 5: Активность
  if (babyId) {
    await testActivity(babyId);
  }

  // ТЕСТ 6: Очистка
  console.log('');
  console.log('❓ Удалить тестовые данные? (y/n)');
  
  // Простой способ для автоматического теста
  // В реальности можно использовать readline
  const shouldCleanup = process.argv.includes('--cleanup');
  
  if (shouldCleanup) {
    await testCleanup(userId);
  } else {
    console.log('ℹ️  Запустите скрипт с флагом --cleanup для удаления данных');
  }

  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║         ТЕСТИРОВАНИЕ ЗАВЕРШЕНО         ║');
  console.log('╚════════════════════════════════════════╝');
}

// Запуск
runTests().catch(console.error);
