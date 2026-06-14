import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebsocketService } from './core/websocket.service';
import { ApiService } from './core/api.service';
import { MapComponent } from './map/map.component';
import { Subscription } from 'rxjs';

const MOCK_AIRPORTS = [
  { iata: 'BOM', name: 'Chhatrapati Shivaji', city: 'Mumbai', lat: 19.0886, lon: 72.8679 },
  { iata: 'DEL', name: 'Indira Gandhi',       city: 'Delhi',  lat: 28.5562, lon: 77.1000 },
  { iata: 'BLR', name: 'Kempegowda',          city: 'Bangalore', lat: 13.1986, lon: 77.7066 },
  { iata: 'HYD', name: 'Rajiv Gandhi',        city: 'Hyderabad', lat: 17.2403, lon: 78.4294 },
  { iata: 'MAA', name: 'Chennai Intl',        city: 'Chennai', lat: 12.9941, lon: 80.1709 },
  { iata: 'CCU', name: 'Netaji Subhas',       city: 'Kolkata', lat: 22.6520, lon: 88.4467 },
  { iata: 'LHR', name: 'Heathrow',            city: 'London', lat: 51.4700, lon: -0.4543 },
  { iata: 'DXB', name: 'Dubai Intl',          city: 'Dubai', lat: 25.2532, lon: 55.3657 },
  { iata: 'SIN', name: 'Changi',              city: 'Singapore', lat: 1.3644, lon: 103.9915 },
  { iata: 'JFK', name: 'John F. Kennedy',     city: 'New York', lat: 40.6413, lon: -73.7781 },
  { iata: 'FRA', name: 'Frankfurt',           city: 'Frankfurt', lat: 50.0379, lon: 8.5622 },
  { iata: 'CDG', name: 'Charles de Gaulle',   city: 'Paris', lat: 49.0097, lon: 2.5479 },
  { iata: 'DOH', name: 'Hamad Intl',          city: 'Doha', lat: 25.2730, lon: 51.6080 },
  { iata: 'SYD', name: 'Sydney Intl',         city: 'Sydney', lat: -33.9399, lon: 151.1753 },
  { iata: 'NRT', name: 'Narita',              city: 'Tokyo', lat: 35.7647, lon: 140.3863 }
];

const REAL_AIRLINES: Record<string, any> = {
  'IGO': { name: 'IndiGo',            color: '#001B94', logo: 'https://www.gstatic.com/flights/airline_logos/70px/6E.png' },
  'AIC': { name: 'Air India',         color: '#CC1B2D', logo: 'https://www.gstatic.com/flights/airline_logos/70px/AI.png' },
  'SEJ': { name: 'SpiceJet',          color: '#EB1C24', logo: 'https://www.gstatic.com/flights/airline_logos/70px/SG.png' },
  'VTI': { name: 'Vistara',           color: '#5B2558', logo: 'https://www.gstatic.com/flights/airline_logos/70px/UK.png' },
  'IAD': { name: 'AirAsia India',     color: '#FF0000', logo: 'https://www.gstatic.com/flights/airline_logos/70px/I5.png' },
  'AXB': { name: 'Air India Express', color: '#EF3E42', logo: 'https://www.gstatic.com/flights/airline_logos/70px/IX.png' },
  'QTR': { name: 'Qatar Airways',     color: '#5C0C2F', logo: 'https://www.gstatic.com/flights/airline_logos/70px/QR.png' },
  'UAE': { name: 'Emirates',          color: '#C8A84B', logo: 'https://www.gstatic.com/flights/airline_logos/70px/EK.png' },
  'SIA': { name: 'Singapore Airlines',color: '#1A4B8C', logo: 'https://www.gstatic.com/flights/airline_logos/70px/SQ.png' },
  'BAW': { name: 'British Airways',   color: '#1B3F8B', logo: 'https://www.gstatic.com/flights/airline_logos/70px/BA.png' },
  'AFR': { name: 'Air France',        color: '#002157', logo: 'https://www.gstatic.com/flights/airline_logos/70px/AF.png' },
  'DLH': { name: 'Lufthansa',         color: '#05164D', logo: 'https://www.gstatic.com/flights/airline_logos/70px/LH.png' },
  'THY': { name: 'Turkish Airlines',  color: '#C8102E', logo: 'https://www.gstatic.com/flights/airline_logos/70px/TK.png' },
  'UAL': { name: 'United Airlines',   color: '#003087', logo: 'https://www.gstatic.com/flights/airline_logos/70px/UA.png' }
};

const AIRCRAFT_TYPES = [
  'Boeing 777-300ER', 'Airbus A380-800', 'Boeing 787-9',  'Airbus A350-900',
  'Boeing 737-800',   'Airbus A321neo',  'Boeing 777-200LR', 'Airbus A330-300'
];

const MOCK_REGS = ['A6-EGM', 'A7-BBI', '9V-SKJ', 'G-VIIA', 'N77867', 'D-AIHY', 'F-GSQF', 'TC-JJK'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MapComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit, OnDestroy {
  trackedFlightsCount = 0;
  avgAltitude         = 0;
  currentTime         = '00:00:00';

  groupedAirlines: any[] = [];
  selectedAirline: any | null = null;

  filteredFlightList: any[] = [];
  searchTerm = '';

  // Replay
  isReplayMode     = false;
  isPlaying        = false;
  replayStartTime  = 0;
  replayEndTime    = 0;
  currentReplayTime = 0;
  replayData: any[] = [];
  replayInterval: any;

  selectedIcao: string | null = null;
  selectedFlight: any = null;
  flightTrail: [number, number, number][] = [];

  private aircraftState = new Map<string, any>();
  private sub!: Subscription;
  private timeInterval: any;

  constructor(
    private wsService: WebsocketService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.updateTime();
    this.timeInterval = setInterval(() => this.updateTime(), 1000);

    this.sub = this.wsService.messages$.subscribe(msg => {
      if (msg.add) {
        msg.add.forEach((ac: any[]) => {
          const existing = this.aircraftState.get(ac[0]);
          this.aircraftState.set(ac[0], this.formatAircraft(ac, existing));
        });
      }

      if (msg.full && !this.isReplayMode) this.aircraftState.clear();

      if (msg.upd && !this.isReplayMode) {
        msg.upd.forEach((ac: any) => {
          const existing = this.aircraftState.get(ac[0]);
          const formatted = this.formatAircraft(ac, existing);
          this.aircraftState.set(ac[0], formatted);

          if (this.selectedIcao === ac[0]) {
            this.selectedFlight = formatted;
            
            if (this.flightTrail.length > 0) {
              const last = this.flightTrail[this.flightTrail.length - 1];
              const dLat = formatted.lat - last[1];
              const dLon = formatted.lon - last[0];
              if (Math.sqrt(dLat * dLat + dLon * dLon) > 10) {
                this.flightTrail = [];
              }
            }
            
            this.flightTrail = [...this.flightTrail, [formatted.lon, formatted.lat, formatted.alt || 0]];
          }
        });
      }

      if (msg.rm) {
        msg.rm.forEach((id: string) => {
          this.aircraftState.delete(id);
          if (this.selectedIcao === id) { this.selectedFlight = null; this.selectedIcao = null; }
        });
      }

      // Update stats
      let totalAlt = 0;
      this.aircraftState.forEach(f => totalAlt += (f.alt || 0));
      this.avgAltitude = this.aircraftState.size ? totalAlt / this.aircraftState.size : 0;

      this.applyFilter();
      this.cdr.detectChanges();
    });
  }

  private formatAircraft(ac: any, existing?: any): any {
    const icao = Array.isArray(ac) ? ac[0] : ac.icao24;

    let hash = parseInt(icao, 16) || 0;
    const callsign = Array.isArray(ac) ? ac[7] : ac.callsign;
    const flightNum = callsign ? callsign.trim() : icao;
    const airlineCode = flightNum.substring(0, 3).toUpperCase();
    
    // Attempt to match the real airline, fallback to a generated one
    const airline = REAL_AIRLINES[airlineCode] || { 
      name: airlineCode.length === 3 ? `${airlineCode} Airlines` : 'Private/Unknown', 
      color: `hsl(${hash % 360}, 70%, 50%)` 
    };
    
    const lat = Array.isArray(ac) ? ac[1] : ac.lat;
    const lon = Array.isArray(ac) ? ac[2] : ac.lon;
    const track = Array.isArray(ac) ? ac[3] : ac.track;

    let origin, dest;
    
    const origMock = Array.isArray(ac) && ac.length > 8 ? ac[8] : null;
    const destMock = Array.isArray(ac) && ac.length > 9 ? ac[9] : null;

    if (origMock && destMock) {
      origin = MOCK_AIRPORTS.find(a => a.iata === origMock) || MOCK_AIRPORTS[0];
      dest = MOCK_AIRPORTS.find(a => a.iata === destMock) || MOCK_AIRPORTS[1];
    } else if (existing && existing.originCoord) {
      // Retain the assigned route so the plane can progress along it
      origin = MOCK_AIRPORTS.find(a => a.iata === existing.originMock) || MOCK_AIRPORTS[0];
      dest = MOCK_AIRPORTS.find(a => a.iata === existing.destMock) || MOCK_AIRPORTS[1];
    } else {
      const computeProjected = (startLat: number, startLon: number, distanceKm: number, bearingDeg: number) => {
        const R = 6371;
        const d = distanceKm / R;
        const brng = bearingDeg * Math.PI / 180;
        const lat1 = startLat * Math.PI / 180;
        const lon1 = startLon * Math.PI / 180;
        let lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
        let lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
        return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
      };

      const origProj = computeProjected(lat, lon, 1500, (track + 180) % 360);
      const destProj = computeProjected(lat, lon, 1500, track);

      const calcDistToCity = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371;
        const dLat = (lat2-lat1)*Math.PI/180;
        const dLon = (lon2-lon1)*Math.PI/180;
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };

      let bestOrig = MOCK_AIRPORTS[0];
      let bestOrigDist = Infinity;
      let bestDest = MOCK_AIRPORTS[1];
      let bestDestDist = Infinity;

      MOCK_AIRPORTS.forEach(a => {
        const dOrig = calcDistToCity(origProj.lat, origProj.lon, a.lat, a.lon);
        if (dOrig < bestOrigDist) { bestOrigDist = dOrig; bestOrig = a; }
        const dDest = calcDistToCity(destProj.lat, destProj.lon, a.lat, a.lon);
        if (dDest < bestDestDist && a.iata !== bestOrig.iata) { bestDestDist = dDest; bestDest = a; }
      });

      origin = bestOrig;
      dest = bestDest;
    }

    const airlineName = airline.name;

    const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2-lat1)*Math.PI/180;
      const dLon = (lon2-lon1)*Math.PI/180;
      const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    const totalDistKm = calcDist(origin.lat, origin.lon, dest.lat, dest.lon);
    const flownDistKm = calcDist(origin.lat, origin.lon, lat, lon);
    const progress = totalDistKm > 0 ? Math.min(100, Math.max(0, Math.round((flownDistKm / totalDistKm) * 100))) : 0;

    const aircraftType = existing ? existing.aircraftType : AIRCRAFT_TYPES[hash % AIRCRAFT_TYPES.length];
    const registration = existing ? existing.registration : MOCK_REGS[hash % MOCK_REGS.length];

    const baseHour = hash % 12;
    const depH = String(baseHour).padStart(2, '0');
    const depM = String((hash * 3) % 60).padStart(2, '0');
    const arrH = String((baseHour + 8 + (hash % 5)) % 24).padStart(2, '0');
    const arrM = String((hash * 7) % 60).padStart(2, '0');

    const num = flightNum.substring(3) || String((hash % 900) + 100).padStart(3, '0');

    return {
      icao24: icao,
      lat, lon,
      track: Array.isArray(ac) ? ac[3] : ac.track,
      alt:   Array.isArray(ac) ? ac[4] : ac.alt,
      speed: Array.isArray(ac) ? ac[5] : ac.speed,
      vr:    Array.isArray(ac) ? ac[6] : ac.vr,
      callsign: flightNum,
      airlineMock:     airline.name,
      airlineCodeMock: airlineCode,
      airlineColor:    airline.color,
      airlineLogo:     airline.logo || null,
      originMock:      origin.iata,
      destMock:        dest.iata,
      originCityMock:  origin.city,
      destCityMock:    dest.city,
      cityRouteMock:   `${origin.city} → ${dest.city}`,
      progressMock:    progress,
      originCoord:     [origin.lon, origin.lat],
      destCoord:       [dest.lon, dest.lat],
      aircraftType,
      registration,
      depTime:      `${depH}:${depM}`,
      arrTime:      `${arrH}:${arrM}`,
      totalDistKm
    };
  }

  // ── Airline / Flight navigation ────────────────────────────────────
  private applyFilter() {
    this.trackedFlightsCount = this.aircraftState.size;
    const allFlights = Array.from(this.aircraftState.values());

    // Group by airline
    const groups = new Map<string, any[]>();
    for (const f of allFlights) {
      if (!groups.has(f.airlineMock)) groups.set(f.airlineMock, []);
      groups.get(f.airlineMock)!.push(f);
    }

    this.groupedAirlines = Array.from(groups.entries())
      .map(([name, flights]) => {
        const sample = flights[0];
        return {
          name,
          code: sample.airlineCodeMock,
          color: sample.airlineColor,
          logoUrl: sample.airlineLogo,
          count: flights.length,
          flights
        };
      })
      .sort((a, b) => b.count - a.count);

    if (this.selectedAirline) {
      const current = this.groupedAirlines.find(g => g.name === this.selectedAirline.name);
      let airlineFlights: any[] = current ? current.flights : [];

      if (this.searchTerm) {
        const q = this.searchTerm.toLowerCase();
        airlineFlights = airlineFlights.filter(f =>
          (f.callsign  && f.callsign.toLowerCase().includes(q)) ||
          (f.originMock && f.originMock.toLowerCase().includes(q)) ||
          (f.destMock   && f.destMock.toLowerCase().includes(q))
        );
      }
      this.filteredFlightList = airlineFlights;
    } else {
      if (this.searchTerm) {
        const q = this.searchTerm.toLowerCase();
        this.groupedAirlines = this.groupedAirlines.filter(g =>
          g.name.toLowerCase().includes(q)
        );
      }
      this.filteredFlightList = [];
    }
  }

  selectAirline(airline: any | null) {
    this.selectedAirline = airline;
    this.selectedIcao = null;
    this.selectedFlight = null;
    this.flightTrail = [];
    this.applyFilter();
    this.cdr.detectChanges();
  }

  async selectFlight(icao: string) {
    if (this.selectedIcao === icao) { this.closeFlight(); return; }
    this.selectedIcao   = icao;
    this.selectedFlight = this.aircraftState.get(icao);
    this.flightTrail    = await this.apiService.getTrackHistory(icao);
    if (this.selectedFlight) {
      this.flightTrail = [...this.flightTrail, [this.selectedFlight.lon, this.selectedFlight.lat, this.selectedFlight.alt || 0]];
    }
    this.applyFilter();
    this.cdr.detectChanges();
  }

  closeFlight() {
    this.selectedIcao   = null;
    this.selectedFlight = null;
    this.flightTrail    = [];
    this.applyFilter();
    this.cdr.detectChanges();
  }

  onSearch(event: any) {
    this.searchTerm = event.target.value.toLowerCase();
    this.applyFilter();
    this.cdr.detectChanges();
  }

  // ── Replay ────────────────────────────────────────────────────────
  async toggleReplay() {
    this.isReplayMode = !this.isReplayMode;
    if (this.isReplayMode) {
      const now = Math.floor(Date.now() / 1000);
      this.replayStartTime  = now - 1800;
      this.replayEndTime    = now;
      this.currentReplayTime = this.replayStartTime;
      this.replayData = await this.apiService.getReplayData(this.replayStartTime, now);
      this.renderReplayFrame();
    } else {
      if (this.replayInterval) clearInterval(this.replayInterval);
      this.isPlaying = false;
      this.replayData = [];
      this.aircraftState.clear();
      this.applyFilter();
    }
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      this.replayInterval = setInterval(() => {
        this.currentReplayTime += 5;
        if (this.currentReplayTime > this.replayEndTime) this.currentReplayTime = this.replayStartTime;
        this.renderReplayFrame();
      }, 200);
    } else {
      clearInterval(this.replayInterval);
    }
  }

  onScrub(event: any) {
    this.currentReplayTime = parseInt(event.target.value, 10);
    this.renderReplayFrame();
  }

  renderReplayFrame() {
    this.aircraftState.clear();
    for (const p of this.replayData) {
      if (p.ts_epoch <= this.currentReplayTime && this.currentReplayTime - p.ts_epoch <= 300) {
        this.aircraftState.set(p.icao24, {
          icao24: p.icao24, lat: p.lat, lon: p.lon,
          alt: p.altitude_ft, speed: p.ground_speed, track: p.track_deg,
          callsign: p.icao24, airlineMock: 'Replay', airlineCodeMock: 'RP',
          airlineColor: '#666666', originMock: 'REP', destMock: 'LAY',
          cityRouteMock: 'Historical', progressMock: 50,
          originCoord: [0, 0], destCoord: [0, 0]
        });
      }
    }
    this.applyFilter();
    if (this.selectedIcao) this.selectedFlight = this.aircraftState.get(this.selectedIcao);
    this.cdr.detectChanges();
  }

  formatEpoch(epoch: number) {
    if (!epoch) return '00:00:00';
    return new Date(epoch * 1000).toISOString().substring(11, 19);
  }

  private updateTime() {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  trackByAirline(index: number, airline: any): string {
    return airline.code;
  }

  trackByFlight(index: number, flight: any): string {
    return flight.icao24;
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    clearInterval(this.timeInterval);
    if (this.replayInterval) clearInterval(this.replayInterval);
  }
}
