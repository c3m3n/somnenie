(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NutrioLearningPath = api;
  if (root && root.window) root.window.NutrioLearningPath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CHECKPOINT_PASS_RATIO = 0.7;
  const BLOCK_STATES = Object.freeze({
    LOCKED: "locked",
    AVAILABLE: "available",
    IN_PROGRESS: "in_progress",
    LESSONS_READ: "lessons_read",
    CHECKPOINT_READY: "checkpoint_ready",
    CHECKPOINT_FAILED: "checkpoint_failed",
    CHECKPOINT_PASSED: "checkpoint_passed",
  });

  function getBlockState(block, progress, reviewState, options = {}) {
    if (options.locked) return BLOCK_STATES.LOCKED;

    const blockProgress = progressForBlock(block, progress);
    if (isCheckpointPassed(blockProgress, options.passRatio)) return BLOCK_STATES.CHECKPOINT_PASSED;
    if (isCheckpointFailed(blockProgress, options.passRatio)) return BLOCK_STATES.CHECKPOINT_FAILED;
    if (isBlockRead(blockProgress)) return BLOCK_STATES.CHECKPOINT_READY;
    if (isBlockStarted(blockProgress)) return BLOCK_STATES.IN_PROGRESS;
    return BLOCK_STATES.AVAILABLE;
  }

  function isBlockStarted(blockProgress) {
    const progress = blockProgress || {};
    return Boolean(
      progress.theoryRead ||
      progress.lessonsReadAt ||
      progress.blockStartedAt ||
      progress.takeaway ||
      progress.takeawayDraft ||
      progress.quizAttemptStatus === "in-progress" ||
      progress.quizAttemptStatus === "complete" ||
      progress.quizBest != null ||
      progress.quizAnswered ||
      Object.keys(progress.weakSpots || {}).length,
    );
  }

  function isBlockRead(blockProgress) {
    const progress = blockProgress || {};
    return Boolean(progress.theoryRead || progress.lessonsReadAt || progress.blockReadAt);
  }

  function isBlockCheckpointPassed(blockProgress, passRatio = CHECKPOINT_PASS_RATIO) {
    return isCheckpointPassed(blockProgress, passRatio);
  }

  function isCheckpointPassed(blockProgress, passRatio = CHECKPOINT_PASS_RATIO) {
    const progress = blockProgress || {};
    if (!hasCheckpointResult(progress)) return false;

    const total = Number(progress.quizTotal);
    if (total === 0) return true;
    if (!Number.isFinite(total) || total < 0) return false;

    const best = Number(progress.quizBest);
    if (!Number.isFinite(best)) return false;
    return best / total >= passRatio;
  }

  function isBlockCheckpointFailed(blockProgress, passRatio = CHECKPOINT_PASS_RATIO) {
    return isCheckpointFailed(blockProgress, passRatio);
  }

  function isCheckpointFailed(blockProgress, passRatio = CHECKPOINT_PASS_RATIO) {
    const progress = blockProgress || {};
    if (!hasCheckpointResult(progress)) return false;
    return !isCheckpointPassed(progress, passRatio);
  }

  function findCurrentBlock(course, progress) {
    return findNextAvailableBlock(course, progress);
  }

  function findNextAvailableBlock(course, progress) {
    const blocks = normalizeBlocks(course);
    for (const block of blocks) {
      if (!isCheckpointPassed(progressForBlock(block, progress))) return block;
    }
    return null;
  }

  function findFirstFailedCheckpoint(course, progress, passRatio = CHECKPOINT_PASS_RATIO) {
    const blocks = normalizeBlocks(course);
    for (const block of blocks) {
      const blockProgress = progressForBlock(block, progress);
      if (isCheckpointPassed(blockProgress, passRatio)) continue;
      return isCheckpointFailed(blockProgress, passRatio) ? block : null;
    }
    return null;
  }

  function getNextLearningAction(course, progress, reviewState, options = {}) {
    const blocks = normalizeBlocks(course);
    const passRatio = options.passRatio || CHECKPOINT_PASS_RATIO;
    const failedBlock = findFirstFailedCheckpoint(blocks, progress, passRatio);

    if (failedBlock) {
      return action("fix_failed_checkpoint", failedBlock, {
        title: "Дальше пока закрыто",
        cta: "Разобрать ошибки",
        reason: "Контрольная блока не сдана. Следующий блок откроется после повторной успешной проверки.",
      });
    }

    const currentBlock = findNextAvailableBlock(blocks, progress);
    if (!currentBlock) {
      return {
        type: "course_complete",
        title: "Курс завершён",
        cta: "Открыть выводы",
        reason: "Все блоки сданы. Можно вернуться к выводам или повторению слабых мест.",
      };
    }

    const blockProgress = progressForBlock(currentBlock, progress);
    const state = getBlockState(currentBlock, progress, reviewState, { passRatio });

    if (isBlockRead(blockProgress)) {
      return action("take_checkpoint", currentBlock, {
        state,
        title: "Пора пройти контрольную",
        cta: "Пройти контрольную",
        reason: "Материалы блока прочитаны. Допуск к следующему блоку зависит от контрольной.",
      });
    }

    if (isBlockStarted(blockProgress)) {
      return action("continue_block", currentBlock, {
        state,
        title: "Продолжить блок",
        cta: "Продолжить с места",
        reason: "Есть начатый блок. Сначала завершаем его, затем переходим к контрольной.",
      });
    }

    return action("start_block", currentBlock, {
      state,
      title: "Начать блок",
      cta: "Начать блок",
      reason: "Предыдущие блоки сданы. Можно открыть следующий блок.",
    });
  }

  function action(type, block, fields) {
    return Object.assign({
      type,
      block,
      blockId: blockId(block),
      moduleId: blockId(block),
    }, fields);
  }

  function progressForBlock(block, progress) {
    if (!isRecord(progress)) return {};
    const id = blockId(block);
    if (id && isRecord(progress[id])) return progress[id];
    return progress;
  }

  function hasCheckpointResult(progress) {
    if (!progress) return false;
    if (progress.quizBest != null && progress.quizTotal != null) return true;
    return progress.quizAttemptStatus === "complete" && Number(progress.quizTotal) === 0;
  }

  function normalizeBlocks(course) {
    if (Array.isArray(course)) return course.filter(Boolean);
    if (!isRecord(course)) return [];

    if (Array.isArray(course.modules) && course.modules.every((item) => typeof item === "string")) {
      return course.modules.map((id) => ({ id }));
    }

    if (Array.isArray(course.modules)) return course.modules.filter(Boolean);

    const byId = isRecord(course.blocksById) ? course.blocksById : {};
    const blocks = [];
    for (const phase of course.phases || []) {
      for (const id of phase.modules || phase.blocks || []) {
        blocks.push(Object.assign({ id }, isRecord(byId[id]) ? byId[id] : {}));
      }
    }
    return blocks;
  }

  function blockId(block) {
    if (typeof block === "string") return block;
    return String(block?.id || block?.moduleId || "");
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return {
    CHECKPOINT_PASS_RATIO,
    BLOCK_STATES,
    getBlockState,
    isBlockStarted,
    isBlockRead,
    isBlockCheckpointPassed,
    isBlockCheckpointFailed,
    isCheckpointPassed,
    isCheckpointFailed,
    findCurrentBlock,
    findNextAvailableBlock,
    findFirstFailedCheckpoint,
    getNextLearningAction,
    normalizeBlocks,
  };
});
