import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private ws: WebSocket | null = null;
  public messages$ = new Subject<any>();
  private reconnectInterval = 2000;
  private currentBbox: number[] | null = null;

  constructor(private ngZone: NgZone) {
    this.connect();
  }

  private connect() {
    // Connects to port 3000 (API Gateway) which proxies /realtime to the Realtime Gateway
    this.ws = new WebSocket('ws://98.130.134.148:3000/realtime');

    this.ws.onopen = () => {
      console.log('WebSocket connected to Realtime Gateway');
      if (this.currentBbox) {
        this.updateViewport(this.currentBbox);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          this.messages$.next(data);
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected. Reconnecting in 2s...');
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      this.ws?.close();
    };
  }

  public updateViewport(bbox: number[]) {
    this.currentBbox = bbox;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'viewport',
        bbox: bbox
      }));
    }
  }
}
