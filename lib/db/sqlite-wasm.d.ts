declare module "@sqlite.org/sqlite-wasm" {
    const initSqlite: (options?: {
      print?: (...args: any[]) => void;
      printErr?: (...args: any[]) => void;
    }) => Promise<any>;
  
    export default initSqlite;
  }