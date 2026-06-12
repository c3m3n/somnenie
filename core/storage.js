(function () {
  "use strict";

  const DB_NAME = "nutrio-db";
  const DB_VERSION = 1;
  const PROFILE_ID = "default";
  const SCHEMA_VERSION = 2;
  const APP_STATE_KEY = "appState";
  const COURSE_ID = "nutrition";
  const PROFILE_KEY = "nutrio-profile";
  const PROGRESS_KEY = "nutrio-progress";

  let dbPromise = null;

  function getIndexedDB() {
    return globalThis.indexedDB || (globalThis.window && globalThis.window.indexedDB);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function todayISO() {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function defaultAppState() {
    const today = todayISO();
    return {
      schemaVersion: SCHEMA_VERSION,
      review: { courseId: COURSE_ID, schemaVersion: SCHEMA_VERSION, items: [] },
      sessions: {
        courseId: COURSE_ID,
        schemaVersion: SCHEMA_VERSION,
        lastDate: null,
        streakDays: 0,
        bestStreakDays: 0,
        todayDone: { date: today, reviews: 0, moduleStep: false },
        activeDays: [],
      },
    };
  }

  function normalizeAppState(value) {
    const fallback = defaultAppState();
    const source = isPlainObject(value) ? value : {};
    const review = isPlainObject(source.review) ? source.review : {};
    const sessions = isPlainObject(source.sessions) ? source.sessions : {};
    const todayDone = isPlainObject(sessions.todayDone) ? sessions.todayDone : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      review: {
        courseId: review.courseId || COURSE_ID,
        schemaVersion: SCHEMA_VERSION,
        items: Array.isArray(review.items) ? clone(review.items) : [],
      },
      sessions: {
        courseId: sessions.courseId || COURSE_ID,
        schemaVersion: SCHEMA_VERSION,
        lastDate: sessions.lastDate || null,
        streakDays: Number.isFinite(Number(sessions.streakDays)) ? Number(sessions.streakDays) : 0,
        bestStreakDays: Number.isFinite(Number(sessions.bestStreakDays)) ? Number(sessions.bestStreakDays) : 0,
        todayDone: {
          date: todayDone.date || fallback.sessions.todayDone.date,
          reviews: Number.isFinite(Number(todayDone.reviews)) ? Number(todayDone.reviews) : 0,
          moduleStep: Boolean(todayDone.moduleStep),
        },
        activeDays: Array.isArray(sessions.activeDays) ? sessions.activeDays.filter(Boolean).slice(-120) : [],
      },
    };
  }

  function withoutKey(record, key) {
    if (!record) return null;
    const copy = clone(record);
    delete copy[key];
    return copy;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function openDatabase() {
    const indexedDBApi = getIndexedDB();
    if (!indexedDBApi) return Promise.reject(new Error("IndexedDB is not available"));

    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath: "id" });
        if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "moduleId" });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    });
  }

  function getDatabase() {
    if (!dbPromise) dbPromise = openDatabase();
    return dbPromise;
  }

  async function readRecord(storeName, key) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, "readonly");
    const done = transactionDone(tx);
    const request = tx.objectStore(storeName).get(key);
    const record = await requestToPromise(request);
    await done;
    return clone(record) || null;
  }

  async function readAll(storeName) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, "readonly");
    const done = transactionDone(tx);
    const request = tx.objectStore(storeName).getAll();
    const records = await requestToPromise(request);
    await done;
    return clone(records) || [];
  }

  async function putRecord(storeName, record) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, "readwrite");
    const done = transactionDone(tx);
    const request = tx.objectStore(storeName).put(clone(record));
    await requestToPromise(request);
    await done;
  }

  async function deleteRecord(storeName, key) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, "readwrite");
    const done = transactionDone(tx);
    const request = tx.objectStore(storeName).delete(key);
    await requestToPromise(request);
    await done;
  }

  async function clearStore(storeName) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, "readwrite");
    const done = transactionDone(tx);
    const request = tx.objectStore(storeName).clear();
    await requestToPromise(request);
    await done;
  }

  async function init() {
    await getDatabase();
    await putRecord("meta", { key: "schemaVersion", value: SCHEMA_VERSION });
    const stored = await readRecord("meta", APP_STATE_KEY);
    await putRecord("meta", { key: APP_STATE_KEY, value: normalizeAppState(stored?.value) });
  }

  async function getProfile() {
    return withoutKey(await readRecord("profile", PROFILE_ID), "id");
  }

  async function saveProfile(profile) {
    const record = Object.assign({ id: PROFILE_ID }, clone(profile) || {});
    await putRecord("profile", record);
  }

  async function resetProfile() {
    await deleteRecord("profile", PROFILE_ID);
  }

  function progressRecordToValue(record) {
    return withoutKey(record, "moduleId") || {};
  }

  async function getAllProgress() {
    const records = await readAll("progress");
    const progress = {};
    for (const record of records) {
      if (record && record.moduleId) progress[record.moduleId] = progressRecordToValue(record);
    }
    return progress;
  }

  async function getModuleProgress(moduleId) {
    return progressRecordToValue(await readRecord("progress", moduleId));
  }

  async function saveModuleProgress(moduleId, patch) {
    const current = await getModuleProgress(moduleId);
    const next = Object.assign({}, current, clone(patch) || {});
    await putRecord("progress", Object.assign({ moduleId }, next));
  }

  async function replaceModuleProgress(moduleId, value) {
    await putRecord("progress", Object.assign({ moduleId }, clone(value) || {}));
  }

  async function resetProgress() {
    await clearStore("progress");
  }

  async function getAppState() {
    const record = await readRecord("meta", APP_STATE_KEY);
    return normalizeAppState(record?.value);
  }

  async function saveAppState(patch) {
    const current = await getAppState();
    const next = normalizeAppState(Object.assign({}, current, clone(patch) || {}));
    await putRecord("meta", { key: APP_STATE_KEY, value: next });
    await putRecord("meta", { key: "schemaVersion", value: SCHEMA_VERSION });
    return clone(next);
  }

  async function resetAppState() {
    const next = defaultAppState();
    await putRecord("meta", { key: APP_STATE_KEY, value: next });
    await putRecord("meta", { key: "schemaVersion", value: SCHEMA_VERSION });
  }

  async function exportData() {
    const appState = await getAppState();
    return {
      exportedAt: new Date().toISOString(),
      app: "nutrio-app",
      schemaVersion: SCHEMA_VERSION,
      profile: await getProfile(),
      progress: await getAllProgress(),
      review: appState.review,
      sessions: appState.sessions,
    };
  }

  function readLocalStorageJson(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return { exists: false, ok: true, value: null };
    try {
      return { exists: true, ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return { exists: true, ok: false, value: null, error };
    }
  }

  function progressRecordsArePlainObjects(progress) {
    if (!isPlainObject(progress)) return false;
    return Object.values(progress).every(isPlainObject);
  }

  function verifyMigratedProfile(expected, actual) {
    return JSON.stringify(expected) === JSON.stringify(actual);
  }

  function verifyMigratedProgress(expected, actual) {
    for (const [moduleId, value] of Object.entries(expected)) {
      if (JSON.stringify(value || {}) !== JSON.stringify(actual[moduleId] || {})) return false;
    }
    return true;
  }

  async function migrateFromLocalStorage() {
    const profileSource = readLocalStorageJson(PROFILE_KEY);
    const progressSource = readLocalStorageJson(PROGRESS_KEY);

    if (!profileSource.exists && !progressSource.exists) return { migrated: false };

    if (!profileSource.ok || !progressSource.ok) {
      console.warn("NutrioStorage migration skipped: localStorage JSON could not be parsed.");
      return { migrated: false, skipped: true };
    }

    if (
      (profileSource.exists && !isPlainObject(profileSource.value)) ||
      (progressSource.exists && !progressRecordsArePlainObjects(progressSource.value))
    ) {
      console.warn("NutrioStorage migration skipped: localStorage data has an unexpected shape.");
      return { migrated: false, skipped: true };
    }

    const db = await getDatabase();
    try {
      const tx = db.transaction(["profile", "progress", "meta"], "readwrite");
      const done = transactionDone(tx);
      const profileStore = tx.objectStore("profile");
      const progressStore = tx.objectStore("progress");
      const metaStore = tx.objectStore("meta");
      const requests = [];

      if (profileSource.exists && isPlainObject(profileSource.value)) {
        requests.push(requestToPromise(profileStore.put(Object.assign({ id: PROFILE_ID }, clone(profileSource.value)))));
      }

      if (progressSource.exists && isPlainObject(progressSource.value)) {
        for (const [moduleId, value] of Object.entries(progressSource.value)) {
          requests.push(requestToPromise(progressStore.put(Object.assign({ moduleId }, clone(value) || {}))));
        }
      }

      requests.push(requestToPromise(metaStore.put({ key: "schemaVersion", value: SCHEMA_VERSION })));
      await Promise.all(requests);
      await done;

      const migratedProfile = await getProfile();
      const migratedProgress = await getAllProgress();
      const profileOk = !profileSource.exists || verifyMigratedProfile(profileSource.value, migratedProfile);
      const progressOk = !progressSource.exists || verifyMigratedProgress(progressSource.value, migratedProgress);

      if (!profileOk || !progressOk) throw new Error("Migrated data could not be verified");

      if (profileSource.exists) localStorage.removeItem(PROFILE_KEY);
      if (progressSource.exists) localStorage.removeItem(PROGRESS_KEY);
      return { migrated: true };
    } catch (error) {
      console.warn("NutrioStorage migration failed; localStorage data was preserved.", error);
      return { migrated: false, error };
    }
  }

  window.NutrioStorage = {
    init,
    getProfile,
    saveProfile,
    resetProfile,
    getAllProgress,
    getModuleProgress,
    saveModuleProgress,
    replaceModuleProgress,
    resetProgress,
    getAppState,
    saveAppState,
    resetAppState,
    exportData,
    migrateFromLocalStorage,
  };
})();
