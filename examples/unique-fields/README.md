# Unique Field Validation Example

Demonstrates the `-u` option, which checks that the combined values of one or more fields
are unique across every record in the file (for example, a primary key column).

## Files

- [employees.ftm](employees.ftm) — Meta file with 3 fields: `EmployeeId` (Integer), `Name`
  and `Department`.
- [employees-with-duplicate.csv](employees-with-duplicate.csv) — a data file where
  `EmployeeId` `1` appears twice (lines 2 and 4).

## Running

Can run either by installing or directly from repository.

### Run directly from repository

From the repository root run:

```bash
node index.js examples/basic-valid/employees.csv -m:examples/basic-valid/employees.ftm
```

### Run after installing

Install the package globally (`npm install -g .`) and from the repository root:

```bash
ftvalid examples/unique-fields/employees-with-duplicate.csv -m:examples/unique-fields/employees.ftm -u:EmployeeId
```

## Expected output

```text
Record with duplicate Unique Fields at lines: 2, 4
```

The process exits with a non-zero code because `EmployeeId` is declared unique but is
duplicated. Removing or changing one of the two `1` values (or omitting `-u:EmployeeId`)
would make the file pass validation.
