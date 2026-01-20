import { CONFIG } from './config.js';
import GeminiAPI, { StoryData, Frame, Choice } from './gemini-api.js';

// Глобальные переменные
let geminiAPI: GeminiAPI | null = null;
let currentStoryData: StoryData | null = null;
let currentFrameIndex = 0;
let currentFrames: Frame[] = [];
let isTextAnimating = false;
let textAnimationInterval: number | null = null;
let coreSummary: string | null = null;
let currentStage: 'START' | 'MIDDLE' | 'FINAL' = 'START';
let settings = { ...CONFIG.DEFAULT_SETTINGS };
let dialogueHistory: Array<{ speaker: string; text: string }> = [];
let isAutoMode = false;
let autoModeTimeout: number | null = null;
let isUIVisible = true;
let isShowingFrames = false; // Флаг для предотвращения параллельных вызовов showNextFrame
let frameShowTimeout: number | null = null; // Таймер для показа следующего фрейма
let badChoicesCount = 0; // Счётчик последовательных плохих выборов
let lastMoodLevel = 50; // Последний уровень настроения
let totalVovaReplies = 0; // Общее количество реплик Вовы (для расчёта прогресса)
let visitedLocations: string[] = []; // Отслеживание посещенных локаций (для контроля актов)
let currentLocation: string = 'entrance'; // Текущая локация (для проверки соответствия событий)
let previousNote: string | null = null; // Заметка от предыдущего вызова Gemini (для связи между запросами)
let previousEvaluation: { mood_adjustment?: number; next_note_hint?: string; suggestions?: string } | null = null; // Оценка от evaluateDialogue
let vovaAskLeaveRefusalCount = 0; // Сколько раз Вова просил уйти, а игрок отказался (после 2 — принудительный FINAL)
let discussedTopics: string[] = []; // Темы, которые уже обсуждались (для запрета повторов)
let vovaIQ: number = 100; // IQ Вовы в текущей сессии (роллится в начале игры, 60-140)
let vovaBaseMood: 'grumpy' | 'chill' | 'reflective' = 'chill'; // Базовое настроение дня (роллится в начале игры)

// Ключевые слова для детекции тем (очень простая эвристика)
const topicKeywords: { [key: string]: string[] } = {
    new_world_bananas: ['new world', 'банан', 'бананов', 'фарм', 'бирж'],
    poland_escape: ['польша', 'польше', 'тиса', 'тису', 'переплыть', 'свалить'],
    war_tck: ['тцк', 'военкомат', 'повестк', 'фронт', 'войн'],
    zhena: ['женя', 'жекусик', 'бывшая'],
    mother: ['мама', 'мамы', 'мать'],
    plans_3d: ['3d', 'модел', 'блендер', 'программировани'],
    friends: ['богдан', 'илья', 'миша'],
};

function recomputeDiscussedTopics(extraVovaTexts: string[] = []) {
    discussedTopics = [];
    const lastVovaReplies = dialogueHistory
        .filter(h => h.speaker === 'Вова')
        .slice(-10)
        .map(h => h.text.toLowerCase());
    
    const pool = [...lastVovaReplies, ...extraVovaTexts.map(t => t.toLowerCase())];
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some(kw => pool.some(reply => reply.includes(kw)))) {
            discussedTopics.push(topic);
        }
    }
}

// Элементы DOM
const background = document.getElementById('background') as HTMLDivElement;
const character = document.getElementById('character') as HTMLDivElement;
const characterSprite = document.getElementById('characterSprite') as HTMLImageElement;
const questionIcon = document.getElementById('questionIcon') as HTMLDivElement;
const dialogueBox = document.getElementById('dialogue-box') as HTMLDivElement;
const dialogueText = document.getElementById('dialogue-text') as HTMLDivElement;
const choicesContainer = document.getElementById('choices-container') as HTMLDivElement;
const startScreen = document.getElementById('start-screen') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const backgroundMusic = document.getElementById('background-music') as HTMLAudioElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement;
const logPanel = document.getElementById('log-panel') as HTMLDivElement;
const logContent = document.getElementById('log-content') as HTMLDivElement;
const gameControls = document.getElementById('game-controls') as HTMLDivElement;
const systemIcons = document.getElementById('system-icons') as HTMLDivElement;

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', () => {
    if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === '') {
        console.error('⚠️ Gemini API ключ не установлен! Создайте .env файл и добавьте VITE_GEMINI_API_KEY=ваш_ключ');
        alert('⚠️ Ошибка: Gemini API ключ не установлен!\n\nСоздайте файл .env в корне проекта и добавьте:\nVITE_GEMINI_API_KEY=ваш_ключ');
    }
    
    geminiAPI = new GeminiAPI(CONFIG.GEMINI_API_KEY);
    
    // Обработчики главного меню
    document.getElementById('start-menu-button')?.addEventListener('click', () => {
        const fileSection = document.getElementById('file-upload-section');
        if (fileSection) {
            fileSection.classList.toggle('hidden');
        }
    });
    
    document.getElementById('settings-menu-button')?.addEventListener('click', toggleSettings);
    
    // Обработчики выбора режима запуска
    const modeTextButton = document.getElementById('mode-text');
    const modeVisitButton = document.getElementById('mode-visit');
    const textInputMode = document.getElementById('text-input-mode');
    const visitActions = document.getElementById('visit-actions');
    const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
    
    // Кнопка "Текст"
    modeTextButton?.addEventListener('click', () => {
        modeTextButton.classList.add('active');
        modeVisitButton?.classList.remove('active');
        textInputMode?.classList.remove('hidden');
        visitActions?.classList.add('hidden');
        // Очищаем состояние визита
        (window as any).startMode = 'text';
    });
    
    // Кнопка "Просто прийти в гости"
    modeVisitButton?.addEventListener('click', () => {
        modeVisitButton.classList.add('active');
        modeTextButton?.classList.remove('active');
        textInputMode?.classList.add('hidden');
        visitActions?.classList.remove('hidden');
        // Очищаем текст при переключении
        if (textInput) {
            textInput.value = '';
            updateTextCharCount();
        }
        (window as any).startMode = 'visit';
    });
    
    // Обработчики кнопок запуска
    document.getElementById('start-text-button')?.addEventListener('click', startGame);
    document.getElementById('start-visit-button')?.addEventListener('click', startVisit);
    
    // Обработчики кнопок отмены
    document.getElementById('cancel-button')?.addEventListener('click', cancelStart);
    document.getElementById('cancel-visit-button')?.addEventListener('click', cancelStart);
    
    // Обновление счётчика символов
    function updateTextCharCount() {
        const charCount = textInput?.value.length || 0;
        const charCountElement = document.getElementById('text-char-count');
        if (charCountElement) {
            charCountElement.textContent = `${charCount.toLocaleString()} символов`;
        }
    }
    
    textInput?.addEventListener('input', updateTextCharCount);
    textInput?.addEventListener('paste', () => {
        // Небольшая задержка для обработки вставленного текста
        setTimeout(updateTextCharCount, 10);
    });
    
    // Обработчики кликов
    document.body.addEventListener('click', handleClick);
    
    // Настройки
    const textSpeedSlider = document.getElementById('text-speed') as HTMLInputElement;
    const musicVolumeSlider = document.getElementById('music-volume') as HTMLInputElement;
    const musicSelect = document.getElementById('music-select') as HTMLSelectElement;
    
    textSpeedSlider?.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        settings.textSpeed = parseInt(target.value);
        const speedValue = document.getElementById('speed-value');
        if (speedValue) speedValue.textContent = target.value;
    });
    
    musicVolumeSlider?.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const volume = parseInt(target.value);
        settings.musicVolume = volume;
        const volumeValue = document.getElementById('volume-value');
        if (volumeValue) volumeValue.textContent = volume.toString();
        backgroundMusic.volume = volume / 100;
    });
    
    musicSelect?.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        settings.music = target.value;
        changeMusic(target.value);
    });
    
    // Игровые кнопки управления
    document.getElementById('auto-button')?.addEventListener('click', toggleAutoMode);
    document.getElementById('log-button')?.addEventListener('click', toggleLogPanel);
    document.getElementById('hide-button')?.addEventListener('click', toggleUI);
    
    // Системные иконки
    document.getElementById('settings-icon')?.addEventListener('click', toggleSettings);
    document.getElementById('reset-icon')?.addEventListener('click', resetGame);
    document.getElementById('exit-icon')?.addEventListener('click', exitGame);
    
    // Очистка при закрытии страницы (синхронная версия для beforeunload)
    window.addEventListener('beforeunload', () => {
        // Останавливаем таймеры
        if (textAnimationInterval) {
            clearInterval(textAnimationInterval);
        }
        if (autoModeTimeout) {
            clearTimeout(autoModeTimeout);
        }
        if (frameShowTimeout) {
            clearTimeout(frameShowTimeout);
        }
        
        // Очищаем кэш (локально, без удаления на сервере - нет времени)
        if (geminiAPI) {
            // Кэширование больше не используется
        }
        
        // Очищаем файлы
        (window as any).uploadedFile = null;
        (window as any).uploadedText = null;
    });
    
    // Очистка при потере фокуса (опционально, если нужно)
    // window.addEventListener('visibilitychange', () => {
    //     if (document.hidden) {
    //         // Можно добавить очистку при потере фокуса
    //     }
    // });
    
    // Добавляем глобальные функции для работы с логами
    (window as any).getGeminiLogs = () => {
        const logs = GeminiAPI.getLogs();
        console.log('📋 Логи Gemini API:', logs);
        console.log('💾 Для скачивания логов используйте: downloadGeminiLogs()');
        return logs;
    };
    
    (window as any).downloadGeminiLogs = () => {
        GeminiAPI.downloadLogs();
    };
    
    (window as any).clearGeminiLogs = () => {
        if (confirm('Очистить все логи?')) {
            GeminiAPI.clearLogs();
            console.log('✅ Логи очищены');
        }
    };
    
    console.log('🔧 Команды для работы с логами:');
    console.log('  - getGeminiLogs() - показать все логи');
    console.log('  - downloadGeminiLogs() - скачать логи как файл');
    console.log('  - clearGeminiLogs() - очистить логи');
    
    document.getElementById('close-log')?.addEventListener('click', () => {
        logPanel.classList.add('hidden');
    });
    
    // Установка дефолтного фона
    changeBackground(settings.background);
    
    // В главном меню играет main_theme
    changeMusic('main_theme');
    backgroundMusic.volume = settings.musicVolume / 100;
    // Устанавливаем начальное значение ползунка громкости в system-icons
    // Ползунок громкости теперь только в панели настроек
    
    // Загрузка фона меню (пробуем PNG, потом JPG)
    loadMenuBackground();
    
    // Убираем отдельную загрузку фото Вовы - он уже в menu_main.png
    // const menuCharImg = document.getElementById('menu-character-img') as HTMLImageElement;
    // if (menuCharImg) {
    //     menuCharImg.src = `/assets/characters/${CONFIG.POSES.standing}`;
    // }
});

// === ЗАГРУЗКА ФАЙЛА ===
function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    
    // Показываем имя файла и меняем иконку
    const fileInputText = document.getElementById('file-input-text');
    const fileInputIcon = document.querySelector('.file-input-icon');
    
    if (fileInputText) {
        fileInputText.textContent = file.name;
        fileInputText.classList.add('has-file');
    }
    
    // Меняем иконку в зависимости от типа файла
    if (fileInputIcon) {
        if (file.type.startsWith('image/')) {
            fileInputIcon.textContent = '🖼️';
        } else {
            fileInputIcon.textContent = '📄';
        }
    }
    
    // Показываем кнопки действий
    const fileActions = document.getElementById('file-actions');
    if (fileActions) {
        fileActions.classList.remove('hidden');
    }
    
    const reader = new FileReader();
    
    // Проверяем тип файла
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || 
                   file.name.endsWith('.txt') || 
                   file.name.endsWith('.json') ||
                   file.name.endsWith('.pdf');
    
    if (isImage) {
        // Для изображений конвертируем в base64
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            // Сохраняем как объект с типом и данными
            (window as any).uploadedFile = {
                type: 'image',
                data: base64,
                mimeType: file.type,
                name: file.name
            };
        };
        reader.readAsDataURL(file);
    } else if (isText) {
        // Для текстовых файлов читаем как текст
        reader.onload = (e) => {
            const text = e.target?.result as string;
            (window as any).uploadedFile = {
                type: 'text',
                data: text,
                name: file.name
            };
            // Для обратной совместимости
            (window as any).uploadedText = text;
        };
        reader.readAsText(file);
    } else {
        // Для PDF и других - пытаемся как текст
        reader.onload = (e) => {
            const text = e.target?.result as string;
            (window as any).uploadedFile = {
                type: 'text',
                data: text,
                name: file.name
            };
            (window as any).uploadedText = text;
        };
        reader.readAsText(file);
    }
}

// === ОТМЕНА ЗАПУСКА ===
function cancelStart() {
    // Очищаем текст
    const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
    if (textInput) {
        textInput.value = '';
        const charCountElement = document.getElementById('text-char-count');
        if (charCountElement) {
            charCountElement.textContent = '0 символов';
        }
    }
    
    // Очищаем состояние
    (window as any).uploadedFile = null;
    (window as any).uploadedText = null;
    (window as any).startMode = null;
    
    // Скрываем секцию выбора
    const fileSection = document.getElementById('file-upload-section');
    if (fileSection) {
        fileSection.classList.add('hidden');
    }
    
    // Скрываем все подсекции
    const textInputMode = document.getElementById('text-input-mode');
    const visitActions = document.getElementById('visit-actions');
    if (textInputMode) textInputMode.classList.add('hidden');
    if (visitActions) visitActions.classList.add('hidden');
    
    // Убираем активность с кнопок
    const modeTextButton = document.getElementById('mode-text');
    const modeVisitButton = document.getElementById('mode-visit');
    if (modeTextButton) modeTextButton.classList.remove('active');
    if (modeVisitButton) modeVisitButton.classList.remove('active');
}

// === СТАРТ ИГРЫ С ТЕКСТОМ ===
async function startGame() {
    // ПЕРВЫМ ДЕЛОМ проверяем текстовое поле
    const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
    if (!textInput || !textInput.value.trim()) {
        alert('Пожалуйста, введите текст для обсуждения!');
        return;
    }
    
    const uploadedText = textInput.value.trim();
    // Создаём виртуальный файл из текста
    const uploadedFile = {
        type: 'text',
        data: uploadedText,
        name: 'input_text.txt'
    };
    // Сохраняем в window для дальнейшего использования
    (window as any).uploadedFile = uploadedFile;
    (window as any).uploadedText = uploadedText;
    
    await startGameWithData(uploadedFile);
}

// === СТАРТ ИГРЫ "ПРОСТО ПРИЙТИ В ГОСТИ" ===
async function startVisit() {
    // Запускаем без файла/текста - Вова просто приветствует в коридоре
    await startGameWithData(null);
}

// === ОБЩАЯ ФУНКЦИЯ СТАРТА ИГРЫ ===
async function startGameWithData(uploadedFile: any) {
    
    // Очищаем предыдущее состояние перед новым стартом
    await cleanupGameState();
    discussedTopics = [];
    
    // Роллим IQ от 60 до 140 (фиксируется на всю сессию)
    vovaIQ = Math.floor(Math.random() * 81) + 60; // 60–140
    console.log(`🎲 Ролл IQ Вовы: ${vovaIQ}`); // Для дебага
    
    // Роллим базовое настроение дня (влияет на тон диалога)
    const moods: ('grumpy' | 'chill' | 'reflective')[] = ['grumpy', 'chill', 'reflective'];
    vovaBaseMood = moods[Math.floor(Math.random() * moods.length)];
    console.log(`🎭 Базовое настроение Вовы: ${vovaBaseMood}`); // Для дебага
    
    // Сбрасываем счётчик реплик Вовы
    totalVovaReplies = 0;
    
    // Скрываем стартовый экран
    startScreen.style.opacity = '0';
    setTimeout(() => {
        startScreen.classList.add('hidden');
        gameControls.classList.remove('hidden');
        systemIcons.classList.remove('hidden');
    }, 500);
    
    // Показываем загрузку с погружающим сообщением
    showLoading(true, 'Вова готовится к разговору...');
    
    try {
        if (!geminiAPI) {
            throw new Error('Gemini API не инициализирован');
        }
        
        // Обновляем статус
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus) {
            loadingStatus.textContent = 'Хм... как же начать...';
        }
        
        // Генерируем первый блок (без кэширования - Flash модели дешевые)
        // Если uploadedFile null - передаём пустой текст (визит без темы)
        const fileData = uploadedFile || { type: 'text', data: '' };
        currentStoryData = await geminiAPI.generateStory(
            fileData,
            'START',
            null,
            null,
            0,
            50, // lastMoodLevel - начальное значение 50 (нейтральное)
            false, // isCustomInput
            0, // totalChoicesMade
            [], // dialogueHistory
            0, // totalVovaReplies - в START ещё нет реплик
            [], // visitedLocations - в START ещё нет посещенных локаций
            null, // previousNote - в START ещё нет заметки
            [], // discussedTopics - в START ещё нет обсуждённых тем
            vovaIQ, // IQ Вовы в этой сессии (60-140)
            vovaBaseMood, // Базовое настроение дня
            0, // vovaAskLeaveRefusalCount - в START счётчик 0
            null // previousEvaluation - в START ещё нет оценки
        );
        coreSummary = currentStoryData.session_info.core_summary;
        currentStage = currentStoryData.session_info.stage;
        currentFrames = currentStoryData.frames;
        // Сохраняем заметку для следующего вызова
        previousNote = currentStoryData.next_note || null;
        currentFrameIndex = 0;
        lastMoodLevel = currentStoryData.session_info.mood_level;
        badChoicesCount = 0; // Сбрасываем счётчик при старте
        vovaAskLeaveRefusalCount = 0;
        
        // Применяем настройки из AI
        // Локация и действие (action)
        if (currentStoryData.session_info.location) {
            changeLocation(
                currentStoryData.session_info.location,
                currentStoryData.session_info.action
            );
        }
        // Поза персонажа (для обычных локаций)
        if (currentStoryData.session_info.character_pose && !currentStoryData.session_info.action) {
            changePose(currentStoryData.session_info.character_pose);
        }
        // Музыка (для обратной совместимости)
        if (currentStoryData.session_info.music) {
            changeMusic(currentStoryData.session_info.music);
        }
        
        showLoading(false);
        
        // Показываем персонажа
        showCharacter();
        
        // Показываем первый фрейм (проверяем, что данные инициализированы)
        setTimeout(() => {
            if (currentStoryData && currentFrames && currentFrames.length > 0) {
                showNextFrame();
            } else {
                console.error('Ошибка: данные не инициализированы перед показом фрейма');
                alert('Ошибка загрузки: данные не инициализированы');
            }
        }, 500);
        
    } catch (error) {
        showLoading(false);
        alert('Ошибка загрузки истории: ' + (error as Error).message);
        console.error(error);
        console.log('📋 Логи сохранены! Используйте getGeminiLogs() в консоли для просмотра или downloadGeminiLogs() для скачивания.');
    }
}

// === ПОКАЗ ПЕРСОНАЖА ===
function showCharacter() {
    character.classList.remove('hidden');
    character.classList.add('fade-in', 'slide-up');
    setTimeout(() => {
        character.classList.remove('fade-in', 'slide-up');
    }, 500);
}

function hideCharacter() {
    character.classList.add('fade-out', 'slide-down');
    setTimeout(() => {
        character.classList.add('hidden');
        character.classList.remove('fade-out', 'slide-down');
    }, 500);
}

// === ПОКАЗ ФРЕЙМА (ИТЕРАТИВНЫЙ ПОДХОД) ===
function showNextFrame() {
    // Защита от параллельных вызовов
    if (isShowingFrames) {
        console.log('⚠️ showNextFrame уже выполняется, игнорируем повторный вызов');
        return;
    }
    
    // Защита от вызова без инициализации
    if (!currentStoryData || !currentFrames || currentFrames.length === 0) {
        console.error('showNextFrame вызван без инициализации данных');
        return;
    }
    
    // Защита от бесконечного цикла (максимум 100 фреймов за раз)
    if (currentFrameIndex >= currentFrames.length + 100) {
        console.error('⚠️ Превышен лимит фреймов, принудительная остановка');
        isShowingFrames = false;
        handleEarlyEnd('kicked_out');
        return;
    }
    
    // ЖЁСТКОЕ ЗАВЕРШЕНИЕ: если force_end или FINAL с низким mood - завершаем сразу
    if (currentStoryData.force_end === true || (currentStage === 'FINAL' && currentFrameIndex >= currentFrames.length - 1 && (currentStoryData.session_info?.mood_level ?? 0) < 20)) {
        isShowingFrames = false;
        handleEarlyEnd(currentStoryData.end_reason || 'kicked_out');
        return;
    }
    
    if (currentFrameIndex >= currentFrames.length) {
        // Если stage = FINAL и фреймы закончились - завершаем историю
        const isFinal = currentStage === 'FINAL';
        isShowingFrames = false;
        if (isFinal) {
            showEndScreen();
            return;
        }
        
        // Фреймы закончились - показываем выборы (если они не были показаны в середине)
        const shouldShowChoices = currentStoryData?.show_choices_at_end !== false;
        if (shouldShowChoices) {
            showChoices();
        } else {
            // Выборы уже были показаны в середине, но фреймы закончились - конец блока
            // Если FINAL - завершаем, иначе показываем выборы
            if (isFinal) {
                showEndScreen();
            } else {
                showChoices();
            }
        }
        return;
    }
    
    isShowingFrames = true;
    
    const frame = currentFrames[currentFrameIndex];
    
    // Обновляем персонажа (поза из session_info, не из frame.emotion)
    // Если есть action (событийная локация) - спрайт уже скрыт
    if (currentStoryData?.session_info && !currentStoryData.session_info.action) {
        changePose(currentStoryData.session_info.character_pose || 'standing');
    }
    
    // Показываем диалог
    dialogueBox.classList.remove('hidden');
    
    // Сохраняем текущие данные для использования в колбэках
    const storyData = currentStoryData;
    const frames = currentFrames;
    const frameIndex = currentFrameIndex;
    
    // Показываем текст с анимацией
    animateText(frame.text, 'Вова');
    
    // Добавляем в историю
    dialogueHistory.push({
        speaker: 'Вова',
        text: frame.text
    });
    
    // Увеличиваем счётчик реплик Вовы для расчёта прогресса
    totalVovaReplies++;
    
    currentFrameIndex++;
    
    // Проверка на show_choices_after и продолжение показа фреймов
    // происходит в animateText после завершения анимации текста
}

// === АНИМАЦИЯ ТЕКСТА ===
function animateText(text: string, speaker: string) {
    isTextAnimating = true;
    dialogueText.textContent = '';
    
    let charIndex = 0;
    const speed = 100 - settings.textSpeed; // Инверсия для удобства (больше = быстрее)
    
    // Сохраняем текущие данные для использования в колбэках
    const storyData = currentStoryData;
    const frames = currentFrames;
    const frameIndex = currentFrameIndex - 1; // Текущий фрейм (уже увеличен в showNextFrame)
    
    if (textAnimationInterval) {
        clearInterval(textAnimationInterval);
    }
    
    textAnimationInterval = window.setInterval(() => {
        if (charIndex < text.length) {
            dialogueText.textContent += text[charIndex];
            charIndex++;
        } else {
            if (textAnimationInterval) {
                clearInterval(textAnimationInterval);
                textAnimationInterval = null;
            }
            isTextAnimating = false;
            
            // Сбрасываем флаг показа фреймов после завершения анимации
            isShowingFrames = false;
            
            // Проверяем, нужно ли показать выборы после этого фрейма
            if (storyData && frames && frameIndex >= 0 && frameIndex < frames.length) {
                const frame = frames[frameIndex];
                if (frame.show_choices_after === true && storyData.choices && storyData.choices.length > 0) {
                    // Показываем выборы в середине диалога
                    setTimeout(() => {
                        showChoices();
                    }, 500);
                    return;
                }
            }
            
            // Если авто-режим включен, продолжаем автоматически
            if (isAutoMode && storyData && frames && frames.length > 0) {
                // Очищаем предыдущий таймер, если он есть
                if (autoModeTimeout) {
                    clearTimeout(autoModeTimeout);
                }
                autoModeTimeout = window.setTimeout(() => {
                    if (!storyData || !frames) return;
                    // Проверяем, что данные не изменились
                    if (currentStoryData !== storyData || currentFrames !== frames) return;
                    if (currentFrameIndex < frames.length) {
                        showNextFrame();
                    } else if (storyData.choices && storyData.choices.length > 0) {
                        showChoices();
                    }
                }, 2000);
            }
        }
    }, speed);
}

// === ОБРАБОТКА КЛИКОВ ===
function handleClick(event: MouseEvent) {
    // Игнорируем клики, если игра не запущена (показывается главное меню)
    if (startScreen && !startScreen.classList.contains('hidden')) {
        return;
    }
    
    // Игнорируем клики по кнопкам и настройкам
    const target = event.target as HTMLElement;
    if (target.closest('.choice-button') || 
        target.closest('.settings-button') || 
        target.closest('.settings-panel') ||
        target.closest('.system-icon') ||
        target.closest('.control-button') ||
        target.closest('.menu-button') ||
        target.closest('#file-input') ||
        target.closest('.start-button') ||
        target.closest('.cancel-button') ||
        target.closest('.file-upload-section') ||
        target.closest('.custom-choice-input') ||
        target.closest('.custom-choice-container') ||
        target.closest('.choices-container') ||
        target.closest('#choices-container')) {
        return;
    }
    
    // Игнорируем клики, если нет активной игры
    if (!currentStoryData || currentFrames.length === 0) {
        return;
    }
    
    // Если фреймы уже показываются - игнорируем клик
    if (isShowingFrames) {
        return;
    }
    
    // Если текст анимируется - мгновенно показываем весь
    if (isTextAnimating) {
        if (textAnimationInterval) {
            clearInterval(textAnimationInterval);
            textAnimationInterval = null;
        }
        const frame = currentFrames[currentFrameIndex - 1];
        dialogueText.textContent = frame.text;
        isTextAnimating = false;
        isShowingFrames = false; // Сбрасываем флаг после завершения анимации
        return;
    }
    
    // Иначе - следующий фрейм
    showNextFrame();
}

// === ПОКАЗ ВЫБОРОВ ===
function showChoices() {
    // Сбрасываем флаг показа фреймов при показе выборов
    isShowingFrames = false;
    
    // Останавливаем таймеры показа фреймов
    if (frameShowTimeout) {
        clearTimeout(frameShowTimeout);
        frameShowTimeout = null;
    }
    
    // Защита от вызова без инициализации
    if (!currentStoryData) {
        console.error('showChoices вызван без инициализации данных');
        return;
    }
    
    // ЖЁСТКОЕ ЗАВЕРШЕНИЕ: если force_end, FINAL или очень низкий mood - не показываем выборы, завершаем
    if (currentStoryData.force_end === true || currentStage === 'FINAL' || (currentStoryData.session_info?.mood_level ?? 0) < 20) {
        handleEarlyEnd(currentStoryData.end_reason || 'kicked_out');
        return;
    }
    
    if (!currentStoryData.choices || currentStoryData.choices.length === 0) {
        // Конец игры
        showEndScreen();
        return;
    }
    
    choicesContainer.innerHTML = '';
    choicesContainer.classList.remove('hidden');
    
    // Анимация появления выборов (сразу устанавливаем правильное позиционирование)
    choicesContainer.style.opacity = '0';
    choicesContainer.style.transform = 'translateX(20px) translateY(20px)';
    
    currentStoryData.choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.className = 'choice-button';
        button.textContent = choice.text;
        button.onclick = () => handleChoice(choice);
        button.style.opacity = '0';
        button.style.transform = 'translateY(10px)';
        choicesContainer.appendChild(button);
        
        // Анимация появления кнопки с задержкой
        setTimeout(() => {
            button.style.transition = 'all 0.3s ease';
            button.style.opacity = '1';
            button.style.transform = 'translateY(0)';
        }, index * 100);
    });
    
    // Добавляем поле для ввода своего варианта ответа
    const customChoiceDiv = document.createElement('div');
    customChoiceDiv.className = 'custom-choice-container';
    customChoiceDiv.style.marginTop = '15px';
    customChoiceDiv.style.opacity = '0';
    
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'custom-choice-input';
    customInput.placeholder = 'Или введите свой вариант ответа...';
    // Удаляем inline стили, используем только CSS класс
    
    customInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && customInput.value.trim()) {
            const customChoice: Choice = {
                text: customInput.value.trim(),
                next_stage_hint: 'custom',
                mood_impact: 0 // Нейтральный выбор по умолчанию
            };
            handleChoice(customChoice);
        }
    });
    
    customChoiceDiv.appendChild(customInput);
    choicesContainer.appendChild(customChoiceDiv);
    
    // Анимация появления поля ввода
    setTimeout(() => {
        customChoiceDiv.style.transition = 'all 0.3s ease';
        customChoiceDiv.style.opacity = '1';
    }, currentStoryData.choices.length * 100 + 100);
    
    // Анимация контейнера (убираем translateX, оставляем только translateY)
    setTimeout(() => {
        choicesContainer.style.transition = 'all 0.3s ease';
        choicesContainer.style.opacity = '1';
        choicesContainer.style.transform = 'translateX(0) translateY(0)';
    }, 50);
}

// === ОБРАБОТКА ВЫБОРА ===
// Флаг для предотвращения множественных кликов
let isProcessingChoice = false;

async function handleChoice(choice: Choice) {
    // Защита от множественных кликов
    if (isProcessingChoice) {
        console.log('⚠️ Выбор уже обрабатывается, игнорируем повторный клик');
        return;
    }
    
    isProcessingChoice = true;
    
    // Останавливаем все таймеры перед новым запросом
    if (textAnimationInterval) {
        clearInterval(textAnimationInterval);
        textAnimationInterval = null;
    }
    if (autoModeTimeout) {
        clearTimeout(autoModeTimeout);
        autoModeTimeout = null;
    }
    if (frameShowTimeout) {
        clearTimeout(frameShowTimeout);
        frameShowTimeout = null;
    }
    
    // Сбрасываем флаги
    isShowingFrames = false;
    isTextAnimating = false;
    
    // Сразу скрываем выборы (без задержки)
    choicesContainer.classList.add('hidden');
    choicesContainer.style.opacity = '0';
    choicesContainer.style.transform = '';
    choicesContainer.innerHTML = ''; // Очищаем содержимое сразу
    
    // Показываем загрузку
    showLoading(true, 'Вова продолжает историю...');
    
    try {
        if (!geminiAPI) {
            throw new Error('Gemini API не инициализирован');
        }
        
        // Детекция: Вова просил уйти, а игрок отказался — считаем для принудительного выпроваживания
        const frames = currentStoryData?.frames || currentFrames;
        const vovaAskedToLeave = frames.some((f: Frame) => /уйди|уходи|иди уже|надоел|свали|иди вон|иди домой/i.test(f.text));
        const playerRefused = /^(нет|неа|не уйду|останусь|не пойду|не хочу уходить|не собираюсь|ни за что)\b/i.test(choice.text.trim());
        if (vovaAskedToLeave && playerRefused) vovaAskLeaveRefusalCount++;
        
        // Определяем следующий этап (AI может сам решить, но мы даем подсказку)
        let nextStage: 'START' | 'MIDDLE' | 'FINAL' = currentStage;
        
        // ПРИНУДИТЕЛЬНЫЙ ПЕРЕХОД В FINAL после 3 плохих выборов подряд
        // Проверяем: если уже было 2 плохих выбора, и этот тоже будет плохим - будет 3
        // Но лучше проверить после получения ответа от AI
        if (badChoicesCount >= 2) {
            // Если уже 2 плохих выбора подряд, следующий плохой выбор приведёт к 3
            // Устанавливаем FINAL заранее, чтобы AI знал, что нужно завершать
            nextStage = 'FINAL';
        } else if (currentStage === 'START') {
            nextStage = 'MIDDLE'; // После START всегда MIDDLE
        } else if (currentStage === 'MIDDLE') {
            // AI может сам решить остаться в MIDDLE или перейти в FINAL
            // Передаем 'MIDDLE', но AI может вернуть 'FINAL' если хочет завершить
            nextStage = 'MIDDLE';
        } else {
            // Если уже FINAL, остаемся в FINAL
            nextStage = 'FINAL';
        }
        // Принудительный FINAL: Вова 2–3 раза просил уйти, игрок отказывался — выпроваживаем
        if (vovaAskLeaveRefusalCount >= 2) nextStage = 'FINAL';
        
        // Подсчитываем количество выборов игрока (перед добавлением текущего)
        const totalChoicesMade = dialogueHistory.filter(h => h.speaker === 'Player').length;
        
        // Пересчитываем обсуждённые темы по последним репликам (чтобы запретить повторы)
        recomputeDiscussedTopics();
        
        // Генерируем следующий блок
        // Если есть кэш, используем его, иначе обычный метод
        const isCustomInput = choice.next_stage_hint === 'custom'; // Проверяем, кастомный ли это ввод
        const fileData = (window as any).uploadedFile || { type: 'text', data: (window as any).uploadedText };
        // Передаем последние реплики диалога (только текст, не JSON)
        const recentDialogue = dialogueHistory.slice(-10); // Последние 10 реплик
        currentStoryData = await geminiAPI.generateStory(
            fileData,
            nextStage,
            choice.text,
            coreSummary || '',
            badChoicesCount,
            lastMoodLevel,
            isCustomInput,
            totalChoicesMade,
            recentDialogue,
            totalVovaReplies, // Передаём количество реплик Вовы для расчёта прогресса
            visitedLocations, // Передаём посещенные локации для контроля актов
            previousNote, // Передаём заметку от предыдущего вызова
            discussedTopics, // Запрещаем повторять уже обсуждённое
            vovaIQ, // IQ Вовы в этой сессии (60-140)
            vovaBaseMood, // Базовое настроение дня
            vovaAskLeaveRefusalCount, // После 2+ отказов уйти — принудительное выпроваживание
            previousEvaluation // Передаём оценку от предыдущего вызова evaluateDialogue
        );
        
        // Обновляем список тем с учётом новых фреймов (чтобы следующий ход ещё меньше зацикливался)
        recomputeDiscussedTopics((currentStoryData.frames || []).map(f => f.text));
        
        // Сохраняем заметку для следующего вызова
        previousNote = currentStoryData.next_note || null;
        
        // Очищаем оценку после использования (новая будет получена от evaluateDialogue)
        previousEvaluation = null;
        
        // Добавляем выбор игрока в историю (после генерации)
        dialogueHistory.push({
            speaker: 'Player',
            text: choice.text
        });
        
        // Отслеживаем плохие выборы
        // Для кастомного ввода AI сам оценил влияние в session_info.mood_level
        const newMoodLevel = currentStoryData.session_info.mood_level;
        // Вычисляем изменение настроения
        const moodChange = newMoodLevel - lastMoodLevel;
        
        // Если выбор негативный (настроение упало на 10+) и mood_level низкий
        if (moodChange < -10 && newMoodLevel < 20) {
            badChoicesCount++;
        } else if (moodChange > 0) {
            // Если выбор позитивный, сбрасываем счётчик
            badChoicesCount = 0;
        }
        
        lastMoodLevel = newMoodLevel;
        
        // ПРИНУДИТЕЛЬНЫЙ ПЕРЕХОД В FINAL после 3 плохих выборов подряд
        // Если после этого выбора счётчик достиг 3, принудительно устанавливаем FINAL
        if (badChoicesCount >= 3) {
            currentStage = 'FINAL';
            // Переопределяем stage в ответе AI, чтобы гарантировать FINAL
            if (currentStoryData.session_info.stage !== 'FINAL') {
                currentStoryData.session_info.stage = 'FINAL';
            }
        } else {
            // ЗАЩИТА ОТ РАННЕГО ЗАВЕРШЕНИЯ: Проверяем, можно ли завершать игру
            const canFinish = visitedLocations.length >= 2 || totalChoicesMade >= 6;
            
            // Если AI пытается завершить игру слишком рано - блокируем
            if (currentStoryData.session_info.stage === 'FINAL' && !canFinish) {
                console.log(`⚠️ Блокируем раннее завершение: посещено ${visitedLocations.length} локаций, ходов: ${totalChoicesMade}`);
                // Принудительно оставляем в MIDDLE
                currentStoryData.session_info.stage = 'MIDDLE';
                currentStage = 'MIDDLE';
            } else {
                // AI может сам решить изменить stage! Уважаем его решение
                currentStage = currentStoryData.session_info.stage;
            }
        }
        
        currentFrames = currentStoryData.frames;
        currentFrameIndex = 0;
        
        // Обновляем core summary
        coreSummary = currentStoryData.session_info.core_summary;
        
        // Проверяем, нужно ли завершить историю досрочно
        // force_end разрешен, но всегда показываем минимум 2-3 фрейма перед завершением
        if (currentStoryData && currentStoryData.force_end === true) {
            const endReason = currentStoryData.end_reason;
            
            // Если это явная команда "end" - завершаем сразу
            if (endReason === 'end_command') {
                showLoading(false);
                isProcessingChoice = false; // Сбрасываем флаг перед выходом
                setTimeout(() => {
                    handleEarlyEnd(endReason);
                }, 500);
                return;
            }
            
            // Для других случаев (bad_choices, ужасная история) - показываем фреймы
            // AI должен завершить диалог красиво через несколько реплик
            if (currentStoryData.frames) {
                showLoading(false);
                isProcessingChoice = false; // Сбрасываем флаг перед выходом
                currentFrames = currentStoryData.frames;
                currentFrameIndex = 0;
                
                // Если фреймов меньше 2 - это проблема, но показываем что есть
                if (currentFrames.length < 2) {
                    console.warn('⚠️ AI вернул force_end с менее чем 2 фреймами. Показываем что есть.');
                }
                
                showNextFrame();
                return;
            } else {
                // Если нет фреймов - завершаем сразу
                showLoading(false);
                isProcessingChoice = false; // Сбрасываем флаг перед выходом
                setTimeout(() => {
                    handleEarlyEnd(endReason);
                }, 500);
                return;
            }
        }
        
        // Применяем новые настройки
        // Локация и действие (action)
        if (currentStoryData.session_info.location) {
            const newLocation = currentStoryData.session_info.location;
            const action = currentStoryData.session_info.action;
            
            // Проверка соответствия локации и события
            if (action && action !== null) {
                const isValidAction = 
                    (action === 'cooking' && newLocation === 'kitchen') ||
                    (action === 'gaming' && newLocation === 'room') ||
                    (action === 'smoking' && newLocation === 'balcony');
                
                if (!isValidAction) {
                    console.warn(`⚠️ Некорректное событие: location="${newLocation}" + action="${action}". Исправляем на action=null`);
                    // Исправляем некорректное событие
                    currentStoryData.session_info.action = null;
                } else if (newLocation !== currentLocation) {
                    console.warn(`⚠️ Событие "${action}" назначено при смене локации "${currentLocation}" → "${newLocation}". Сначала нужно перейти в локацию. Исправляем.`);
                    // Исправляем: убираем событие при смене локации
                    currentStoryData.session_info.action = null;
                } else {
                    // Событие происходит в текущей локации - показываем анимацию ожидания 5 секунд
                    await showWaitingAnimation(action);
                }
            }
            
            // Обновляем текущую локацию
            currentLocation = newLocation;
            
            changeLocation(
                newLocation,
                currentStoryData.session_info.action
            );
        }
        // Поза персонажа (для обычных локаций)
        if (currentStoryData.session_info.character_pose && !currentStoryData.session_info.action) {
            changePose(currentStoryData.session_info.character_pose);
        }
        // Музыка (для обратной совместимости)
        if (currentStoryData.session_info.music) {
            changeMusic(currentStoryData.session_info.music);
        }
        
        showLoading(false);
        
        // Плавный переход
        setTimeout(() => {
            showNextFrame();
        }, 300);
        
    } catch (error) {
        showLoading(false);
        alert('Ошибка загрузки: ' + (error as Error).message);
        console.error(error);
        console.log('📋 Логи сохранены! Используйте getGeminiLogs() в консоли для просмотра или downloadGeminiLogs() для скачивания.');
    } finally {
        // Сбрасываем флаг обработки выбора
        isProcessingChoice = false;
    }
}

// === СМЕНА ПОЗЫ ===
function changePose(pose: string) {
    const fileName = CONFIG.POSES[pose] || CONFIG.POSES.standing;
    const newSrc = `/assets/characters/${fileName}`;
    
    // Сравниваем только имена файлов, так как characterSprite.src возвращает полный URL
    const currentFileName = characterSprite.src.split('/').pop() || '';
    
    if (currentFileName !== fileName && characterSprite.src) {
        // Crossfade анимация только если файл действительно меняется
        characterSprite.style.opacity = '0';
        setTimeout(() => {
            characterSprite.src = newSrc;
            characterSprite.style.opacity = '1';
        }, 150);
    } else if (!characterSprite.src) {
        // Если спрайт еще не загружен, просто устанавливаем без анимации
        characterSprite.src = newSrc;
    }
    
    // Показываем иконку вопроса для позы thinking
    if (pose === 'thinking') {
        questionIcon.classList.remove('hidden');
    } else {
        questionIcon.classList.add('hidden');
    }
}

// === СМЕНА ЛОКАЦИИ ===
function changeLocation(locationName: string, action?: string | null) {
    // Отслеживаем посещенные локации (только уникальные, без повторений)
    if (locationName && !visitedLocations.includes(locationName)) {
        visitedLocations.push(locationName);
    }
    
    // Автоматически меняем музыку при смене локации
    if (locationName && CONFIG.MUSIC[locationName]) {
        changeMusic(locationName);
    }
    
    // Если action задан (cooking/gaming/smoking) → используем единую картинку события
    if (action && action !== null) {
        const eventFileName = `${locationName}_${action}_vova`;
        loadEventLocation(eventFileName);
        // Скрываем спрайт персонажа (он уже в картинке фона)
        character.classList.add('hidden');
        return;
    }
    
    // Если action == null → используем фон + спрайт отдельно
    const baseFileName = CONFIG.LOCATIONS[locationName] || CONFIG.LOCATIONS.entrance;
    // Убираем расширение из имени файла
    const nameWithoutExt = baseFileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    
    // Пробуем загрузить PNG, если не получится - JPG, потом WebP
    const pngImg = new Image();
    pngImg.onload = () => {
        const newBg = `url('/assets/backgrounds/${nameWithoutExt}.png')`;
        if (background.style.backgroundImage !== newBg) {
            // Меняем фон без анимации (убрали fade-out/fade-in)
            background.style.backgroundImage = newBg;
        }
    };
    pngImg.onerror = () => {
        // Если PNG не найден, пробуем JPG
        const jpgImg = new Image();
        jpgImg.onload = () => {
            const newBg = `url('/assets/backgrounds/${nameWithoutExt}.jpg')`;
            if (background.style.backgroundImage !== newBg) {
                // Меняем фон без анимации
                background.style.backgroundImage = newBg;
            }
        };
        jpgImg.onerror = () => {
            // Если JPG не найден, пробуем WebP
            const webpImg = new Image();
            webpImg.onload = () => {
                const newBg = `url('/assets/backgrounds/${nameWithoutExt}.webp')`;
                if (background.style.backgroundImage !== newBg) {
                    // Меняем фон без анимации
                    background.style.backgroundImage = newBg;
                }
            };
            webpImg.onerror = () => {
                console.warn(`Фон ${nameWithoutExt} не найден (пробовали .png, .jpg, .webp)`);
            };
            webpImg.src = `/assets/backgrounds/${nameWithoutExt}.webp`;
        };
        jpgImg.src = `/assets/backgrounds/${nameWithoutExt}.jpg`;
    };
    pngImg.src = `/assets/backgrounds/${nameWithoutExt}.png`;
    
    // Показываем спрайт персонажа (для обычных локаций)
    character.classList.remove('hidden');
}

// === ЗАГРУЗКА СОБЫТИЙНОЙ ЛОКАЦИИ (единая картинка: фон + Вова вместе) ===
function loadEventLocation(fileName: string) {
    // Убираем расширение из имени файла
    const nameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    
    // Пробуем загрузить PNG, если не получится - JPG, потом WebP
    const pngImg = new Image();
    pngImg.onload = () => {
        const newBg = `url('/assets/backgrounds/${nameWithoutExt}.png')`;
        if (background.style.backgroundImage !== newBg) {
            background.style.backgroundImage = newBg;
        }
    };
    pngImg.onerror = () => {
        // Если PNG не найден, пробуем JPG
        const jpgImg = new Image();
        jpgImg.onload = () => {
            const newBg = `url('/assets/backgrounds/${nameWithoutExt}.jpg')`;
            if (background.style.backgroundImage !== newBg) {
                background.style.backgroundImage = newBg;
            }
        };
        jpgImg.onerror = () => {
            // Если JPG не найден, пробуем WebP
            const webpImg = new Image();
            webpImg.onload = () => {
                const newBg = `url('/assets/backgrounds/${nameWithoutExt}.webp')`;
                if (background.style.backgroundImage !== newBg) {
                    background.style.backgroundImage = newBg;
                }
            };
            webpImg.onerror = () => {
                console.warn(`Событийная локация ${nameWithoutExt} не найдена (пробовали .png, .jpg, .webp)`);
            };
            webpImg.src = `/assets/backgrounds/${nameWithoutExt}.webp`;
        };
        jpgImg.src = `/assets/backgrounds/${nameWithoutExt}.jpg`;
    };
    pngImg.src = `/assets/backgrounds/${nameWithoutExt}.png`;
}

// === СМЕНА ФОНА (для обратной совместимости) ===
function changeBackground(backgroundName: string) {
    changeLocation(backgroundName, null);
}

// === СМЕНА МУЗЫКИ ===
function changeMusic(musicName: string) {
    const fileName = CONFIG.MUSIC[musicName] || CONFIG.MUSIC.main_theme;
    const newSrc = `/assets/music/${fileName}`;
    
    if (backgroundMusic.src !== newSrc) {
        backgroundMusic.pause();
        
        // Очищаем предыдущие обработчики
        backgroundMusic.onerror = null;
        backgroundMusic.oncanplaythrough = null;
        
        // Обработчик ошибки загрузки
        backgroundMusic.onerror = (e) => {
            console.warn(`⚠️ Файл музыки не найден или не поддерживается: ${fileName}`);
            console.warn(`   Проверьте, что файл существует в /assets/music/${fileName}`);
            console.warn(`   Поддерживаемые форматы: MP3, OGG, WAV`);
        };
        
        backgroundMusic.src = newSrc;
        backgroundMusic.load();
        
        // Пытаемся воспроизвести только если файл загрузился успешно
        const playWhenReady = () => {
            backgroundMusic.play().catch(err => {
                // Игнорируем ошибки автовоспроизведения (браузер может блокировать)
                if (err.name !== 'NotAllowedError') {
                    console.warn('Не удалось воспроизвести музыку:', err);
                }
            });
        };
        
        if (backgroundMusic.readyState >= 2) {
            // Файл уже загружен
            playWhenReady();
        } else {
            // Ждем загрузки
            backgroundMusic.addEventListener('canplaythrough', playWhenReady, { once: true });
        }
    }
}

// === ЗАГРУЗКА ===
function showLoading(show: boolean, status?: string) {
    if (show) {
        loading.classList.remove('hidden');
        
        // Обновляем статус загрузки
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus && status) {
            loadingStatus.textContent = status;
        }
        
        // Запускаем анимацию прогресса
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => {
                progressBar.style.width = '100%';
            }, 100);
        }
    } else {
        loading.classList.add('hidden');
        
        // Сбрасываем прогресс
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
    }
}

// === АНИМАЦИЯ ОЖИДАНИЯ ДЛЯ СОБЫТИЙ ===
async function showWaitingAnimation(action: string): Promise<void> {
    return new Promise((resolve) => {
        const actionNames: { [key: string]: string } = {
            'cooking': 'готовит еду',
            'gaming': 'играет в New World',
            'smoking': 'курит'
        };
        
        const actionName = actionNames[action] || 'завершает действие';
        const loadingTitle = document.querySelector('.loading-title') as HTMLElement;
        const loadingStatus = document.getElementById('loading-status');
        
        // Показываем загрузку с сообщением ожидания
        showLoading(true, `Вы ждете, пока Вова ${actionName}...`);
        
        if (loadingTitle) {
            loadingTitle.textContent = 'Вы ждете...';
        }
        
        // Ожидаем 5 секунд с анимацией прогресса
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
            let progress = 0;
            const interval = setInterval(() => {
                progress += 2; // 100% за 5 секунд (5000ms / 50ms = 100 итераций, 100% / 100 = 1% за итерацию)
                progressBar.style.width = `${progress}%`;
                
                if (progress >= 100) {
                    clearInterval(interval);
                    // Восстанавливаем текст
                    if (loadingTitle) {
                        loadingTitle.textContent = 'Вова думает...';
                    }
                    showLoading(false);
                    resolve();
                }
            }, 100); // Обновляем каждые 100мс (50 итераций = 5 секунд)
        } else {
            // Если прогресс-бар не найден, просто ждем 5 секунд
            setTimeout(() => {
                if (loadingTitle) {
                    loadingTitle.textContent = 'Вова думает...';
                }
                showLoading(false);
                resolve();
            }, 5000);
        }
    });
}

// === КОНЕЦ ИГРЫ ===
function showEndScreen() {
    alert('The End. Спасибо за прочтение!');
    setTimeout(() => {
        location.reload();
    }, 1000);
}

// === ОБРАБОТКА ДОСРОЧНОГО ЗАВЕРШЕНИЯ ===
function handleEarlyEnd(endReason?: 'end_command' | 'bad_choices' | 'kicked_out' | null) {
    // Показываем все оставшиеся фреймы
    if (currentFrameIndex < currentFrames.length) {
        // Показываем оставшиеся фреймы (завершающие реплики)
        showNextFrame();
        return;
    }
    
    // Все фреймы показаны - завершаем историю
    let endMessage = 'История завершена.';
    
    if (endReason === 'end_command') {
        endMessage = 'Вова попрощался с тобой. История завершена.';
    } else if (endReason === 'bad_choices') {
        endMessage = 'Вова разочарован твоими выборами. История завершена.';
    } else if (endReason === 'kicked_out') {
        endMessage = 'Вова выпроводил тебя. История завершена.';
    }
    
    // Скрываем выборы если они были показаны
    choicesContainer.classList.add('hidden');
    
    // Показываем финальное сообщение
    setTimeout(() => {
        alert(endMessage);
        setTimeout(() => {
            location.reload();
        }, 1000);
    }, 1000);
}

// === НАСТРОЙКИ ===
function toggleSettings() {
    settingsPanel.classList.toggle('hidden');
}

function toggleAutoMode() {
    isAutoMode = !isAutoMode;
    const autoButton = document.getElementById('auto-button');
    if (autoButton) {
        if (isAutoMode) {
            autoButton.classList.add('active');
            // Продолжаем автоматически, если текст уже показан
            if (!isTextAnimating && currentStoryData && currentFrames && currentFrameIndex < currentFrames.length) {
                const storyData = currentStoryData; // Сохраняем ссылку
                const frames = currentFrames; // Сохраняем ссылку
                autoModeTimeout = window.setTimeout(() => {
                    // Используем прямой вызов вместо handleClick, чтобы избежать рекурсии
                    if (!storyData || !frames) return;
                    if (currentFrameIndex < frames.length) {
                        showNextFrame();
                    } else if (storyData.choices && storyData.choices.length > 0) {
                        showChoices();
                    }
                }, 2000);
            }
        } else {
            autoButton.classList.remove('active');
            if (autoModeTimeout) {
                clearTimeout(autoModeTimeout);
                autoModeTimeout = null;
            }
        }
    }
}

function toggleLogPanel() {
    logPanel.classList.toggle('hidden');
    if (!logPanel.classList.contains('hidden')) {
        updateLogContent();
    }
}

function updateLogContent() {
    logContent.innerHTML = '';
    dialogueHistory.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.text}`;
        logContent.appendChild(div);
    });
    logContent.scrollTop = logContent.scrollHeight;
}

function toggleUI() {
    isUIVisible = !isUIVisible;
    if (isUIVisible) {
        dialogueBox.classList.remove('hidden');
        gameControls.classList.remove('hidden');
        systemIcons.classList.remove('hidden');
    } else {
        dialogueBox.classList.add('hidden');
        gameControls.classList.add('hidden');
        systemIcons.classList.add('hidden');
    }
}


// === ЗАГРУЗКА ФОНА МЕНЮ ===
function loadMenuBackground() {
    const startScreen = document.getElementById('start-screen') as HTMLDivElement;
    if (!startScreen) return;
    
    // Загружаем одно фото главного меню (menu_main.png)
    const menuImg = new Image();
    menuImg.onload = () => {
        startScreen.style.backgroundImage = `url('/assets/backgrounds/${CONFIG.MENU_MAIN}')`;
    };
    menuImg.onerror = () => {
        // Если файл не найден, оставляем fallback цвет
        console.log('Главное меню (menu_main.png) не найдено, используется fallback цвет');
    };
    menuImg.src = `/assets/backgrounds/${CONFIG.MENU_MAIN}`;
}

// === СБРОС ИГРЫ ===
async function resetGame() {
    if (confirm('Прервать диалог и вернуться в меню? Все несохраненные данные будут потеряны.')) {
        await cleanupGameState();
        returnToMenu();
    }
}

async function cleanupGameState() {
    // Сбрасываем отслеживание посещенных локаций
    visitedLocations = [];
    currentLocation = 'entrance'; // Сбрасываем текущую локацию
    previousNote = null; // Сбрасываем заметку
    previousEvaluation = null; // Сбрасываем оценку
    discussedTopics = [];
    vovaIQ = 100; // Сбрасываем IQ (будет перезаписан при следующем старте)
    vovaBaseMood = 'chill'; // Сбрасываем базовое настроение (будет перезаписано при следующем старте)
    
    // Останавливаем все таймеры
    if (textAnimationInterval) {
        clearInterval(textAnimationInterval);
        textAnimationInterval = null;
    }
    if (autoModeTimeout) {
        clearTimeout(autoModeTimeout);
        autoModeTimeout = null;
    }
    if (frameShowTimeout) {
        clearTimeout(frameShowTimeout);
        frameShowTimeout = null;
    }
    
    // Сбрасываем флаги
    isShowingFrames = false;
    
    // Очищаем кэш Gemini API (асинхронно, удаляем на сервере)
    if (geminiAPI) {
        // Кэширование больше не используется
    }
    
    // Очищаем файлы
    (window as any).uploadedFile = null;
    (window as any).uploadedText = null;
    
    // Очищаем состояние игры
    currentStoryData = null;
    totalVovaReplies = 0; // Сбрасываем счётчик реплик
    currentFrames = [];
    currentFrameIndex = 0;
    coreSummary = null;
    currentStage = 'START';
    badChoicesCount = 0;
        lastMoodLevel = 40;
    dialogueHistory = [];
    isAutoMode = false;
    isTextAnimating = false;
    
    // Скрываем игровые элементы
    character.classList.add('hidden');
    dialogueBox.classList.add('hidden');
    choicesContainer.classList.add('hidden');
    loading.classList.add('hidden');
    
    // Очищаем текст
    dialogueText.textContent = '';
    choicesContainer.innerHTML = '';
    
    // Сбрасываем файловый ввод
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    if (fileInput) {
        fileInput.value = '';
    }
    
    // Очищаем UI файла
    const fileInputText = document.getElementById('file-input-text');
    const fileInputIcon = document.querySelector('.file-input-icon');
    if (fileInputText) {
        fileInputText.textContent = 'Выберите файл';
        fileInputText.classList.remove('has-file');
    }
    if (fileInputIcon) {
        fileInputIcon.textContent = '📄';
    }
    
    // Скрываем кнопки действий файла
    const fileActions = document.getElementById('file-actions');
    if (fileActions) {
        fileActions.classList.add('hidden');
    }
    
    console.log('✅ Состояние игры очищено');
}

function returnToMenu() {
    // Показываем стартовый экран
    startScreen.classList.remove('hidden');
    startScreen.style.opacity = '1';
    
    // Скрываем игровые элементы
    gameControls.classList.add('hidden');
    systemIcons.classList.add('hidden');
    
    // Скрываем панели
    settingsPanel.classList.add('hidden');
    logPanel.classList.add('hidden');
    
    // Возвращаем музыку главного меню
    changeMusic('main_theme');
    
    // Сбрасываем фон на дефолтный
    changeBackground(settings.background);
}

// === ВЫХОД ИЗ ИГРЫ ===
function exitGame() {
    if (confirm('Завершить игру и выйти в главное меню? Все несохраненные данные будут потеряны.')) {
        cleanupGameState();
        returnToMenu();
    }
}

// Экспорт для глобального доступа
(window as any).toggleSettings = toggleSettings;
