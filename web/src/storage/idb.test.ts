import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getAllProgress, getProfile, initStorage, migrateFromLocalStorage, resetStorageConnectionForTests, saveModuleProgress } from "./idb";

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
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}
