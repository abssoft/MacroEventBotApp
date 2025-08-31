document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand();

    const form = document.getElementById('registrationForm');
    const submitButton = document.getElementById('submitButton');
    const statusMessage = document.getElementById('statusMessage');
    const nameInput = document.getElementById('name'); // <-- 1. Находим поле для имени

    // URL вашего нового вебхука из n8n
    const N8N_WEBHOOK_URL = 'https://n8n.n.macroserver.ru/webhook/register-for-macro-event';

    // --- НАЧАЛО НОВОГО БЛОКА ---
    // Получаем данные пользователя из Telegram
    const user = tg.initDataUnsafe.user;

    // Проверяем, что данные пользователя и имя существуют, и подставляем в поле
    if (user && user.first_name) {
        nameInput.value = user.first_name;
    }
    // --- КОНЕЦ НОВОГО БЛОКА ---


    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        statusMessage.textContent = 'Отправка...';

        const formData = {
            name: nameInput.value, // <-- Используем nameInput для получения значения
            company: document.getElementById('company').value,
            phone: document.getElementById('phone').value,
            email: document.getElementById('email').value,
        };

        try {
            const response = await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                // Отправляем и данные формы, и initData для валидации
                body: JSON.stringify({
                    formData: formData,
                    initData: tg.initData
                })
            });

            if (response.ok) {
                statusMessage.textContent = 'Вы успешно зарегистрированы!';
                // Сообщаем Telegram, что все прошло хорошо и можно закрывать приложение
                tg.close();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Ошибка регистрации.');
            }
        } catch (error) {
            statusMessage.textContent = `Ошибка: ${error.message}`;
            submitButton.disabled = false;
        }
    });
});