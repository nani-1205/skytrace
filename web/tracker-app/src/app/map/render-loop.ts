// great-circle forward position given speed + track over elapsed time
const R = 6371000; // Earth radius in meters

export function deadReckon(lat: number, lon: number, trackDeg: number, speedMs: number, dtSeconds: number): [number, number] {
  const dist = speedMs * dtSeconds;       // metres travelled
  const theta = trackDeg * Math.PI / 180;
  const delta = dist / R;
  const phi1 = lat * Math.PI / 180;
  const lambda1 = lon * Math.PI / 180;
  
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  
  return [lambda2 * 180 / Math.PI, phi2 * 180 / Math.PI]; // [lon, lat]
}
