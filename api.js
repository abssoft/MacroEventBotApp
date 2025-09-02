// API module for Macro Event Telegram WebApp
// Responsible for communicating with n8n webhook using POST with unified envelope

const APP_VERSION = '1.0.0';
const API_URL = 'https://n8n.n.macroserver.ru/webhook-test/register-for-macro-event';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function fetchWithRetry(url, fetchOptions, opts = {}) {
  const { timeoutMs = 12000, retries = 2, retryDelays = [300, 1000], signal } = opts;

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

    try {
      const mergedSignal = mergeSignals(signal, controller.signal);
      const res = await fetch(url, { ...fetchOptions, signal: mergedSignal });
      clearTimeout(timeoutId);

      // Try parse JSON always
      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        try { data = JSON.parse(text); } catch { data = { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Неверный формат ответа.' } }; }
      }

      if (!res.ok) {
        // HTTP error - retriable if 5xx
        const httpError = new Error(`HTTP ${res.status}`);
        httpError.response = res;
        httpError.data = data;
        if (res.status >= 500 && attempt < retries) {
          attempt++;
          await sleep(retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]);
          continue;
        }
        throw httpError;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      const retriable = isRetriableError(err);
      if (retriable && attempt < retries) {
        attempt++;
        await sleep(retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function mergeSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const onAbort = () => controller.abort(a.aborted ? a.reason : b.reason);
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}

function isRetriableError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false; // timeout treated as non-retriable beyond configured loop
  // Network error or 5xx handled in fetchWithRetry
  return true;
}

function collectTelegramContext() {
  try {
    const WebApp = window.Telegram?.WebApp;
    if (!WebApp) return null;
    const iu = WebApp.initDataUnsafe || {};
    const theme = WebApp.themeParams || {};
    return {
      initData: WebApp.initData || '',
      initDataUnsafe: {
        user: iu.user || null,
        chat: iu.chat || null,
        receiver: iu.receiver || null,
        start_param: iu.start_param || null,
        auth_date: iu.auth_date || null,
        hash: iu.hash || null,
        can_send_after: iu.can_send_after || null,
        query_id: iu.query_id || null,
      },
      user: iu.user || null,
      platform: WebApp.platform || null,
      version: WebApp.version || null,
      colorScheme: WebApp.colorScheme || null,
      themeParams: theme,
      isExpanded: typeof WebApp.isExpanded === 'boolean' ? WebApp.isExpanded : null,
      viewportHeight: WebApp?.viewportHeight ?? null,
      viewportStableHeight: WebApp?.viewportStableHeight ?? null,
    };
  } catch (_) {
    return null;
  }
}

export async function useBackendAction(action, data = {}, opts = {}) {
  const WebApp = window.Telegram?.WebApp;
  const body = {
    action,
    data,
    tg: collectTelegramContext(),
    meta: {
      tgInitData: WebApp?.initData || '',
      appVersion: APP_VERSION,
    }
  };

  const res = await fetchWithRetry(
    API_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    { timeoutMs: opts.timeoutMs ?? 12000, signal: opts.signal }
  );

  // Expect { ok, data?, error? }
  if (typeof res !== 'object' || res === null || typeof res.ok !== 'boolean') {
    throw new Error('Неверный формат ответа сервера.');
  }
  return res;
}
