import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private apiUrl = 'https://spoved.online';

  async getTrackHistory(icao24: string): Promise<[number, number, number][]> {
    try {
      const res = await fetch(`${this.apiUrl}/track/${icao24}`);
      if (!res.ok) throw new Error('Failed to fetch track');
      return await res.json();
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async getReplayData(from: number, to: number): Promise<any[]> {
    try {
      const res = await fetch(`${this.apiUrl}/replay?from=${from}&to=${to}`);
      if (!res.ok) throw new Error('Failed to fetch replay data');
      return await res.json();
    } catch (err) {
      console.error(err);
      return [];
    }
  }
}
