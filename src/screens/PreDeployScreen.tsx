import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { JobStackParamList } from '../navigation/types';
import type { Job, DeployedNodeRecord } from '../services/jobStore';
import { listJobs, loadDeployed, upsertDeployedNodes, setJobStatus } from '../services/jobStore';
import { useScannerContext } from '../context/ScannerContext';
import JobHeader from '../components/JobHeader';
import NodeResultRow from '../components/NodeResultRow';

const FLUSH_DEBOUNCE_MS = 2500;

const fmt = (ts: number) => new Date(ts).toLocaleString();

export default function PreDeployScreen({ navigation, route }: NativeStackScreenProps<JobStackParamList, 'PreDeploy'>) {
  const { jobId } = route.params;
  const { nodesBySerial, scanning, bleReady, startScan, stopScan } = useScannerContext();

  const [job, setJob] = useState<Job | null>(null);
  const [jobChecked, setJobChecked] = useState(false);
  const [manifest, setManifest] = useState<Record<string, DeployedNodeRecord>>({});
  const [saveError, setSaveError] = useState(false);

  const deployStartedAtRef = useRef<number>(0);
  const manifestRef = useRef<Record<string, DeployedNodeRecord>>({});
  const pendingRef = useRef<Record<string, DeployedNodeRecord>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  // Reload job + manifest whenever this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const found = (await listJobs()).find(j => j.id === jobId) ?? null;
          if (cancelled) return;
          setJob(found);
          const deployed = await loadDeployed(jobId);
          if (cancelled) return;
          setManifest(deployed);
          manifestRef.current = deployed;
        } catch {
          if (!cancelled) {
            setJob(null);
            setManifest({});
            manifestRef.current = {};
          }
        } finally {
          if (!cancelled) setJobChecked(true);
        }
      })();
      return () => { cancelled = true; };
    }, [jobId]),
  );

  const flushPending = useCallback(() => {
    const records = Object.values(pendingRef.current);
    pendingRef.current = {};
    if (records.length === 0) return;
    upsertDeployedNodes(jobId, records)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, [jobId]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }, [flushPending]);

  // While scanning, absorb newly seen nodes into the manifest, throttled to disk.
  useEffect(() => {
    if (!scanning || !jobChecked) return;
    const startedAt = deployStartedAtRef.current;
    const next = { ...manifestRef.current };
    let grew = false;

    for (const node of nodesBySerial.values()) {
      if (node.lastSeen < startedAt) continue;
      const key = String(node.bleSerial);
      const existing = next[key];

      if (existing) {
        if (existing.deployFix === null && node.lastGoodFix != null && node.lastGoodFix.ts >= startedAt) {
          const updated: DeployedNodeRecord = {
            ...existing,
            deployFix: node.lastGoodFix,
            batteryPctAtDeploy: existing.batteryPctAtDeploy === null ? node.batteryPct : existing.batteryPctAtDeploy,
          };
          next[key] = updated;
          pendingRef.current[key] = updated;
          grew = true;
        }
        continue;
      }

      const record: DeployedNodeRecord = {
        bleSerial: node.bleSerial,
        physicalLabel: node.physicalLabel,
        deployedAt: Date.now(),
        deployFix: node.lastGoodFix && node.lastGoodFix.ts >= startedAt ? node.lastGoodFix : null,
        batteryPctAtDeploy: node.batteryPct,
      };
      next[key] = record;
      pendingRef.current[key] = record;
      grew = true;
    }

    if (grew) {
      manifestRef.current = next;
      setManifest(next);
      scheduleFlush();
    }
  }, [nodesBySerial, scanning, jobChecked, scheduleFlush]);

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    stopScan();
  }, [stopScan]);

  const handleScanPress = () => {
    if (scanning) {
      stopScan();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushPending();
    } else {
      deployStartedAtRef.current = Date.now();
      startScan();
    }
  };

  const handleFinish = async () => {
    if (!job) return;
    stopScan();
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      const records = Object.values(pendingRef.current);
      if (records.length > 0) {
        await upsertDeployedNodes(jobId, records);
        pendingRef.current = {};
      }
      if (job.status !== 'closed') {
        await setJobStatus(jobId, 'deployed');
      }
      setSaveError(false);
    } catch {
      setSaveError(true);
      return;
    }
    navigation.goBack();
  };

  const manifestList = Object.values(manifest);
  const count = manifestList.length;

  if (!jobChecked) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
        <JobHeader title="Pre-deploy" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
        <JobHeader title="Pre-deploy" />
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
      <JobHeader title="Pre-deploy" subtitle={job.name} />
      <Text style={styles.metaLine}>{job.name} - created {fmt(job.createdAt)}</Text>
      {saveError ? (
        <Text style={styles.errorTxt}>Some nodes may not be saved, tap Finish again</Text>
      ) : null}

      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <Text style={styles.countText}>
            <Text style={styles.countNum}>{count}</Text> node{count !== 1 ? 's' : ''} in manifest
          </Text>
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

      {count === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>
            {bleReady ? 'Press SCAN and walk the nodes to deploy' : 'Bluetooth not ready'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={manifestList}
          keyExtractor={r => String(r.bleSerial)}
          renderItem={({ item }) => {
            const live = nodesBySerial.get(item.bleSerial);
            return (
              <View style={styles.rowWrap}>
                <NodeResultRow
                  physicalLabel={item.physicalLabel}
                  batteryPct={item.batteryPctAtDeploy}
                  rssi={live ? live.rssi : null}
                  positionStatus={live ? live.positionStatus : null}
                />
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      <TouchableOpacity style={styles.finishBtn} onPress={handleFinish}>
        <Text style={styles.finishBtnTxt}>Finish deploy ({count})</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  metaLine: {
    color: '#777',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toolbarLeft: { flex: 1 },
  countText: { color: '#fff', fontSize: 15 },
  countNum: { fontWeight: 'bold' },
  statusTxt: { color: '#aaa', fontSize: 12, marginTop: 2 },
  hint: { color: '#FF9800', fontSize: 12, marginTop: 4 },
  errorTxt: {
    color: '#F44336',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 16,
    paddingTop: 4,
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
  finishBtn: {
    backgroundColor: '#42A5F5',
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  finishBtnTxt: { color: '#0D0D0D', fontWeight: 'bold', fontSize: 16 },
});
