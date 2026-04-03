/**
 * SQL Language Support for Project Graph
 *
 * Parses .sql files (schema dumps) and extracts SQL queries from code strings.
 * Provides table/column extraction via regex (zero-dependency, ~80% accuracy).
 */

/**
 * @typedef {Object} TableInfo
 * @property {string} name - Table name
 * @property {{name: string, type: string}[]} columns - Column definitions
 * @property {string} file - Source file
 * @property {number} line - Line number
 */

/**
 * @typedef {Object} SQLExtraction
 * @property {string[]} reads - Tables read (SELECT/FROM/JOIN)
 * @property {string[]} writes - Tables written (INSERT/UPDATE/DELETE)
 */

/**
 * SQL keywords that should NOT be treated as table names.
 * Used to filter false positives from regex extraction.
 */
const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'on',
  'as', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'full',
  'group', 'order', 'by', 'having', 'limit', 'offset', 'union',
  'all', 'distinct', 'case', 'when', 'then', 'else', 'end',
  'null', 'true', 'false', 'is', 'between', 'like', 'ilike',
  'exists', 'any', 'some', 'set', 'values', 'into', 'table',
  'create', 'alter', 'drop', 'index', 'primary', 'key', 'foreign',
  'references', 'constraint', 'default', 'check', 'unique',
  'if', 'begin', 'commit', 'rollback', 'transaction',
  'returning', 'conflict', 'nothing', 'do', 'update',
  'cascade', 'restrict', 'lateral', 'each', 'row',
  'with', 'recursive', 'only',
  // PostgreSQL data types (prevent false positives)
  'integer', 'int', 'bigint', 'smallint', 'serial', 'bigserial',
  'text', 'varchar', 'char', 'character', 'boolean', 'bool',
  'timestamp', 'timestamptz', 'date', 'time', 'timetz', 'interval',
  'numeric', 'decimal', 'real', 'float', 'double',
  'json', 'jsonb', 'uuid', 'bytea', 'inet', 'cidr', 'macaddr',
  'array', 'point', 'line', 'box', 'circle', 'polygon', 'path',
  // Common false positives
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'cast',
  'extract', 'now', 'current_timestamp', 'current_date',
  'generate_series', 'unnest', 'string_agg', 'array_agg',
  'row_number', 'rank', 'dense_rank', 'over', 'partition',
  'asc', 'desc', 'nulls', 'first', 'last', 'filter',
  // PostgreSQL system/meta identifiers
  'columns', 'rows', 'tables', 'schema', 'schemas',
  'information_schema', 'pg_catalog', 'pg_tables', 'pg_class',
]);

/**
 * Check if a string looks like a SQL query.
 * Requires SQL keyword anchor at the start to minimize false positives.
 * @param {string} str
 * @returns {boolean}
 */
export function isSQLString(str) {
  if (!str || typeof str !== 'string') return false;
  return /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE\s+TABLE)\b/i.test(str);
}

/**
 * Check if identifier is a valid table name (not a SQL keyword or too short).
 * @param {string} name
 * @returns {boolean}
 */
function isValidTableName(name) {
  if (!name || name.length < 2) return false;
  if (SQL_KEYWORDS.has(name.toLowerCase())) return false;
  // Must look like a valid identifier
  if (!/^[a-zA-Z_]\w*$/.test(name)) return false;
  // Reject ALL-UPPERCASE or PascalCase (real PG tables are snake_case/lowercase)
  if (/^[A-Z][A-Z_]*$/.test(name)) return false;   // SKIP, API, etc.
  if (/^[A-Z][a-z]/.test(name)) return false;       // Job, Organization, etc.
  // Reject PostgreSQL built-in functions/types
  if (/^(pg_|jsonb_|array_|string_|regexp_)/.test(name)) return false;
  return true;
}

/**
 * Extract table names from a SQL string.
 * Returns lists of tables being read and written.
 * @param {string} sql
 * @returns {SQLExtraction}
 */
export function extractSQLFromString(sql) {
  if (!sql || typeof sql !== 'string') {
    return { reads: [], writes: [] };
  }

  const reads = new Set();
  const writes = new Set();

  // Normalize: collapse whitespace, strip comments
  const normalized = sql
    .replace(/--[^\n]*/g, '')           // single-line SQL comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // multi-line SQL comments
    .replace(/\s+/g, ' ')
    .trim();

  // READ patterns
  // FROM table [alias] — skip function calls: FROM func(...)
  const fromRegex = /\bFROM\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)/gi;
  let match;
  while ((match = fromRegex.exec(normalized)) !== null) {
    // Skip if followed by ( — it's a function call, not a table
    const afterMatch = normalized.slice(match.index + match[0].length).trimStart();
    if (afterMatch.startsWith('(')) continue;
    const name = match[1].split('.').pop(); // handle schema.table
    if (isValidTableName(name)) reads.add(name);
  }

  // JOIN table [alias] — same check for safety
  const joinRegex = /\bJOIN\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)/gi;
  while ((match = joinRegex.exec(normalized)) !== null) {
    const afterMatch = normalized.slice(match.index + match[0].length).trimStart();
    if (afterMatch.startsWith('(')) continue;
    const name = match[1].split('.').pop();
    if (isValidTableName(name)) reads.add(name);
  }

  // WRITE patterns
  // INSERT INTO table
  const insertRegex = /\bINSERT\s+INTO\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)/gi;
  while ((match = insertRegex.exec(normalized)) !== null) {
    const name = match[1].split('.').pop();
    if (isValidTableName(name)) writes.add(name);
  }

  // UPDATE table
  const updateRegex = /\bUPDATE\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)/gi;
  while ((match = updateRegex.exec(normalized)) !== null) {
    const name = match[1].split('.').pop();
    if (isValidTableName(name)) writes.add(name);
  }

  // DELETE FROM table
  const deleteRegex = /\bDELETE\s+FROM\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)/gi;
  while ((match = deleteRegex.exec(normalized)) !== null) {
    const name = match[1].split('.').pop();
    if (isValidTableName(name)) writes.add(name);
  }

  // Per peer review: remove DELETE primary target from reads to avoid double-counting.
  // Only the primary mutation target is removed — subquery reads are preserved.
  for (const w of writes) {
    if (/\bDELETE\s+FROM\s+/i.test(normalized)) {
      const deleteTargetMatch = normalized.match(/\bDELETE\s+FROM\s+([a-zA-Z_]\w*)/i);
      if (deleteTargetMatch) {
        const primaryTarget = deleteTargetMatch[1].split('.').pop();
        if (w === primaryTarget) reads.delete(primaryTarget);
      }
    }
  }

  return {
    reads: [...reads],
    writes: [...writes],
  };
}

/**
 * Parse a .sql file (schema dump / migration).
 * Extracts CREATE TABLE statements with column definitions.
 * @param {string} code - SQL file content
 * @param {string} filename - File path
 * @returns {Object} ParseResult-compatible + tables[]
 */
export function parseSQL(code = '', filename = '') {
  const result = {
    file: filename,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    tables: [],
  };

  if (!code) return result;

  // Match CREATE TABLE statements
  // Handles: CREATE TABLE [IF NOT EXISTS] [schema.]name (columns...)
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-zA-Z_]\w*\.)?([a-zA-Z_]\w*)\s*\(([\s\S]*?)\);/gi;
  let match;

  while ((match = createTableRegex.exec(code)) !== null) {
    const tableName = match[1];
    const columnsBlock = match[2];
    const line = code.substring(0, match.index).split('\n').length;

    const columns = parseColumns(columnsBlock);

    result.tables.push({
      name: tableName,
      columns,
      file: filename,
      line,
    });
  }

  return result;
}

/**
 * Parse column definitions from CREATE TABLE body.
 * @param {string} block - The content between parentheses
 * @returns {{name: string, type: string}[]}
 */
function parseColumns(block) {
  const columns = [];
  // Split by commas, but respect parentheses (for types like NUMERIC(10,2))
  const parts = splitByTopLevelComma(block);

  for (const part of parts) {
    const trimmed = part.trim();
    // Skip constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, CONSTRAINT)
    if (/^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(trimmed)) {
      continue;
    }

    // Match: column_name TYPE [constraints...]
    const colMatch = trimmed.match(/^([a-zA-Z_]\w*)\s+([A-Za-z]\w*(?:\s*\([^)]*\))?(?:\s*\[\])?)/);
    if (colMatch) {
      const name = colMatch[1];
      const type = colMatch[2].trim();
      // Skip if "name" is a SQL keyword (misparse)
      if (!SQL_KEYWORDS.has(name.toLowerCase())) {
        columns.push({ name, type });
      }
    }
  }

  return columns;
}

/**
 * Split string by commas, respecting parentheses depth.
 * @param {string} str
 * @returns {string[]}
 */
function splitByTopLevelComma(str) {
  const parts = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  return parts;
}

/**
 * Extract SQL queries from raw source code (Python/Go pre-pass).
 * Scans string literals and finds SQL patterns before stripStringsAndComments
 * destroys the string contents.
 *
 * Returns aggregated reads/writes for the entire file.
 * @param {string} code - Raw source code
 * @returns {SQLExtraction}
 */
export function extractSQLFromCode(code) {
  const allReads = new Set();
  const allWrites = new Set();

  if (!code) return { reads: [], writes: [] };

  // Find all string literals that look like SQL
  // Match: "...", '...', `...`, """...""", '''...'''
  const stringPatterns = [
    /"""([\s\S]*?)"""/g,     // Python triple double-quote
    /'''([\s\S]*?)'''/g,     // Python triple single-quote
    /`([\s\S]*?)`/g,         // Go/JS backtick
    /"((?:[^"\\]|\\.)*)"/g,  // Double-quoted
    /'((?:[^'\\]|\\.)*)'/g,  // Single-quoted
  ];

  for (const pattern of stringPatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const content = match[1];
      if (isSQLString(content)) {
        const extraction = extractSQLFromString(content);
        extraction.reads.forEach(t => allReads.add(t));
        extraction.writes.forEach(t => allWrites.add(t));
      }
    }
  }

  return {
    reads: [...allReads],
    writes: [...allWrites],
  };
}
