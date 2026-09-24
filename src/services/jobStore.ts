// AsyncStorage persistence layer for the deploy/pickup job inventory feature.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LastGoodFix } from './quantum';

export type JobStatus = 'preDeploy' | 'deployed' | 'pickup' | 'closed';

export interface Job {
  id: string;
  name: string;
  createdAt: number;
  status: JobStatus;
  deployedAt?: number;
  pickedUpAt?: number;
  closedAt?: number;
}

export interface DeployedNodeRecord {
  bleSerial: number;
  physicalLabel: string;
  deployedAt: number;
  deployFix: LastGoodFix | null;
  batteryPctAtDeploy: number | null;
}

export type ReconState = 'recovered' | 'heard-not-close' | 'missing' | 'extra';

export interface PickupResult {
  bleSerial: number;
  physicalLabel: string;
  state: ReconState;
  heard: boolean;
  rssi: number | null;
  distanceM: number | null;
  positionStatus: number | null;
  fixAgeMs: number | null;
  reason: string;
  reconciledAt: number;
}

export interface LogEntry {
  ts: number;
  type: string;
  jobId?: string;
  jobName?: string;
  detail?: string;
}

let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = writeChain.then(op, op);
  writeChain = run.catch(() => {});
  return run as Promise<T>;
}

const ACTIVE_JOB_ID_KEY = 'qapp:activeJobId';
const JOBS_INDEX_KEY = 'qapp:jobs:index';
const LOG_KEY = 'qapp:log';
const MAX_LOG_ENTRIES = 2000;

function jobMetaKey(id: string): string {
  return `qapp:job:${id}:meta`;
}

function jobDeployedKey(id: string): string {
  return `qapp:job:${id}:deployed`;
}

function jobPickupKey(id: string): string {
  return `qapp:job:${id}:pickup`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function appendLogInternal(e: { type: string; jobId?: string; jobName?: string; detail?: string }): Promise<void> {
  try {
    const log = await readJson<LogEntry[]>(LOG_KEY, []);
    log.push({ ...e, ts: Date.now() });
    const trimmed = log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log;
    await writeJson(LOG_KEY, trimmed);
  } catch {
    // never throw to the caller
  }
}

export function logEvent(e: { type: string; jobId?: string; jobName?: string; detail?: string }): Promise<void> {
  return enqueue(() => appendLogInternal(e));
}

export async function loadLog(): Promise<LogEntry[]> {
  return readJson<LogEntry[]>(LOG_KEY, []);
}

export function clearLog(): Promise<void> {
  return enqueue(() => writeJson(LOG_KEY, []));
}

export function createJob(name: string): Promise<Job> {
  return enqueue(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const job: Job = {
      id: `${Date.now()}-${suffix}`,
      name,
      createdAt: Date.now(),
      status: 'preDeploy',
    };

    const index = await readJson<Job[]>(JOBS_INDEX_KEY, []);
    index.push(job);
    await writeJson(JOBS_INDEX_KEY, index);
    await writeJson(jobMetaKey(job.id), job);
    await setActiveJobInternal(job.id);

    logEvent({ type: 'job-created', jobId: job.id, jobName: job.name });

    return job;
  });
}

export async function loadActiveJob(): Promise<Job | null> {
  try {
    const id = await AsyncStorage.getItem(ACTIVE_JOB_ID_KEY);
    if (!id) return null;
    return await readJson<Job | null>(jobMetaKey(id), null);
  } catch {
    return null;
  }
}

async function setActiveJobInternal(id: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_JOB_ID_KEY, id);
}

export function setActiveJob(id: string): Promise<void> {
  return enqueue(() => setActiveJobInternal(id));
}

export async function listJobs(): Promise<Job[]> {
  return readJson<Job[]>(JOBS_INDEX_KEY, []);
}

function stampLifecycle(job: Job, status: JobStatus): void {
  if (status === 'deployed') {
    job.deployedAt = Date.now();
  } else if (status === 'pickup') {
    job.pickedUpAt = Date.now();
  } else if (status === 'closed') {
    job.closedAt = Date.now();
  }
}

export function setJobStatus(id: string, status: JobStatus): Promise<void> {
  return enqueue(async () => {
    const meta = await readJson<Job | null>(jobMetaKey(id), null);
    if (meta) {
      meta.status = status;
      stampLifecycle(meta, status);
      await writeJson(jobMetaKey(id), meta);
    }

    const index = await readJson<Job[]>(JOBS_INDEX_KEY, []);
    const entry = index.find(j => j.id === id);
    if (entry) {
      entry.status = status;
      stampLifecycle(entry, status);
      await writeJson(JOBS_INDEX_KEY, index);
    }

    logEvent({ type: 'status', jobId: id, jobName: meta?.name ?? id, detail: status });
  });
}

export async function loadDeployed(jobId: string): Promise<Record<string, DeployedNodeRecord>> {
  return readJson<Record<string, DeployedNodeRecord>>(jobDeployedKey(jobId), {});
}

export function upsertDeployedNodes(jobId: string, records: DeployedNodeRecord[]): Promise<void> {
  return enqueue(async () => {
    const existing = await loadDeployed(jobId);
    for (const record of records) {
      existing[String(record.bleSerial)] = record;
    }
    await writeJson(jobDeployedKey(jobId), existing);
  });
}

export async function loadPickup(jobId: string): Promise<Record<string, PickupResult>> {
  return readJson<Record<string, PickupResult>>(jobPickupKey(jobId), {});
}

export function mergePickupResults(jobId: string, results: PickupResult[]): Promise<void> {
  return enqueue(async () => {
    const existing = await loadPickup(jobId);
    for (const result of results) {
      const key = String(result.bleSerial);
      const current = existing[key];
      if (current && current.state === 'recovered') {
        // recovered is sticky: never downgrade a confirmed recovery
        continue;
      }
      existing[key] = result;
    }
    await writeJson(jobPickupKey(jobId), existing);
  });
}

export function removeDeployedNode(jobId: string, bleSerial: number): Promise<void> {
  return enqueue(async () => {
    const key = String(bleSerial);

    const deployed = await loadDeployed(jobId);
    if (key in deployed) {
      delete deployed[key];
      await writeJson(jobDeployedKey(jobId), deployed);
    }

    const pickup = await loadPickup(jobId);
    if (key in pickup) {
      delete pickup[key];
      await writeJson(jobPickupKey(jobId), pickup);
    }

    logEvent({ type: 'node-removed', jobId, detail: 'serial ' + String(bleSerial) });
  });
}

export function deleteJob(jobId: string): Promise<void> {
  return enqueue(async () => {
    const meta = await readJson<Job | null>(jobMetaKey(jobId), null);
    const deployed = await loadDeployed(jobId);
    const pickup = await loadPickup(jobId);
    const deployedCount = Object.keys(deployed).length;
    const recoveredCount = Object.values(pickup).filter(p => p.state === 'recovered').length;

    await appendLogInternal({
      type: 'job-deleted',
      jobId,
      jobName: meta?.name ?? jobId,
      detail: `${deployedCount} deployed, ${recoveredCount} recovered`,
    });

    await AsyncStorage.removeItem(jobMetaKey(jobId));
    await AsyncStorage.removeItem(jobDeployedKey(jobId));
    await AsyncStorage.removeItem(jobPickupKey(jobId));

    const index = await readJson<Job[]>(JOBS_INDEX_KEY, []);
    const nextIndex = index.filter(j => j.id !== jobId);
    await writeJson(JOBS_INDEX_KEY, nextIndex);

    const activeId = await AsyncStorage.getItem(ACTIVE_JOB_ID_KEY);
    if (activeId === jobId) {
      await AsyncStorage.removeItem(ACTIVE_JOB_ID_KEY);
    }
  });
}
