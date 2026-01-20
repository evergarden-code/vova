// Конфигурация игры
export interface GameSettings {
  textSpeed: number;
  musicVolume: number;
  background: string;
  music: string;
}

export interface PoseMapping {
  [key: string]: string;
}

export interface LocationMapping {
  [key: string]: string;
}

export interface MusicMapping {
  [key: string]: string;
}

export const CONFIG = {
  // API ключ Gemini (читается из .env файла)
  // Создайте .env файл в корне проекта с: VITE_GEMINI_API_KEY=ваш_ключ
  GEMINI_API_KEY: import.meta.env.VITE_GEMINI_API_KEY || '',
  
  // Модель Gemini (gemini-2.5-flash-lite - оптимизирована для низкой задержки и низких затрат)
  GEMINI_MODEL: 'gemini-2.5-flash-lite',
  
  // Маппинг поз Вовы на файлы (для обычных локаций - когда action == null)
  // Всего 7 спрайтов для различных ситуаций и эмоций
  POSES: {
    'standing': 'vova_standing.png',      // Стоит (дефолт, нейтральный)
    'thinking': 'vova_thinking.png',      // Задумался, почёсывает затылок
    'happy': 'vova_happy.png',            // Радостный (высокий mood, обсуждает New World)
    'sad': 'vova_sad.png',                // Грустный (низкий mood)
    'nervous': 'vova_nervous.png',        // Нервный (обсуждает войну, ТЦК)
    'annoyed': 'vova_annoyed.png'         // Раздражённый (шутят про маму, адрес)
  } as PoseMapping,
  
  // Маппинг локаций (без расширения - функция сама попробует .png, .jpg, .webp)
  LOCATIONS: {
    'entrance': 'entrance',   // Прихожая
    'kitchen': 'kitchen',     // Кухня
    'room': 'room',           // Комната Вовы
    'balcony': 'balcony'      // Балкон
  } as LocationMapping,
  
  // Маппинг музыки (для каждой локации своя музыка + главное меню)
  MUSIC: {
    'main_theme': 'main_theme.mp3',        // Главное меню
    'entrance': 'entrance_music.mp3',      // Музыка для прихожей
    'kitchen': 'kitchen_music.mp3',        // Музыка для кухни
    'room': 'room_music.mp3',              // Музыка для комнаты
    'balcony': 'balcony_music.mp3'         // Музыка для балкона
  } as MusicMapping,
  
  // Главное меню - одно фото с Вовой
  MENU_MAIN: 'menu_main.png',  // Одно фото для главного меню (фон + Вова вместе)
  
  // Настройки по умолчанию
  DEFAULT_SETTINGS: {
    textSpeed: 50,
    musicVolume: 70,
    background: 'entrance',  // Дефолтная локация - прихожая
    music: 'main_music_1'  // По умолчанию музыка 1
  } as GameSettings
};
