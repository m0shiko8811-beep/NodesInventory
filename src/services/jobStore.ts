// AsyncStorage persistence layer for the deploy/pickup job inventory feature.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LastGoodFix } from './quantum';

export type JobStatus = 'preDeploy' | 'deployed' | 'pickup' | 'closed';

export interface Job {
  id: string;
  name: string;
  createdAt: number;
  status: JobStatus;
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

const ACTIVE_JOB_ID_KEY = 'qapp:activeJobId';
const JOBS_INDEX_KEY = 'qapp:jobs:index';

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

export async function createJob(name: string): Promise<Job> {
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
  await setActiveJob(job.id);

  return job;
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

export async function setActiveJob(id: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_JOB_ID_KEY, id);
}

export async function listJobs(): Promise<Job[]> {
  return readJson<Job[]>(JOBS_INDEX_KEY, []);
}

export async function setJobStatus(id: string, status: JobStatus): Promise<void> {
  const meta = await readJson<Job | null>(jobMetaKey(id), null);
  if (meta) {
    meta.status = status;
    await writeJson(jobMetaKey(id), meta);
  }

  const index = await readJson<Job[]>(JOBS_INDEX_KEY, []);
  const entry = index.find(j => j.id === id);
  if (entry) {
    entry.status = status;
    await writeJson(JOBS_INDEX_KEY, index);
  }
}

export async function loadDeployed(jobId: string): Promise<Record<string, DeployedNodeRecord>> {
  return readJson<Record<string, DeployedNodeRecord>>(jobDeployedKey(jobId), {});
}

export async function upsertDeployedNodes(jobId: string, records: DeployedNodeRecord[]): Promise<void> {
  const existing = await loadDeployed(jobId);
  for (const record of records) {
    existing[String(record.bleSerial)] = record;
  }
  await writeJson(jobDeployedKey(jobId), existing);
}

export async function loadPickup(jobId: string): Promise<Record<string, PickupResult>> {
  return readJson<Record<string, PickupResult>>(jobPickupKey(jobId), {});
}

export async function mergePickupResults(jobId: string, results: PickupResult[]): Promise<void> {
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
}
