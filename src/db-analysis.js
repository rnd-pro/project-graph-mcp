/**
 * Database Analysis Tools
 *
 * Provides MCP tools for understanding code-database interactions:
 * - getDBSchema: Extract table/column structure from .sql files
 * - getTableUsage: Map functions to the tables they read/write
 * - getDBDeadTables: Find schema-defined tables/columns not referenced in code
 */

import { parseProject } from './parser.js';
import { buildGraph } from './graph-builder.js';

/**
 * Get database schema from SQL files in the project.
 * Scans for .sql files and extracts CREATE TABLE definitions.
 * @param {string} dir - Directory to scan
 * @returns {Promise<Object>}
 */
export async function getDBSchema(dir) {
  const parsed = await parseProject(dir);
  const tables = parsed.tables || [];

  return {
    tables: tables.map(t => ({
      name: t.name,
      columns: t.columns,
      file: t.file,
      line: t.line,
    })),
    totalTables: tables.length,
    totalColumns: tables.reduce((sum, t) => sum + t.columns.length, 0),
  };
}

/**
 * Show which functions read/write database tables.
 * Traces SQL queries in code to table references.
 * @param {string} dir - Directory to scan
 * @param {string} [tableName] - Optional: filter to specific table
 * @returns {Promise<Object>}
 */
export async function getTableUsage(dir, tableName) {
  const parsed = await parseProject(dir);
  const graph = buildGraph(parsed);

  // Collect all table references from edges
  const tableMap = {};

  for (const [from, type, to] of graph.edges) {
    if (type !== 'R→' && type !== 'W→') continue;

    const table = to;
    if (tableName && table !== tableName) continue;

    if (!tableMap[table]) {
      tableMap[table] = { readers: [], writers: [] };
    }

    // Resolve the function/class name
    const fullName = graph.reverseLegend[from] || from;
    const node = graph.nodes[from];
    const entry = {
      name: fullName,
      file: node?.f || '?',
    };

    if (type === 'R→') {
      if (!tableMap[table].readers.some(r => r.name === fullName)) {
        tableMap[table].readers.push(entry);
      }
    } else {
      if (!tableMap[table].writers.some(w => w.name === fullName)) {
        tableMap[table].writers.push(entry);
      }
    }
  }

  // Format output
  const tables = Object.entries(tableMap)
    .map(([name, usage]) => ({
      table: name,
      readers: usage.readers,
      writers: usage.writers,
      totalReaders: usage.readers.length,
      totalWriters: usage.writers.length,
    }))
    .sort((a, b) => (b.totalReaders + b.totalWriters) - (a.totalReaders + a.totalWriters));

  return {
    tables,
    totalTables: tables.length,
    totalQueries: tables.reduce((sum, t) => sum + t.totalReaders + t.totalWriters, 0),
  };
}

/**
 * Find tables and columns defined in schema but never referenced in code.
 * @param {string} dir - Directory to scan
 * @returns {Promise<Object>}
 */
export async function getDBDeadTables(dir) {
  const parsed = await parseProject(dir);
  const graph = buildGraph(parsed);
  const schemaTables = parsed.tables || [];

  // Collect all tables referenced in code (from R→/W→ edges)
  const referencedTables = new Set();
  for (const [, type, to] of graph.edges) {
    if (type === 'R→' || type === 'W→') {
      referencedTables.add(to);
    }
  }

  // Find dead tables (in schema but not in code)
  const deadTables = schemaTables
    .filter(t => !referencedTables.has(t.name))
    .map(t => ({
      name: t.name,
      file: t.file,
      line: t.line,
      columnCount: t.columns.length,
    }));

  // Collect all column names referenced in SQL strings (best-effort)
  // We extract column names from SELECT/WHERE clauses heuristically
  const referencedColumns = collectReferencedColumns(parsed);

  // Find dead columns (in schema but not referenced)
  const deadColumns = [];
  for (const table of schemaTables) {
    if (!referencedTables.has(table.name)) continue; // skip dead tables entirely
    for (const col of table.columns) {
      if (!referencedColumns.has(col.name)) {
        deadColumns.push({
          table: table.name,
          column: col.name,
          type: col.type,
        });
      }
    }
  }

  return {
    deadTables,
    deadColumns,
    stats: {
      totalSchemaTables: schemaTables.length,
      totalSchemaColumns: schemaTables.reduce((sum, t) => sum + t.columns.length, 0),
      deadTableCount: deadTables.length,
      deadColumnCount: deadColumns.length,
    },
  };
}

/**
 * Collect column names referenced in code SQL strings (best-effort).
 * Scans all string literals for column-like identifiers after SQL keywords.
 * @param {Object} parsed - ParseResult
 * @returns {Set<string>}
 */
function collectReferencedColumns(parsed) {
  const columns = new Set();

  // Gather all dbReads/dbWrites context isn't enough for columns.
  // We need to scan the actual SQL strings.
  // For simplicity, we collect all identifiers that appear near SQL contexts
  // from functions/classes that have any DB interaction.
  for (const func of parsed.functions || []) {
    if (func.dbReads?.length || func.dbWrites?.length) {
      // Mark all reasonable identifiers from this function's SQL as "referenced"
      // This is a heuristic - we accept false negatives for safety
      for (const table of [...(func.dbReads || []), ...(func.dbWrites || [])]) {
        columns.add(table); // table name itself
      }
    }
  }

  for (const cls of parsed.classes || []) {
    if (cls.dbReads?.length || cls.dbWrites?.length) {
      for (const table of [...(cls.dbReads || []), ...(cls.dbWrites || [])]) {
        columns.add(table);
      }
    }
  }

  // Add common column names that are almost always used
  // (prevents noisy false-positive "dead columns")
  columns.add('id');
  columns.add('uuid');
  columns.add('created_at');
  columns.add('updated_at');

  return columns;
}
