# ftvalid

ftvalid is a Node.JS command line program which can be used to validate the format/structure of a Fielded Text or CSV file.

## Installation

```bash
npm install -g ftvalid
```

## Usage

```text
ftvalid TextFile [TextFile ...] -m:MetaFile [-u:UniqueFields] [-i] [-h]
```

- `TextFile` — path of a text file to be validated. Multiple files may be specified.
- `-m:MetaFile` — path of the Fielded Text Meta file to validate against.
- `-u:UniqueFields` — comma separated list of fields whose combined values must be unique across the file.
- `-i` — validate standard input instead of (or as well as) `TextFile`.
- `-h` — display help.

Example:

```bash
ftvalid data.csv -m:meta.ftm
```

## More Information

- See the [examples](examples) directory for runnable, documented examples,
- [https://pbkware.klink.au/fielded-text/ftvalid/](https://pbkware.klink.au/fielded-text/ftvalid/) for more information about ftvalid,
- [https://fieldedtext.org](https://fieldedtext.org) for the Fielded Text standard.
