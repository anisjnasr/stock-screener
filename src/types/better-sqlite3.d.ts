declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
    pluck(toggleState?: boolean): this;
    expand(toggleState?: boolean): this;
    raw(toggleState?: boolean): this;
    bind(...params: unknown[]): this;
    columns(): { name: string; column: string | null }[];
  }

  interface DatabaseInstance {
    prepare(sql: string): Statement;
    exec(sql: string): this;
    function(name: string, fn: (...args: unknown[]) => unknown): this;
    close(): this;
    readonly open: boolean;
  }

  const Database: (new (filename: string, options?: Options) => DatabaseInstance) & {
    Database: DatabaseInstance;
  };
  export = Database;
}
