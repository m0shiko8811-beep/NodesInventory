// Recovery proximity evaluation: pure logic, no React, no storage, no clock reads.
// All time comes in via inputs so this stays unit-testable.

import type { LastGoodFix } from './quantum';

export const RECOVERY_RADIUS_M = 5;
export const RSSI_FALLBACK_THRESHOLD = -70;

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000; // earth radius, meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export interface RecoveryInput {
  phone: { lat: number; lon: number } | null;
  nodeFix: LastGoodFix | null;
  rssi: number | null;
  phaseStartedAt: number;
  now: number;
}

export interface RecoveryEval {
  recovered: boolean;
  reason: 'gps-close' | 'rssi-fallback' | 'too-far' | 'weak-signal' | 'no-fix';
  distanceM: number | null;
  positionStatus: number | null;
  fixAgeMs: number | null;
}

export function evaluateRecovery(
  input: RecoveryInput,
  radiusM: number = RECOVERY_RADIUS_M,
  rssiThreshold: number = RSSI_FALLBACK_THRESHOLD,
): RecoveryEval {
  const hasFreshFix =
    input.nodeFix != null &&
    input.nodeFix.positionStatus === 1 &&
    input.nodeFix.ts >= input.phaseStartedAt;

  const distanceM =
    input.phone != null && input.nodeFix != null
      ? haversineMeters(input.phone.lat, input.phone.lon, input.nodeFix.lat, input.nodeFix.lon)
      : null;

  const positionStatus = input.nodeFix ? input.nodeFix.positionStatus : null;
  const fixAgeMs = input.nodeFix ? input.now - input.nodeFix.ts : null;

  if (hasFreshFix && input.phone != null && distanceM != null && distanceM <= radiusM) {
    return { recovered: true, reason: 'gps-close', distanceM, positionStatus, fixAgeMs };
  }

  if (!hasFreshFix && input.rssi != null && input.rssi >= rssiThreshold) {
    return { recovered: true, reason: 'rssi-fallback', distanceM, positionStatus, fixAgeMs };
  }

  const reason = hasFreshFix ? 'too-far' : input.rssi != null ? 'weak-signal' : 'no-fix';
  return { recovered: false, reason, distanceM, positionStatus, fixAgeMs };
}
