import React, { useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar,
} from 'react-native';
import { useScannerContext } from '../context/ScannerContext';
import { QuantumNode } from '../services/quantum';

function batteryColor(pct: number | null): string {
  if (pct === null) return '#888';
  if (pct > 50) return '#4CAF50';
  if (pct > 20) return '#FF9800';
  return '#F44336';
}

function posLabel(status: number, lat: number | null): string {
  if (lat !== null) return '● GPS';
  if (status === 1) return '○ No lock';
  return '○ No GPS';
}

function NodeRow({ node }: { node: QuantumNode }) {
  const age = Math.round((Date.now() - node.lastSeen) / 1000);
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.label}>{node.physicalLabel}</Text>
        <Text style={styles.sub}>RSSI {node.rssi} dBm · {age}s ago</Text>
        <Text style={[styles.sub, { color: node.latitude ? '#4CAF50' : '#888' }]}>
          {posLabel(node.positionStatus, node.latitude)}
          {node.latitude ? `  ${node.latitude.toFixed(6)}, ${node.longitude!.toFixed(6)}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {node.batteryPct !== null ? (
          <>
            <Text style={[styles.battery, { color: batteryColor(node.batteryPct) }]}>
              {node.batteryPct}%
            </Text>
            <Text style={styles.batLabel}>BAT</Text>
          </>
        ) : (
          <Text style={styles.sub}>--</Text>
        )}
      </View>
    </View>
  );
}

export default function ScanScreen() {
  const { nodes, scanning, bleReady, startScan, stopScan, clearNodes } = useScannerContext();

  const sorted = useMemo(
    () => Array.from(nodes.values()).sort((a, b) => b.rssi - a.rssi),
    [nodes],
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A237E" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Quantum Scanner</Text>
          <Text style={styles.headerSub}>
            {nodes.size} node{nodes.size !== 1 ? 's' : ''} · {scanning ? 'Scanning…' : 'Idle'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.btn, !bleReady && styles.btnDisabled]}
          onPress={scanning ? stopScan : startScan}
          disabled={!bleReady}
        >
          <Text style={styles.btnTxt}>{scanning ? 'STOP' : 'SCAN'}</Text>
        </TouchableOpacity>
      </View>

      {nodes.size === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTxt}>
            {bleReady ? 'Press SCAN and walk near the nodes' : 'Bluetooth not ready'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={n => n.mac}
          renderItem={({ item }) => <NodeRow node={item} />}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      {nodes.size > 0 && (
        <TouchableOpacity style={styles.clearBtn} onPress={clearNodes}>
          <Text style={styles.clearTxt}>Clear list</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    backgroundColor: '#1A237E',
    padding: 16,
    paddingTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerSub: { color: '#90CAF9', fontSize: 13, marginTop: 2 },
  btn: {
    backgroundColor: '#42A5F5',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnDisabled: { backgroundColor: '#444' },
  btnTxt: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  row: {
    backgroundColor: '#1A1A1A',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'center', minWidth: 52 },
  label: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  sub: { color: '#aaa', fontSize: 12, marginTop: 3 },
  battery: { fontSize: 22, fontWeight: 'bold' },
  batLabel: { color: '#777', fontSize: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTxt: { color: '#777', fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },
  clearBtn: { padding: 14, alignItems: 'center' },
  clearTxt: { color: '#555', fontSize: 13 },
});
