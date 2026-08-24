# vulnerable-todo

A small todo list app. It works: you can add todos, tick them off, share a
read only view of the list, import a list from a YAML file, and print what is
overdue.

It is also, on purpose, a badly maintained codebase. The dependencies are old
and carry real published vulnerabilities, one directory contains real typosquat
and malware package names, and the CI workflow pins its actions the wrong way.
Every one of those is deliberate, and every one is written down in
[FINDINGS.md](FINDINGS.md).

The point is to give a supply chain scanner something real to find, in a
repository that still looks and behaves like an ordinary app rather than a bag
of test fixtures.

## Do not treat this as an example to copy

Nothing here is a pattern worth reusing. The vulnerable versions are pinned
intentionally, so please do not open a pull request bumping them, and do not
enable automated dependency updates on a fork.

`demo-signals/` is not installable and must never be installed. Read
[demo-signals/README.md](demo-signals/README.md) before you touch it.

## Running it

```bash
npm install          # the root workspaces only, demo-signals is excluded
npm run dev          # http://localhost:3000
```

Other things you can do:

```bash
npm run import -- lists/groceries.yaml   # bulk import from a YAML file
npm run overdue                          # print everything past its due date
npm run typecheck                        # tsc --noEmit
```

Open `http://localhost:3000/share?title=Groceries&theme=dark` for the shareable
view. Query parameters become template variables, which is how the page carries
display preferences, and also happens to be the interesting part for a scanner.

## Layout

```
web/                  the API and the browser UI
  src/routes/         todo CRUD, and the server rendered share page
  src/lib/            version reporting, webhook delivery, pluggable renderers
  src/cli/import.ts   operator only bulk import
worker/               a cron style job that reports overdue todos
lists/                sample data for the importer
demo-signals/         manifests only, never installed
.github/workflows/    CI
```

Storage is a JSON file under `data/`, which is not committed. Both the web app
and the worker read it, so set `TODO_DATA_FILE` if you want it somewhere else.

`TODO_WEBHOOK_URL` is optional. When it is set, every created todo is posted to
it.
