# Basic Valid File Example

Demonstrates the simplest `ftvalid` use case: validating a single CSV file against a
Fielded Text Meta file.

## Files

- [employees.ftm](employees.ftm) — the Meta file describing the structure of the data (5
  fields: `EmployeeId` (Integer), `Name`, `Department`, `Salary` (Decimal) and `StartDate`
  (DateTime)). One heading line is expected in the data file.
- [employees.csv](employees.csv) — a well-formed data file with 3 records that matches the
  Meta file.

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
ftvalid examples/basic-valid/employees.csv -m:examples/basic-valid/employees.ftm
```

## Expected output

```text
File(s) are valid. 3 records.
```

The process exits with code `0`.
