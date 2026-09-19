#!/usr/bin/env node
// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { FtNodeFileReader, FtNodeMetaSerialization, FtReadRecordResult } from '@pbkware/fielded-text-node';

/**
 * @typedef {import('@pbkware/fielded-text-node').FtNodeFileReader} FtNodeFileReaderType
 */

/**
 * @typedef {{
 *   textFilePaths: string[],
 *   metaFilePath: string,
 *   uniqueFieldNames: string[],
 *   optionStandardInput: boolean,
 *   optionHelp: boolean,
 * }} ParsedCommandLine
 */

/**
 * @typedef {{
 *   clearRecords: () => void,
 *   prepareTable: () => { ok: boolean, errorText?: string },
 *   addRecord: () => { ok: boolean, errorText?: string },
 *   checkDuplicates: () => { ok: boolean, errorText?: string },
 * }} UniqueFieldsState
 */

export function writeHelp() {
  console.log('ftvalid: Validates text files against a Fielded Text Meta file');
  console.log('');
  console.log('ftvalid TextFile [TextFile ...] -m:MetaFile [-u:UniqueFields] [-i] [-h]');
  console.log('');
  console.log('  TextFile     Path (directory/filename) of text file to be validated.');
  console.log('  -m           Path (directory/filename) of meta file against which text files');
  console.log('               are validated.');
  console.log('  -u           Comma separated list of fields (key) whose combined values');
  console.log('               are unique across the text file.');
  console.log('  -i           Validate standard input.');
  console.log('  -h           Display help.');
  console.log('');
  console.log('For more information go to https://pbkware.klink.au/fielded-text/ftvalid/');
}

function unquoteParam(/** @type {string} */ param) {
  if (param.length >= 2 && param[0] === '"' && param[param.length - 1] === '"') {
    return param.slice(1, -1).replace(/""/g, '"');
  }
  return param;
}

function splitUniqueFieldList(/** @type {string} */ value) {
  const result = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (quoted) {
      if (ch === '"') {
        if (i + 1 < value.length && value[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === ',') {
      if (current.length === 0) {
        return 'Cannot add blank unique field';
      }
      result.push(current);
      current = '';
    } else if (ch === '"') {
      quoted = true;
    } else {
      current += ch;
    }
  }

  if (quoted) {
    return 'Unique Field missing closing double quote character';
  }

  if (current.length === 0) {
    return 'Unique Field missing';
  }

  result.push(current);
  return result;
}

export function parseCmdLine(/** @type {string[]} */ argv) {
  const textFilePaths = [];
  let metaFilePath = '';
  const uniqueFieldNames = [];
  let optionStandardInput = false;
  let optionHelp = false;

  // On non-Windows platforms, "/" is a normal path separator character (used in absolute
  // paths such as "/home/user/data.csv"), so only "-" is treated as an option prefix.
  const optionPrefixChars = process.platform === 'win32' ? ['-', '/'] : ['-'];

  for (const rawArg of argv) {
    const arg = rawArg.trim();
    if (arg.length === 0) {
      continue;
    }

    const optionPrefix = optionPrefixChars.includes(arg[0]);
    if (optionPrefix && arg.length >= 2) {
      const optionLetter = arg[1].toUpperCase();

      if (optionLetter === 'M') {
        if (arg.length < 4 || arg[2] !== ':') {
          return 'Invalid Meta File Option specified';
        }
        const value = unquoteParam(arg.slice(3));
        if (value.length === 0) {
          return 'Invalid Meta File Option specified';
        }
        metaFilePath = value;
        continue;
      }

      if (optionLetter === 'U') {
        if (arg.length < 4 || arg[2] !== ':') {
          return 'Invalid Unique Fields Option specified';
        }

        const value = arg.slice(3);
        if (value.length === 0) {
          return 'Incomplete Unique Fields Option at end of command line';
        }

        const splitResult = splitUniqueFieldList(value);
        if (typeof splitResult === 'string') {
          return splitResult;
        }

        for (const field of splitResult) {
          if (field.length === 0) {
            return 'Empty field name not allowed';
          }
          uniqueFieldNames.push(field);
        }
        continue;
      }

      if (optionLetter === 'I') {
        if (arg.length !== 2) {
          return 'Invalid Standard Input Option specified';
        }
        optionStandardInput = true;
        continue;
      }

      if (optionLetter === 'H' || optionLetter === '?') {
        if (arg.length !== 2) {
          return 'Invalid Help Option specified';
        }
        optionHelp = true;
        continue;
      }

      if (arg[0] === '-' || (arg[0] === '/' && arg.length === 2)) {
        return `Invalid Option: "${arg[1]}"`;
      }
    }

    const textFilePath = unquoteParam(arg);
    if (textFilePath.length === 0) {
      return 'Empty Text File Path not allowed';
    }
    textFilePaths.push(textFilePath);
  }

  if (!optionHelp) {
    if (textFilePaths.length === 0 && !optionStandardInput) {
      return 'No Text File or Standard Input specified';
    }
    if (metaFilePath.length === 0) {
      return 'Meta File not specified';
    }
  }

  return {
    textFilePaths,
    metaFilePath,
    uniqueFieldNames,
    optionStandardInput,
    optionHelp,
  };
}

function valueToComparable(/** @type {unknown} */ value) {
  if (value instanceof Date) {
    return ['Date', value.getTime()];
  }
  if (typeof value === 'bigint') {
    return ['BigInt', value.toString()];
  }
  if (typeof value === 'number') {
    return ['Number', value];
  }
  if (typeof value === 'boolean') {
    return ['Boolean', value];
  }
  if (typeof value === 'string') {
    return ['String', value];
  }
  if (value === null || value === undefined) {
    return ['Null', null];
  }
  return [Object.prototype.toString.call(value), String(value)];
}

function createUniqueFields(
  /** @type {any} */ reader,
  /** @type {string[]} */ uniqueFieldNames,
) {
  /** @type {{
   *   active: boolean,
   *   fields: Array<{ name: string, ordinal: number, dataType: unknown, dataTypeSpecified: boolean }>,
   *   seen: Map<string, number>
   * }} */
  const state = {
    active: uniqueFieldNames.length > 0,
    fields: uniqueFieldNames.map((/** @type {string} */ name) => ({
      name,
      ordinal: -1,
      dataType: undefined,
      dataTypeSpecified: false,
    })),
    seen: new Map(),
  };

  function currentLineNumber() {
    const parser = reader._lineParser;
    if (parser && typeof parser.lineCount === 'number') {
      return parser.lineCount;
    }
    return reader.recordCount;
  }

  function clearRecords() {
    if (!state.active) {
      return;
    }

    state.seen.clear();
    for (const field of state.fields) {
      field.ordinal = -1;
      field.dataTypeSpecified = false;
      field.dataType = undefined;
    }
  }

  function prepareTable() {
    if (!state.active) {
      return { ok: true };
    }

    for (const field of state.fields) {
      let ordinal;
      try {
        ordinal = reader.getOrdinal(field.name);
      } catch {
        return {
          ok: false,
          errorText: `Could not find Unique Field: "${field.name}" in Line: ${currentLineNumber()}`,
        };
      }

      const runtimeField = reader.fieldList.get(ordinal);
      const currentDataType = runtimeField.dataType;

      if (!field.dataTypeSpecified) {
        field.ordinal = ordinal;
        field.dataType = currentDataType;
        field.dataTypeSpecified = true;
      } else if (field.dataType !== currentDataType) {
        return {
          ok: false,
          errorText: `DataType of Unique Field changed. Field: "${field.name}" in Line: ${currentLineNumber()}`,
        };
      } else {
        field.ordinal = ordinal;
      }
    }

    return { ok: true };
  }

  function addRecord() {
    if (!state.active) {
      return { ok: true };
    }

    const lineNumber = currentLineNumber();
    const keyParts = [];

    for (const field of state.fields) {
      const runtimeField = reader.fieldList.get(field.ordinal);
      if (runtimeField.isNull()) {
        return {
          ok: false,
          errorText: `Null Unique Field: "${field.name}" in Line: ${lineNumber}`,
        };
      }

      keyParts.push(valueToComparable(runtimeField.nullableValue));
    }

    const key = JSON.stringify(keyParts);
    const existingLineNumber = state.seen.get(key);
    if (existingLineNumber !== undefined) {
      const lowerLineNumber = Math.min(existingLineNumber, lineNumber);
      const higherLineNumber = Math.max(existingLineNumber, lineNumber);
      return {
        ok: false,
        errorText: `Record with duplicate Unique Fields at lines: ${lowerLineNumber}, ${higherLineNumber}`,
      };
    }

    state.seen.set(key, lineNumber);
    return { ok: true };
  }

  function checkDuplicates() {
    return { ok: true };
  }

  return {
    clearRecords,
    prepareTable,
    addRecord,
    checkDuplicates,
  };
}

export function normalizeTextFilePaths(/** @type {string[]} */ textFilePaths) {
  /** @type {string[]} */
  const normalized = [];
  for (const filePath of textFilePaths) {
    const fullFilePath = path.resolve(filePath);
    if (!fs.existsSync(fullFilePath)) {
      return `Text File does not exist: ${filePath} (${fullFilePath})`
    }
    normalized.push(fullFilePath);
  }

  return normalized;
}

export function normalizeMetaFilePath(/** @type {string} */ metaFilePath) {
  const fullFilePath = path.resolve(metaFilePath);
  if (!fs.existsSync(fullFilePath)) {
    return `Meta File does not exist: ${metaFilePath} (${fullFilePath})`;
  }

  // Wrapped in an array (mirroring normalizeTextFilePaths) so a successful resolution
  // (a string) can never be mistaken for an error message (also a string).
  return [fullFilePath];
}

function formatParseError(/** @type {unknown} */ err, /** @type {string} */ filePath) {
  const message = err instanceof Error ? err.message : String(err);
  return `Parse Error: "${message}" File: ${filePath}`;
}

function validateReader(
  /** @type {{ readRecord: () => typeof FtReadRecordResult[keyof typeof FtReadRecordResult] }} */ reader,
  /** @type {UniqueFieldsState} */ uniqueFieldsState,
) {
  /** @type {{ ok: true, recordCount: number } | { ok: false, recordCount: number, errorText: string }} */
  let result;
  let recordCount = 0;

  uniqueFieldsState.clearRecords();

  let readResult;
  try {
    readResult = reader.readRecord();
  } catch (err) {
    return {
      ok: false,
      recordCount,
      errorText: formatParseError(err, '<Unknown>'),
    };
  }

  while (readResult !== FtReadRecordResult.NoMoreRecords) {
    if (readResult === FtReadRecordResult.NewTable) {
      const prepResult = uniqueFieldsState.prepareTable();
      if (!prepResult.ok) {
        return { ok: false, recordCount, errorText: prepResult.errorText ?? 'Unknown validation error' };
      }
    }

    const addResult = uniqueFieldsState.addRecord();
    if (!addResult.ok) {
      return { ok: false, recordCount, errorText: addResult.errorText ?? 'Unknown validation error' };
    }

    recordCount++;

    try {
      readResult = reader.readRecord();
    } catch (err) {
      return {
        ok: false,
        recordCount,
        errorText: formatParseError(err, '<Unknown>'),
      };
    }
  }

  const duplicateResult = uniqueFieldsState.checkDuplicates();
  if (!duplicateResult.ok) {
    return { ok: false, recordCount, errorText: duplicateResult.errorText ?? 'Unknown validation error' };
  }

  uniqueFieldsState.clearRecords();
  return { ok: true, recordCount };
}

export function validate(
  /** @type {string[]} */ textFilePaths,
  /** @type {string} */ metaFilePath,
  /** @type {string[]} */ uniqueFieldNames,
  /** @type {boolean} */ standardInput,
) {
  let totalRecordCount = 0;
  const meta = FtNodeMetaSerialization.deserializeFromFile(metaFilePath);

  for (const filePath of textFilePaths) {
    const reader = new FtNodeFileReader(filePath, meta);
    const uniqueFields = createUniqueFields(reader, uniqueFieldNames);

    const validateResult = validateReader(reader, uniqueFields);
    reader.close();

    if (!validateResult.ok) {
      const message = validateResult.errorText?.replace('<Unknown>', filePath) ?? `Parse Error: "Unknown" File: ${filePath}`;
      return { ok: false, errorText: message };
    }

    totalRecordCount += validateResult.recordCount;
  }

  if (standardInput) {
    const reader = new FtNodeFileReader('/dev/stdin', meta);
    const uniqueFields = createUniqueFields(reader, uniqueFieldNames);

    const validateResult = validateReader(reader, uniqueFields);
    reader.close();

    if (!validateResult.ok) {
      const message = validateResult.errorText?.replace('<Unknown>', '<StdInput>') ?? 'Parse Error: "Unknown" File: <StdInput>';
      return { ok: false, errorText: message };
    }

    totalRecordCount += validateResult.recordCount;
  }

  return { ok: true, recordCount: totalRecordCount };
}

export function main() {
  const parsedOrError = parseCmdLine(process.argv.slice(2));

  if (typeof parsedOrError === 'string') {
    console.error(parsedOrError);
    writeHelp();
    process.exitCode = 1;
    return;
  }

  if (parsedOrError.optionHelp) {
    writeHelp();
    process.exitCode = 0;
    return;
  }

  const normalizedTextFilesOrError = normalizeTextFilePaths(parsedOrError.textFilePaths);
  if (typeof normalizedTextFilesOrError === 'string') {
    console.error(normalizedTextFilesOrError);
    process.exitCode = 1;
    return;
  }

  const normalizedMetaFileOrError = normalizeMetaFilePath(parsedOrError.metaFilePath);
  if (typeof normalizedMetaFileOrError === 'string') {
    console.error(normalizedMetaFileOrError);
    process.exitCode = 1;
    return;
  }
  const normalizedMetaFilePath = normalizedMetaFileOrError[0];

  try {
    const validateResult = validate(
      normalizedTextFilesOrError,
      normalizedMetaFilePath,
      parsedOrError.uniqueFieldNames,
      parsedOrError.optionStandardInput,
    );

    if (validateResult.ok) {
      console.log(`File(s) are valid. ${validateResult.recordCount} records.`);
      process.exitCode = 0;
    } else {
      console.error(validateResult.errorText);
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(`${err.name}: ${err.message}`);
    } else {
      console.error(String(err));
    }
    process.exitCode = 1;
  }
}

// Ensure that the main function is called only when this module is executed directly, not when imported.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}