import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, NgZone, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { WebsocketService } from '../core/websocket.service';
import { deadReckon } from './render-loop';
import { Subscription } from 'rxjs';

/**
 * Compute N evenly-spaced waypoints along the great-circle between two points.
 * Longitude is "unwrapped" so the path never jumps by >180° (fixes antimeridian double-line).
 */
function greatCirclePath(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
  n = 80
): [number, number][] {
  const toR = (d: number) => d * Math.PI / 180;
  const toD = (r: number) => r * 180 / Math.PI;
  const φ1 = toR(lat1), λ1 = toR(lon1);
  const φ2 = toR(lat2), λ2 = toR(lon2);
  const d = Math.acos(Math.min(1, Math.max(-1,
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1)
  )));
  if (d < 1e-6) return [[lon1, lat1], [lon2, lat2]];
  const pts: [number, number][] = [];
  let prevLon = lon1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    let lon = toD(Math.atan2(y, x));
    const lat = toD(Math.atan2(z, Math.sqrt(x * x + y * y)));
    // Unwrap: keep each step within ±180° of previous to avoid antimeridian jumping
    while (lon - prevLon >  180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    pts.push([lon, lat]);
    prevLon = lon;
  }
  return pts;
}

// SVG commercial plane icon pointing UP (0 degrees)
const PLANE_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg viewBox="0 0 24 24" width="256" height="256" xmlns="http://www.w3.org/2000/svg">
  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#fff"/>
</svg>`);

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css']
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;
  @Input() selectedIcao: string | null = null;
  @Input() selectedFlight: any = null;
  @Input() trailData: [number, number, number][] = [];
  @Input() filteredFlights: any[] = [];

  // Expose to template for the legend
  get hasSelection(): boolean { return !!this.selectedIcao; }
  get totalVisible(): number { return this.aircraftState.size; }

  private map!: maplibregl.Map;
  private overlay!: MapboxOverlay;
  private animationFrameId: number | null = null;
  private sub!: Subscription;
  private mapReady = false;
  private isFollowing = false;

  // Local aircraft state: icao24 → [icao24, lat, lon, trk, alt, speed, vrate, lastUpdateTs]
  private aircraftState = new Map<string, any[]>();

  constructor(private ngZone: NgZone, private wsService: WebsocketService) {}

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => this.initMap());

    this.sub = this.wsService.messages$.subscribe(msg => {
      this.ngZone.runOutsideAngular(() => this.processUpdate(msg));
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.map || !this.mapReady) return;

    if (changes['selectedIcao']) {
      if (this.selectedIcao && this.selectedFlight) {
        this.isFollowing = true;
        this.map.flyTo({ 
          center: [this.selectedFlight.lon, this.selectedFlight.lat], 
          zoom: 6, 
          duration: 1500 
        });
      } else if (!this.selectedIcao) {
        this.isFollowing = false;
        // Deselected — zoom back to globe
        this.map.flyTo({ center: [0, 20], zoom: 1.5, duration: 1000 });
      }
    }
  }

  /** Fit map view to show full great-circle route between origin and destination */
  private fitToRoute() {
    const f = this.selectedFlight;
    if (!f || !f.originCoord || !f.destCoord) return;

    const [oLon, oLat] = f.originCoord;
    const [dLon, dLat] = f.destCoord;

    const minLon = Math.min(oLon, dLon);
    const maxLon = Math.max(oLon, dLon);
    const minLat = Math.min(oLat, dLat);
    const maxLat = Math.max(oLat, dLat);

    // Also include the aircraft's current position
    const acLon = f.lon ?? (minLon + maxLon) / 2;
    const acLat = f.lat ?? (minLat + maxLat) / 2;

    const bbox: [number, number, number, number] = [
      Math.min(minLon, acLon) - 5,
      Math.min(minLat, acLat) - 8,
      Math.max(maxLon, acLon) + 5,
      Math.max(maxLat, acLat) + 8
    ];

    this.map.fitBounds(bbox, {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      duration: 1200
    });
  }

  private initMap() {
    fetch('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')
      .then(res => res.json())
      .then(style => {
        // Custom styling to match the light slate reference image
        const bgLayer = style.layers.find((l: any) => l.id === 'background');
        if (bgLayer) bgLayer.paint['background-color'] = '#f4f6f8'; // Off-white/light grey land
        
        const waterLayer = style.layers.find((l: any) => l.id === 'water');
        if (waterLayer) waterLayer.paint['fill-color'] = '#8da1b6'; // Slate blue oceans/lakes
        
        const waterwayLayer = style.layers.find((l: any) => l.id === 'waterway');
        if (waterwayLayer) waterwayLayer.paint['line-color'] = '#7993a4'; // Slate blue rivers

        this.map = new maplibregl.Map({
          container: this.mapContainer.nativeElement,
          style: style,
          center: [0, 20],
          zoom: 1.5,
          pitch: 0
        });

        this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        this.map.addControl(this.overlay as any);

        this.map.on('load', () => {
          this.mapReady = true;
          this.updateViewport();
          this.startRenderLoop();
        });

        this.map.on('dragstart', () => { this.isFollowing = false; });
        this.map.on('zoomstart', (e: any) => { 
          // Only cancel follow if zooming via user interaction (scroll/pinch), not our own flyTo/easeTo
          if (e.originalEvent) this.isFollowing = false; 
        });

        this.map.on('moveend', () => this.updateViewport());
        this.map.on('zoomend', () => this.updateViewport());
      });
  }

  private updateViewport() {
    const b = this.map.getBounds();
    this.wsService.updateViewport([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  private processUpdate(msg: any) {
    const now = Date.now();
    if (msg.add) msg.add.forEach((ac: any[]) => this.aircraftState.set(ac[0], [...ac, now]));
    if (msg.upd) msg.upd.forEach((ac: any[]) => this.aircraftState.set(ac[0], [...ac, now]));
    if (msg.rm)  msg.rm.forEach((id: string) => this.aircraftState.delete(id));
  }

  private startRenderLoop() {
    const render = () => {
      const now = Date.now();
      const layerData: any[] = [];
      let selLon = this.selectedFlight?.lon;
      let selLat = this.selectedFlight?.lat;

      for (const [id, state] of this.aircraftState.entries()) {
        const [icao24, lat, lon, trk, alt, speed, vr, cs, orig, dest, lastUpdateTs] = state;
        const dtSeconds = (now - lastUpdateTs) / 1000;
        const [currentLon, currentLat] = deadReckon(lat, lon, trk || 0, speed || 0, dtSeconds);
        const isSelected = this.selectedIcao === icao24;

        if (!isSelected) {
          continue; // Hide all flights unless specifically selected
        }

        if (isSelected) {
          selLon = currentLon;
          selLat = currentLat;
          
          if (this.isFollowing) {
             this.map.easeTo({ center: [currentLon, currentLat], duration: 0 });
          }
        }

        layerData.push({
          id: icao24,
          position: [currentLon, currentLat, alt || 0],
          angle: trk || 0,
          // Selected = bright blue, visible-dimmed = soft grey, normal = dark slate
          color: isSelected
            ? [52, 152, 219, 255]       // #3498db
            : this.selectedIcao
              ? [148, 163, 184, 150]    // Dimmed slate
              : [30, 41, 59, 220],      // #1e293b Dark slate for standard
          size: isSelected ? 44 : this.selectedIcao ? 18 : 24
        });
      }

      // ── Icon layer (all planes) ───────────────────────────────────────
      const iconLayer = new IconLayer({
        id: 'aircraft-layer',
        data: layerData,
        pickable: true,
        iconAtlas: PLANE_ICON,
        iconMapping: { plane: { x: 0, y: 0, width: 256, height: 256, mask: true } },
        getIcon: () => 'plane',
        getPosition: (d: any) => d.position,
        getAngle: (d: any) => -d.angle, // Negative angle to rotate correctly in deck.gl
        getSize: (d: any) => d.size,
        getColor: (d: any) => d.color,
        sizeUnits: 'pixels',
        parameters: { depthTest: false }
      });

      const layers: any[] = [iconLayer];

      // ── Great-circle route: full origin → destination (always drawn) ──
      if (this.selectedFlight?.originCoord && this.selectedFlight?.destCoord) {
        const [oLon, oLat] = this.selectedFlight.originCoord as number[];
        const [dLon, dLat] = this.selectedFlight.destCoord as number[];

        const routePath = greatCirclePath(oLon, oLat, dLon, dLat, 100);

        // Full planned route — same thickness as trail but faint
        const routeLayer = new PathLayer({
          id: 'flight-route',
          data: [{ path: routePath }],
          getPath: (d: any) => d.path,
          getColor: [52, 152, 219, 70],
          getWidth: 5,
          widthUnits: 'pixels',
          widthMinPixels: 4,
          capRounded: true,
          jointRounded: true
        });
        layers.unshift(routeLayer);

        // ── Airport label dots at origin & dest ──────────────────────────
        const airportData = [
          {
            position: this.selectedFlight.originCoord,
            label: this.selectedFlight.originMock,
            city: this.selectedFlight.originCityMock
          },
          {
            position: this.selectedFlight.destCoord,
            label: this.selectedFlight.destMock,
            city: this.selectedFlight.destCityMock
          }
        ];

        // Airport IATA code labels
        const iataTextLayer = new TextLayer({
          id: 'airport-iata',
          data: airportData,
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.label,
          getSize: 16,
          getColor: [30, 41, 59, 255], // Dark slate
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          fontWeight: 800,
          getPixelOffset: [0, -16],
          fontFamily: 'Inter, sans-serif',
          parameters: { depthTest: false }
        });

        // City name labels below IATA
        const cityTextLayer = new TextLayer({
          id: 'airport-city',
          data: airportData,
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.city,
          getSize: 11,
          getColor: [71, 85, 105, 255], // Slate gray
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          getPixelOffset: [0, 6],
          fontFamily: 'Inter, sans-serif',
          parameters: { depthTest: false }
        });

        // Small dot markers at airport positions
        const dotLayer = new IconLayer({
          id: 'airport-dots',
          data: airportData,
          iconAtlas: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            `<svg viewBox="0 0 64 64" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="28" fill="#3498db" stroke="#fff" stroke-width="4"/>
            </svg>`
          ),
          iconMapping: { dot: { x: 0, y: 0, width: 64, height: 64, mask: false } },
          getIcon: () => 'dot',
          getPosition: (d: any) => d.position,
          getSize: 12,
          sizeUnits: 'pixels',
          parameters: { depthTest: false }
        });

        layers.push(dotLayer, iataTextLayer, cityTextLayer);
      }

      // ── Historical trail ──────────────────────────────────────────────
      if (this.selectedIcao && this.trailData?.length > 1) {
        // Split trail into segments at any gap > 5°. This prevents straight
        // "shortcut" lines from bridging distant positions across the globe.
        const segments: any[][] = [];
        let seg: any[] = [];

        for (let i = 0; i < this.trailData.length; i++) {
          const curr = this.trailData[i];
          if (i > 0) {
            const prev = this.trailData[i - 1];
            const dist = Math.sqrt(
              Math.pow(curr[0] - prev[0], 2) + Math.pow(curr[1] - prev[1], 2)
            );
            if (dist > 5) {
              // Start a new segment — do NOT connect across the gap
              if (seg.length > 1) segments.push(seg);
              seg = [];
            }
          }
          seg.push(curr);
        }
        if (seg.length > 1) segments.push(seg);

        if (segments.length > 0) {
          const pathLayer = new PathLayer({
            id: 'flight-trail',
            data: segments.map(s => ({ path: s })),
            getPath: (d: any) => d.path,
            getColor: [52, 152, 219, 255], // Solid bright blue
            getWidth: 5,
            widthUnits: 'pixels',
            widthMinPixels: 4,
            capRounded: true,
            jointRounded: true
          });
          layers.splice(1, 0, pathLayer);
        }
      }

      this.overlay.setProps({ layers });
      this.animationFrameId = requestAnimationFrame(render);
    };

    this.animationFrameId = requestAnimationFrame(render);
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    if (this.map) this.map.remove();
  }
}
