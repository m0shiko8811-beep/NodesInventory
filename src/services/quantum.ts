// INOVA Quantum node BLE advertisement decoder
// Physical label: Q + zero-pad(BLE_serial - 0x20000000, 8)

export const INOVA_BASE = 536870912; // 0x20000000

export interface LastGoodFix { lat: number; lon: number; positionStatus: number; ts: number; }

export interface QuantumNode {
  mac: string;
  bleSerial: number;
  physicalLabel: string; // e.g. "Q00635653"
  batteryPct: number | null;
  latitude: number | null;
  longitude: number | null;
  positionStatus: number; // 0=none 1=ok 2=estimated 3=last-known
  rssi: number;
  manufacturerRaw: string; // hex, for future decoding
  lastSeen: number; // Date.now()
  lastGoodFix?: LastGoodFix | null;   // sticky snapshot of the last real GPS fix
  locDataPresent?: boolean;           // transient: did THIS packet carry 0x1819 location data
}

export function bleSerialToLabel(serial: number): string {
  const id = serial - INOVA_BASE;
  return 'Q' + id.toString().padStart(8, '0');
}

export function parseQuantumAdvertisement(
  manufacturerData: Record<string, Uint8Array> | null,
  serviceData: Record<string, Uint8Array> | null,
  rssi: number,
  mac: string,
  localName: string | null,
): Partial<QuantumNode> | null {
  // Must have "TN " prefix in name
  if (!localName?.startsWith('TN ')) return null;

  const bleSerial = parseInt(localName.slice(3), 10);
  if (isNaN(bleSerial)) return null;

  let batteryPct: number | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let positionStatus = 0;
  let manufacturerRaw = '';
  let locDataPresent: boolean | undefined;

  // Battery Service data (UUID 0x180F)
  const batKey = Object.keys(serviceData ?? {}).find(k =>
    k.toLowerCase().replace(/-/g, '').includes('180f'),
  );
  if (batKey && serviceData![batKey]?.length >= 1) {
    batteryPct = serviceData![batKey][0];
  }

  // Location and Navigation service data (UUID 0x1819)
  const locKey = Object.keys(serviceData ?? {}).find(k =>
    k.toLowerCase().replace(/-/g, '').includes('1819'),
  );
  if (locKey && serviceData![locKey]?.length >= 10) {
    locDataPresent = true;
    const d = serviceData![locKey];
    const flags = d[0] | (d[1] << 8);
    const locPresent = (flags >> 2) & 1;
    positionStatus = (flags >> 7) & 3;
    if (locPresent) {
      const latRaw =
        d[2] | (d[3] << 8) | (d[4] << 16) | ((d[5] << 24) >> 0);
      const lonRaw =
        d[6] | (d[7] << 8) | (d[8] << 16) | ((d[9] << 24) >> 0);
      latitude  = latRaw * 1e-7;
      longitude = lonRaw * 1e-7;
      if (latitude === 0 && longitude === 0) {
        latitude  = null;
        longitude = null;
      }
    }
  }

  // Manufacturer specific data (company 0x0821 = INOVA)
  const mfrKey = Object.keys(manufacturerData ?? {}).find(k =>
    k === '2081', // little-endian 0x0821
  );
  if (mfrKey && manufacturerData![mfrKey]) {
    manufacturerRaw = Array.from(manufacturerData![mfrKey])
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  return {
    mac,
    bleSerial,
    physicalLabel: bleSerialToLabel(bleSerial),
    batteryPct,
    latitude,
    longitude,
    positionStatus,
    rssi,
    manufacturerRaw,
    lastSeen: Date.now(),
    locDataPresent,
  };
}

export function mergeNode(existing: QuantumNode | undefined, parsed: Partial<QuantumNode>): QuantumNode {
  const merged = { ...existing, ...parsed } as QuantumNode;
  const hasCoords = parsed.latitude != null && parsed.longitude != null;
  if (!hasCoords && existing) {
    // a GPS-less advertisement must not wipe a previously known position
    merged.latitude = existing.latitude;
    merged.longitude = existing.longitude;
  }
  if (!parsed.locDataPresent && existing) {
    // this packet carried no location block: keep the last known status
    merged.positionStatus = existing.positionStatus;
  }
  if (hasCoords) {
    merged.lastGoodFix = {
      lat: parsed.latitude as number,
      lon: parsed.longitude as number,
      positionStatus: parsed.positionStatus ?? 0,
      ts: parsed.lastSeen ?? existing?.lastGoodFix?.ts ?? 0,   // stamp from the packet's lastSeen, never a fresh clock read
    };
  } else {
    merged.lastGoodFix = existing?.lastGoodFix ?? null;
  }
  return merged;
}
