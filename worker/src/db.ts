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

/** 量 D1 讀了幾列（免費方案每天 500 萬列）：照查詢、照標籤（排程的哪一項工作）加總 */
export class D1Meter {
  label = '';
  rowsRead = 0;
  readonly byLabel = new Map<string, number>();
  readonly bySql = new Map<string, { calls: number; rows: number }>();
  add(sql: string, meta: { rows_read?: number } | undefined): void {
    const n = meta?.rows_read ?? 0;
    this.rowsRead += n;
    if (this.label) this.byLabel.set(this.label, (this.byLabel.get(this.label) ?? 0) + n);
    const key = `${this.label ? `[${this.label}] ` : ''}${sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`;
    const cur = this.bySql.get(key) ?? { calls: 0, rows: 0 };
    cur.calls++;
    cur.rows += n;
    this.bySql.set(key, cur);
  }
  /** 讀最多的幾個查詢 */
  top(n = 15): Array<{ sql: string; calls: number; rows: number }> {
    return [...this.bySql].map(([sql, v]) => ({ sql, ...v })).sort((a, b) => b.rows - a.rows).slice(0, n);
  }
}

type Result = { meta?: { rows_read?: number }; results?: unknown[] };

function wrapStatement(s: D1PreparedStatement, sql: string, meter?: D1Meter): D1PreparedStatement {
  return new Proxy(s, {
    get(target, prop) {
      if (prop === ORIGINAL) return target;
      if (prop === 'bind') return (...args: unknown[]) => wrapStatement(target.bind(...args), sql, meter);
      // 量的時候 first 改用 all 拿到 meta（first 不回傳讀了幾列），結果一樣取第一列
      if (prop === 'first' && meter)
        return (col?: string) =>
          retry(() => target.all()).then((r) => {
            meter.add(sql, (r as Result).meta);
            const row = (r.results[0] ?? null) as Record<string, unknown> | null;
            return col ? (row?.[col] ?? null) : row;
          });
      if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
        const fn = (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop];
        return (...args: unknown[]) =>
          retry(() => fn.apply(target, args)).then((r) => {
            if (meter && (prop === 'run' || prop === 'all')) meter.add(sql, (r as Result).meta);
            return r;
          });
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** 會自動重試暫時性錯誤的 D1；給了 meter 就順便量讀了幾列 */
export function resilientDb(db: D1Database, meter?: D1Meter): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare')
        return (query: string) => wrapStatement(target.prepare(query), query, meter);
      if (prop === 'batch')
        return (stmts: D1PreparedStatement[]) =>
          retry(() => target.batch(stmts.map((s) => ((s as unknown as Record<symbol, D1PreparedStatement>)[ORIGINAL] ?? s)))).then((rs) => {
            if (meter) for (const r of rs) meter.add('(batch)', (r as Result).meta);
            return rs;
          });
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** env 換成會重試的 DB，其他綁定照舊 */
export const withResilientDb = <E extends { DB: D1Database }>(env: E, meter?: D1Meter): E =>
  Object.create(env, { DB: { value: resilientDb(env.DB, meter), enumerable: true } }) as E;
