import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const review = require("../core/review.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const start = "2026-06-11";
let state = review.normalizeReviewState();
state = review.upsertWrongQuestion(state, {
  moduleId: "M09",
  question: { number: 3, text: "Что сравниваем: нутриент, продукт или рацион?" },
  diagnosis: {
    level: { label: "Продукт", key: "product" },
    mistakeType: "Нутриент принят за продукт",
  },
}, start);

let item = state.items[0];
assert(item.courseId === "nutrition", "Review item should carry courseId");
assert(item.id === "M09-q3", "Question review id should be module-question based");
assert(item.interval === 1, "Wrong quiz answer should reset interval to 1 day");
assert(item.due === "2026-06-12", "Wrong quiz answer should return tomorrow");
assert(item.errors === 1 && item.streak === 0, "Wrong answer should increment errors and reset streak");

item = review.applyReviewAnswer(item, true, "2026-06-12");
assert(item.interval === 3, "First correct review should move to 3 days");
assert(item.due === "2026-06-15", "First correct review due date should be +3 days");

item = review.applyReviewAnswer(item, true, "2026-06-15");
assert(item.interval === 7 && item.due === "2026-06-22", "Second correct review should move to 7 days");

item = review.applyReviewAnswer(item, false, "2026-06-22");
assert(item.interval === 1, "Wrong review answer should reset interval to 1 day");
assert(item.due === "2026-06-23", "Wrong review answer should return tomorrow");
assert(item.errors === 2 && item.streak === 0, "Wrong review answer should increment errors and reset streak");

for (const [now, interval, due] of [
  ["2026-06-23", 3, "2026-06-26"],
  ["2026-06-26", 7, "2026-07-03"],
  ["2026-07-03", 14, "2026-07-17"],
  ["2026-07-17", 30, "2026-08-16"],
  ["2026-08-16", 60, "2026-10-15"],
]) {
  item = review.applyReviewAnswer(item, true, now);
  assert(item.interval === interval, `Expected interval ${interval} after ${now}`);
  assert(item.due === due, `Expected due ${due} after ${now}`);
  assert(item.retired === false, "Item should not retire before the next 60-day success");
}

item = review.applyReviewAnswer(item, true, "2026-10-15");
assert(item.retired === true, "Correct answer after 60-day interval should retire the item");
assert(item.due === null, "Retired item should not stay due");

let queue = review.normalizeReviewState({ items: [] });
for (let i = 1; i <= 12; i++) {
  queue.items.push(review.normalizeReviewItem({
    id: `M01-q${i}`,
    courseId: "nutrition",
    moduleId: "M01",
    kind: "question",
    questionNumber: i,
    text: `Question ${i}`,
    errors: i,
    due: "2026-06-11",
    interval: 1,
  }, start));
}
const due = review.dueReviewItems(queue, start);
assert(due.length === 10, "Due queue should cap at 10 items");
assert(due[0].errors === 12 && due[9].errors === 3, "Due queue should sort by errors descending");

const grouped = review.groupReviewItems({
  items: [
    { id: "M01-q1", moduleId: "M01", due: "2026-06-10", interval: 1, errors: 1 },
    { id: "M01-q2", moduleId: "M01", due: "2026-06-18", interval: 7, errors: 1 },
    { id: "M01-q3", moduleId: "M01", retired: true, interval: 60, errors: 1 },
  ],
}, start);
assert(grouped.today.length === 1, "Grouping should expose due-today items");
assert(grouped.soon.length === 1, "Grouping should expose soon items");
assert(grouped.retired.length === 1, "Grouping should expose retired items");

const migrated = review.itemFromWeakSpot("M02", {
  number: 4,
  text: "Старая ошибка",
  level: "Рацион",
  levelKey: "ration",
  misses: 3,
  updatedAt: "2026-06-09T12:00:00.000Z",
}, start);
assert(migrated.id === "M02-q4", "Weak spot migration should preserve question identity");
assert(migrated.due === start, "Weak spot migration should make the item due today");
assert(migrated.errors === 3, "Weak spot migration should preserve miss count as errors");
assert(migrated.courseId === "nutrition", "Migrated weak spot should carry courseId");

let sessions = review.recordSessionActivity(null, { reviews: 2 }, "2026-06-11");
assert(sessions.streakDays === 1, "First activity day should start streak");
sessions = review.recordSessionActivity(sessions, { moduleStep: true }, "2026-06-12");
assert(sessions.streakDays === 2, "Consecutive activity day should extend streak");
sessions = review.recordSessionActivity(sessions, { reviews: 1 }, "2026-06-14");
assert(sessions.streakDays === 1, "Skipped day should quietly reset streak");
assert(sessions.bestStreakDays === 2, "Best streak should be preserved after reset");
assert(sessions.activeDays.includes("2026-06-14"), "Active day matrix should record activity date");

const plan = review.buildSessionPlan({
  review: queue,
  sessions: { lastDate: "2026-06-01", streakDays: 3 },
  nextModule: { id: "M09", title: "Module 9" },
  now: start,
});
assert(plan.reviews.length === 3, "Long break session should start with three oldest due reviews");
assert(plan.moduleStep.moduleId === "M09", "Session plan should include the next module step");

console.log("Review tests passed.");
