import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { JobStackParamList } from '../navigation/types';
import JobHeader from '../components/JobHeader';
import { LogEntry, loadLog, clearLog } from '../services/jobStore';

const CSV_HEADER = ['time_iso', 'type', 'job', 'detail'];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function buildCsv(log: LogEntry[]): string {
  const lines = [CSV_HEADER.join(',')];

  for (const entry of log) {
    const fields = [
      new Date(entry.ts).toISOString(),
      entry.type,
      entry.jobName ?? '',
      entry.detail ?? '',
    ];
    lines.push(fields.map(csvEscape).join(','));
  }

  return lines.join('\n');
}

function humanizeType(entry: LogEntry): string {
  switch (entry.type) {
    case 'job-created':
      return 'Job created';
    case 'status':
      return 'Status: ' + entry.detail;
    case 'deploy-finished':
      return 'Deploy finished' + (entry.detail ? ' (' + entry.detail + ')' : '');
    case 'node-removed':
      return 'Node removed' + (entry.detail ? ' (' + entry.detail + ')' : '');
    case 'reconcile':
      return 'Reconcile: ' + entry.detail;
    case 'csv-export':
      return 'Report exported';
    case 'job-deleted':
      return 'Job deleted' + (entry.detail ? ' (' + entry.detail + ')' : '');
    default:
      return entry.type;
  }
}

export default function LogScreen({ navigation }: NativeStackScreenProps<JobStackParamList, 'Log'>) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const load = useCallback(async () => {
    const log = await loadLog();
    const sorted = [...log].sort((a, b) => b.ts - a.ts);
    setEntries(sorted);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleExportLog = useCallback(async () => {
    try {
      const csv = buildCsv(entries);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');

      const dir = new Directory(Paths.document, 'QuantumReports');
      dir.create({ intermediates: true, idempotent: true });

      const file = new File(dir, 'log_' + stamp + '.csv');
      file.create();
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export operations log',
          UTI: 'public.comma-separated-values-text',
        });
      }

      Alert.alert('Log saved', file.uri);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    }
  }, [entries]);

  const handleClearLog = useCallback(() => {
    Alert.alert('Clear log?', 'This removes the operations log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearLog();
          load();
        },
      },
    ]);
  }, [load]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
      <JobHeader title="Log" subtitle="All operations" />

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleExportLog}>
          <Text style={styles.primaryBtnText}>Export log</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleClearLog}>
          <Text style={styles.secondaryBtnText}>Clear log</Text>
        </TouchableOpacity>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>No operations logged yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {entries.map((entry, index) => {
            const secondLineParts: string[] = [];
            if (entry.jobName) secondLineParts.push(entry.jobName);
            if (entry.detail) secondLineParts.push(entry.detail);
            const secondLine = secondLineParts.join(' - ');

            return (
              <View key={`${entry.ts}-${index}`} style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardLabel}>{humanizeType(entry)}</Text>
                  <Text style={styles.cardTime}>{new Date(entry.ts).toLocaleString()}</Text>
                </View>
                {secondLine ? <Text style={styles.cardSecondLine}>{secondLine}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  actionRow: { flexDirection: 'row', gap: 8, padding: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#42A5F5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0D0D0D', fontWeight: 'bold', fontSize: 14 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  scrollContent: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLabel: { color: '#fff', fontSize: 14, fontWeight: 'bold', flexShrink: 1, marginRight: 8 },
  cardTime: { color: '#aaa', fontSize: 11 },
  cardSecondLine: { color: '#aaa', fontSize: 12, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTxt: { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
