// Minimal typings for better-sqlite3-multiple-ciphers. The package ships an index.d.ts,
// but its package.json "exports" map hides it under moduleResolution "bundler", so tsc
// cannot resolve it. This ambient declaration covers only the read-only API cipherDb uses.
declare module 'better-sqlite3-multiple-ciphers' {
  namespace Database {
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
    }
    interface Statement {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
    }
    interface Database {
      pragma(source: string, options?: { simple?: boolean }): unknown;
      prepare(sql: string): Statement;
      close(): void;
    }
  }
  interface DatabaseConstructor {
    new (filename: string, options?: Database.Options): Database.Database;
    (filename: string, options?: Database.Options): Database.Database;
  }
  const Database: DatabaseConstructor;
  export = Database;
}
