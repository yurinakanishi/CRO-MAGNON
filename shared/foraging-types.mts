export interface ResidentForage {
  day: number;
  sourceId: string;
  carrying: boolean;
  deliveredDay: number | null;
  deliveredTo: string | null;
}
