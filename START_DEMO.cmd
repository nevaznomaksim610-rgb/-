@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  echo Не найден файл .env
  echo Скопируйте .env.example в .env и добавьте OPENAI_API_KEY.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Зависимости ещё не установлены. Выполните npm install при подключённом интернете.
  pause
  exit /b 1
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
npm start
pause
