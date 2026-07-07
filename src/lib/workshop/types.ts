// Shared client/server types for the Data Workshop (no server-only imports).

export type MetricLite = {
  id: number;
  code: string;
  name: string;
  category: string | null;
  unit: string | null;
  dataType: string;
};

export type CellValue = { entityId: number; value: number | null };
