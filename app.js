// Macro Event Telegram WebApp frontend
// Implements state-driven UI and a single backend hook for n8n
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  // Configure your n8n webhook URL here
  const API_URL = 'https://n8n.n.macroserver.ru/webhook-test/register-for-macro-event';
  const SNAPSHOT_KEY = 'macro_event_snapshot_v1';

  const STRINGS = {
    ru: {
      loading: 'Загрузка... ',
      noEvent: 'Пока нет запланированных мероприятий.',
      refresh: 'Обновить',
      register: 'Зарегистрировать',
      unregister: 'Отменить регистрацию',
      changeName: 'Изменить имя',
      errorTitle: 'Произошла ошибка',
      retry: 'Повторить',
      nameLabel: 'Ваше имя',
      placeholderName: 'Введите имя',
      companyLabel: 'Компания',
      placeholderCompany: 'Укажите компанию',
      phoneLabel: 'Ваш телефон',
      placeholderPhone: '+7 (___) ___-__-__',
      emailLabel: 'Ваш eMail',
      placeholderEmail: 'name@example.com',
      askRegister: (name) => `${name}, зарегистрировать вас?`,
      registeredText: (title) => `Вы уже зарегистрированы на «${title}».`,
      openInTelegram: 'Откройте это приложение через Telegram для продолжения.',
      eventTitle: (title) => `${title}`,
      invalidName: 'Имя должно быть от 2 до 64 символов, только буквы, пробелы и дефисы.',
      invalidCompany: 'Укажите название компании (от 2 символов).',
      invalidPhone: 'Укажите корректный номер телефона (минимум 7 цифр).',
      invalidEmail: 'Укажите корректный e-mail.'
    }
  };
  const T = STRINGS.ru;

  const el = {
    app: null,
  };

  const state = {
    phase: 'idle', // idle | loading_bootstrap | loading_action | ui_empty | ui_registration_form | ui_offer_register | ui_registered | ui_error
    event: null,
    user: null,
    is_registered_for_current_event: false,
    error: null,
    temp: {
      nameInput: '',
      companyInput: '',
      phoneInput: '',
      emailInput: '',
      editingName: false,
    },
    pending: false,
  };

  function saveSnapshot() {
    try {
      const snap = {
        event: state.event,
        user: state.user,
        is_registered_for_current_event: state.is_registered_for_current_event,
        phase: state.phase.startsWith('ui_') ? state.phase : 'ui_empty'
      };
      sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch (_) {}
  }

  function loadSnapshot() {
    try {
      const txt = sessionStorage.getItem(SNAPSHOT_KEY);
      if (!txt) return null;
      return JSON.parse(txt);
    } catch (_) { return null; }
  }

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

  async function useBackendAction(action, data = {}, opts = {}) {
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

  function defaultNameFromTelegram() {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!u) return '';
    return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  }

  function validateName(name) {
    const n = (name || '').trim();
    if (n.length < 2 || n.length > 64) return { valid: false, message: T.invalidName };
    const re = /^[A-Za-zА-Яа-яЁё\-\s]+$/;
    if (!re.test(n)) return { valid: false, message: T.invalidName };
    return { valid: true, value: n };
  }

  function setPhase(newPhase) {
    state.phase = newPhase;
    render();
  }

  async function bootstrap() {
    state.error = null;
    setPhase('loading_bootstrap');
    try {
      const resp = await useBackendAction('bootstrap', {});
      if (resp.ok) {
        const { event, user, is_registered_for_current_event } = resp.data || {};
        state.event = event || null;
        state.user = user || null;
        state.is_registered_for_current_event = Boolean(is_registered_for_current_event);
        if (!state.event) {
          setPhase('ui_empty');
        } else if (!state.user) {
          state.temp.nameInput = state.temp.nameInput || defaultNameFromTelegram();
          state.temp.companyInput = state.temp.companyInput || '';
          state.temp.phoneInput = state.temp.phoneInput || '';
          state.temp.emailInput = state.temp.emailInput || '';
          setPhase('ui_registration_form');
        } else if (state.user && !state.is_registered_for_current_event) {
          state.temp.nameInput = state.user.name || state.temp.nameInput || defaultNameFromTelegram();
          state.temp.companyInput = state.user.company || state.temp.companyInput || '';
          state.temp.phoneInput = state.user.phone || state.temp.phoneInput || '';
          state.temp.emailInput = state.user.email || state.temp.emailInput || '';
          setPhase('ui_offer_register');
        } else {
          setPhase('ui_registered');
        }
        saveSnapshot();
      } else {
        // business error - still can display something
        state.error = resp.error || { message: 'Неизвестная ошибка.' };
        setPhase('ui_error');
      }
    } catch (e) {
      state.error = { code: 'NETWORK', message: e?.message || 'Сеть недоступна' };
      setPhase('ui_error');
    }
  }

  function validateCompany(company) {
    const c = (company || '').trim();
    if (c.length < 2) return { valid: false, message: T.invalidCompany };
    return { valid: true, value: c };
  }

  function validatePhone(phone) {
    const p = (phone || '').trim();
    const digits = p.replace(/\D+/g, '');
    if (digits.length < 7) return { valid: false, message: T.invalidPhone };
    return { valid: true, value: p };
  }

  function validateEmail(email) {
    const e = (email || '').trim();
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(e)) return { valid: false, message: T.invalidEmail };
    return { valid: true, value: e };
  }

  async function register(payload) {
    const { name, company, phone, email } = payload || {};
    const vName = validateName(name);
    if (!vName.valid) {
      state.error = { code: 'VALIDATION_ERROR', message: vName.message };
      setPhase('ui_error');
      return;
    }
    const vCompany = validateCompany(company);
    if (!vCompany.valid) { state.error = { code: 'VALIDATION_ERROR', message: vCompany.message }; setPhase('ui_error'); return; }
    const vPhone = validatePhone(phone);
    if (!vPhone.valid) { state.error = { code: 'VALIDATION_ERROR', message: vPhone.message }; setPhase('ui_error'); return; }
    const vEmail = validateEmail(email);
    if (!vEmail.valid) { state.error = { code: 'VALIDATION_ERROR', message: vEmail.message }; setPhase('ui_error'); return; }

    state.pending = true;
    setPhase('loading_action');
    try {
      const resp = await useBackendAction('register', {
        name: vName.value,
        company: vCompany.value,
        phone: vPhone.value,
        email: vEmail.value,
      });
      if (!resp.ok) {
        state.error = resp.error || { code: 'INTERNAL', message: 'Ошибка регистрации' };
        setPhase('ui_error');
      } else {
        await bootstrap();
      }
    } catch (e) {
      state.error = { code: 'NETWORK', message: e?.message || 'Сеть недоступна' };
      setPhase('ui_error');
    } finally {
      state.pending = false;
    }
  }

  async function unregister(eventId) {
    if (!eventId) return;
    state.pending = true;
    setPhase('loading_action');
    try {
      const resp = await useBackendAction('unregister', { eventId });
      if (!resp.ok) {
        state.error = resp.error || { code: 'INTERNAL', message: 'Ошибка отмены регистрации' };
        setPhase('ui_error');
      } else {
        await bootstrap();
      }
    } catch (e) {
      state.error = { code: 'NETWORK', message: e?.message || 'Сеть недоступна' };
      setPhase('ui_error');
    } finally {
      state.pending = false;
    }
  }

  // Telegram MainButton helpers
  let lastMainButtonHandler = null;
  function configureMainButton({ text, onClick, visible }) {
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

  function button(attrs, text) {
    const { id, className = '', disabled = false, variant = 'primary' } = attrs || {};
    const cls = ['btn', variant === 'secondary' ? 'btn-secondary' : ''].filter(Boolean).join(' ');
    return `<button ${id ? `id="${id}"` : ''} class="${cls} ${className}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  }

  function render() {
    const WebApp = window.Telegram?.WebApp;
    const app = el.app || (el.app = document.getElementById('app'));
    if (!app) return;

    // Default hide main button each render, then selectively enable
    configureMainButton({ text: '', onClick: null, visible: false });

    // Non-Telegram environment handling
    if (!WebApp) {
      app.innerHTML = `
        <div class="section">
          <p>${T.openInTelegram}</p>
        </div>
      `;
      return;
    }

    if (state.phase === 'loading_bootstrap' || state.phase === 'loading_action' || state.phase === 'idle') {
      app.innerHTML = `
        <div class="section center">
          <div class="spinner" aria-label="${T.loading}"></div>
          <p>${T.loading}</p>
        </div>`;
      WebApp.expand && WebApp.expand();
      return;
    }

    if (state.phase === 'ui_empty') {
      app.innerHTML = `
        <div class="section">
          <p>${T.noEvent}</p>
          ${button({ id: 'btn-refresh' }, T.refresh)}
        </div>`;
      const btn = document.getElementById('btn-refresh');
      btn.onclick = () => bootstrap();
      configureMainButton({ text: T.refresh, onClick: () => bootstrap(), visible: true });
      return;
    }

    if (state.phase === 'ui_registration_form') {
      const title = state.event?.title || '';
      const description = state.event?.description || '';
      const nameValue = state.temp.nameInput || defaultNameFromTelegram();
      const companyValue = state.temp.companyInput || '';
      const phoneValue = state.temp.phoneInput || '';
      const emailValue = state.temp.emailInput || '';
      app.innerHTML = `
        <div class="section">
          ${title ? `<h2 class=\"title\">${T.eventTitle(title)}</h2>` : ''}
          ${description ? `<p class=\"muted\">${description}</p>` : ''}
          <label for="name" class="label">${T.nameLabel}</label>
          <input id="name" type="text" class="input" placeholder="${T.placeholderName}" value="${escapeHtml(nameValue)}" ${state.pending ? 'disabled' : ''} />
          <label for="company" class="label">${T.companyLabel}</label>
          <input id="company" type="text" class="input" placeholder="${T.placeholderCompany}" value="${escapeHtml(companyValue)}" ${state.pending ? 'disabled' : ''} />
          <label for="phone" class="label">${T.phoneLabel}</label>
          <input id="phone" type="tel" class="input" placeholder="${T.placeholderPhone}" value="${escapeHtml(phoneValue)}" ${state.pending ? 'disabled' : ''} />
          <label for="email" class="label">${T.emailLabel}</label>
          <input id="email" type="email" class="input" placeholder="${T.placeholderEmail}" value="${escapeHtml(emailValue)}" ${state.pending ? 'disabled' : ''} />
          <div class="gap"></div>
          ${button({ id: 'btn-register' }, T.register)}
        </div>`;
      const nameEl = document.getElementById('name');
      const companyEl = document.getElementById('company');
      const phoneEl = document.getElementById('phone');
      const emailEl = document.getElementById('email');
      nameEl.oninput = (e) => (state.temp.nameInput = e.target.value);
      companyEl.oninput = (e) => (state.temp.companyInput = e.target.value);
      phoneEl.oninput = (e) => (state.temp.phoneInput = e.target.value);
      emailEl.oninput = (e) => (state.temp.emailInput = e.target.value);
      const onReg = () => {
        if (state.pending) return;
        register({
          name: nameEl.value,
          company: companyEl.value,
          phone: phoneEl.value,
          email: emailEl.value,
        });
      };
      document.getElementById('btn-register').onclick = onReg;
      configureMainButton({ text: T.register, onClick: onReg, visible: true });
      return;
    }

    if (state.phase === 'ui_offer_register') {
      const name = state.temp.nameInput || state.user?.name || defaultNameFromTelegram() || '';
      app.innerHTML = `
        <div class="section">
          <p>${T.askRegister(escapeHtml(name))}</p>
          <div class="row">
            ${button({ id: 'btn-offer-register' }, T.register)}
            <div class="gap-8"></div>
            ${button({ id: 'btn-edit-name', variant: 'secondary' }, T.changeName)}
          </div>
        </div>`;
      const onReg = () => {
        if (state.pending) return;
        const payload = {
          name: state.temp.nameInput || state.user?.name || defaultNameFromTelegram() || '',
          company: state.temp.companyInput || state.user?.company || '',
          phone: state.temp.phoneInput || state.user?.phone || '',
          email: state.temp.emailInput || state.user?.email || '',
        };
        register(payload);
      };
      document.getElementById('btn-offer-register').onclick = onReg;
      document.getElementById('btn-edit-name').onclick = () => setPhase('ui_registration_form');
      configureMainButton({ text: T.register, onClick: onReg, visible: true });
      return;
    }

    if (state.phase === 'ui_registered') {
      const title = state.event?.title || '';
      app.innerHTML = `
        <div class="section">
          <p>${T.registeredText(escapeHtml(title))}</p>
          ${button({ id: 'btn-unregister', variant: 'secondary' }, T.unregister)}
        </div>`;
      const onUnreg = () => { if (!state.pending) unregister(state.event?.id); };
      document.getElementById('btn-unregister').onclick = onUnreg;
      configureMainButton({ text: T.unregister, onClick: onUnreg, visible: true });
      return;
    }

    if (state.phase === 'ui_error') {
      const msg = state.error?.message || 'Неизвестная ошибка';
      app.innerHTML = `
        <div class="section">
          <p class="error">${escapeHtml(T.errorTitle)}: ${escapeHtml(msg)}</p>
          ${button({ id: 'btn-retry' }, T.retry)}
        </div>`;
      document.getElementById('btn-retry').onclick = () => bootstrap();
      configureMainButton({ text: T.retry, onClick: () => bootstrap(), visible: true });
      return;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    el.app = document.getElementById('app');

    // Render snapshot if any to reduce perceived latency
    const snap = loadSnapshot();
    if (snap) {
      state.event = snap.event || null;
      state.user = snap.user || null;
      state.is_registered_for_current_event = !!snap.is_registered_for_current_event;
      state.phase = snap.phase || 'ui_empty';
      render();
    } else {
      render();
    }

    const WebApp = window.Telegram?.WebApp;
    if (WebApp) {
      try { WebApp.expand && WebApp.expand(); WebApp.ready && WebApp.ready(); } catch (_) {}
      bootstrap();
    } else {
      // No Telegram env
      state.phase = 'ui_error';
      state.error = { code: 'NO_TELEGRAM', message: T.openInTelegram };
      render();
    }
  });
})();