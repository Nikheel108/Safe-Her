import { closeDatabase as closeSqliteDatabase, db } from './db.mjs';

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (Boolean(supabaseUrl) !== Boolean(supabaseSecretKey)) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must both be configured.');
const useSupabase = Boolean(supabaseUrl && supabaseSecretKey);
if (process.env.NODE_ENV === 'production' && !useSupabase) throw new Error('Supabase storage must be configured in production.');

function sqliteWhere(filters, params) {
  if (!filters.length) return '';
  const clauses = filters.map(([column, operator, value]) => {
    params.push(value);
    return `${column} ${operator === 'eq' ? '=' : operator === 'lt' ? '<' : operator === 'lte' ? '<=' : operator === 'gt' ? '>' : operator === 'gte' ? '>=' : operator === 'neq' ? '!=' : (() => { throw new Error('Unsupported filter operator.'); })()} ?`;
  });
  return ` WHERE ${clauses.join(' AND ')}`;
}

function sqlOrder(order) {
  return order ? ` ORDER BY ${order.map(([column, direction]) => `${column} ${direction === 'asc' ? 'ASC' : 'DESC'}`).join(',')}` : '';
}

async function request(tablePath, { method = 'GET', query, body, prefer } = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${tablePath}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  const headers = {
    apikey: supabaseSecretKey,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : null; }
  catch { result = null; }
  if (!response.ok) {
    const error = new Error(result?.message ?? `Supabase request failed (${response.status}).`);
    error.code = result?.code ?? 'supabase_request_failed';
    error.status = response.status;
    throw error;
  }
  return result;
}

function filterEntries(filters = {}) {
  return Object.entries(filters).map(([column, condition]) => {
    if (Array.isArray(condition)) return [column, condition[0], condition[1]];
    return [column, 'eq', condition];
  });
}

class Storage {
  async one(table, { filters = {}, order, select = '*', limit = 1 } = {}) {
    if (!useSupabase) {
      const entries = filterEntries(filters); const params = [];
      const rows = db.prepare(`SELECT ${select} FROM ${table}${sqliteWhere(entries, params)}${sqlOrder(order)} LIMIT ?`).all(...params, limit);
      return rows[0] ?? null;
    }
    const query = { select, limit };
    for (const [column, operator, value] of filterEntries(filters)) query[column] = `${operator}.${value}`;
    if (order) query.order = order.map(([column, direction]) => `${column}.${direction}`).join(',');
    const rows = await request(table, { query });
    return rows?.[0] ?? null;
  }

  async many(table, { filters = {}, order, limit, select = '*' } = {}) {
    if (!useSupabase) {
      const entries = filterEntries(filters); const params = [];
      return db.prepare(`SELECT ${select} FROM ${table}${sqliteWhere(entries, params)}${sqlOrder(order)}${limit ? ' LIMIT ?' : ''}`).all(...params, ...(limit ? [limit] : []));
    }
    const query = { select };
    for (const [column, operator, value] of filterEntries(filters)) query[column] = `${operator}.${value}`;
    if (order) query.order = order.map(([column, direction]) => `${column}.${direction}`).join(',');
    if (limit) query.limit = limit;
    return (await request(table, { query })) ?? [];
  }

  async insert(table, row) {
    if (!useSupabase) {
      const columns = Object.keys(row); const values = Object.values(row);
      const result = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values);
      return { id: Number(result.lastInsertRowid), row: null };
    }
    const rows = await request(table, { method: 'POST', body: row, prefer: 'return=representation' });
    return { id: rows?.[0]?.id ?? null, row: rows?.[0] ?? null };
  }

  async upsert(table, row, conflictColumn) {
    if (!useSupabase) {
      const columns = Object.keys(row); const values = Object.values(row);
      const updates = columns.filter(column => column !== conflictColumn).map(column => `${column}=excluded.${column}`).join(',');
      db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates}`).run(...values);
      return;
    }
    await request(table, { method: 'POST', query: { on_conflict: conflictColumn }, body: row, prefer: 'resolution=merge-duplicates,return=minimal' });
  }

  async update(table, filters, values) {
    if (!useSupabase) {
      const params = Object.values(values); const where = sqliteWhere(filterEntries(filters), params);
      const result = db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(column => `${column}=?`).join(',')}${where}`).run(...params);
      return { changes: result.changes };
    }
    const query = {};
    for (const [column, operator, value] of filterEntries(filters)) query[column] = `${operator}.${value}`;
    const rows = await request(table, { method: 'PATCH', query, body: values, prefer: 'return=representation' });
    return { changes: rows?.length ?? 0, rows };
  }

  async remove(table, filters) {
    if (!useSupabase) {
      const params = []; const where = sqliteWhere(filterEntries(filters), params);
      return { changes: db.prepare(`DELETE FROM ${table}${where}`).run(...params).changes };
    }
    const query = {};
    for (const [column, operator, value] of filterEntries(filters)) query[column] = `${operator}.${value}`;
    const rows = await request(table, { method: 'DELETE', query, prefer: 'return=representation' });
    return { changes: rows?.length ?? 0 };
  }

  async rpc(name, body) {
    if (useSupabase) return (await request(`rpc/${name}`, { method: 'POST', body }))?.[0] ?? null;
    if (name !== 'save_emergency_contact') throw new Error('Unsupported local database procedure.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (body.p_primary) db.prepare('UPDATE emergency_contacts SET is_primary=0').run();
      if (body.p_update) {
        db.prepare("UPDATE emergency_contacts SET name=?,phone=?,relationship=?,priority=?,active=?,is_primary=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
          .run(body.p_name,body.p_phone,body.p_relationship,body.p_priority,Number(body.p_active),Number(body.p_primary),body.p_id);
      } else {
        db.prepare('INSERT INTO emergency_contacts(id,name,phone,relationship,priority,active,is_primary) VALUES(?,?,?,?,?,?,?)')
          .run(body.p_id,body.p_name,body.p_phone,body.p_relationship,body.p_priority,Number(body.p_active),Number(body.p_primary));
      }
      const row = db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(body.p_id);
      db.exec('COMMIT');
      return row;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  async health() {
    if (!useSupabase) { db.prepare('SELECT 1').get(); return 'sqlite'; }
    await request('devices', { query: { select: 'id', limit: 0 } });
    return 'supabase';
  }

  async close() { if (!useSupabase) closeSqliteDatabase(); }
  get mode() { return useSupabase ? 'supabase' : 'sqlite'; }
  get configured() { return useSupabase; }
}

export const store = new Storage();
export const closeDatabase = () => store.close();
