import { COURSE_ID, SCHEMA_VERSION, type AppState, type ExportPayload, type LearnerProfile, type ModuleProgress, type ProgressMap } from "../domain/types";
import { defaultReviewState, defaultSessionsState, normalizeReviewState, normalizeSessionsState } from "../domain/review";

const DB_NAME = "nutrio-db";
const DB_VERSION = 1;
const PROFILE_ID = "default";
const APP_STATE_KEY = "appState";
const PROFILE_KEY = "nutrio-profile";
const PROGRESS_KEY = "nutrio-progress";

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

export async function getAllProgress(): Promise<ProgressMap> {
  const records = await readAll<ModuleProgress & { moduleId: string }>("progress");
  return Object.fromEntries(records.map((record) => [record.moduleId, progressValue(record)]));
}

export async function getModuleProgress(moduleId: string): Promise<ModuleProgress> {
  const record = await readRecord<ModuleProgress & { moduleId: string }>("progress", moduleId);
  return record ? progressValue(record) : {};
}

export async function saveModuleProgress(moduleId: string, patch: ModuleProgress): Promise<ModuleProgress> {
  const current = await getModuleProgress(moduleId);
  const next = { ...current, ...clone(patch) };
  await putRecord("progress", { moduleId, ...next });
  return next;
}

export async function replaceModuleProgress(moduleId: string, value: ModuleProgress): Promise<void> {
  await putRecord("progress", { moduleId, ...clone(value) });
}

export async function resetProgress(): Promise<void> {
  await clearStore("progress");
  await resetAppState();
}

export async function getAppState(): Promise<AppState> {
  const record = await readRecord<{ value?: unknown }>("meta", APP_STATE_KEY);
  return normalizeAppState(record?.value);
}

export async function saveAppState(patch: Partial<AppState>): Promise<AppState> {
  const current = await getAppState();
  const next = normalizeAppState({ ...current, ...patch });
  await putRecord("meta", { key: APP_STATE_KEY, value: next });
  return next;
}

export async function resetAppState(): Promise<AppState> {
  const next = defaultAppState();
  await putRecord("meta", { key: APP_STATE_KEY, value: next });
  return next;
}

export async function exportData(): Promise<ExportPayload> {
  const appState = await getAppState();
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    courseId: COURSE_ID,
    profile: await getProfile(),
    progress: await getAllProgress(),
    review: appState.review,
    sessions: appState.sessions,
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

export function normalizeAppState(value: unknown): AppState {
  const source = isRecord(value) ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    review: normalizeReviewState(source.review),
    sessions: normalizeSessionsState(source.sessions),
  };
}

function defaultAppState(): AppState {
  return { schemaVersion: SCHEMA_VERSION, review: defaultReviewState(), sessions: defaultSessionsState() };
}

async function getDatabase(): Promise<IDBDatabase> {
  databasePromise ||= openDatabase();
  return databasePromise;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => createStores(request.result);
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
  const raw = localStorage.getItem(key);
  if (raw === null) return { exists: false };
  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch {
    return { exists: true, invalid: true };
  }
}

function validLegacyShapes(profile: unknown, progress: unknown): boolean {
  const profileOk = profile === undefined || profile === null || isRecord(profile);
  const progressOk = progress === undefined || isProgressMap(progress);
  return profileOk && progressOk;
}

async function writeLegacyData(profile: unknown, progress: unknown): Promise<void> {
  if (isRecord(profile)) await saveProfile(profile);
  if (isProgressMap(progress)) {
    await Promise.all(Object.entries(progress).map(([moduleId, value]) => replaceModuleProgress(moduleId, value)));
  }
}

async function verifyLegacyMigration(profile: unknown, progress: unknown): Promise<void> {
  if (isRecord(profile) && !(await getProfile())) throw new Error("Profile migration verification failed");
  if (isProgressMap(progress) && Object.keys(progress).length !== Object.keys(await getAllProgress()).length) throw new Error("Progress migration verification failed");
}

function removeMigratedKeys(profileExists: boolean, progressExists: boolean): void {
  if (profileExists) localStorage.removeItem(PROFILE_KEY);
  if (progressExists) localStorage.removeItem(PROGRESS_KEY);
}

function isProgressMap(value: unknown): value is ProgressMap {
  return isRecord(value) && Object.values(value).every((item) => isRecord(item));
}

function progressValue(record: ModuleProgress & { moduleId: string }): ModuleProgress {
  const copy: ModuleProgress & { moduleId?: string } = { ...record };
  delete copy.moduleId;
  return copy;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
