declare module "sql.js" {
  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    prepare(sql: string): Statement;
    close(): void;
    export(): Uint8Array;
  }
  export interface Statement {
    bind(values: unknown[]): boolean;
    step(): boolean;
    get(): unknown[];
    getAsObject(): Record<string, unknown>;
    reset(): void;
    free(): void;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<{
    Database: new (buffer?: ArrayBuffer | Uint8Array) => Database;
  }>;
}
