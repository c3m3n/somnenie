# Somnenie

Личное статическое PWA-приложение для курса «Нутрициология без мифов». Работает без сборки: HTML, CSS, JS, локальный Markdown-контент и IndexedDB для прогресса.

Курс нужен для обучения и самопроверки. Он не заменяет врача, диагностику, лечение или индивидуальные рекомендации по питанию.

## Запуск

```powershell
git clone https://github.com/c3m3n/somnenie.git
cd somnenie
python -m http.server 8766 --bind 127.0.0.1
```

Открыть:

```text
http://127.0.0.1:8766/
```

На Windows можно запустить `start.bat`.

## Проверки

```powershell
node --check app.js
node .\tools\test-review.mjs
node .\tools\smoke-test.mjs
powershell -ExecutionPolicy Bypass -File .\tools\validate-content.ps1
```

Browser E2E:

```powershell
$env:NUTRIO_E2E_URL="http://127.0.0.1:8766/"
node .\tools\e2e-prod.mjs
```

## Структура

```text
index.html                  оболочка приложения
app.js                      экран курса, чтение, тесты, прогресс
style.css                   стили
sw.js                       PWA-кэш и офлайн-режим
manifest.webmanifest        PWA manifest
core/storage.js             IndexedDB и миграция старого localStorage
core/review.js              очередь повторения слабых мест
lib/marked.min.js           локальный Markdown-рендерер
content/manifest.json       индекс учебных модулей
content/course.json         фазы курса
content/claims.json         контракт источников для чувствительных утверждений
content/MXX/                теория, термины, тест, практика, схемы, итог
tools/                      валидатор, smoke, review test, browser E2E
fonts/, icons/              локальные ассеты PWA
```

Markdown-контент не должен содержать raw HTML. Валидатор и smoke test проверяют базовые XSS-ограничения, структуру курса, PWA-кэш и security headers.
