# howgitworks

Interactive terminal sandbox that teaches git by doing, not reading.

## Project goal

Visitor lands on a black-background page with one thing: a fake terminal. No instructions, no tutorial text. They type commands, see results, learn by doing. Minimal prose.

## Stack

Pure HTML/CSS/JS. No frameworks, no build step. Open `index.html` in browser — done.

## Files

- `index.html` — page shell, terminal markup
- `style.css` — all styles (black bg, white border terminal)
- `terminal.js` — sandbox state machine (fake filesystem + git simulation)

## Sandbox design

### Filesystem

In-memory JS object tree rooted at `/`. State resets on page reload. No persistence.

### Supported shell commands

`ls`, `cd`, `mkdir`, `touch`, `rm -r`, `pwd`, `clear`, `help`

### Supported git commands

`git init`, `git status`, `git add`, `git commit -m`, `git log`, `git branch`, `git checkout`, `git checkout -b`, `git merge`, `git remote add origin`, `git remote -v`, `git push`, `git diff`

### Key state vars in terminal.js

| var | meaning |
|-----|---------|
| `fs` | in-memory directory tree |
| `cwd` | current working directory |
| `gitInitialized` | bool — git init called |
| `stagedFiles` | files in staging area |
| `committedFiles` | all ever-committed files |
| `commits` | commit history array |
| `gitRemote` | remote URL string or null |
| `currentBranch` | active branch name |

## Design rules

- Black background (`#000`), white border on terminal box
- macOS-style traffic light dots in header (decorative only)
- Output colors: white = commands, green = success, red = error, blue = info, gray = dim/meta
- No tutorial text on screen — user discovers via `help` and exploration
- Placeholder text: `type commands here` — disappears on focus

## Development rules

### After every change — automated git flow (no confirmation needed)

User has granted full git permission. After every code change:

1. `git add <changed files>` — only changed files, never `git add -A` blindly
2. Write and run commit with message following format below
3. `git push origin main` — always push immediately after commit

Do all three steps autonomously. No asking for confirmation. No secrets or `.env` files committed.

### Commit message format

```
<type>: <short summary under 50 chars>

<optional body — explain WHY if not obvious>
```

Types: `feat`, `fix`, `style`, `refactor`, `docs`

Example:
```
feat: add git merge simulation

Merge only affects branch state, no real conflict resolution needed for tutorial scope.
```

### Push

```bash
git push origin main
```

Always push to `main`. No force push.
