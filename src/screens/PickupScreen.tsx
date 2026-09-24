import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import type { JobStackParamList } from '../navigation/types';
import type { Job, DeployedNodeRecord, PickupResult, ReconState } from '../services/jobStore';
import {
  listJobs, loadDeployed, loadPickup, mergePickupResults, setJobStatus,
} from '../services/jobStore';
import { evaluateRecovery } from '../services/proximity';
import { useScannerContext } from '../context/ScannerContext';
import JobHeader from '../components/JobHeader';
import NodeResultRow from '../components/NodeResultRow';

type GpsMode = 'ok' | 'unavailable';

interface Row {
  key: string;
  physicalLabel: string;
  batteryPct?: number | null;
  rssi?: number | null;
  distanceM?: number | null;
  positionStatus?: number | null;
  fixAgeMs?: number | null;
  state?: ReconState;
}

const fmt = (ts: number) => new Date(ts).toLocaleString();

export default function PickupScreen({ navigation, route }: NativeStackScreenProps<JobStackParamList, 'Pickup'>) {
  const { jobId } = route.params;
  const { nodesBySerial, scanning, bleReady, startScan, stopScan } = useScannerContext();

  const [job, setJob] = useState<Job | null>(null);
  const [jobChecked, setJobChecked] = useState(false);
  const [manifest, setManifest] = useState<Record<string, DeployedNodeRecord>>({});
  const [results, setResults] = useState<Record<string, PickupResult>>({});

  const [phoneFix, setPhoneFix] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsMode, setGpsMode] = useState<GpsMode>('unavailable');
  const [reconciling, setReconciling] = useState(false);
  const [reconciledAt, setReconciledAt] = useState<number | null>(null);

  const pickupStartedAtRef = useRef<number>(0);

  // Reload job, manifest and cumulative results whenever this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const found = (await listJobs()).find(j => j.id === jobId) ?? null;
          if (cancelled) return;
          setJob(found);
          const [deployed, pickup] = await Promise.all([
            loadDeployed(jobId),
            loadPickup(jobId),
          ]);
          if (cancelled) return;
          setManifest(deployed);
          setResults(pickup);
        } catch {
          if (!cancelled) {
            setJob(null);
            setManifest({});
            setResults({});
          }
        } finally {
          if (!cancelled) setJobChecked(true);
        }
      })();
      return () => { cancelled = true; };
    }, [jobId]),
  );

  const handleScanPress = () => {
    if (scanning) {
      stopScan();
    } else {
      pickupStartedAtRef.current = Date.now();
      startScan();
    }
  };

  const handleReconcile = async () => {
    if (!job || reconciling) return;
    setReconciling(true);

    let fix: { lat: number; lon: number } | null = null;
    let accuracy: number | null = null;
    let mode: GpsMode = 'unavailable';
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
        fix = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        accuracy = pos.coords.accuracy;
        mode = 'ok';
      } else {
        fix = null;
        mode = 'unavailable';
      }
    } catch {
      fix = null;
      mode = 'unavailable';
    }
    setPhoneFix(fix);
    setGpsAccuracy(accuracy);
    setGpsMode(mode);

    const now = Date.now();
    const startedAt = pickupStartedAtRef.current;
    const newResults: PickupResult[] = [];

    for (const rec of Object.values(manifest)) {
      const node = nodesBySerial.get(rec.bleSerial);
      const heard = !!node && node.lastSeen >= startedAt;

      if (!heard) {
        newResults.push({
          bleSerial: rec.bleSerial,
          physicalLabel: rec.physicalLabel,
          state: 'missing',
          heard: false,
          rssi: null,
          distanceM: null,
          positionStatus: null,
          fixAgeMs: null,
          reason: 'not-heard',
          reconciledAt: now,
        });
        continue;
      }

      const ev = evaluateRecovery({
        phone: fix,
        nodeFix: node!.lastGoodFix ?? null,
        rssi: node!.rssi ?? null,
        phaseStartedAt: startedAt,
        now,
      });
      const state: ReconState = ev.recovered ? 'recovered' : 'heard-not-close';
      newResults.push({
        bleSerial: rec.bleSerial,
        physicalLabel: rec.physicalLabel,
        state,
        heard: true,
        rssi: node!.rssi,
        distanceM: ev.distanceM,
        positionStatus: ev.positionStatus,
        fixAgeMs: ev.fixAgeMs,
        reason: ev.reason,
        reconciledAt: now,
      });
    }

    for (const node of nodesBySerial.values()) {
      if (node.lastSeen < startedAt) continue;
      const key = String(node.bleSerial);
      if (manifest[key]) continue;

      const ev = evaluateRecovery({
        phone: fix,
        nodeFix: node.lastGoodFix ?? null,
        rssi: node.rssi ?? null,
        phaseStartedAt: startedAt,
        now,
      });
      newResults.push({
        bleSerial: node.bleSerial,
        physicalLabel: node.physicalLabel,
        state: 'extra',
        heard: true,
        rssi: node.rssi,
        distanceM: ev.distanceM,
        positionStatus: ev.positionStatus,
        fixAgeMs: ev.fixAgeMs,
        reason: 'extra',
        reconciledAt: now,
      });
    }

    try {
      await mergePickupResults(jobId, newResults);
      await setJobStatus(jobId, 'pickup');
    } catch {
      // best effort persistence; local results state still updates below
    }

    setResults(prev => {
      const next = { ...prev };
      for (const r of newResults) {
        const key = String(r.bleSerial);
        const current = next[key];
        if (current && current.state === 'recovered') continue; // recovered is sticky, mirrors mergePickupResults
        next[key] = r;
      }
      return next;
    });

    setReconciledAt(now);
    setReconciling(false);
    navigation.navigate('Report', { jobId });
  };

  const manifestSize = Object.keys(manifest).length;
  const recoveredCount = Object.values(results).filter(r => r.state === 'recovered').length;
  const hasReconciled = Object.keys(results).length > 0;

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(manifest)) {
    seen.add(key);
    const rec = manifest[key];
    const result = results[key];
    if (result) {
      rows.push({
        key,
        physicalLabel: result.physicalLabel,
        batteryPct: rec.batteryPctAtDeploy,
        rssi: result.rssi,
        distanceM: result.distanceM,
        positionStatus: result.positionStatus,
        fixAgeMs: result.fixAgeMs,
        state: result.state,
      });
    } else {
      rows.push({
        key,
        physicalLabel: rec.physicalLabel,
        batteryPct: rec.batteryPctAtDeploy,
      });
    }
  }
  for (const key of Object.keys(results)) {
    if (seen.has(key)) continue;
    const result = results[key];
    rows.push({
      key,
      physicalLabel: result.physicalLabel,
      rssi: result.rssi,
      distanceM: result.distanceM,
      positionStatus: result.positionStatus,
      fixAgeMs: result.fixAgeMs,
      state: result.state,
    });
  }

  if (!jobChecked) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
        <JobHeader title="Pickup" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
        <JobHeader title="Pickup" />
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>
            Job not found, go back to Jobs
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
      <JobHeader title="Pickup" subtitle={job.name} />

      <View style={styles.statusRow}>
        <Text style={styles.statusLine}>
          {gpsMode === 'ok'
            ? `Phone GPS +/- ${gpsAccuracy != null ? Math.round(gpsAccuracy) : '?'}m`
            : 'GPS unavailable, RSSI only'}
        </Text>
        <Text style={styles.statusLine}>
          <Text style={styles.countNum}>{recoveredCount}</Text> of {manifestSize} recovered
        </Text>
        {reconciledAt != null ? (
          <Text style={styles.reconciledLine}>Reconciled at {fmt(reconciledAt)}</Text>
        ) : null}
      </View>

      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <Text style={styles.statusTxt}>{scanning ? 'Scanning...' : 'Idle'}</Text>
          {!bleReady ? <Text style={styles.hint}>Turn on Bluetooth to scan</Text> : null}
        </View>
        <TouchableOpacity
          style={[
            styles.scanBtn,
            scanning ? styles.stopBtn : styles.scanBtnAccent,
            !bleReady && styles.btnDisabled,
          ]}
          onPress={handleScanPress}
          disabled={!bleReady}
        >
          <Text style={scanning ? styles.scanBtnTxtLight : styles.scanBtnTxtDark}>
            {scanning ? 'STOP' : 'SCAN'}
          </Text>
        </TouchableOpacity>
      </View>

      {!hasReconciled ? (
        <Text style={styles.hintCenter}>Scan the collected nodes, then tap Reconcile now.</Text>
      ) : null}

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>No nodes in the manifest for this job.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.key}
          renderItem={({ item }) => (
            <View style={styles.rowWrap}>
              <NodeResultRow
                physicalLabel={item.physicalLabel}
                batteryPct={item.batteryPct}
                rssi={item.rssi}
                distanceM={item.distanceM}
                positionStatus={item.positionStatus}
                fixAgeMs={item.fixAgeMs}
                state={item.state}
              />
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      <TouchableOpacity
        style={[styles.reconcileBtn, reconciling && styles.btnDisabled]}
        onPress={handleReconcile}
        disabled={reconciling}
      >
        <Text style={styles.reconcileBtnTxt}>{reconciling ? 'Reconciling...' : 'Reconcile now'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  statusRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 2,
  },
  statusLine: { color: '#aaa', fontSize: 13 },
  reconciledLine: { color: '#777', fontSize: 12, marginTop: 2 },
  countNum: { color: '#fff', fontWeight: 'bold' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toolbarLeft: { flex: 1 },
  statusTxt: { color: '#aaa', fontSize: 12 },
  hint: { color: '#FF9800', fontSize: 12, marginTop: 4 },
  hintCenter: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingBottom: 8,
  },
  scanBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  scanBtnAccent: { backgroundColor: '#42A5F5' },
  stopBtn: { backgroundColor: '#F44336' },
  btnDisabled: { backgroundColor: '#444' },
  scanBtnTxtDark: { color: '#0D0D0D', fontWeight: 'bold', fontSize: 15 },
  scanBtnTxtLight: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  rowWrap: { marginHorizontal: 12, marginTop: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTxt: { color: '#777', fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },
  reconcileBtn: {
    backgroundColor: '#42A5F5',
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  reconcileBtnTxt: { color: '#0D0D0D', fontWeight: 'bold', fontSize: 16 },
});
