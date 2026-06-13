import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const projectRoot = process.cwd();
const source = await readFile(path.join(projectRoot, "core", "learningPath.js"), "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "core/learningPath.js" });

const learningPath = context.NutrioLearningPath;
const blocks = [{ id: "M01", title: "Base" }, { id: "M02", title: "Macros" }];

test("new learner starts the first block", () => {
  const action = learningPath.getNextLearningAction(blocks, {});
  assert.equal(action.type, "start_block");
  assert.equal(action.blockId, "M01");
  assert.equal(learningPath.getBlockState(blocks[0], {}), "available");
});

test("started block continues before checkpoint", () => {
  const action = learningPath.getNextLearningAction(blocks, { M01: { takeawayDraft: "note" } });
  assert.equal(action.type, "continue_block");
  assert.equal(action.blockId, "M01");
});

test("read block sends learner to checkpoint", () => {
  const progress = { M01: { theoryRead: true } };
  const action = learningPath.getNextLearningAction(blocks, progress);
  assert.equal(action.type, "take_checkpoint");
  assert.equal(action.blockId, "M01");
  assert.equal(learningPath.getBlockState(blocks[0], progress), "checkpoint_ready");
});

test("failed checkpoint blocks the next block", () => {
  const progress = {
    M01: { theoryRead: true, quizAttemptStatus: "complete", quizBest: 3, quizTotal: 5 },
  };
  const action = learningPath.getNextLearningAction(blocks, progress);
  assert.equal(action.type, "fix_failed_checkpoint");
  assert.equal(action.blockId, "M01");
  assert.equal(learningPath.findNextAvailableBlock(blocks, progress).id, "M01");
  assert.equal(learningPath.getBlockState(blocks[0], progress), "checkpoint_failed");
});

test("passed checkpoint opens the next block", () => {
  const progress = {
    M01: { theoryRead: true, quizAttemptStatus: "complete", quizBest: 4, quizTotal: 5 },
  };
  const action = learningPath.getNextLearningAction(blocks, progress);
  assert.equal(action.type, "start_block");
  assert.equal(action.blockId, "M02");
  assert.equal(learningPath.isCheckpointPassed(progress.M01), true);
});

test("all passed blocks complete the course", () => {
  const progress = {
    M01: { theoryRead: true, quizBest: 4, quizTotal: 5 },
    M02: { theoryRead: true, quizBest: 5, quizTotal: 5 },
  };
  const action = learningPath.getNextLearningAction(blocks, progress);
  assert.equal(action.type, "course_complete");
});
