// src/config/environment.js
export const ENV = {
  isDevelopment: import.meta.env.VITE_ENVIRONMENT === 'development',
  isProduction: import.meta.env.VITE_ENVIRONMENT === 'production',
  name: import.meta.env.VITE_ENVIRONMENT || 'unknown',
};

if (typeof window !== 'undefined') {
  console.log('🌍 Environment:', ENV.name);
  console.log('📡 Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
}

export default ENV;