import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  exportData,
  getAllProgress,
  getAppState,
  getModuleProgress,
  getProfile,
  initStorage,
  migrateFromLocalStorage,
  normalizeAppState,
  replaceModuleProgress,
  resetProfile,
  resetProgress,
  resetStorageConnectionForTests,
  saveAppState,
  saveModuleProgress,
  saveProfile,
} from "./idb";
import { appStateWithDefaults, migrateModuleProgress, migrateProgress } from "./migrations";

describe("IndexedDB storage compatibility", () => {
  beforeEach(async () => {
    resetStorageConnectionForTests();
    localStorage.clear();
    await deleteDatabase("nutrio-db");
  });

  it("persists module progress in the existing progress store shape", async () => {
    await initStorage();
    await saveModuleProgress("M01", { takeaway: "Learned" });
    expect((await getAllProgress()).M01.takeaway).toBe("Learned");
    expect((await getModuleProgress("M01")).takeaway).toBe("Learned");
    expect(await getModuleProgress("M99")).toEqual({});
  });

  it("saves, exports and resets profile, progress and app state", async () => {
    await initStorage();
    await saveProfile({ name: "Learner" });
    await replaceModuleProgress("M04", { takeaway: "Replaced", quizAttemptStatus: "complete" });
    const state = await saveAppState({ sessions: { courseId: "nutrition", todayDone: { blocks: 1 }, activeDays: ["2026-06-14"], lastDate: "2026-06-14", streakDays: 1, bestStreakDays: 1 } });
    const exported = await exportData();
    expect((await getProfile())?.name).toBe("Learner");
    expect((await getAllProgress()).M04.takeaway).toBe("Replaced");
    expect(state.sessions.todayDone.blocks).toBe(1);
    expect(exported.profile?.name).toBe("Learner");
    expect(exported.progress.M04.quizAttemptStatus).toBe("complete");

    await resetProfile();
    await resetProgress();
    expect(await getProfile()).toBeNull();
    expect(await getAllProgress()).toEqual({});
    expect((await getAppState()).sessions.todayDone).toEqual({});
  });

  it("migrates legacy localStorage only after verified writes", async () => {
    localStorage.setItem("nutrio-profile", JSON.stringify({ name: "Learner" }));
    localStorage.setItem("nutrio-progress", JSON.stringify({ M02: { takeaway: "Old" } }));
    await initStorage();
    const result = await migrateFromLocalStorage();
    expect(result.migrated).toBe(true);
    expect(await getProfile()).toMatchObject({ name: "Learner" });
    expect((await getAllProgress()).M02.takeaway).toBe("Old");
    expect(localStorage.getItem("nutrio-profile")).toBeNull();
  });

  it("skips legacy migration when data is absent, invalid or malformed", async () => {
    await initStorage();
    expect(await migrateFromLocalStorage()).toEqual({ migrated: false });

    localStorage.setItem("nutrio-profile", "{bad json");
    expect(await migrateFromLocalStorage()).toEqual({ migrated: false, skipped: true });
    localStorage.clear();

    localStorage.setItem("nutrio-progress", JSON.stringify({ M01: [] }));
    expect(await migrateFromLocalStorage()).toEqual({ migrated: false, skipped: true });
  });

  it("keeps v2 progress records readable without deleting legacy quiz fields", async () => {
    await seedVersion2Database();
    resetStorageConnectionForTests();
    await initStorage();
    const progress = await getAllProgress();
    expect(progress.M03.quizTotal).toBe(10);
    expect(progress.M03.quizTotalQuestions).toBe(10);
    expect(progress.M03.quizMistakes).toBe(3);
    expect(progress.M03.weakSpots?.["1"]?.questionNumber).toBe(1);
    expect(progress.M03.weakSpots?.["1"]?.number).toBe(1);
    expect(progress.M03.takeaway).toBe("Legacy takeaway");
  });

  it("migrates app state to the current schema without dropping review or session data", async () => {
    await seedVersion2Database();
    resetStorageConnectionForTests();
    await initStorage();
    const state = await getAppState();
    expect(state.schemaVersion).toBe(2);
    expect(state.review.items[0]?.id).toBe("M01-q1");
    expect(state.sessions.todayDone.reviews).toBe(2);
  });

  it("normalizes unknown future app state safely", () => {
    const state = normalizeAppState({
      schemaVersion: 999,
      review: { items: [{ id: "M01-q1", moduleId: "M01", text: "Q", due: "2026-06-13", errors: 1, interval: 1 }] },
      sessions: { todayDone: { reviews: 3 }, activeDays: ["2026-06-13"], lastDate: "2026-06-13" },
    });
    expect(state.schemaVersion).toBe(2);
    expect(state.review.items[0]?.id).toBe("M01-q1");
    expect(state.sessions.todayDone.reviews).toBe(3);
  });

  it("migrates progress maps without resetting progress, weak spots or takeaways", () => {
    const progress = migrateProgress({
      M01: {
        quizAttemptStatus: "complete",
        quizBest: 7,
        quizTotal: 10,
        weakSpots: { "1": { number: 1, text: "Legacy", level: "medium", mistakeType: "concept" } },
        takeaway: "Saved takeaway",
        checkpointAttempts: [{ blockId: "M01", startedAt: "2026-01-01", completedAt: "2026-01-01", correct: 7, total: 10, passed: true, failedQuestionIds: [] }],
      },
    });
    expect(progress.M01.quizBest).toBe(7);
    expect(progress.M01.checkpointAttempts).toHaveLength(1);
    expect(progress.M01.weakSpots?.["1"]?.diagnosticType).toBe("concept");
    expect(progress.M01.takeaway).toBe("Saved takeaway");
  });

  it("missing optional progress fields do not crash migration", () => {
    expect(migrateModuleProgress({ takeaway: "Only note" })).toMatchObject({ takeaway: "Only note" });
    expect(migrateModuleProgress(null)).toEqual({});
    expect(migrateModuleProgress({ weakSpots: { bad: null, "2": { text: "No number" } } }).weakSpots?.["2"]?.questionNumber).toBe(2);
  });

  it("fills app state defaults for non-record values", () => {
    expect(appStateWithDefaults(null).sessions.courseId).toBe("nutrition");
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

function seedVersion2Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nutrio-db", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("meta", { keyPath: "key" });
      db.createObjectStore("profile", { keyPath: "id" });
      db.createObjectStore("progress", { keyPath: "moduleId" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["meta", "profile", "progress"], "readwrite");
      tx.objectStore("profile").put({ id: "default", name: "Learner" });
      tx.objectStore("meta").put({
        key: "appState",
        value: {
          schemaVersion: 2,
          review: { schemaVersion: 2, courseId: "nutrition", items: [{ id: "M01-q1", moduleId: "M01", text: "Q", due: "2026-06-13", errors: 1, interval: 1 }] },
          sessions: { courseId: "nutrition", todayDone: { reviews: 2 }, activeDays: ["2026-06-13"], lastDate: "2026-06-13", streakDays: 1, bestStreakDays: 1 },
        },
      });
      tx.objectStore("progress").put({
        moduleId: "M03",
        quizAttemptStatus: "complete",
        quizBest: 7,
        quizTotalQuestions: 10,
        quizMistakes: 3,
        takeaway: "Legacy takeaway",
        weakSpots: {
          "1": { number: 1, text: "Legacy", level: "medium", mistakeType: "concept" },
        },
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}
