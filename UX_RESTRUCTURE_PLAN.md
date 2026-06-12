# UX restructure plan v1.0

## 1. Core product shift

Nutrio is a daily learning route, not a lesson catalog.

The product should not ask the user to re-enter the course structure every time. It should decide the next useful learning act, explain why this act matters now, and show what happens after it.

Target formula:

```text
Open app -> see one useful act -> complete a short station -> diagnose understanding -> return weak spots later
```

This is a product model change, not a screen polish pass.

## 2. Main daily path

The primary user path must stay short:

```text
Today -> Station -> Check -> Weak spot / Takeaway -> Repeat later
```

This is the main scenario. Atlas and Journal can support it, but they are not required daily steps.

The user should almost always see one recommended next task, not a set of equal navigation choices.

## 3. Mental model hierarchy

Most important rule:

```text
Today is not a section. Today is the default operating mode.
```

Correct interpretation:

```text
User opens Nutrio -> Nutrio decides the next act.
```

Incorrect interpretation:

```text
User opens Nutrio -> chooses Today / Atlas / Memory / Journal.
```

Product layers:

```text
Today = what to do now
Station = one short learning unit
Memory = weak spots and spaced repetition
Atlas = where I am in the course
Journal = personal takeaways and understanding history
```

Hierarchy:

```text
Primary mode:
Today

Driven by Today:
Station
Memory

Supporting layers:
Atlas
Journal
```

The user's center of gravity must remain:

```text
What should I do now?
```

Not:

```text
Where should I go?
```

## 4. Product rules

1. The home screen always shows one main action.

2. Due repetition is more important than new material, but it must be limited to a short session.

3. One learning station should be short: 5-8 minutes.

4. A module can contain multiple stations.

5. Memory stores weak spots, not just missed questions.

6. Journal entries are saved automatically; editing is optional.

7. Primary progress is completed stations. Secondary progress is the current step inside a station.

## 5. Learning state model

Slice 0 should define the state model before visual redesign work.

Minimum entities:

```text
TodayAction
Station
StationProgress
WeakSpot
ReviewCard
JournalEntry
AtlasNode
```

### TodayAction

```text
type = repeat | continue_station | start_station | course_complete
title
description
estimatedTime
primaryCta
secondaryContext
targetRoute
reason
afterAction
```

### Station

```text
id
moduleId
title
mainIdea
estimatedMinutes
steps = understand | apply | check | anchor
sourceContent
```

### StationProgress

```text
stationId
currentStep
completedSteps
checkCompleted
takeawaySaved
weakSpotIds
completedAt
```

### WeakSpot

```text
id
diagnosticType
userLabel
shortExplanation
reviewStrategy
moduleId
stationId
createdAt
updatedAt
```

Example:

```text
diagnosticType:
nutrient_vs_product_reasoning

userLabel:
You judged a product by one nutrient.

shortExplanation:
A product is a food matrix, not just a nutrient list.

reviewStrategy:
Ask a new comparison question about two products.
```

### ReviewCard

```text
id
weakSpotId
dueAt
interval
lastResult
questionSource
```

### JournalEntry

```text
id
stationId
moduleId
takeaway
source = auto | edited
createdAt
updatedAt
```

### AtlasNode

```text
id
type = phase | module | station
status = locked | not_started | in_progress | completed | has_weak_spots | repeat_today
progress
```

## 6. Today priority algorithm

Today is not a dashboard. Today is the attention dispatcher.

Priority order:

```text
If there are due weak spots:
  select the highest-priority 3-5 weak spots;
  start a short repetition session;
  show what comes after.

Else if there is an unfinished station:
  continue it from the exact next step.

Else if there is a next station:
  start it.

Else if the course is complete:
  suggest practice, journal review, or maintenance repetition.
```

Session limits:

```text
Repetition session: 3-5 weak spots or 4-6 minutes.
Station session: 5-8 minutes.
```

The screen should not present several equally strong actions. It should make a decision and show the reason.

Example with due repetition:

```text
Today

Repeat 2 weak spots
This will take about 4 minutes.

[Start repetition]

After that:
Continue M03.2 · Proteins and satiety
```

Example without due repetition:

```text
Today

Continue M03.2 · Proteins and satiety
Read one short block and answer 2 questions.

About 6 minutes

[Continue]
```

## 7. Station model

Replace the mental model of "module with tabs" with "station with a linear route".

Important distinction:

```text
Module = curriculum container.
Station = daily learning unit.
```

Example:

```text
M01 · Introduction to nutrition
  M01.1 · Nutrient / product / diet
  M01.2 · Six nutrient classes
  M01.3 · Essential nutrients
```

Old model:

```text
Theory / Terms / Practice / Diagrams / Check / Summary
```

Target model:

```text
Understand -> Apply -> Check -> Anchor
```

Rule:

```text
One station = one idea + one example + one check + one takeaway
```

Station structure:

```text
1. Understand
A short block with one main idea.

2. Apply
An example or mini situation.

3. Check
1-3 questions.

4. Anchor
Verdict, weak spot, and personal takeaway.
```

The user should not choose a content format. The user should move through a learning station.

Implementation note:

```text
First version may wrap existing module content into one guided route.
Target model is to split modules into 5-8 minute stations.
```

This prevents "Guided Lesson" from becoming the old module model with renamed tabs.

## 8. Memory model

Memory must work with error patterns, not only repeated questions.

Weak model:

```text
User missed question 4.
Repeat question 4.
```

Target model:

```text
Weak spot:
Confuses nutrient-level and product-level reasoning.

Repetition:
Give a new question testing the same misunderstanding.
```

Memory flow:

```text
Wrong answer -> diagnose weak spot -> store memory card -> later ask a new question -> increase interval after a correct answer
```

Example:

```text
Weak spot:
You made a conclusion about a product from one nutrient.

Return interval:
1 day -> 3 days -> 7 days -> 14 days
```

Memory records need two layers:

```text
Internal diagnostic type
Human-readable learning card
```

This is the difference between a quiz repeater and a trainer for understanding.

## 9. Atlas role

Atlas explains context. It does not decide the next action.

Atlas answers:

```text
Where am I in the overall route?
```

Today answers:

```text
What should I do now?
```

Atlas can show:

```text
Phase 1 · Basics
M01 completed
M02 in progress
M03 next
M04 locked
```

Atlas states:

```text
not started
in progress
completed
has weak spots
repeat today
locked
```

Atlas should avoid becoming a grid of module cards with many manual choices. The user moves through Today; Atlas shows how the route is built.

## 10. Journal role

Journal is not extra homework. It is the trace left by learning.

After a station:

```text
Takeaway saved to Journal

Nutrient, product, and diet are different levels of analysis.
You cannot judge a diet by one substance.

[Edit in my words]
[Continue]
```

The takeaway should be saved automatically. The user can edit it, but saving should not be an extra required action.

Journal should accumulate:

```text
what I understood
which myths I unpacked
where I made mistakes
which weak spots returned
```

## 11. Motion rules

Awwwards-style motion is allowed only as a layer of explanation, not as a layer of meaning.

Rule:

```text
Motion must explain state or transition.
If it does not explain state, it is decorative.
If it is decorative, it must be short, rare, and optional.
```

Useful motion:

```text
Today -> station opens
station -> check starts
wrong answer -> weak spot moves to Memory
Memory -> interval increases
Atlas -> station changes state
```

Harmful motion:

```text
while reading long text
while choosing an answer
while reading mistake explanation
when repeating the same CTA
```

Best principle:

```text
Movement should show cause and effect.
```

## 12. Implementation slices

Do not start with a full redesign. Start with the state model, then ship vertical UX slices.

Current implementation status:

```text
Slice 0: implemented as compatibility state helpers.
Slice 1: implemented; Today is the default operating mode and Atlas is secondary.
Slice 2: implemented as a station route over existing module files.
Slice 3: implemented as weak-spot learning cards over the existing SRS engine.
Slice 4: implemented; Journal now auto-saves the station takeaway and keeps user edits as a draft until the user continues.
```

### Slice 0: Learning state model

Scope:

- define `TodayAction`;
- define station and station progress;
- define weak spot and review card fields;
- define journal entry rules;
- define Atlas node status;
- define progress rules;
- define analytics events.

Success criteria:

- Today can be computed from state, not manually assembled by UI;
- station progress is independent from module progress;
- weak spots have both diagnostic and user-facing fields;
- progress has a clear unit.

### Slice 1: Today as the default operating mode

Scope:

- create a single-action Today screen;
- implement the priority algorithm and session limits;
- move the current course overview into a secondary Atlas view;
- keep existing content, storage, quiz, and review logic;
- do not redesign Station yet.

Success criteria:

- the first screen has one dominant CTA;
- due repetitions are selected before new material, within the short-session limit;
- an unfinished station/module is resumed before starting a new one;
- Atlas is reachable but does not compete with Today;
- the user can start or continue learning without understanding the full course map.

### Slice 2: Station route

Scope:

- replace tab-first module navigation with a linear Station route;
- temporarily map existing module content into station steps;
- target later content splitting into multiple stations per module;
- keep terms and sources as supporting material, not equal route steps.

Temporary mapping:

```text
theory.md -> Understand
practice.md / diagrams.md -> Apply
quiz.md -> Check
summary.md -> Anchor
terms.md -> support
```

Success criteria:

- a station feels like one learning step, not a mini LMS;
- the user always sees the next action inside the station;
- completion requires the learning loop, not just opening material.

### Slice 3: Memory as weak spots

Scope:

- make the Memory UI describe weak spots, not only missed questions;
- keep the existing spaced repetition intervals;
- make Today surface due weak spots as the top priority;
- prepare for future generated or alternate questions per weak spot.

Success criteria:

- the user understands what misunderstanding is being repeated;
- a due weak spot appears on Today;
- after a correct answer, the return interval is visible.

### Slice 4: Journal as learning trace

Scope:

- auto-save station takeaways;
- allow optional editing in the user's words;
- collect saved takeaways in Journal;
- include weak spot history as part of understanding history.

Success criteria:

- Journal does not block station completion;
- the user can see accumulated understanding without doing extra admin work.

## 13. Success metrics

### Slice 1: Today

```text
Time to first meaningful action decreases.
Primary CTA click rate increases.
Users can answer "what should I do now?" within 3 seconds.
Fewer users open Atlas before starting learning.
More users resume unfinished work.
```

### Slice 2: Station

```text
Station completion rate.
Drop-off between Understand and Check.
Average time per station.
Percentage of users reaching Anchor.
```

### Slice 3: Memory

```text
Due repetition completion rate.
Weak spot clearance rate.
Repeat accuracy improvement.
Number of weak spots becoming overdue.
```

### Slice 4: Journal

```text
Takeaway auto-save success rate.
Takeaway edit rate.
Journal revisit rate.
```

## 14. Risks and guardrails

Guardrails:

```text
1. Today must never become a dashboard with many equal cards.

2. Atlas must never become the main way to choose what to learn next.

3. Station must never become a module with renamed tabs.

4. Memory must never become a list of missed questions without weak spot diagnosis.

5. Journal must never become mandatory homework.

6. Motion must never slow down reading, answering, or reviewing mistakes.
```

Main implementation risk:

```text
The team technically implements the new names, but keeps the old mental model.
```

The product should be judged by behavior:

```text
Open app -> one useful act -> short station -> check -> weak spot or takeaway -> later repetition
```

Not by whether every named screen exists.
