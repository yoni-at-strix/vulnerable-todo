# Do not install this directory

These manifests exist so that a supply chain scanner has something to find. They
are read, never installed.

`lodahs` is a real name that really did carry malware. npm has since replaced it
with an empty `0.0.1-security` holding package, so the malicious version no
longer exists to download, and the version pinned here never existed at all.
That makes the entry inert today. It is not a guarantee about tomorrow, which is
why this directory is deliberately left out of the workspaces list in the root
`package.json`: a plain `npm install` at the repo root never looks at it. The
same is true of `axioss`, which is introduced on one of the open demo branches
rather than here on main.

`expresss` and `exprеss` are typosquats of `express`. The second one is not a
duplicate. It contains a Cyrillic `е` in place of the Latin `e`, which is a
different kind of attack and takes a different code path in the detector.

`better-sqlite3` is here only because it declares an install script, which is a
signal a scanner should report. It is a legitimate package.

If you want to run the app, use the repo root. Never run `npm install` or
`npm ci` in here.
