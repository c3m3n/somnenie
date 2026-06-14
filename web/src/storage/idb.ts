import { COURSE_ID, SCHEMA_VERSION, type CourseAppState, type CourseId, type ExportPayload, type LearnerProfile, type ModuleProgress, type MultiCourseAppState, type ProgressMap } from "../domain/types";
import { defaultReviewState, defaultSessionsState } from "../domain/review";
import { defaultAppState, migrateAppState, migrateModuleProgress, migrateProgress } from "./migrations";

const DB_NAME = "nutrio-db";
const DB_VERSION = SCHEMA_VERSION;
const PROFILE_ID = "default";
const APP_STATE_KEY = "appState";
const PROFILE_KEY = "nutrio-profile";
const PROGRESS_KEY = "nutrio-progress";
const LEGACY_COURSE_ID: CourseId = COURSE_ID;

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

export function resetStorageConnectionForTests(): void {
  activeDatabase?.close();
  activeDatabase = null;
  databasePromise = null;
}

export async function initStorage(): Promise<void> {
  await getDatabase();
  await putRecord("meta", { key: "schemaVersion", value: SCHEMA_VERSION });
  const stored = await readRecord<{ value?: unknown }>("meta", APP_STATE_KEY);
  await putRecord("meta", { key: APP_STATE_KEY, value: normalizeAppState(stored?.value) });
}

export async function getProfile(): Promise<LearnerProfile | null> {
  const record = await readRecord<LearnerProfile>("profile", PROFILE_ID);
  return record || null;
}

export async function saveProfile(profile: LearnerProfile): Promise<void> {
  await putRecord("profile", { ...clone(profile), id: PROFILE_ID, updatedAt: new Date().toISOString() });
}

export async function resetProfile(): Promise<void> {
  await deleteRecord("profile", PROFILE_ID);
}

export async function getAllProgress(courseId: CourseId = LEGACY_COURSE_ID): Promise<ProgressMap> {
  const records = await readAll<ModuleProgress & { moduleId: string; courseId?: CourseId }>("progress");
  const filtered = records.filter((record) => (record.courseId || LEGACY_COURSE_ID) === courseId);
  const entries = filtered.map((record) => [progressKey(record.moduleId), progressValue(record)] as const);
  return migrateProgress(Object.fromEntries(entries));
}

export async function getModuleProgress(courseId: CourseId, moduleId: string): Promise<ModuleProgress> {
  const record = await readRecord<ModuleProgress & { moduleId: string; courseId?: CourseId }>("progress", progressStoreKey(courseId, moduleId));
  return record ? migrateModuleProgress(progressValue(record)) : {};
}

export async function saveModuleProgress(courseId: CourseId, moduleId: string, patch: ModuleProgress): Promise<ModuleProgress> {
  const current = await getModuleProgress(courseId, moduleId);
  const next = migrateModuleProgress({ ...current, ...clone(patch) });
  await putRecord("progress", { moduleId: progressStoreKey(courseId, moduleId), courseId, ...next });
  return next;
}

export async function replaceModuleProgress(courseId: CourseId, moduleId: string, value: ModuleProgress): Promise<void> {
  await putRecord("progress", { moduleId: progressStoreKey(courseId, moduleId), courseId, ...migrateModuleProgress(clone(value)) });
}

export async function resetProgress(courseId?: CourseId): Promise<void> {
  if (!courseId) {
    await clearStore("progress");
    await resetAppState();
    return;
  }
  const records = await readAll<{ moduleId: string; courseId?: CourseId }>("progress");
  await Promise.all(records
    .filter((record) => (record.courseId || LEGACY_COURSE_ID) === courseId)
    .map((record) => deleteRecord("progress", record.moduleId)));
  await saveCourseAppState(courseId, {
    review: { schemaVersion: 2, courseId, items: [] },
    sessions: { courseId, todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 },
  });
}

export async function getAppState(): Promise<MultiCourseAppState> {
  const record = await readRecord<{ value?: unknown }>("meta", APP_STATE_KEY);
  return normalizeAppState(record?.value);
}

export async function saveAppState(patch: Partial<MultiCourseAppState>): Promise<MultiCourseAppState> {
  const current = await getAppState();
  const next = normalizeAppState({ ...current, ...patch });
  await putRecord("meta", { key: APP_STATE_KEY, value: next });
  return next;
}

export async function getCourseAppState(courseId: CourseId): Promise<CourseAppState> {
  const state = await getAppState();
  return state.courses[courseId] || defaultCourseAppState(courseId);
}

export async function saveCourseAppState(courseId: CourseId, patch: Partial<CourseAppState>): Promise<CourseAppState> {
  const current = await getAppState();
  const nextCourse = {
    ...defaultCourseAppState(courseId),
    ...current.courses[courseId],
    ...patch,
  };
  const next = normalizeAppState({ ...current, courses: { ...current.courses, [courseId]: nextCourse } });
  await putRecord("meta", { key: APP_STATE_KEY, value: next });
  return next.courses[courseId];
}

export async function resetAppState(): Promise<MultiCourseAppState> {
  const next = defaultAppState();
  await putRecord("meta", { key: APP_STATE_KEY, value: next });
  return next;
}

export async function exportData(courseId?: CourseId): Promise<ExportPayload> {
  const targetCourseId = courseId || LEGACY_COURSE_ID;
  const appState = await getAppState();
  const courseState = appState.courses[targetCourseId] || defaultCourseAppState(targetCourseId);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    courseId: targetCourseId,
    profile: await getProfile(),
    progress: await getAllProgress(targetCourseId),
    review: courseState.review,
    sessions: courseState.sessions,
  };
}

export async function migrateFromLocalStorage(): Promise<{ migrated: boolean; skipped?: boolean }> {
  const profileSource = readLocalStorageJson(PROFILE_KEY);
  const progressSource = readLocalStorageJson(PROGRESS_KEY);
  if (!profileSource.exists && !progressSource.exists) return { migrated: false };
  if (profileSource.invalid || progressSource.invalid) return { migrated: false, skipped: true };
  if (!validLegacyShapes(profileSource.value, progressSource.value)) return { migrated: false, skipped: true };
  await writeLegacyData(profileSource.value, progressSource.value);
  await verifyLegacyMigration(profileSource.value, progressSource.value);
  removeMigratedKeys(profileSource.exists, progressSource.exists);
  return { migrated: true };
}

export function normalizeAppState(value: unknown): MultiCourseAppState {
  return migrateAppState(value);
}

async function getDatabase(): Promise<IDBDatabase> {
  databasePromise ||= openDatabase();
  return databasePromise;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => migrateDatabase(request.result, request.transaction, event.oldVersion);
    request.onsuccess = () => {
      activeDatabase = request.result;
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB open request was blocked"));
  });
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
  if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath: "id" });
  if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "moduleId" });
}

function migrateDatabase(db: IDBDatabase, transaction: IDBTransaction | null, oldVersion: number): void {
  createStores(db);
  if (oldVersion < 3) {
    void runV3Migration(transaction);
  }
}

interface ProgressRecord {
  moduleId: string;
  courseId?: string;
  [key: string]: unknown;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

async function runV3Migration(transaction: IDBTransaction | null): Promise<void> {
  if (!transaction) return;
  await migrateProgressRecords(transaction.objectStore("progress"));
  await migrateAppStateRecord(transaction.objectStore("meta"));
}

async function migrateProgressRecords(progressStore: IDBObjectStore): Promise<void> {
  const progressRecords = await requestToPromise(progressStore.getAll());
  for (const record of progressRecords) {
    await migrateSingleProgressRecord(progressStore, record);
  }
}

async function migrateSingleProgressRecord(progressStore: IDBObjectStore, record: unknown): Promise<void> {
  if (!isProgressRecord(record)) return;
  const moduleId = String(record.moduleId);
  if (moduleId.includes(":")) return;
  const newModuleId = progressStoreKey(LEGACY_COURSE_ID, moduleId);
  await requestToPromise(progressStore.put({ ...record, moduleId: newModuleId, courseId: LEGACY_COURSE_ID }));
  await requestToPromise(progressStore.delete(moduleId));
}

function isProgressRecord(value: unknown): value is ProgressRecord {
  return isRecord(value) && "moduleId" in value && typeof value.moduleId === "string";
}

async function migrateAppStateRecord(metaStore: IDBObjectStore): Promise<void> {
  const appStateRecord: unknown = await requestToPromise(metaStore.get(APP_STATE_KEY));
  if (!isMetaRecord(appStateRecord)) return;
  const value = appStateRecord.value;
  if (isRecord(value) && (!value.courses || !isRecord(value.courses))) {
    const migrated = migrateAppState(value);
    await requestToPromise(metaStore.put({ key: APP_STATE_KEY, value: migrated }));
  }
}

function isMetaRecord(value: unknown): value is MetaRecord {
  return isRecord(value) && "value" in value;
}

function progressStoreKey(courseId: CourseId, moduleId: string): string {
  return moduleId.includes(":") ? moduleId : `${courseId}:${moduleId}`;
}

function progressKey(moduleId: string): string {
  return moduleId.includes(":") ? moduleId.split(":").slice(1).join(":") : moduleId;
}

function defaultCourseAppState(courseId: CourseId): CourseAppState {
  return {
    review: defaultReviewState(courseId),
    sessions: defaultSessionsState(undefined, courseId),
  };
}


async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readonly");
  const done = transactionDone(tx);
  const request = tx.objectStore(storeName).get(key) as IDBRequest<T | undefined>;
  const record = await requestToPromise(request);
  await done;
  return clone(record);
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readonly");
  const done = transactionDone(tx);
  const request = tx.objectStore(storeName).getAll() as IDBRequest<T[]>;
  const records = await requestToPromise(request);
  await done;
  return clone(records) || [];
}

async function putRecord(storeName: string, record: object): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  await requestToPromise(tx.objectStore(storeName).put(clone(record)));
  await done;
}

async function deleteRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  await requestToPromise(tx.objectStore(storeName).delete(key));
  await done;
}

async function clearStore(storeName: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  await requestToPromise(tx.objectStore(storeName).clear());
  await done;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function readLocalStorageJson(key: string): { exists: boolean; invalid?: boolean; value?: unknown } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { exists: false, invalid: true };
  }
  if (raw === null) return { exists: false };
  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch {
    return { exists: true, invalid: true };
  }
}

function validLegacyShapes(profile: unknown, progress: unknown): boolean {
  const profileOk = profile === undefined || profile === null || isRecord(profile);
  const progressOk = progress === undefined || progress === null || isProgressMap(progress);
  return profileOk && progressOk;
}

async function writeLegacyData(profile: unknown, progress: unknown): Promise<void> {
  if (isRecord(profile)) await saveProfile(profile);
  if (isProgressMap(progress)) {
    await Promise.all(Object.entries(progress).map(([moduleId, value]) => replaceModuleProgress(LEGACY_COURSE_ID, moduleId, value)));
  }
}

async function verifyLegacyMigration(profile: unknown, progress: unknown): Promise<void> {
  if (isRecord(profile) && !(await getProfile())) throw new Error("Profile migration verification failed");
  if (isProgressMap(progress) && Object.keys(progress).length !== Object.keys(await getAllProgress(LEGACY_COURSE_ID)).length) throw new Error("Progress migration verification failed");
}

function removeMigratedKeys(profileExists: boolean, progressExists: boolean): void {
  if (profileExists) localStorage.removeItem(PROFILE_KEY);
  if (progressExists) localStorage.removeItem(PROGRESS_KEY);
}

function isProgressMap(value: unknown): value is ProgressMap {
  return isRecord(value) && Object.values(value).every((item) => isRecord(item));
}

function progressValue(record: ModuleProgress & { moduleId: string }): ModuleProgress {
  const copy: ModuleProgress & { moduleId?: string; courseId?: CourseId } = { ...record };
  delete copy.moduleId;
  delete copy.courseId;
  return copy;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
