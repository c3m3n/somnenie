# UX restructure plan v2.0

## 0. Fixed v2 decision: block checkpoint model

The first v2 refactor is not visual. It changes the progression model.

Canonical formula:

```text
User opens the app
-> continues from the saved place
-> completes one or several short lessons inside the current block
-> reaches the block checkpoint
-> if passed, the next block opens
-> if failed, the next block stays locked and mistakes must be reviewed
```

Main difference from v1:

```text
Not: lesson/station -> check -> next
But: block -> several lessons -> checkpoint -> next block
```

Vocabulary:

```text
Course
Section
Block
Lesson
Checkpoint
Error review
Review
Takeaways
```

Temporary mapping to the current codebase:

```text
module / M01 / M02 / M03 -> Block
theory / terms / practice / diagrams / summary -> lesson-like screens inside a block
quiz.md -> block checkpoint
weak spots / review items -> weak spots / review
journal / takeaway -> takeaways
```

Important migration rule:

```text
Current M01 is a block, not a station.
Do not mass-rename files first.
First change the meaning of "completed" and "next action".
```

## 1. Product core

The product is not a lesson library, not a classic course catalog, and not a long-scroll textbook.

The product is a guided reader for short sequential learning:

```text
short reader lessons
+
exact place autosave
+
checkpoints after meaningful lesson blocks
+
locks on the next block when understanding is not confirmed
+
weak-spot review
```

The application must take over the user's learning-management load:

```text
I know where you stopped.
I know what you have read.
I know what is not checked yet.
I know where you made mistakes.
I will not open the next required block until the base is confirmed.
Here is the next short action.
```

This is the main promise. All screens exist to support it.

## 2. Product position

Working description:

```text
A mobile-first guided learning reader where lessons are read page by page,
progress is saved at the exact page,
and new blocks open only after checkpoint understanding is confirmed.
```

Short version:

```text
Short lessons in a reader format, with checkpoints and admission to the next block.
```

The product should feel like a pocket learning route with an automatic teacher.
It should not feel like a folder of Markdown files.

## 3. Mental model

Replace the v1 mental model:

```text
Today -> Station -> Check -> Weak spot / Takeaway
```

With the v2 mental model:

```text
Now -> Reader lesson -> Lesson block checkpoint -> Open next block or fix weak spots -> Review later
```

Important distinction:

```text
Reading is not passing.
Passing is not mastery.
Mastery requires later successful review.
```

The product should preserve this distinction in state, copy, and navigation.

## 3.1 Canonical user flow

Primary flow:

```text
User opens the app
-> sees where they stopped
-> continues the current reader lesson
-> completes one or several lessons in the current lesson block
-> closes the app

User returns later
-> the app opens the exact required place
-> user finishes the lesson block
-> the app offers the block checkpoint
-> user passes or fails
```

If the checkpoint is passed:

```text
checkpoint passed
-> next block opens
-> Now shows the next available lesson
```

If the checkpoint is failed:

```text
checkpoint failed
-> next block stays locked
-> app shows the failed concepts and mistakes
-> user reviews weak spots
-> user takes a focused retry check
-> if retry is passed, next block opens
-> if retry is failed, the app keeps the next block locked and returns to weak-spot review
```

Important rule:

```text
Error review alone does not open the next block.
The next block opens only after understanding is confirmed by the checkpoint or retry check.
```

This keeps the product from becoming a passive explanation tool. It remains an admission system for sequential learning.

## 4. Navigation v1 for v2 product

Primary navigation:

```text
Сейчас | Курс | Повторение | Выводы
```

Meaning:

```text
Сейчас = the next required action
Курс = route map, locks, sections, lesson blocks
Повторение = weak spots and due review
Выводы = saved understanding and personal takeaways
```

Profile/settings are service screens. They should not be part of the main learning navigation.

Avoid:

```text
Атлас
Память
Станция
Журнал
```

These words are either too metaphorical or point to the old mental model.

## 5. Content hierarchy

The user-facing hierarchy should be:

```text
Topic
Course
Section
Lesson block
Lesson
Reader page
Checkpoint
Weak spot
Takeaway
```

Example for nutrition:

```text
Topic: Нутрициология
Course: Нутрициология с нуля
Section: База
Lesson block: Уровни питания
Lesson 1: Нутриент, продукт, рацион
Lesson 2: Классы нутриентов
Lesson 3: Норма не равна личному меню
Checkpoint: Базовые уровни питания
```

## 6. Core states

Lesson states:

```text
locked = lesson is not available yet
available = lesson can be started
in_progress = lesson started, exact reader page saved
read = lesson was read to the end, but no checkpoint has confirmed the block yet
```

Checkpoint states:

```text
locked = checkpoint is not available yet
available = enough lessons are read to take it
failed = checkpoint failed, next block remains locked
passed = checkpoint passed, next block opens
```

Concept states:

```text
seen = concept appeared in reading
checked = concept was tested
weak = user missed or confused it
review_due = it should be repeated
mastered = it was later reviewed successfully
```

User-facing labels:

```text
Можно читать
Начато
Прочитано, но не проверено
Нужна контрольная точка
Дальше пока закрыто
Сдано
Нужно повторить
Закреплено
```

## 7. The Now screen

The `Сейчас` screen is the product's dispatcher. It must return exactly one primary action.

It answers:

```text
What should I do right now?
Why this action?
Where will it take me?
What opens after it?
```

It must not become a dashboard.

### State A: continue a reader lesson

User sees:

```text
Сейчас

Продолжить обучение

Раздел 1 · База
Урок 2 из 3
Шесть классов нутриентов

Вы остановились:
Экран 3 из 6 · Вода тоже нутриент

После этого урока:
останется 1 урок до контрольной точки

[Продолжить]
```

How it works:

```text
Primary action opens the reader at the exact saved page.
No choice is required.
The user does not need to remember the course map.
```

### State B: checkpoint is required

User sees:

```text
Сейчас

Нужна контрольная точка

Вы прочитали 3 урока блока "Уровни питания".
Чтобы открыть следующий блок, пройдите короткую проверку.

5 вопросов · около 3 минут

[Пройти контрольную]
```

How it works:

```text
This appears after a meaningful lesson block is read.
It should not appear after every reader page.
The copy is direct: reading happened, admission is not granted yet.
```

### State C: checkpoint failed

User sees:

```text
Сейчас

Дальше пока закрыто

Контрольная точка "Уровни питания" не сдана.

Слабые места:
- нутриент != продукт
- норма != личная рекомендация

Разберите ошибки, чтобы открыть следующий блок.

[Разобрать ошибки]
```

How it works:

```text
Failure is real but not dramatic.
The next block remains locked.
The app explains what blocks progress and what to do next.
```

### State D: next block opened

User sees:

```text
Сейчас

Следующий блок открыт

Контрольная точка "Уровни питания" сдана.
Можно перейти к блоку "Энергия и баланс".

[Начать первый урок]
```

How it works:

```text
The screen explains why the user can continue.
Access is earned by the checkpoint, not by scrolling.
```

### State E: due review

User sees:

```text
Сейчас

Повторить перед новым блоком

Сегодня нужно закрыть 2 слабых места из прошлых уроков.
Это займет около 3 минут.

[Начать повторение]

После этого:
Урок 4 · Энергия и баланс
```

How it works:

```text
Due review can become the primary action.
It should not block everything by default.
It blocks only when the weak spot is a prerequisite for the next block.
```

## 8. Course screen

The `Курс` screen is a route map, not the primary decision surface.

It answers:

```text
Where am I in the course?
What is open?
What is locked?
What must be done to unlock the next part?
```

User sees:

```text
Курс

Нутрициология с нуля

Раздел 1 · База
✓ Урок 1 · Нутриент, продукт, рацион
✓ Урок 2 · Классы нутриентов
→ Урок 3 · Норма не равна личному меню
□ Контрольная точка · База

Раздел 2 · Энергия
закрыто до контрольной точки "База"
```

Rules:

```text
Only available lessons and checkpoints are clickable.
Locked items explain the condition.
The strongest CTA still belongs on Сейчас, not here.
```

## 9. Reader lesson screen

The reader lesson is the core experience.

It must not be a long vertical scroll.

Reader structure:

```text
Lesson
  Page 1: main idea
  Page 2: explanation
  Page 3: example
  Page 4: typical mistake
  Page 5: mini summary
```

User sees:

```text
Урок 2 · Шесть классов нутриентов

Экран 3 из 6

Вода тоже нутриент

Вода не дает энергии, но без нее не работают транспорт веществ,
терморегуляция и выведение отходов.

[Назад]        3 / 6        [Дальше]
```

Reader behavior:

```text
Horizontal page progression.
Tap or button to move forward/back.
Swipe can be added later, but buttons must remain.
Exact page autosaves.
Leaving the lesson preserves lessonId, pageIndex, and timestamp.
```

Content rule:

```text
If a reader page needs long scrolling, it is too large.
Split it into two pages.
```

Allowed local scroll:

```text
Small internal scroll only for tables, diagrams, or references.
It should not become the main reading mechanism.
```

Reader page types:

```text
main_idea
explanation
example
common_mistake
mini_summary
source_note
```

## 10. Checkpoint screen

Checkpoint is not a quiz tab. It is an admission check after a meaningful block.

User sees before starting:

```text
Контрольная точка

Блок: Уровни питания

Проверим 3 понятия:
- нутриент
- продукт
- рацион

5 вопросов · около 3 минут

[Начать]
```

During the checkpoint:

```text
Вопрос 2 из 5

Почему нельзя назвать продукт хорошим только по одному нутриенту?

[answers]
```

Rules:

```text
Checkpoint tests concepts, not memory of wording.
Critical concepts can block passing even if total score is acceptable.
Passing condition can be:
score >= 80%
AND all critical concepts passed
```

## 11. Checkpoint result screen

Passed state:

```text
Контрольная сдана

4 из 5 правильных ответов
Ключевые понятия подтверждены.

Открыт следующий блок:
Энергия и баланс

[Продолжить]
```

Failed state:

```text
Контрольная не сдана

2 из 5 правильных ответов

Что нужно разобрать:
- нутриент != продукт
- рацион не оценивается по одному приему пищи

Следующий блок пока закрыт.

[Разобрать ошибки]
```

Rules:

```text
Do not shame the user.
Do not say the lesson is passed when understanding is not confirmed.
Always show the next constructive action.
```

## 12. Error review screen

This screen turns failed checkpoint answers into weak spots.

User sees:

```text
Разбор ошибок

Слабое место 1 из 2

Вы смешали нутриент и продукт.

Нутриент - это вещество.
Продукт - это пищевая матрица.

Пример:
сахар как нутриент и сок как продукт - разные уровни анализа.

[Понятно]
```

After the review:

```text
Повторная проверка

2 вопроса по слабым местам

[Начать]
```

Rules:

```text
Error review is not a list of wrong answers.
It explains the misunderstanding.
Each weak spot should map to a concept, not only to a question number.
```

## 13. Review screen

The `Повторение` screen is a consequence of mistakes and time, not a decorative feature.

User sees:

```text
Повторение

Сегодня нужно закрыть:
3 слабых места

1. Нутриент != продукт
2. Порция меняет смысл продукта
3. Рацион важнее отдельного приема пищи

[Начать повторение]
```

Review card:

```text
Почему нельзя назвать продукт "хорошим" только по одному нутриенту?

[Показать ответ]

Оцените:
[Не понял] [Почти понял] [Понял]
```

Rules:

```text
For important prerequisite weak spots, prefer a new question over pure self-rating.
Old due review should be prioritized, but not always hard-block the whole course.
Prerequisite weak spots can block the next dependent block.
```

## 14. Takeaways screen

The `Выводы` screen is the user's accumulated understanding.

It is not mandatory homework and not a diary-first experience.

User sees:

```text
Выводы

Нутрициология

База
- Нельзя судить о рационе по одному нутриенту.
- Норма потребления - ориентир, не личное меню.

Энергия
- Вес меняется от устойчивого баланса энергии, а не от одного продукта.
```

Rules:

```text
Takeaways are created automatically after passed checkpoints or lesson summaries.
User editing is optional.
The screen should help revisit understanding, not manage profile data.
```

## 15. Settings/profile

Profile is a service area.

It can contain:

```text
name
goal
data export
reset progress
offline/app settings
```

It should not occupy a main navigation slot in v2.

## 16. Next action algorithm

Core function:

```text
getNextAction()
```

Priority:

```text
1. If there is a failed blocking checkpoint:
   show error review.

2. If there is an in-progress reader lesson:
   continue from saved page.

3. If a lesson block is read but checkpoint is not passed:
   show checkpoint.

4. If a prerequisite weak spot blocks the next block:
   show targeted review.

5. If there is high-priority due review:
   show short review session.

6. If a next lesson is available:
   start it.

7. If the course is complete:
   show completion and maintenance review.
```

This is the heart of the product.

The app is valuable because it computes the next required action and removes the user's need to manage the route manually.

## 17. Screen list for v2

Required screens:

```text
1. Сейчас
2. Курс
3. Читалка урока
4. Контрольная точка
5. Результат контрольной
6. Разбор ошибок
7. Повторение
8. Выводы
9. Профиль/настройки
```

Not required for v2:

```text
marketplace
course editor
social features
ratings
public profiles
complex gamification
AI advice
meal tracking
```

## 18. MVP boundary

The first v2 MVP should prove one loop:

```text
open app
-> continue exact reader page
-> finish a small lesson block
-> take checkpoint
-> pass and open next block
OR fail and review weak spots
-> return later to the same state
```

Minimum scope:

```text
one course
one topic
2 sections
3-5 reader lessons per section
one checkpoint per section or lesson block
exact page autosave
blocking checkpoint
weak-spot review
Now screen
Course screen
Reader screen
Checkpoint/result/error-review screens
```

## 19. Guardrails

1. Do not replace long scrolling with long pages. Reader pages must be small.

2. Do not test after every page by default. Checkpoints happen after meaningful blocks.

3. Do not call reading "passed".

4. Do not make failure dramatic. Make it actionable.

5. Do not let Course become the main manual navigation surface. `Сейчас` decides the next action.

6. Do not let repetition become optional decoration. It is generated from weak spots.

7. Do not add platform/admin scope to v2.

8. Do not hide why something is locked. Every lock needs a plain reason and a next action.

## 20. Open product questions

These should be decided before implementation:

```text
How many lessons belong to one checkpoint block?
Default hypothesis: 3-5 short lessons.

How long is one reader lesson?
Default hypothesis: 3-7 reader pages, 3-7 minutes.

How strict is a checkpoint?
Default hypothesis: score >= 80% and all critical concepts passed.

When does due review block progress?
Default hypothesis: only when the weak spot is a prerequisite for the next block.

Should one current 24-module nutrition course become 6 sections or more?
Default hypothesis: keep 6 sections, split modules into reader lessons and checkpoints.
```

## 21. Screen sketches v0

These are low-fidelity mobile-first sketches. They define what each screen must communicate before visual design starts.

General screen rule:

```text
One screen = one mode.
One mode = one primary action.
Secondary actions must not compete with the primary learning path.
```

### 21.1 App shell

Persistent bottom navigation:

```text
[Сейчас] [Курс] [Повторение] [Выводы]
```

Top area:

```text
Course/context title
Small settings/profile entry
```

Rules:

```text
The shell should not show too many counters.
The user should feel "I know what to do", not "I need to manage a dashboard".
```

### 21.2 Сейчас: continue reading

Purpose:

```text
Return the user to the exact learning place.
```

Sketch:

```text
Сейчас

Продолжить обучение

Нутрициология с нуля
Раздел 1 · База

Урок 2 из 3
Шесть классов нутриентов

Вы остановились:
Экран 3 из 6
Вода тоже нутриент

До контрольной точки:
еще 1 урок

[Продолжить]

Мелко:
последний раз: сегодня, 14:20
```

Primary action:

```text
Open reader at saved page.
```

Do not show:

```text
full course map
all modules
multiple equal cards
large motivational text
```

### 21.3 Сейчас: checkpoint required

Purpose:

```text
Tell the user that reading is done, but admission is not confirmed.
```

Sketch:

```text
Сейчас

Нужна контрольная точка

Вы прочитали блок:
Уровни питания

Чтобы открыть следующий блок,
нужно подтвердить базовое понимание.

Проверим:
- нутриент
- продукт
- рацион

5 вопросов · около 3 минут

[Пройти контрольную]
```

Primary action:

```text
Start checkpoint intro/question flow.
```

### 21.4 Сейчас: failed checkpoint

Purpose:

```text
Explain why progress is blocked and what unlocks it.
```

Sketch:

```text
Сейчас

Дальше пока закрыто

Контрольная точка не сдана:
Уровни питания

Слабые места:
1. Нутриент != продукт
2. Норма != личная рекомендация

Следующий блок откроется после
повторной проверки этих мест.

[Разобрать ошибки]
```

Primary action:

```text
Open error review.
```

Rule:

```text
The screen must be calm and practical.
No shame copy.
No "try harder" language.
```

### 21.5 Курс

Purpose:

```text
Show the route and locks, not decide the next action.
```

Sketch:

```text
Курс

Нутрициология с нуля

Раздел 1 · База
Статус: идет

Уроки блока:
[Сдано] Урок 1 · Нутриент, продукт, рацион
[Прочитано] Урок 2 · Классы нутриентов
[Открыто] Урок 3 · Норма и меню
[Закрыто] Контрольная точка · База

Раздел 2 · Энергия
Закрыто
Откроется после контрольной точки "База"
```

Item states:

```text
Закрыто
Открыто
Начато
Прочитано
Нужна контрольная
Сдано
Нужно повторить
Закреплено
```

Primary action:

```text
Usually none, or "Перейти к текущему шагу".
```

Rules:

```text
Locked items should explain the lock.
Available items can be opened, but Сейчас remains the main route.
```

### 21.6 Читалка урока

Purpose:

```text
Read one small page, then move to the next page.
```

Sketch:

```text
Урок 2 · Шесть классов нутриентов

Экран 3 из 6

Вода тоже нутриент

Вода не дает энергии, но без нее
не работают транспорт веществ,
терморегуляция и выведение отходов.

Пример:
без воды кровь не переносит вещества
и тело хуже регулирует температуру.

[Назад]        3 / 6        [Дальше]
```

Top controls:

```text
close/back
lesson title
optional page menu
```

Bottom controls:

```text
Назад
page indicator
Дальше
```

Autosave:

```text
lessonId
pageIndex
lastActiveAt
optional local position inside page if a small component scrolls
```

Content rules:

```text
One reader page should fit one main idea.
If a page feels like an article section, split it.
Tables and diagrams can be horizontally or locally scrollable, but the lesson itself is page-based.
```

### 21.7 End of lesson page

Purpose:

```text
Close a reader lesson without pretending that the block is passed.
```

Sketch:

```text
Урок прочитан

Главная мысль:
Вода - нутриент, даже если она не дает энергии.

Дальше:
еще 1 урок до контрольной точки

[Следующий урок]
[Закрыть]
```

If this was the final lesson in a block:

```text
Блок прочитан

Теперь нужна контрольная точка,
чтобы открыть следующий блок.

[Пройти контрольную]
[Вернуться позже]
```

### 21.8 Контрольная точка: intro

Purpose:

```text
Prepare the user for a short admission check.
```

Sketch:

```text
Контрольная точка

Блок:
Уровни питания

Проверим, держится ли база:
- нутриент
- продукт
- рацион

5 вопросов
около 3 минут

Чтобы открыть следующий блок:
80% и все ключевые понятия

[Начать]
```

Rules:

```text
Use "контрольная точка", not "экзамен".
Explain unlock criteria before the attempt.
```

### 21.9 Контрольная точка: question

Purpose:

```text
Test concept understanding.
```

Sketch:

```text
Вопрос 2 из 5

Понятие:
продукт

Почему нельзя назвать продукт
"хорошим" только по одному нутриенту?

[A] потому что продукт - это пищевая матрица
[B] потому что нутриенты не важны
[C] потому что калории всегда важнее
[D] потому что состав нельзя читать
```

After answer:

```text
Короткая обратная связь:
Верно / Неверно

Почему:
...

[Дальше]
```

Rules:

```text
Do not make the user hunt for UI.
Feedback should teach, but not become a full article.
```

### 21.10 Результат контрольной

Purpose:

```text
Give a clear admission decision.
```

Passed sketch:

```text
Контрольная сдана

4 из 5
Ключевые понятия подтверждены.

Открыт следующий блок:
Энергия и баланс

[Начать следующий блок]
```

Failed sketch:

```text
Контрольная не сдана

2 из 5

Не держатся:
1. Нутриент != продукт
2. Рацион не оценивается по одному продукту

Следующий блок пока закрыт.

[Разобрать ошибки]
```

Rules:

```text
Result must answer "can I go further?"
If no, it must answer "what exactly do I fix?"
```

### 21.11 Разбор ошибок

Purpose:

```text
Turn wrong answers into understandable weak spots.
```

Sketch:

```text
Разбор ошибок

Слабое место 1 из 2

Вы смешали:
нутриент и продукт

Как правильно:
Нутриент - вещество.
Продукт - пищевая матрица.

Пример:
сахар как нутриент != сок как продукт

[Понятно]
```

After all weak spots:

```text
Готово к повторной проверке

2 вопроса по слабым местам

[Пройти повторную проверку]
```

Rules:

```text
Error review explains misunderstandings, not only correct answers.
Retry check is required to unlock the next block.
```

### 21.12 Повторение

Purpose:

```text
Return to weak spots later.
```

Sketch:

```text
Повторение

Сегодня:
2 слабых места

1. Нутриент != продукт
2. Норма != личное меню

Около 3 минут

[Начать]
```

Review card sketch:

```text
Слабое место:
Нутриент != продукт

Новый вопрос:
Почему сок и цельный фрукт нельзя сравнивать
только по сахару?

[Ответить]
```

Rules:

```text
For prerequisite weak spots, use a real question.
For old lightweight review, self-rating can be acceptable.
```

### 21.13 Выводы

Purpose:

```text
Show accumulated understanding, not a diary chore.
```

Sketch:

```text
Выводы

Нутрициология

Раздел 1 · База

После контрольной точки:
Нельзя судить о рационе по одному нутриенту.

Мои формулировки:
[optional edited takeaway]

Слабые места, которые были закрыты:
- нутриент != продукт
```

Rules:

```text
Takeaways can be auto-created.
Editing is optional.
The screen is for revisiting understanding, not for required journaling.
```

### 21.14 Profile/settings

Purpose:

```text
Service area only.
```

Sketch:

```text
Настройки

Профиль
Цель обучения
Экспорт данных
Сброс прогресса
Офлайн-режим
```

Rules:

```text
No primary learning actions here.
Do not put it in the main learning nav.

### 23. Debt note for MVP recovery flow

Later: checkpoint retake should use equivalent questions, not identical answers.
```
