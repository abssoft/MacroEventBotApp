# n8n API спецификация для Macro Event Telegram WebApp

Документ описывает контракт между фронтендом (Telegram WebApp) и n8n backend (Webhook Workflow). Описаны поддерживаемые действия (action), структура запросов и ожидаемые ответы.

Актуально на: 2025‑09‑02 • Версия фронтенда: 1.0.0

- Бэкенд URL (Webhook): https://n8n.n.macroserver.ru/webhook-test/register-for-macro-event
- Метод: POST
- Заголовки: Content-Type: application/json
- Формат ответа (унифицированный): JSON, всегда с флагом ok
  - ok: boolean — признак успеха бизнес‑операции
  - data?: object — полезные данные (при ok=true)
  - error?: { code: string, message: string, details?: any } — описание ошибки (при ok=false)

Важно: для бизнес‑ошибок (валидация, не найдено и т. п.) возвращайте HTTP 200 с ok=false. Технические сбои — допустимы HTTP 5xx. Клиент повторяет сетевые/5xx попытки автоматически (см. «Повторы и таймауты»).


## Конверт запроса (envelope)
Каждый запрос отправляется в одном формате, поле action определяет операцию:

- action: string — имя действия (см. список ниже)
- data: object — полезные данные действия (зависит от action)
- tg: object|null — контекст Telegram WebApp (см. ниже)
- meta: object — метаданные клиента
  - tgInitData: string — оригинальная строка WebApp.initData (для верификации подписи Telegram)
  - appVersion: string — версия фронтенда (напр. "1.0.0")

Структура tg (Telegram контекст):
- initData: string — оригинальная строка initData
- initDataUnsafe: object
  - user?: object — как в Telegram WebApp (id, first_name, last_name, username, language_code, ...)
  - chat?: object|null
  - receiver?: object|null
  - start_param?: string|null — параметр из deep-link (можно использовать для eventId)
  - auth_date?: number|null
  - hash?: string|null
  - can_send_after?: number|null
  - query_id?: string|null
- user?: object|null — дублирование initDataUnsafe.user для удобства
- platform?: string|null
- version?: string|null
- colorScheme?: string|null
- themeParams?: object
- isExpanded?: boolean|null
- viewportHeight?: number|null
- viewportStableHeight?: number|null

Замечания по безопасности:
- Рекомендуется в n8n проверять подпись Telegram initData (HMAC-SHA256 с токеном бота). Используйте meta.tgInitData или tg.initData. При неуспехе возвращать ok=false, error.code="AUTH_INVALID_TG".


## Список действий (actions)
Поддерживаются три действия: bootstrap, register, unregister.

### 1) action = "bootstrap"
Назначение: вернуть текущий активный эвент, известного пользователя (если есть) и признак регистрации пользователя на текущий эвент.

Запрос:
- data: {}

Успешный ответ:
- Новый (рекомендуется):
  - ok: true
  - data: {
      event: {
        id?: string|number|null,
        title?: string,
        description?: string,
        short_description?: string
      } | null,
      user: {
        id?: string|number|null,
        name?: string,
        company?: string,
        phone?: string,
        email?: string
      } | null,
      is_registered_for_current_event: boolean
    }

Поведение фронтенда:
- Если event отсутствует — показывается экран «Пока нет мероприятий».
- Если user отсутствует — форма регистрации.
- Если user есть, но не зарегистрирован на текущий event — предложение зарегистрироваться.
- Если зарегистрирован — экран «Уже зарегистрированы», с возможностью отменить регистрацию.

Примеры ответов:
- Новый формат:
  {
    "ok": true,
    "data": {
      "event": { "id": 42, "title": "Macro Meetup", "description": "Тема: n8n", "short_description": "Meetup" },
      "user": { "id": 1001, "name": "Иван Иванов", "company": "Macro", "phone": "+79991234567", "email": "ivan@example.com" },
      "is_registered_for_current_event": true
    }
  }


Ошибки:
- ok=false, error: { code: "EVENT_NOT_FOUND" | "AUTH_INVALID_TG" | "INTERNAL", message: string }


### 2) action = "register"
Назначение: создать/обновить участника и зарегистрировать его на текущий активный эвент.

Запрос:
- data: {
    name: string (2..64, буквы/пробелы/дефис),
    company: string (мин. 2 символа),
    phone: string (минимум 7 цифр при удалении нецифровых символов),
    email: string (валидный формат)
    // eventId НЕ отправляется фронтендом. Бэкенд должен определить текущий эвент сам
    // (например, на основе активного события в системе или tg.initDataUnsafe.start_param).
    // Дополнительно бэкенд МОЖЕТ поддерживать опциональный data.eventId для совместимости.
  }

Успешный ответ:
- ok: true
- data?: object — опционально; можно вернуть сведения об участнике/регистрации (например, attender_id, event_id).

Ошибки (ok=false):
- code: "VALIDATION_ERROR" — при некорректных полях (message — человекочитаемое описание)
- code: "EVENT_NOT_FOUND" — если активного события нет
- code: "ALREADY_REGISTERED" — если уже зарегистрирован (по решению бэкенда)
- code: "AUTH_INVALID_TG" — подпись Telegram невалидна
- code: "INTERNAL" — иные ошибки

Пример запроса:
POST /webhook-test/register-for-macro-event
{
  "action": "register",
  "data": {
    "name": "Иван Иванов",
    "company": "Macro",
    "phone": "+7 (999) 123-45-67",
    "email": "ivan@example.com"
  },
  "tg": { ... },
  "meta": { "tgInitData": "...", "appVersion": "1.0.0" }
}

Пример успешного ответа:
{ "ok": true, "data": { "attender_id": 1001, "event_id": 42 } }


### 3) action = "unregister"
Назначение: отменить регистрацию пользователя на событие.

Запрос:
- data: { eventId: string|number } — ИД события, от которого отказаться.

Успешный ответ:
- ok: true
- data?: object — опционально

Ошибки (ok=false):
- code: "EVENT_NOT_FOUND" | "NOT_REGISTERED" | "AUTH_INVALID_TG" | "INTERNAL"

Пример запроса:
POST /webhook-test/register-for-macro-event
{
  "action": "unregister",
  "data": { "eventId": 42 },
  "tg": { ... },
  "meta": { "tgInitData": "...", "appVersion": "1.0.0" }
}

Пример успешного ответа:
{ "ok": true }


## Унифицированный формат ошибок
error: {
  code: string,         // машиночитаемый код, SCREAMING_SNAKE_CASE
  message: string,      // для отображения пользователю (ru)
  details?: any         // опционально — технические детали/валидация
}

Рекомендуемые коды ошибок:
- AUTH_INVALID_TG — подпись Telegram не прошла верификацию
- VALIDATION_ERROR — валидация входных данных не пройдена
- EVENT_NOT_FOUND — нет активного события / указанное событие не найдено
- ALREADY_REGISTERED — пользователь уже зарегистрирован
- NOT_REGISTERED — пользователь не был зарегистрирован
- RATE_LIMITED — превышен лимит запросов
- INTERNAL — внутренняя ошибка


## Повторы и таймауты (поведение клиента)
- Таймаут запроса: 12 000 мс.
- Повторы: до 2 дополнительных попыток при сетевых ошибках и HTTP 5xx (задержки ~300 мс и ~1000 мс).
- Совет: для предсказуемости бизнес‑ошибок отвечайте HTTP 200 с ok=false, чтобы клиент не делал ретраи.


## Замечания к реализации в n8n
- Webhook (POST, JSON). В ноде Webhook включить «Response » JSON и вернуть ok/data/error.
- Ветка router/switch по полю body.action: bootstrap | register | unregister.
- Валидация:
  - Для register: проверить name/company/phone/email по правилам выше. Можно дублировать фронт‑валидацию и возвращать VALIDATION_ERROR с понятным message (на русском).
  - Для unregister: проверить наличие data.eventId.
- Идентификация пользователя:
  - Использовать tg.initDataUnsafe.user.id как постоянный идентификатор Telegram пользователя.
- Определение текущего события:
  - Для register не ожидать eventId от клиента. Определять активный эвент по вашей бизнес‑логике (или через tg.initDataUnsafe.start_param, если используется deep-linking).
- Идемпотентность:
  - register должен быть идемпотентен относительно (userId, eventId): повторный вызов не должен создавать дубликаты.
  - unregister должен быть идемпотентен: повторная отмена просто возвращает ok=true.
- Локализация сообщений:
  - message в error желательно русским текстом — он показывается пользователю.


## Примеры полных ответов
Успех (общий шаблон):
{
  "ok": true,
  "data": { /* зависит от action */ }
}

Ошибка:
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Укажите корректный e-mail.",
    "details": { "field": "email" }
  }
}


## Версионирование
- Клиент отправляет meta.appVersion. Можно условно менять поведение/форматы ответа, сохраняя обратную совместимость.
- Рекомендуется возвращать новый формат bootstrap (data.event, data.user, data.is_registered_for_current_event). Легаси ключи поддерживаются фронтендом, но считаются устаревшими.


## Дополнительно
- Контент‑тайп в ответе: application/json.
- Ограничение размера тела: рекомендуется < 100 КБ.
- Лимитирование/антиспам: рекомендуется, с возвратом ok=false и RATE_LIMITED при превышении.
