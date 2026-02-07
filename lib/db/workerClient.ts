const worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url), {
  type: "module",
});

let nextId = 1;
const pending = new Map<number, { resolve: Function; reject: Function }>();

worker.onmessage = (e) => {
  const { id, ok, rows, error } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  ok ? p.resolve(rows ?? []) : p.reject(new Error(error));
};

function call(type: string, payload?: any) {
  const id = nextId++;
  return new Promise<any[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

let inited = false;

export async function initDbWorker() {
  if (inited) return;
  await call("init");
  inited = true;
}

export async function execWorker(sql: string, bind: any[] = []) {
  await initDbWorker();
  return await call("exec", { sql, bind });
}
