// Backend сервер для проксирования запросов к Gemini API
// Решает проблему CORS в браузере

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Загружаем переменные окружения
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Увеличиваем лимит для изображений
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверяем наличие API ключа
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ ОШИБКА: GEMINI_API_KEY не установлен в переменных окружения!');
  console.error('Установите его в Render Dashboard -> Environment Variables');
  process.exit(1);
}

// Эндпоинт для генерации истории через Gemini API
app.post('/api/generate-story', async (req, res) => {
  try {
    const {
      contents,
      systemInstruction,
      generationConfig
    } = req.body;

    if (!contents || !systemInstruction) {
      return res.status(400).json({ 
        error: 'Отсутствуют обязательные поля: contents, systemInstruction' 
      });
    }

    // Формируем запрос к Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        systemInstruction,
        generationConfig: {
          ...generationConfig,
          // Гарантируем JSON Mode
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ошибка Gemini API:', errorText);
      return res.status(response.status).json({ 
        error: 'Ошибка при обращении к Gemini API',
        details: errorText 
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Ошибка сервера:', error);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      message: error.message 
    });
  }
});

// Health check для Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Статические файлы из dist (после сборки)
app.use(express.static(join(__dirname, 'dist')));

// Fallback для SPA - все остальные маршруты возвращают index.html
app.get('*', (req, res) => {
  // Если это API запрос - возвращаем 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // Иначе возвращаем index.html для SPA
  try {
    const indexPath = join(__dirname, 'dist', 'index.html');
    const html = readFileSync(indexPath, 'utf-8');
    res.send(html);
  } catch (error) {
    res.status(404).send('Файл не найден. Убедитесь, что выполнили npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 API эндпоинт: http://localhost:${PORT}/api/generate-story`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
