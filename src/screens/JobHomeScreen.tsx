import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { JobStackParamList } from '../navigation/types';
import JobHeader from '../components/JobHeader';
import {
  Job, JobStatus, createJob, loadActiveJob, setActiveJob, listJobs, loadDeployed, loadPickup,
} from '../services/jobStore';

interface PastJobEntry {
  job: Job;
  deployedCount: number;
  recoveredCount: number;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  preDeploy: 'Pre-Deploy',
  deployed: 'Deployed',
  pickup: 'Pickup',
  closed: 'Closed',
};

const STATUS_COLOR: Record<JobStatus, string> = {
  preDeploy: '#aaa',
  deployed: '#42A5F5',
  pickup: '#FF9800',
  closed: '#666',
};

function StatusPill({ status }: { status: JobStatus }) {
  return (
    <View style={[styles.pill, { borderColor: STATUS_COLOR[status] }]}>
      <Text style={[styles.pillText, { color: STATUS_COLOR[status] }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

const fmt = (ts: number) => new Date(ts).toLocaleString();

export default function JobHomeScreen({ navigation }: NativeStackScreenProps<JobStackParamList, 'JobHome'>) {
  const [activeJob, setActiveJobState] = useState<Job | null>(null);
  const [deployedCount, setDeployedCount] = useState(0);
  const [recoveredCount, setRecoveredCount] = useState(0);
  const [pastJobs, setPastJobs] = useState<PastJobEntry[]>([]);
  const [newJobName, setNewJobName] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const job = await loadActiveJob();
    setActiveJobState(job);

    if (job) {
      const deployed = await loadDeployed(job.id);
      const pickup = await loadPickup(job.id);
      setDeployedCount(Object.keys(deployed).length);
      setRecoveredCount(Object.values(pickup).filter(r => r.state === 'recovered').length);
    } else {
      setDeployedCount(0);
      setRecoveredCount(0);
    }

    const all = await listJobs();
    const others = all
      .filter(j => j.id !== job?.id)
      .sort((a, b) => b.createdAt - a.createdAt);

    const entries: PastJobEntry[] = await Promise.all(
      others.map(async j => {
        const deployed = await loadDeployed(j.id);
        const pickup = await loadPickup(j.id);
        return {
          job: j,
          deployedCount: Object.keys(deployed).length,
          recoveredCount: Object.values(pickup).filter(r => r.state === 'recovered').length,
        };
      }),
    );

    setPastJobs(entries);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleCreateJob = useCallback(async () => {
    const name = newJobName.trim() || ('Job ' + new Date().toLocaleDateString());
    await createJob(name);
    setNewJobName('');
    await refresh();
  }, [newJobName, refresh]);

  const handleSelectJob = useCallback(async (id: string) => {
    await setActiveJob(id);
    await refresh();
  }, [refresh]);

  const missingCount = Math.max(0, deployedCount - recoveredCount);
  const canPickup = activeJob !== null && (activeJob.status === 'deployed' || activeJob.status === 'pickup');
  const canReport = activeJob !== null
    && (activeJob.status === 'pickup' || activeJob.status === 'closed' || deployedCount > 0);
  const showEmptyState = loaded && !activeJob && pastJobs.length === 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A237E" />
      <JobHeader title="Jobs" subtitle={activeJob ? activeJob.name : 'No active job'} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.newJobRow}>
          <TextInput
            style={styles.input}
            value={newJobName}
            onChangeText={setNewJobName}
            placeholder="New job name"
            placeholderTextColor="#666"
          />
          <TouchableOpacity style={styles.newJobBtn} onPress={handleCreateJob}>
            <Text style={styles.primaryBtnText}>New Job</Text>
          </TouchableOpacity>
        </View>

        {showEmptyState ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTxt}>
              No jobs yet. Create your first job above to get started.
            </Text>
          </View>
        ) : null}

        {activeJob ? (
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.jobName}>{activeJob.name}</Text>
              <StatusPill status={activeJob.status} />
            </View>

            <View style={styles.timestampBlock}>
              <Text style={styles.timestampTxt}>Created {fmt(activeJob.createdAt)}</Text>
              {activeJob.deployedAt ? (
                <Text style={styles.timestampTxt}>Deployed {fmt(activeJob.deployedAt)}</Text>
              ) : null}
              {activeJob.pickedUpAt ? (
                <Text style={styles.timestampTxt}>Picked up {fmt(activeJob.pickedUpAt)}</Text>
              ) : null}
            </View>

            <View style={styles.tileRow}>
              <View style={styles.tile}>
                <Text style={[styles.tileValue, { color: '#fff' }]}>{deployedCount}</Text>
                <Text style={styles.tileLabel}>Deployed</Text>
              </View>
              <View style={styles.tile}>
                <Text style={[styles.tileValue, { color: '#4CAF50' }]}>{recoveredCount}</Text>
                <Text style={styles.tileLabel}>Recovered</Text>
              </View>
              <View style={styles.tile}>
                <Text style={[styles.tileValue, { color: '#F44336' }]}>{missingCount}</Text>
                <Text style={styles.tileLabel}>Missing</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('PreDeploy', { jobId: activeJob.id })}
              >
                <Text style={styles.primaryBtnText}>Pre-Deploy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, !canPickup && styles.btnDisabled]}
                onPress={() => navigation.navigate('Pickup', { jobId: activeJob.id })}
                disabled={!canPickup}
              >
                <Text style={[styles.secondaryBtnText, !canPickup && styles.btnTextDisabled]}>
                  Start Pickup
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, !canReport && styles.btnDisabled]}
                onPress={() => navigation.navigate('Report', { jobId: activeJob.id })}
                disabled={!canReport}
              >
                <Text style={[styles.secondaryBtnText, !canReport && styles.btnTextDisabled]}>
                  View Report
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {pastJobs.length > 0 ? (
          <View style={styles.pastSection}>
            <Text style={styles.sectionTitle}>Past Jobs</Text>
            {pastJobs.map(entry => (
              <TouchableOpacity
                key={entry.job.id}
                style={styles.pastRow}
                onPress={() => handleSelectJob(entry.job.id)}
              >
                <View style={styles.pastRowLeft}>
                  <Text style={styles.pastRowName}>{entry.job.name}</Text>
                  <Text style={styles.pastRowSub}>
                    {entry.deployedCount} deployed, {entry.recoveredCount} recovered
                  </Text>
                </View>
                <StatusPill status={entry.job.status} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { padding: 12, paddingBottom: 24 },
  newJobRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  input: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#232323',
  },
  newJobBtn: {
    backgroundColor: '#42A5F5',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyTxt: { color: '#777', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  jobName: { color: '#fff', fontSize: 18, fontWeight: 'bold', flexShrink: 1, paddingRight: 8 },
  timestampBlock: { marginBottom: 12 },
  timestampTxt: { color: '#888', fontSize: 11, marginTop: 1 },
  pill: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: { fontSize: 12, fontWeight: 'bold' },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tileValue: { fontSize: 22, fontWeight: 'bold' },
  tileLabel: { color: '#aaa', fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8 },
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
  btnDisabled: { opacity: 0.4 },
  btnTextDisabled: { color: '#aaa' },
  pastSection: { marginTop: 4 },
  sectionTitle: { color: '#aaa', fontSize: 13, fontWeight: 'bold', marginBottom: 8, letterSpacing: 0.5 },
  pastRow: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pastRowLeft: { flex: 1, paddingRight: 8 },
  pastRowName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  pastRowSub: { color: '#aaa', fontSize: 12, marginTop: 3 },
});
