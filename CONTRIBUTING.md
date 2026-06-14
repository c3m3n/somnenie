# Contributing

## Базовое правило

Один pull request решает одну задачу. Если изменение нельзя объяснить одним предложением, его нужно разбить.

Плохой PR: `редизайн, фиксы, README, CI`.

Хороший PR: `fix: block direct quiz route for locked module`.

## Ветки

Используйте короткие имена:

```text
fix/quiz-route-guard
feat/progress-summary
docs/repository-hygiene
chore/remove-unused-assets
```

## Коммиты

Используйте понятные префиксы:

```text
feat: add progress summary
fix: block locked quiz route
refactor: extract markdown renderer
docs: document repository hygiene
test: cover quiz retry flow
chore: remove unused assets
ci: run quality checks on pull requests
```

Если в сообщении хочется написать `and`, коммит почти всегда нужно разбить.

## Pull Request

В описании PR должны быть:

- что изменилось;
- зачем это нужно;
- как проверялось;
- какие есть риски;
- какие области затронуты.

PR без описания не должен мержиться, даже если он маленький.

## Проверки

Перед PR запустите:

```powershell
npm run quality
```

Для релизных или рискованных изменений дополнительно запустите:

```powershell
npm run check
npm run e2e
```

`npm run quality` выполняет typecheck, ESLint, Vitest, production build, проверку контента, PWA-контракт и smoke-проверки.

## Доменная логика

Доменная модель не меняется ради удобства UI.

Если UI требует производное значение, оно должно вычисляться в application/view-model слое, а не записываться в домен.

Изменения в `web/src/domain` требуют явного объяснения в PR.

## Когда нужен architectural note

Добавьте ADR или отдельную заметку, если изменение:

- меняет хранение прогресса;
- меняет порядок открытия блоков;
- меняет PWA/offline-поведение;
- меняет контракт контента в `content/`;
- добавляет новый слой архитектуры или зависимость.
