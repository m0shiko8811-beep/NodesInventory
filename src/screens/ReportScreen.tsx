import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { JobStackParamList } from '../navigation/types';
import JobHeader from '../components/JobHeader';
import NodeResultRow from '../components/NodeResultRow';
import {
  Job, DeployedNodeRecord, PickupResult, listJobs, loadDeployed, loadPickup, setJobStatus,
} from '../services/jobStore';

interface DisplayRow extends PickupResult {
  key: string;
}

const CSV_HEADER = [
  'physicalLabel', 'bleSerial', 'state', 'heard', 'rssi_dbm', 'distance_m',
  'positionStatus', 'fix_age_s', 'reason', 'node_lat', 'node_lon',
  'deployedAt_iso', 'reconciledAt_iso',
];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function buildCsv(manifest: Record<string, DeployedNodeRecord>, rows: DisplayRow[]): string {
  const lines = [CSV_HEADER.join(',')];

  for (const row of rows) {
    const serial = String(row.bleSerial);
    const deployedRecord = manifest[serial];
    const rssiDbm = row.rssi ?? '';
    const distanceM = row.distanceM != null ? Math.round(row.distanceM) : '';
    const positionStatus = row.positionStatus ?? '';
    const fixAgeS = row.fixAgeMs != null ? Math.round(row.fixAgeMs / 1000) : '';
    const nodeLat = deployedRecord?.deployFix ? deployedRecord.deployFix.lat : '';
    const nodeLon = deployedRecord?.deployFix ? deployedRecord.deployFix.lon : '';
    const deployedAtIso = deployedRecord ? new Date(deployedRecord.deployedAt).toISOString() : '';
    const reconciledAtIso = row.reconciledAt ? new Date(row.reconciledAt).toISOString() : '';

    const fields = [
      row.physicalLabel,
      serial,
      row.state,
      String(row.heard),
      String(rssiDbm),
      String(distanceM),
      String(positionStatus),
      String(fixAgeS),
      row.reason,
      String(nodeLat),
      String(nodeLon),
      deployedAtIso,
      reconciledAtIso,
    ];

    lines.push(fields.map(csvEscape).join(','));
  }

  return lines.join('\n');
}

const fmt = (ts: number) => new Date(ts).toLocaleString();

export default function ReportScreen({ navigation, route }: NativeStackScreenProps<JobStackParamList, 'Report'>) {
  const { jobId } = route.params;
  const [job, setJob] = useState<Job | null>(null);
  const [manifest, setManifest] = useState<Record<string, DeployedNodeRecord>>({});
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewedAt] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const activeJob = (await listJobs()).find(j => j.id === jobId) ?? null;
    setJob(activeJob);

    if (!activeJob) {
      setManifest({});
      setRows([]);
      setLoaded(true);
      return;
    }

    const deployed = await loadDeployed(jobId);
    const pickup = await loadPickup(jobId);

    const displayRows: DisplayRow[] = [];
    const seen = new Set<string>();

    for (const serial of Object.keys(deployed)) {
      const record = deployed[serial];
      seen.add(String(record.bleSerial));
      const result = pickup[serial];
      if (result) {
        // An in-manifest node can never really be 'extra' (extra means heard but
        // not deployed). If pickup tagged it that way anyway, fall back to its
        // heard/missing state instead of double-counting it as an extra.
        const state = result.state === 'extra'
          ? (result.heard ? 'heard-not-close' : 'missing')
          : result.state;
        displayRows.push({ key: serial, ...result, state });
      } else {
        displayRows.push({
          key: serial,
          bleSerial: record.bleSerial,
          physicalLabel: record.physicalLabel,
          state: 'missing',
          heard: false,
          rssi: null,
          distanceM: null,
          positionStatus: null,
          fixAgeMs: null,
          reason: 'not-heard',
          reconciledAt: 0,
        });
      }
    }

    for (const serial of Object.keys(pickup)) {
      const result = pickup[serial];
      if (seen.has(String(result.bleSerial))) continue;
      if (result.state === 'extra') {
        displayRows.push({ key: serial, ...result });
      }
    }

    setManifest(deployed);
    setRows(displayRows);
    setLoaded(true);
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const counts = useMemo(() => {
    let recovered = 0;
    let notClose = 0;
    let missing = 0;
    let extra = 0;
    for (const row of rows) {
      if (row.state === 'recovered') recovered += 1;
      else if (row.state === 'heard-not-close') notClose += 1;
      else if (row.state === 'missing') missing += 1;
      else if (row.state === 'extra') extra += 1;
    }
    return { recovered, notClose, missing, extra };
  }, [rows]);

  const handleClose = useCallback(async () => {
    await setJobStatus(jobId, 'closed');
    navigation.navigate('JobHome');
  }, [jobId, navigation]);

  const handleExportCsv = useCallback(async () => {
    if (!job) return;
    try {
      const csv = buildCsv(manifest, rows);
      const safeName = job.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = safeName + '_' + stamp + '.csv';

      // File name itself carries the job name and timestamp, so no per-export subfolder needed.
      const dir = new Directory(Paths.document, 'QuantumReports');
      dir.create({ intermediates: true, idempotent: true });

      const file = new File(dir, fileName);
      file.create();
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export pickup report',
          UTI: 'public.comma-separated-values-text',
        });
      }

      Alert.alert('Report saved', file.uri);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    }
  }, [job, manifest, rows]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
      <JobHeader title="Report" subtitle={job ? job.name : undefined} />

      {job ? (
        <View style={styles.timestampBlock}>
          {job.deployedAt ? (
            <Text style={styles.timestampTxt}>Deployed {fmt(job.deployedAt)}</Text>
          ) : null}
          {job.pickedUpAt ? (
            <Text style={styles.timestampTxt}>Picked up {fmt(job.pickedUpAt)}</Text>
          ) : null}
          <Text style={styles.timestampTxt}>Report viewed {fmt(viewedAt)}</Text>
        </View>
      ) : null}

      {loaded && !job ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>
            No active job. Pick or create one from the Jobs screen.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={[styles.tileValue, { color: '#4CAF50' }]}>{counts.recovered}</Text>
              <Text style={styles.tileLabel}>Recovered</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileValue, { color: '#FF9800' }]}>{counts.notClose}</Text>
              <Text style={styles.tileLabel}>Not close</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileValue, { color: '#F44336' }]}>{counts.missing}</Text>
              <Text style={styles.tileLabel}>Missing</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileValue, { color: '#42A5F5' }]}>{counts.extra}</Text>
              <Text style={styles.tileLabel}>Extra</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleExportCsv}>
              <Text style={styles.primaryBtnText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose}>
              <Text style={styles.secondaryBtnText}>Close job</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.rowsList}>
            {rows.map(row => (
              <View key={row.key} style={styles.rowWrap}>
                <NodeResultRow
                  physicalLabel={row.physicalLabel}
                  rssi={row.rssi}
                  distanceM={row.distanceM}
                  positionStatus={row.positionStatus}
                  fixAgeMs={row.fixAgeMs}
                  state={row.state}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { padding: 12, paddingBottom: 24 },
  timestampBlock: { paddingHorizontal: 16, paddingTop: 8 },
  timestampTxt: { color: '#888', fontSize: 11, marginTop: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTxt: { color: '#777', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tile: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tileValue: { fontSize: 20, fontWeight: 'bold' },
  tileLabel: { color: '#aaa', fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
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
  rowsList: { gap: 8 },
  rowWrap: { marginBottom: 0 },
});
