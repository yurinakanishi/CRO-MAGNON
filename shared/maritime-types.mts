export type SeaWeatherKind = 'calm' | 'breeze' | 'rain' | 'mist';
export interface MaritimeWeather {
  version: number;
  phase: number;
  kind: SeaWeatherKind;
  next: SeaWeatherKind;
  changesAt: number;
  currentX: number;
  currentZ: number;
}
