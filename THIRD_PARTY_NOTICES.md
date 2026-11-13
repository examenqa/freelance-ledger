# Freelance Ledger third-party notices

The repository's [MIT license](LICENSE) applies to the first-party source and
bundled logo/icon, whose publication rights were confirmed by the repository
owner. It does not replace third-party license terms.

No vendored third-party JavaScript libraries, dependency directories, Electron
binaries or installers are included in this source snapshot. The application has
no production npm dependencies. Its development/build dependencies are installed
from `package-lock.json`, which retains each package's resolved version,
integrity and declared licensing metadata.

| Direct development dependency | Locked version | Declared license / upstream |
| --- | --- | --- |
| Electron | 38.8.6 | MIT — [Electron license](https://github.com/electron/electron/blob/v38.8.6/LICENSE) |
| electron-builder | 26.8.1 | MIT — [electron-builder license](https://github.com/electron-userland/electron-builder/blob/master/LICENSE) |

Transitive packages use their own licenses; do not assume the whole dependency
tree is MIT. Consult each installed package's license/notice files and the
lockfile metadata when redistributing dependencies.

Electron distributions also contain Chromium and other third-party components.
Retain Electron's `LICENSE` / packaged `LICENSE.electron.txt` and
`LICENSES.chromium.html`, together with all other applicable notices supplied by
the exact distribution. Review generated artifacts before publishing a binary;
this repository import publishes source only.
