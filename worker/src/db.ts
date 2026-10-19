/**
 * D1 偶爾會回暫時性錯誤（「D1_ERROR: internal error」、連線中斷、逾時、重新啟動），通常再試一次就好。
 * 把 env.DB 包一層：每個查詢（first、run、all、raw）和 batch 碰到這類錯誤就自動重試，最多再試 2 次。
 * 我們的寫入多半是 INSERT OR IGNORE 或帶條件的 UPDATE，重試是安全的。
 */
const TRANSIENT =
  /D1_ERROR: internal error|Network connection lost|storage operation exceeded timeout|object to be reset|D1 is overloaded|reset because its code was updated|transient issue|Internal error in D1/i;
const RETRIES = 2;
const ORIGINAL = Symbol('d1-statement');

export const isTransient = (e: unknown): boolean => TRANSIENT.test(String(e));

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= RETRIES || !isTransient(e)) throw e;
      console.warn(`D1 transient error, retry ${i + 1}: ${String(e)}`);
      await new Promise((r) => setTimeout(r, 120 * 2 ** i + Math.random() * 80));
    }
  }
}

function wrapStatement(s: D1PreparedStatement): D1PreparedStatement {
  return new Proxy(s, {
    get(target, prop) {
      if (prop === ORIGINAL) return target;
      if (prop === 'bind') return (...args: unknown[]) => wrapStatement(target.bind(...args));
      if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
        const fn = (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop];
        return (...args: unknown[]) => retry(() => fn.apply(target, args));
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** 會自動重試暫時性錯誤的 D1 */
export function resilientDb(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (query: string) => wrapStatement(target.prepare(query));
      if (prop === 'batch')
        return (stmts: D1PreparedStatement[]) =>
          retry(() => target.batch(stmts.map((s) => ((s as unknown as Record<symbol, D1PreparedStatement>)[ORIGINAL] ?? s))));
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** env 換成會重試的 DB，其他綁定照舊 */
export const withResilientDb = <E extends { DB: D1Database }>(env: E): E => Object.create(env, { DB: { value: resilientDb(env.DB), enumerable: true } }) as E;
