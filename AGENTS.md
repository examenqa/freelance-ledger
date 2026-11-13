# Freelance Ledger contributor notes

This is a plain JavaScript/Electron desktop application. The UI is in
`src/index.html`, `src/renderer.js` and local CSS. Main-process storage and
exports are in `main.js`, `preload.js` and `src/main/`; shared financial/reporting
logic is in `src/shared/`.

- Preserve saved financial amounts, rates, FX and paid snapshots. Never repair
  or replace user records merely to support a chart or test.
- Keep real financial records, private paths, credentials, settings, backups,
  profiles and review evidence outside Git. Use clearly synthetic test data.
- Inspect staged files and commits; ignore rules do not remove tracked secrets
  or private history.
- Preserve legacy application/storage/install identifiers unless a separate
  migration is explicitly authorized. Visible title changes do not authorize a
  data-path or executable-identity change.
- Use `npm test` for the full suite and `node --check` for changed JavaScript.
  `npm start` launches the application; prefer a fresh isolated review profile.
  `npm run dist` packages Windows NSIS outputs into ignored `dist/`. There is no
  build script and packaging is not installation approval.
- Keep changes local and reviewable. Update the reporting contract or known
  limitations when a deliberate scope change affects totals or date grouping.
