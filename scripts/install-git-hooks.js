// Installs this repo's git hooks (currently: a pre-commit secret scanner)
// into .git/hooks so they run automatically. Runs on `npm install` via the
// "prepare" lifecycle script.
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const gitDir = path.join(repoRoot, ".git");

if (!fs.existsSync(gitDir)) {
  process.exit(0); // not a git checkout — nothing to install
}

const hooksDir = path.join(gitDir, "hooks");
fs.mkdirSync(hooksDir, { recursive: true });

const source = path.join(__dirname, "git-hooks", "pre-commit");
const dest = path.join(hooksDir, "pre-commit");
fs.copyFileSync(source, dest);
fs.chmodSync(dest, 0o755);

console.log("Installed git pre-commit hook (blocks committing .env or raw private keys).");
