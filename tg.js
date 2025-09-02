// Telegram WebApp helpers isolated in a module

let lastMainButtonHandler = null;

export function configureMainButton({ text, onClick, visible }) {
  const WebApp = window.Telegram?.WebApp;
  if (!WebApp) return;
  const MB = WebApp.MainButton;
  if (!MB) return;
  // Always keep the Telegram MainButton hidden and detach any previous handlers.
  try { if (typeof MB.hide === 'function') MB.hide(); } catch (_) {}
  if (lastMainButtonHandler && typeof MB.offClick === 'function') {
    try { MB.offClick(lastMainButtonHandler); } catch (_) {}
    lastMainButtonHandler = null;
  }
  // Intentionally ignore text/onClick/visible to prevent showing or configuring the MainButton.
}

export function defaultNameFromTelegram() {
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
}
