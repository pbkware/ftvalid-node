// @ts-check
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeMetaFilePath,
  normalizeTextFilePaths,
  parseCmdLine,
  validate,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const indexJsPath = path.join(__dirname, '..', 'index.js');

const validMetaPath = path.join(fixturesDir, 'valid-meta.ftm');
const validDataPath = path.join(fixturesDir, 'valid-data.csv');
const secondValidDataPath = path.join(fixturesDir, 'second-valid-data.csv');
const invalidDataTypePath = path.join(fixturesDir, 'invalid-data-type.csv');
const duplicateDataPath = path.join(fixturesDir, 'duplicate-data.csv');

describe('parseCmdLine', () => {
  it('parses a text file and meta file option', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm']);
    assert.deepEqual(result, {
      textFilePaths: ['data.csv'],
      metaFilePath: 'meta.ftm',
      uniqueFieldNames: [],
      optionStandardInput: false,
      optionHelp: false,
    });
  });

  it('parses multiple text files', () => {
    const result = parseCmdLine(['a.csv', 'b.csv', '-m:meta.ftm']);
    assert.equal(typeof result, 'object');
    assert.deepEqual(result.textFilePaths, ['a.csv', 'b.csv']);
  });

  it('parses quoted paths and unquotes them', () => {
    const result = parseCmdLine(['"my data.csv"', '-m:"my meta.ftm"']);
    assert.deepEqual(result.textFilePaths, ['my data.csv']);
    assert.equal(result.metaFilePath, 'my meta.ftm');
  });

  it('parses a simple comma separated unique field list', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm', '-u:Id,Name']);
    assert.deepEqual(result.uniqueFieldNames, ['Id', 'Name']);
  });

  it('parses a quoted unique field list containing a comma', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm', '-u:"Last, First"']);
    assert.deepEqual(result.uniqueFieldNames, ['Last, First']);
  });

  it('parses the standard input option', () => {
    const result = parseCmdLine(['-m:meta.ftm', '-i']);
    assert.equal(result.optionStandardInput, true);
  });

  it('parses the help option and skips other validation', () => {
    const result = parseCmdLine(['-h']);
    assert.equal(result.optionHelp, true);
  });

  it('returns an error when no text file or standard input is specified', () => {
    const result = parseCmdLine(['-m:meta.ftm']);
    assert.equal(result, 'No Text File or Standard Input specified');
  });

  it('returns an error when no meta file is specified', () => {
    const result = parseCmdLine(['data.csv']);
    assert.equal(result, 'Meta File not specified');
  });

  it('returns an error for an unrecognized option', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm', '-x']);
    assert.equal(result, 'Invalid Option: "x"');
  });

  it('returns an error for an empty unique field name', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm', '-u:Id,,Name']);
    assert.equal(result, 'Cannot add blank unique field');
  });

  it('returns an error for an unclosed quote in a unique field list', () => {
    const result = parseCmdLine(['data.csv', '-m:meta.ftm', '-u:"Id']);
    assert.equal(result, 'Unique Field missing closing double quote character');
  });
});

describe('normalizeTextFilePaths / normalizeMetaFilePath', () => {
  it('resolves existing text file paths to absolute paths', () => {
    const result = normalizeTextFilePaths([validDataPath]);
    assert.deepEqual(result, [path.resolve(validDataPath)]);
  });

  it('returns an error string when a text file does not exist', () => {
    const result = normalizeTextFilePaths(['does-not-exist.csv']);
    assert.match(/** @type {string} */ (result), /Text File does not exist/);
  });

  it('resolves an existing meta file path', () => {
    const result = normalizeMetaFilePath(validMetaPath);
    assert.deepEqual(result, [path.resolve(validMetaPath)]);
  });

  it('returns an error string when the meta file does not exist', () => {
    const result = normalizeMetaFilePath('does-not-exist.ftm');
    assert.match(/** @type {string} */ (result), /Meta File does not exist/);
  });
});

describe('validate', () => {
  it('validates a well-formed file and reports the record count', () => {
    const result = validate([validDataPath], validMetaPath, [], false);
    assert.deepEqual(result, { ok: true, recordCount: 3 });
  });

  it('accumulates the record count across multiple files', () => {
    const result = validate([validDataPath, secondValidDataPath], validMetaPath, [], false);
    assert.equal(result.ok, true);
    assert.equal(result.recordCount, 5);
  });

  it('fails when a field value does not match its declared data type', () => {
    const result = validate([invalidDataTypePath], validMetaPath, [], false);
    assert.equal(result.ok, false);
    assert.match(result.errorText, /Parse Error/);
  });

  it('fails when unique field values are duplicated', () => {
    const result = validate([duplicateDataPath], validMetaPath, ['Id'], false);
    assert.equal(result.ok, false);
    assert.match(result.errorText, /duplicate Unique Fields/);
  });

  it('succeeds when unique field values are all distinct', () => {
    const result = validate([validDataPath], validMetaPath, ['Id'], false);
    assert.deepEqual(result, { ok: true, recordCount: 3 });
  });

  it('fails when a unique field name does not exist in the file', () => {
    const result = validate([validDataPath], validMetaPath, ['NotAField'], false);
    assert.equal(result.ok, false);
    assert.match(result.errorText, /Could not find Unique Field/);
  });

  it('validates data read from standard input', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftvalid-test-'));
    try {
      const stdinPath = path.join(tempDir, 'stdin-fixture.csv');
      fs.copyFileSync(validDataPath, stdinPath);
      // /dev/stdin (used by index.js) must be a real, seekable file, not an anonymous pipe,
      // so redirect from an actual file via the shell rather than passing execFileSync's `input`.
      const output = execSync(
        `${JSON.stringify(process.execPath)} ${JSON.stringify(indexJsPath)} -m:${JSON.stringify(validMetaPath)} -i < ${JSON.stringify(stdinPath)}`,
        { encoding: 'utf-8' },
      );
      assert.match(output, /File\(s\) are valid\. 3 records\./);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('CLI (spawned process)', () => {
  it('prints help and exits with code 0', () => {
    const output = execFileSync(process.execPath, [indexJsPath, '-h'], { encoding: 'utf-8' });
    assert.match(output, /ftvalid: Validates text files/);
  });

  it('exits with code 0 and reports the record count for a valid file', () => {
    const output = execFileSync(
      process.execPath,
      [indexJsPath, validDataPath, `-m:${validMetaPath}`],
      { encoding: 'utf-8' },
    );
    assert.match(output, /File\(s\) are valid\. 3 records\./);
  });

  it('exits with a non-zero code and an error message for an invalid file', () => {
    assert.throws(
      () => execFileSync(
        process.execPath,
        [indexJsPath, invalidDataTypePath, `-m:${validMetaPath}`],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
      (/** @type {any} */ err) => {
        assert.equal(err.status, 1);
        assert.match(err.stderr, /Parse Error/);
        return true;
      },
    );
  });

  it('exits with a non-zero code when no arguments are given', () => {
    assert.throws(
      () => execFileSync(process.execPath, [indexJsPath], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }),
      (/** @type {any} */ err) => {
        assert.equal(err.status, 1);
        assert.match(err.stderr, /No Text File or Standard Input specified/);
        return true;
      },
    );
  });
});
