/** Shared between `tgless build` and the manifest child process. */
export const MARKER = '__TGLESS_MANIFEST__';

export interface ManifestPayload {
  ok: boolean;
  error?: 'NOT_APP' | 'LOAD' | 'SCHEMA';
  message?: string;
  updates?: string[];
  endpoints?: string[];
  commands?: { command: string; description: string }[];
  tables?: { tableName: string; exportName: string }[];
  schema?: string;
}
