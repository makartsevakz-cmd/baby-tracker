// notification-server/test-push.js
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

dotenv.config();

// Загружаем Firebase Admin ключ
const serviceAccount = JSON.parse(
  readFileSync('./firebase-admin-key.json', 'utf8')
);

// ВАЖНО: Инициализируем с явным указанием project_id
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendTestPush() {
  console.log('🔍 Searching for device tokens...');
  
  // Получаем ВСЕ токены (не фильтруем по user_id)
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('*')
    .eq('platform', 'android');
  
  if (error) {
    console.error('❌ Error fetching tokens:', error);
    return;
  }
  
  if (!tokens || tokens.length === 0) {
    console.log('❌ No tokens found');
    return;
  }
  
  console.log(`✅ Found ${tokens.length} token(s)`);
  console.log('Token details:', tokens.map(t => ({
    user_id: t.user_id,
    token: t.token.substring(0, 20) + '...',
    created: t.created_at
  })));
  
  // Берём первый токен
  const token = tokens[0].token;
  console.log('📤 Sending push notification to:', token.substring(0, 30) + '...');
  
  try {
    // Используем FCM HTTP v1 API
    const message = {
      token: token,
      notification: {
        title: 'Тестовое уведомление',
        body: 'Если вы видите это - Push работают! 🎉'
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK'
        }
      }
    };

    console.log('Sending via FCM HTTP v1 API...');
    const result = await admin.messaging().send(message);
    console.log('✅ Success! Message ID:', result);
  } catch (error) {
    console.error('💥 Send error:', error.message);
    
    // Дополнительная диагностика
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.error('❌ Token is invalid or expired. App needs to re-register.');
      
      // Удаляем невалидный токен
      const { error: deleteError } = await supabase
        .from('device_tokens')
        .delete()
        .eq('token', token);
      
      if (!deleteError) {
        console.log('🗑️  Invalid token removed from database');
      }
    } else if (error.code === 'messaging/third-party-auth-error') {
      console.error('❌ Firebase credentials are incorrect');
      console.error('Check that firebase-admin-key.json is from the correct project');
    } else {
      console.error('Error code:', error.code);
      console.error('Error details:', error.errorInfo);
    }
  }
}

sendTestPush().then(() => {
  console.log('✅ Test completed');
  process.exit();
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});