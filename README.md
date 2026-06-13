# Somnenie

Личное PWA-приложение для курса «Нутрициология без мифов». Каноническая реализация находится в `web/src` и собирается через React 19, TypeScript и Vite.

Курс нужен для обучения и самопроверки. Он не заменяет врача, диагностику, лечение или индивидуальные рекомендации по питанию.

## Запуск

```powershell
npm install
npm run dev
```

Открыть локальный адрес, который напечатает Vite. По умолчанию это:

```text
http://127.0.0.1:5173/
```

Для проверки production-сборки:

```powershell
npm run build
npm run preview
```

## Проверки

```powershell
npm run typecheck
npm run lint
npm run test
npm run quality
```

`npm run quality` выполняет typecheck, ESLint, Vitest, production build, проверку контента, PWA-контракт и dist smoke.

## Структура

```text
web/index.html              Vite entry HTML
web/src/main.tsx            React entry point
web/src/domain/             чистая доменная логика: путь, quiz, review, today
web/src/ui/                 экраны приложения и стили
web/src/storage/            IndexedDB и миграция старого localStorage
web/src/pwa/                registration и source service worker
content/                    Markdown-контент курса и контракты
manifest.webmanifest        PWA manifest, копируется в dist
assets/, fonts/, icons/     статические ассеты, копируются в dist
tools/                      build/postbuild, content, PWA и smoke проверки
dist/                       результат `npm run build`
```

Правило прохождения курса: следующий блок открывается только после сдачи контрольной предыдущего блока. Источник истины для доступа к блокам находится в `web/src/domain/learningPath.ts`.

## Деплой

Vercel запускает:

```powershell
npm run build
```

и отдаёт каталог:

```text
dist
```
