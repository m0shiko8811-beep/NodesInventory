import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ReconState } from '../services/jobStore';

export interface NodeResultRowProps {
  physicalLabel: string;
  rssi?: number | null;
  distanceM?: number | null;
  positionStatus?: number | null;
  fixAgeMs?: number | null;
  state?: ReconState;
  batteryPct?: number | null;
}

const STATE_BADGES: Record<ReconState, { label: string; color: string }> = {
  recovered: { label: 'Recovered', color: '#4CAF50' },
  'heard-not-close': { label: 'Not close', color: '#FF9800' },
  missing: { label: 'Missing', color: '#F44336' },
  extra: { label: 'Extra', color: '#42A5F5' },
};

function formatRssi(rssi?: number | null): string | null {
  if (rssi === null || rssi === undefined) return null;
  return `${rssi} dBm`;
}

function formatDistance(distanceM?: number | null): string | null {
  if (distanceM === undefined) return null;
  if (distanceM === null) return 'distance n/a';
  return `${Math.round(distanceM)} m`;
}

function formatPositionStatus(positionStatus?: number | null): string | null {
  if (positionStatus === null || positionStatus === undefined) return null;
  switch (positionStatus) {
    case 0: return 'no GPS';
    case 1: return 'GPS ok';
    case 2: return 'GPS estimated';
    case 3: return 'GPS last known';
    default: return null;
  }
}

function formatAge(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function formatFixAge(fixAgeMs?: number | null): string | null {
  if (fixAgeMs === null || fixAgeMs === undefined) return null;
  return `fix ${formatAge(fixAgeMs)} ago`;
}

function batteryColor(pct: number): string {
  if (pct > 50) return '#4CAF50';
  if (pct > 20) return '#FF9800';
  return '#F44336';
}

export default function NodeResultRow({
  physicalLabel,
  rssi,
  distanceM,
  positionStatus,
  fixAgeMs,
  state,
  batteryPct,
}: NodeResultRowProps) {
  const rssiText = formatRssi(rssi);
  const distanceText = formatDistance(distanceM);
  const positionText = formatPositionStatus(positionStatus);
  const fixAgeText = formatFixAge(fixAgeMs);
  const hasBattery = batteryPct !== null && batteryPct !== undefined;
  const badge = state ? STATE_BADGES[state] : null;

  const parts: { key: string; node: React.ReactNode }[] = [];
  if (rssiText) parts.push({ key: 'rssi', node: <Text style={styles.metricText}>{rssiText}</Text> });
  if (distanceText) parts.push({ key: 'distance', node: <Text style={styles.metricText}>{distanceText}</Text> });
  if (positionText) parts.push({ key: 'position', node: <Text style={styles.metricText}>{positionText}</Text> });
  if (fixAgeText) parts.push({ key: 'fixAge', node: <Text style={styles.metricText}>{fixAgeText}</Text> });
  if (hasBattery) {
    parts.push({
      key: 'battery',
      node: (
        <View style={styles.batteryPiece}>
          <View style={[styles.dot, { backgroundColor: batteryColor(batteryPct as number) }]} />
          <Text style={styles.metricText}> {batteryPct}%</Text>
        </View>
      ),
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <Text style={styles.label}>{physicalLabel}</Text>
        {parts.length > 0 ? (
          <View style={styles.metricsRow}>
            {parts.map((part, index) => (
              <View key={part.key} style={styles.metricItem}>
                {index > 0 ? <Text style={styles.metricText}> · </Text> : null}
                {part.node}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {badge ? (
        <View style={styles.badgeWrap}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  left: { flex: 1 },
  label: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 3,
  },
  metricItem: { flexDirection: 'row', alignItems: 'center' },
  metricText: { color: '#aaa', fontSize: 12 },
  batteryPiece: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 1 },
  badgeWrap: { marginLeft: 12 },
  badgeText: { fontSize: 13, fontWeight: 'bold' },
});
