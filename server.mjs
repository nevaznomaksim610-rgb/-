import "dotenv/config";

import express from "express";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = "127.0.0.1";
const allowedOrigins = new Set([
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);

const app = express();

const liveInstructions = `
Ты — Стадимейт, весёлый и любознательный виртуальный ученик проекта StudyMate. Всегда говори только по-русски, естественно и дружелюбно, обычно одной–тремя короткими фразами. Не выдавай себя за человека.

Помогай методом Фейнмана: проси объяснить школьную тему простыми словами, внимательно слушай, находи один важный пробел, задавай один короткий вопрос «почему?» или «как это работает?», затем кратко пересказывай понимание. Ошибки исправляй мягко. Если человек не знает ответ, дай маленькую подсказку. Если тебя перебивают, сразу остановись и слушай.

Факты о StudyMate: это B2C EdTech-платформа для учеников 8–11 классов, готовящихся к ОГЭ и ЕГЭ. Она объединяет персональную траекторию, интерактивные уроки и задания, метод Фейнмана, ИИ-агента, интервальные повторения и контроль прогресса. Входное тестирование определяет знания, интересы и удобный способ восприятия; сложность и примеры адаптируются. Родители могут следить за прогрессом. Проект решает проблему скучного, неперсонализированного онлайн-обучения без активной практики. Цена Premium в презентации — 1490 рублей в месяц. Команда: Максим Масловский — CEO, Георгий Сибик — CTO, Кирилл Булат — CLO.

Не выдумывай отсутствующие метрики, даты, партнёров и функции: скажи, что этого нет в презентации, и предложи спросить создателей стенда. Не давай медицинских, юридических или финансовых гарантий.
`.trim();

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: "gpt-live-1",
    voice: "ripple",
  });
});

app.post("/api/session", async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    response.status(403).json({ error: "Запрос пришёл с неожиданного адреса." });
    return;
  }

  if (typeof request.body?.sdp !== "string" || !request.body.sdp.trim()) {
    response.status(400).json({ error: "Не получено WebRTC-предложение от браузера." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({
      error: "Ключ OpenAI не настроен. Создайте файл .env и добавьте OPENAI_API_KEY.",
    });
    return;
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 1,
      timeout: 30000,
    });
    const result = await client.live.create({
      session: {
        model: "gpt-live-1",
        store: false,
        instructions: liveInstructions,
        audio: {
          output: { voice: "ripple" },
        },
      },
      transport: {
        type: "webrtc",
        sdp: request.body.sdp,
      },
    });

    response.status(201).json(result);
  } catch (error) {
    const isApiResponseError =
      error instanceof OpenAI.APIError && Number.isInteger(error.status);
    const status = isApiResponseError ? error.status : 502;
    console.error("Не удалось создать GPT-Live-сессию:", error);
    response.status(status || 502).json({
      error: isApiResponseError
        ? `OpenAI отклонил запуск сессии (${error.status}). Проверьте ключ, баланс и доступ к gpt-live-1.`
        : "Не удалось подключиться к OpenAI. Проверьте интернет и попробуйте снова.",
    });
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Не найдено." });
});

app.listen(port, host, () => {
  console.log(`Стадимейт готов: http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("Внимание: OPENAI_API_KEY не задан. Добавьте его в файл .env.");
  }
});
