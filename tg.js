// Telegram WebApp helpers isolated in a module

let lastMainButtonHandler = null;

export function configureMainButton({ text, onClick, visible }) {
  const WebApp = window.Telegram?.WebApp;
  if (!WebApp) return;
  const MB = WebApp.MainButton;
  if (!MB) return;
  if (typeof MB.hide === 'function') MB.hide();
  if (lastMainButtonHandler && typeof MB.offClick === 'function') {
    try { MB.offClick(lastMainButtonHandler); } catch (_) {}
    lastMainButtonHandler = null;
  }
  if (text) MB.setText(text);
  if (onClick) {
    MB.onClick(onClick);
    lastMainButtonHandler = onClick;
  }
  if (visible && typeof MB.show === 'function') MB.show();
}

export function defaultNameFromTelegram() {
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
}
