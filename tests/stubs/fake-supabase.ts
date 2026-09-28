/**
 * A tiny in-memory stand-in for the Supabase query builder, covering the calls
 * the generation and sheet services make (insert / update / delete / select
 * with eq, neq, gt, in, is, not, or, order, limit, single, maybeSingle), and for
 * Storage (upload, download, remove, signed URLs). Each statement runs
 * synchronously when awaited, so a conditional update is atomic, as it is in
 * Postgres. `onUpdate` stands in for triggers such as set_updated_at.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; count: number | null; error: { message: string } | null };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function compareValues(a: unknown, b: unknown): number {
  const left = typeof a === "string" ? Date.parse(a) : Number(a);
  const right = typeof b === "string" ? Date.parse(b) : Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b));
}

/** One PostgREST condition, e.g. `last_polled_at.lt.2026-09-27T10:00:00.000Z`. */
function condition(expression: string): Filter {
  const [column = "", operator, ...rest] = expression.split(".");
  if (operator === "not") {
    const inner = condition([column, ...rest].join("."));
    return (row) => !inner(row);
  }
  const value = rest.join(".");
  switch (operator) {
    case "is":
      return (row) => (value === "null" ? row[column] == null : String(row[column]) === value);
    case "eq":
      return (row) => String(row[column]) === value;
    case "lt":
      return (row) => row[column] != null && compareValues(row[column], value) < 0;
    case "gt":
      return (row) => row[column] != null && compareValues(row[column], value) > 0;
    default:
      throw new Error(`fake-supabase: unsupported operator "${operator}"`);
  }
}

class Query implements PromiseLike<Result> {
  private readonly filters: Filter[] = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private patch: Row = {};
  private inserted: Row[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private head = false;

  constructor(
    private readonly table: Row[],
    private readonly defaults: () => Row,
    private readonly onUpdate?: (row: Row) => void,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (options?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.action = "insert";
    this.inserted = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row): this {
    this.action = "update";
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.action = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push((row) => row[column] != null && compareValues(row[column], value) > 0);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.filters.push((row) => (value === null ? row[column] == null : row[column] === value));
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is" || value !== null) throw new Error("fake-supabase: unsupported not()");
    this.filters.push((row) => row[column] != null);
    return this;
  }
  or(expression: string): this {
    const alternatives = expression.split(",").map(condition);
    this.filters.push((row) => alternatives.some((matches) => matches(row)));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }

  private run(): Row[] {
    if (this.action === "insert") {
      const rows = this.inserted.map((row) => ({ ...this.defaults(), ...clone(row) }));
      this.table.push(...rows);
      return rows.map(clone);
    }
    let rows = this.table.filter((row) => this.filters.every((matches) => matches(row)));
    if (this.action === "delete") {
      for (const row of rows) this.table.splice(this.table.indexOf(row), 1);
      return rows.map(clone);
    }
    if (this.action === "update") {
      for (const row of rows) {
        Object.assign(row, clone(this.patch));
        this.onUpdate?.(row);
      }
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        // Postgres puts nulls last when ascending.
        if (a[column] == null || b[column] == null) {
          return (a[column] == null ? 1 : 0) - (b[column] == null ? 1 : 0);
        }
        return ascending
          ? compareValues(a[column], b[column])
          : compareValues(b[column], a[column]);
      });
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows.map(clone);
  }

  single(): Promise<Result> {
    const rows = this.run();
    return Promise.resolve(
      rows.length === 1
        ? { data: rows[0], count: 1, error: null }
        : {
            data: null,
            count: rows.length,
            error: { message: `expected 1 row, got ${rows.length}` },
          },
    );
  }
  maybeSingle(): Promise<Result> {
    const rows = this.run();
    return Promise.resolve({ data: rows[0] ?? null, count: rows.length, error: null });
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const rows = this.run();
    return Promise.resolve<Result>({
      data: this.head ? null : rows,
      count: rows.length,
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

/** Storage: one bucket's objects by path. */
function fakeBucket(objects: Map<string, Buffer>) {
  return {
    upload: async (path: string, data: Buffer | Uint8Array) => {
      objects.set(path, Buffer.from(data));
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      const data = objects.get(path);
      return data
        ? { data: new Blob([new Uint8Array(data)]), error: null }
        : { data: null, error: { message: "Object not found" } };
    },
    remove: async (paths: string[]) => {
      for (const path of paths) objects.delete(path);
      return { data: [], error: null };
    },
    createSignedUrls: async (paths: string[], expiresIn: number) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: objects.has(path) ? `https://storage.test/${path}?expires=${expiresIn}` : null,
        error: objects.has(path) ? null : "Object not found",
      })),
      error: null,
    }),
  };
}

export function createFakeSupabase(
  defaults: Record<string, () => Row> = {},
  options: { onUpdate?: Record<string, (row: Row) => void> } = {},
) {
  const tables = new Map<string, Row[]>();
  const objects = new Map<string, Buffer>();
  const tableOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  return {
    tables,
    objects,
    rows: (name: string) => tableOf(name),
    client: {
      from: (name: string) =>
        new Query(tableOf(name), defaults[name] ?? (() => ({})), options.onUpdate?.[name]),
      storage: { from: () => fakeBucket(objects) },
    },
  };
}
