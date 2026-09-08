export interface ShellBedState {
  id: string;
  amount: number;
  recoveredAt: number;
}
export interface MiddenState {
  id: string;
  shells: number;
}
export interface CoastalActivity {
  kind: 'shells' | 'knap';
  siteId: string;
  startedAt: number;
  endsAt: number;
}
