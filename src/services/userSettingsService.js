import cacheService from './cacheService.js';

const SETTINGS_CACHE_KEY = 'user_settings';

/**
 * Единая схема пользовательских настроек.
 * Хранится в cacheService, который уже namespace-aware,
 * поэтому настройки автоматически изолированы между пользователями.
 */
export const DEFAULT_USER_SETTINGS = {
  language: 'ru',
  theme: 'light',
  systemNotifications: {
    longRunningActivityReminder: true,
  },
};

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const mergeSettings = (incoming = {}) => ({
  ...DEFAULT_USER_SETTINGS,
  ...(isObject(incoming) ? incoming : {}),
  systemNotifications: {
    ...DEFAULT_USER_SETTINGS.systemNotifications,
    ...(isObject(incoming.systemNotifications) ? incoming.systemNotifications : {}),
  },
});

const userSettingsService = {
  async load() {
    const cached = await cacheService.get(SETTINGS_CACHE_KEY);
    return mergeSettings(cached || {});
  },

  async save(nextSettings) {
    const normalized = mergeSettings(nextSettings);
    await cacheService.set(SETTINGS_CACHE_KEY, normalized, null);
    return normalized;
  },

  async update(updater) {
    const current = await this.load();
    const next = typeof updater === 'function' ? updater(current) : updater;
    return this.save(next);
  },
};

export default userSettingsService;
