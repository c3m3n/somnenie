# Somnenie — курсы с маршрутом, зачётами и тренажёром

Персональное PWA для пошагового обучения: теория, зачёты, тренировка слабых мест.

## Локальный запуск

```bash
npm install
npm run dev
```

## Сборка и проверки

```bash
npm run quality   # typecheck + lint + test + build + content/pwa/smoke checks
npm run check     # quality + coverage
```

## Структура

- `content/` — курсы в Markdown и JSON-контрактах
- `web/src/features/` — экраны приложения
- `web/src/ui/` — дизайн-система и компоненты
- `web/src/domain/` — бизнес-логика и тесты
- `web/src/storage/` — IndexedDB + миграции

## Деплой

Статический билд в `dist/` разворачивается на Vercel.
