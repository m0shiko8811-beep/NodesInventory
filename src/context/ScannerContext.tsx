import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import { BleManager, Device, State } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { QuantumNode, parseQuantumAdvertisement, mergeNode } from '../services/quantum';

interface ScannerContextType {
  nodes: Map<string, QuantumNode>;
  nodesBySerial: Map<number, QuantumNode>;
  scanning: boolean;
  bleReady: boolean;
  startScan: () => void;
  stopScan: () => void;
  clearNodes: () => void;
}

const ScannerContext = createContext<ScannerContextType>({
  nodes: new Map(),
  nodesBySerial: new Map(),
  scanning: false,
  bleReady: false,
  startScan: () => {},
  stopScan: () => {},
  clearNodes: () => {},
});

export function useScannerContext() {
  return useContext(ScannerContext);
}

export function ScannerProvider({ children }: { children: React.ReactNode }) {
  const manager = useRef(new BleManager()).current;
  const [nodes, setNodes] = useState<Map<string, QuantumNode>>(new Map());
  const [scanning, setScanning] = useState(false);
  const [bleReady, setBleReady] = useState(false);

  useEffect(() => {
    const sub = manager.onStateChange(state => {
      setBleReady(state === State.PoweredOn);
    }, true);
    return () => sub.remove();
  }, [manager]);

  const requestPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(results).every(r => r === 'granted');
  };

  const startScan = useCallback(async () => {
    if (scanning) return;
    const ok = await requestPermissions();
    if (!ok || !bleReady) return;

    setScanning(true);
    manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
      if (err || !device) return;
      if (!device.localName?.startsWith('TN ')) return;

      const parsed = parseQuantumAdvertisement(
        device.manufacturerData ? { '2081': base64ToUint8(device.manufacturerData) } : null,
        buildServiceData(device),
        device.rssi ?? -99,
        device.id,
        device.localName,
      );
      if (!parsed) return;

      setNodes(prev => {
        const next = new Map(prev);
        const existing = next.get(device.id);
        next.set(device.id, mergeNode(existing, parsed));
        return next;
      });
    });
  }, [scanning, bleReady, manager]);

  const stopScan = useCallback(() => {
    manager.stopDeviceScan();
    setScanning(false);
  }, [manager]);

  const clearNodes = useCallback(() => setNodes(new Map()), []);

  useEffect(() => () => { manager.stopDeviceScan(); manager.destroy(); }, [manager]);

  const nodesBySerial = useMemo(() => {
    const bySerial = new Map<number, QuantumNode>();
    for (const node of nodes.values()) {
      const existing = bySerial.get(node.bleSerial);
      if (!existing) {
        bySerial.set(node.bleSerial, node);
        continue;
      }
      if (node.lastSeen > existing.lastSeen) {
        bySerial.set(node.bleSerial, node);
      } else if (node.lastSeen === existing.lastSeen && node.lastGoodFix && !existing.lastGoodFix) {
        bySerial.set(node.bleSerial, node);
      }
    }
    return bySerial;
  }, [nodes]);

  return (
    <ScannerContext.Provider
      value={{
        nodes, nodesBySerial, scanning, bleReady, startScan, stopScan, clearNodes,
      }}
    >
      {children}
    </ScannerContext.Provider>
  );
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function buildServiceData(device: Device): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  // react-native-ble-plx exposes serviceData as a record of uuid→base64
  const sd = (device as any).serviceData as Record<string, string> | null;
  if (!sd) return result;
  for (const [uuid, b64] of Object.entries(sd)) {
    const key = uuid.toLowerCase().replace(/-/g, '');
    result[key] = base64ToUint8(b64);
  }
  return result;
}
