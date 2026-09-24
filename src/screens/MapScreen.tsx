import React, { useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScannerContext } from '../context/ScannerContext';

function buildHtml(nodesJson: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#0D0D0D}
  .q-label{background:#1A237E;color:#fff;border:2px solid #42A5F5;border-radius:6px;
    padding:2px 6px;font-weight:bold;font-size:13px;white-space:nowrap}
  .bat-ok{color:#4CAF50} .bat-warn{color:#FF9800} .bat-low{color:#F44336}
</style>
</head>
<body>
<div id="map"></div>
<script>
var nodes = ${nodesJson};
var map = L.map('map',{zoomControl:true}).setView([31.5,34.9],8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'OSM'}).addTo(map);

var markers = {};

function batClass(pct){
  if(pct===null) return '';
  if(pct>50) return 'bat-ok';
  if(pct>20) return 'bat-warn';
  return 'bat-low';
}

function addOrUpdate(n){
  if(n.latitude===null || n.longitude===null) return;
  var icon = L.divIcon({
    className:'',
    html:'<div class="q-label">'+n.physicalLabel+'</div>',
    iconAnchor:[0,0]
  });
  var bat = n.batteryPct!==null
    ? '<span class="'+batClass(n.batteryPct)+'">'+n.batteryPct+'%</span>'
    : '--';
  var popup = '<b>'+n.physicalLabel+'</b><br>'
    +'Battery: '+bat+'<br>'
    +'RSSI: '+n.rssi+' dBm<br>'
    +'Lat: '+n.latitude.toFixed(6)+'<br>'
    +'Lon: '+n.longitude.toFixed(6);
  if(markers[n.mac]){
    markers[n.mac].setLatLng([n.latitude,n.longitude]);
    markers[n.mac].setPopupContent(popup);
  } else {
    markers[n.mac]=L.marker([n.latitude,n.longitude],{icon:icon})
      .bindPopup(popup).addTo(map);
  }
}

nodes.forEach(addOrUpdate);

// Fit map to all markers if any
var lats=nodes.filter(n=>n.latitude!==null).map(n=>n.latitude);
var lons=nodes.filter(n=>n.longitude!==null).map(n=>n.longitude);
if(lats.length>0){
  var bounds=[[Math.min(...lats)-0.001,Math.min(...lons)-0.001],
              [Math.max(...lats)+0.001,Math.max(...lons)+0.001]];
  map.fitBounds(bounds,{maxZoom:18});
}

// Listen for updates from React Native
document.addEventListener('message', function(e){
  try{ var n=JSON.parse(e.data); addOrUpdate(n); } catch(ex){}
});
window.addEventListener('message', function(e){
  try{ var n=JSON.parse(e.data); addOrUpdate(n); } catch(ex){}
});
</script>
</body>
</html>`;
}

export default function MapScreen() {
  const { nodes } = useScannerContext();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);

  const nodesWithGps = useMemo(
    () => Array.from(nodes.values()).filter(n => n.latitude !== null),
    [nodes],
  );

  // Push new/updated nodes to the map incrementally
  useEffect(() => {
    if (!webRef.current) return;
    for (const n of nodesWithGps) {
      webRef.current.postMessage(JSON.stringify(n));
    }
  }, [nodes]);

  const html = useMemo(
    () => buildHtml(JSON.stringify(nodesWithGps)),
    // Only rebuild HTML when screen first mounts — updates go via postMessage
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View style={styles.container}>
      {nodesWithGps.length === 0 && (
        <View style={[styles.banner, { paddingTop: 10 + insets.top }]}>
          <Text style={styles.bannerTxt}>
            No GPS positions yet — scan nodes outdoors to see them on the map
          </Text>
        </View>
      )}
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.map}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  map: { flex: 1, backgroundColor: '#0D0D0D' },
  banner: {
    backgroundColor: '#1A237E',
    padding: 10,
    alignItems: 'center',
  },
  bannerTxt: { color: '#90CAF9', fontSize: 13, textAlign: 'center' },
});
