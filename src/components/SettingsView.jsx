import React, { useMemo, useState } from 'react';
import { ArrowLeft, LogOut, Mail, Globe, Moon, Sun } from 'lucide-react';

const languageOptions = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

const themeOptions = [
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dark', label: 'Тёмная', icon: Moon },
];

const systemNotificationDefinitions = [
  {
    id: 'longRunningActivityReminder',
    title: 'Напоминание о длительной активности',
    description: 'Показывать уведомление, если активность длится более 7 часов',
  },
];

const SettingsView = ({
  tg,
  isTelegramApp = false,
  onBack,
  userEmail,
  settings,
  onLanguageChange,
  onThemeChange,
  onSystemNotificationToggle,
  onPasswordChange,
  onSupportClick,
  onLogout,
}) => {
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const sectionCardClass = useMemo(
    () => 'bg-white rounded-2xl shadow-lg p-5 space-y-4',
    []
  );

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError('Заполните все поля для смены пароля.');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Новый пароль должен содержать минимум 6 символов.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Подтверждение пароля не совпадает.');
      return;
    }

    if (passwordForm.currentPassword === passwordForm.newPassword) {
      setPasswordError('Новый пароль должен отличаться от текущего.');
      return;
    }

    setIsSubmittingPassword(true);

    const result = await onPasswordChange({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });

    if (result?.error) {
      setPasswordError(result.error);
    } else {
      setPasswordSuccess('Пароль успешно изменён.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      tg?.HapticFeedback?.notificationOccurred('success');
    }

    setIsSubmittingPassword(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center bg-white rounded-2xl shadow-lg p-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-gray-100 text-gray-700 active:scale-95 transition-transform mr-2"
            title="Назад"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-semibold">Настройки</h2>
        </div>

        <section className={sectionCardClass}>
          <h3 className="text-lg font-semibold">Аккаунт</h3>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={userEmail || '—'}
              readOnly
              className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-gray-700"
            />
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Текущий пароль</label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Новый пароль</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Подтверждение нового пароля</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>

            {passwordError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{passwordError}</div>}
            {passwordSuccess && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{passwordSuccess}</div>}

            <button
              type="submit"
              disabled={isSubmittingPassword}
              className="w-full bg-purple-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-60"
            >
              {isSubmittingPassword ? 'Сохранение...' : 'Сменить пароль'}
            </button>
          </form>
        </section>

        {!isTelegramApp && (
          <section className={sectionCardClass}>
            <h3 className="text-lg font-semibold">Внешний вид</h3>

          <div>
            <div className="text-sm text-gray-500 mb-2">Язык приложения</div>
            <div className="grid grid-cols-2 gap-2">
              {languageOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onLanguageChange(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
                    settings.language === option.value
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-500 mb-2">Тема приложения</div>
            <div className="grid grid-cols-2 gap-2">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => onThemeChange(option.value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
                      settings.theme === option.value
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          </section>
        )}

        <section className={sectionCardClass}>
          <h3 className="text-lg font-semibold">Уведомления</h3>

          <div className="space-y-2">
            {systemNotificationDefinitions.map((item) => (
              <label key={item.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <div className="font-medium text-sm">{item.title}</div>
                  <div className="text-xs text-gray-500">{item.description}</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(settings.systemNotifications[item.id])}
                  onChange={(e) => onSystemNotificationToggle(item.id, e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
              </label>
            ))}
          </div>

          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Канал доставки выбирается автоматически: в Telegram — сообщения от бота,
            в Android-приложении — Push-уведомления.
          </div>
        </section>

        <section className={sectionCardClass}>
          <h3 className="text-lg font-semibold">Поддержка</h3>
          <button
            onClick={onSupportClick}
            className="w-full rounded-lg border border-purple-200 text-purple-700 bg-purple-50 py-2.5 font-medium flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Поддержка
          </button>
        </section>

        {!isTelegramApp && (
          <section className={sectionCardClass}>
            <h3 className="text-lg font-semibold">Система</h3>
            <button
              onClick={onLogout}
              className="w-full rounded-lg border border-red-200 text-red-700 bg-red-50 py-2.5 font-medium flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Выйти из профиля
            </button>
          </section>
        )}
      </div>
    </div>
  );
};

export default SettingsView;
