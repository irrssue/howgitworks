const input = document.getElementById('terminal-input');
const outputArea = document.getElementById('output-area');
const terminalBody = document.getElementById('terminal-body');
const visualCanvas = document.getElementById('visual-canvas');


const fs = {
  '/': { type: 'dir', children: {} }
};

let cwd = '/';
let history = [];
let historyIndex = -1;

// find nearest ancestor dir (including cwd) that has .git
function findRepo(path) {
  let p = path;
  while (true) {
    const node = getNode(p);
    if (node && node.type === 'dir' && node.git) return { path: p, node: node };
    if (p === '/') return null;
    const { parentPath } = parentAndName(p);
    p = parentPath;
  }
}

function currentRepo() { return findRepo(cwd); }

function newGitState() {
  return {
    staged: [],          // file paths relative to repo root
    committed: [],       // file paths ever committed
    pushed: [],          // file paths pushed to remote
    commits: [],
    remote: null,
    branch: 'main',
    hasUnpushedCommits: false
  };
}

// path of file relative to repo root
function relToRepo(repoPath, filePath) {
  if (repoPath === '/') return filePath.replace(/^\//, '');
  return filePath.slice(repoPath.length + 1);
}

function resolvePath(p) {
  if (p.startsWith('/')) return p;
  const parts = (cwd === '/' ? '' : cwd).split('/').concat(p.split('/'));
  const resolved = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return '/' + resolved.join('/');
}

function getNode(path) {
  if (path === '/') return fs['/'];
  const parts = path.split('/').filter(Boolean);
  let node = fs['/'];
  for (const p of parts) {
    if (!node || node.type !== 'dir' || !node.children[p]) return null;
    node = node.children[p];
  }
  return node;
}

function parentAndName(path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  const parentPath = '/' + parts.join('/');
  return { parentPath: parentPath || '/', name };
}

const promptEl = document.getElementById('prompt');

function updatePrompt() {
  promptEl.textContent = (cwd === '/' ? '/' : cwd) + ' $';
}

function print(text, cls) {
  const line = document.createElement('div');
  line.className = 'output-line' + (cls ? ' ' + cls : '');
  line.textContent = text;
  outputArea.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

function printCommand(text) {
  const label = (cwd === '/' ? '/' : cwd) + ' $ ';
  print(label + text, 'command');
}

function clearOutput() {
  while (outputArea.firstChild) {
    outputArea.removeChild(outputArea.firstChild);
  }
}

function lsCmd(args) {
  const node = getNode(cwd);
  if (!node || node.type !== 'dir') { print('not a directory', 'error'); return; }
  const entries = Object.keys(node.children);
  if (entries.length === 0) { print('(empty)', 'dim'); return; }
  const out = entries.map(e => node.children[e].type === 'dir' ? e + '/ (folder)' : e);
  print(out.join('  '));
}

function cdCmd(args) {
  if (!args[0] || args[0] === '~') { cwd = '/'; updatePrompt(); repaintCanvas(); return; }
  const target = resolvePath(args[0]);
  const node = getNode(target);
  if (!node) { print('cd: ' + args[0] + ': No such file or directory', 'error'); return; }
  if (node.type !== 'dir') { print('cd: ' + args[0] + ': Not a directory', 'error'); return; }
  cwd = target;
  updatePrompt();
  repaintCanvas();
}

function fileGitState(repo, fileName) {
  if (!repo) return null;
  const g = repo.node.git;
  const cwdRel = cwd === repo.path ? '' : cwd.slice(repo.path === '/' ? 1 : repo.path.length + 1) + '/';
  const rel = cwdRel + fileName;
  if (g.pushed.includes(rel)) return 'pushed';
  if (g.committed.includes(rel)) return 'committed';
  if (g.staged.includes(rel)) return 'staged';
  return 'untracked';
}

function repaintCanvas() {
  while (visualCanvas.firstChild) visualCanvas.removeChild(visualCanvas.firstChild);

  if (cwd === '/') {
    visualCanvas.classList.remove('canvas-open');
    visualCanvas.removeAttribute('data-name');
  } else {
    visualCanvas.classList.add('canvas-open');
    visualCanvas.dataset.name = cwd.split('/').filter(Boolean).pop();
  }

  const node = getNode(cwd);
  if (!node || node.type !== 'dir') return;

  const repo = currentRepo();

  const grid = document.createElement('div');
  grid.className = 'icon-grid';
  visualCanvas.appendChild(grid);

  Object.keys(node.children).forEach(function(childName) {
    const child = node.children[childName];
    if (child.type === 'dir') {
      spawnFolderIcon(childName, grid, child.git ? true : false);
    } else if (child.type === 'file') {
      spawnFileIcon(childName, grid, fileGitState(repo, childName));
    }
  });

  if (repo) {
    renderPipeline(repo);
  }
}

function renderPipeline(repo) {
  const g = repo.node.git;
  const hasCommits = g.commits.length > 0;
  const hasRemote = !!g.remote;
  const synced = hasRemote && !g.hasUnpushedCommits && g.pushed.length > 0;

  // arrow activation
  const addActive = g.staged.length > 0 || hasCommits || g.pushed.length > 0;
  const commitActive = hasCommits || g.pushed.length > 0;
  const pushActive = synced;

  // bucket files by furthest stage
  const workingFiles = [];
  const stagedFiles = g.staged.slice();
  const committedFiles = [];
  const pushedFiles = g.pushed.slice();

  g.committed.forEach(function(f) {
    if (!g.pushed.includes(f)) committedFiles.push(f);
  });

  // working = files in cwd not yet staged/committed/pushed
  const node = getNode(cwd);
  if (node && node.type === 'dir') {
    const cwdRel = cwd === repo.path ? '' : cwd.slice(repo.path === '/' ? 1 : repo.path.length + 1) + '/';
    Object.keys(node.children).forEach(function(name) {
      if (node.children[name].type !== 'file') return;
      const rel = cwdRel + name;
      if (!g.staged.includes(rel) && !g.committed.includes(rel) && !g.pushed.includes(rel)) {
        workingFiles.push(rel);
      }
    });
  }

  const pipe = document.createElement('div');
  pipe.className = 'pipeline';

  pipe.appendChild(buildStage('Working Dir', 'working', workingFiles));
  pipe.appendChild(buildArrow('git add', addActive));
  pipe.appendChild(buildStage('Staging', 'staged', stagedFiles));
  pipe.appendChild(buildArrow('git commit', commitActive));
  pipe.appendChild(buildStage('Local Repo', 'committed', committedFiles, hasCommits ? g.commits.length : 0));

  if (hasRemote) {
    pipe.appendChild(buildArrow('git push', pushActive));
    pipe.appendChild(buildCloudStage(g.remote, pushedFiles, synced));
  } else {
    pipe.appendChild(buildArrow('connect remote first', false, true));
    pipe.appendChild(buildStage('Remote', 'remote-empty', [], 0, true));
  }

  visualCanvas.appendChild(pipe);
}

function buildStage(title, kind, files, commitBadge, dim) {
  const box = document.createElement('div');
  box.className = 'stage stage-' + kind + (dim ? ' stage-dim' : '');

  const head = document.createElement('div');
  head.className = 'stage-title';
  head.textContent = title;
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'stage-body';

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stage-empty';
    empty.textContent = '∅';
    body.appendChild(empty);
  } else {
    files.forEach(function(f) {
      const chip = document.createElement('div');
      chip.className = 'file-chip chip-' + kind;
      chip.textContent = f;
      body.appendChild(chip);
    });
  }
  box.appendChild(body);

  if (commitBadge && commitBadge > 0) {
    const cb = document.createElement('div');
    cb.className = 'commit-badge';
    cb.textContent = commitBadge + ' commit' + (commitBadge > 1 ? 's' : '');
    box.appendChild(cb);
  }

  return box;
}

function buildCloudStage(remoteUrl, files, synced) {
  const box = document.createElement('div');
  box.className = 'stage stage-cloud' + (synced ? ' cloud-synced' : '');

  const head = document.createElement('div');
  head.className = 'stage-title';
  head.textContent = 'Remote (GitHub)';
  box.appendChild(head);

  const svgWrap = document.createElement('div');
  svgWrap.className = 'cloud-svg-wrap';
  const svg = svgEl('svg', { viewBox: '0 0 64 48' });
  const body = svgEl('path', {
    d: 'M50 30c0-7-6-12-13-12-1-6-7-10-13-10-7 0-13 5-14 12C4 21 0 26 0 32c0 7 6 12 13 12h35c7 0 12-5 12-11 0-5-4-10-10-12z',
    fill: synced ? '#0d2818' : '#222',
    stroke: synced ? '#28c840' : '#666',
    'stroke-width': '1.5'
  });
  svg.appendChild(body);
  if (synced) {
    const check = svgEl('path', {
      d: 'M22 22l9 9 13-13',
      fill: 'none', stroke: '#28c840', 'stroke-width': '3',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    svg.appendChild(check);
  }
  svgWrap.appendChild(svg);
  box.appendChild(svgWrap);

  const filesBody = document.createElement('div');
  filesBody.className = 'stage-body';
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stage-empty';
    empty.textContent = '∅';
    filesBody.appendChild(empty);
  } else {
    files.forEach(function(f) {
      const chip = document.createElement('div');
      chip.className = 'file-chip chip-pushed';
      chip.textContent = f;
      filesBody.appendChild(chip);
    });
  }
  box.appendChild(filesBody);

  const url = document.createElement('div');
  url.className = 'cloud-url';
  url.textContent = remoteUrl;
  box.appendChild(url);

  return box;
}

function buildArrow(label, active, warn) {
  const arrow = document.createElement('div');
  arrow.className = 'pipe-arrow' + (active ? ' arrow-active' : '') + (warn ? ' arrow-warn' : '');

  const lbl = document.createElement('div');
  lbl.className = 'arrow-label';
  lbl.textContent = label;
  arrow.appendChild(lbl);

  const line = document.createElement('div');
  line.className = 'arrow-line';
  arrow.appendChild(line);

  return arrow;
}

function spawnFolderIcon(name, parent, isRepo) {
  const item = document.createElement('div');
  item.className = 'folder-item';

  const wrap = document.createElement('div');
  wrap.className = 'folder-icon-wrap';

  const img = document.createElement('img');
  img.src = 'folder.png';
  img.alt = name;
  wrap.appendChild(img);

  if (isRepo) {
    const badge = document.createElement('div');
    badge.className = 'git-badge';
    badge.textContent = 'git';
    wrap.appendChild(badge);
  }

  const label = document.createElement('div');
  label.className = 'folder-name';
  label.textContent = name;

  item.appendChild(wrap);
  item.appendChild(label);

  (parent || visualCanvas).appendChild(item);
}

function spawnFileIcon(name, parent, state) {
  const item = document.createElement('div');
  item.className = 'folder-item file-item state-' + (state || 'untracked');

  const wrap = document.createElement('div');
  wrap.className = 'folder-icon-wrap';

  const img = document.createElement('img');
  img.src = 'file.svg';
  img.alt = name;
  wrap.appendChild(img);

  if (state === 'staged') {
    const dot = document.createElement('div');
    dot.className = 'state-badge staged-badge';
    dot.textContent = 'S';
    wrap.appendChild(dot);
  } else if (state === 'committed') {
    const dot = document.createElement('div');
    dot.className = 'state-badge committed-badge';
    dot.textContent = '✓';
    wrap.appendChild(dot);
  } else if (state === 'pushed') {
    const dot = document.createElement('div');
    dot.className = 'state-badge pushed-badge';
    dot.textContent = '☁';
    wrap.appendChild(dot);
  }

  const label = document.createElement('div');
  label.className = 'folder-name';
  label.textContent = name;

  item.appendChild(wrap);
  item.appendChild(label);

  (parent || visualCanvas).appendChild(item);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function(k) { el.setAttribute(k, attrs[k]); });
  return el;
}


function mkdirCmd(args) {
  if (!args[0]) { print('mkdir: missing operand', 'error'); return; }
  const target = resolvePath(args[0]);
  const { parentPath, name } = parentAndName(target);
  const parent = getNode(parentPath);
  if (!parent || parent.type !== 'dir') { print('mkdir: cannot create directory: No such file or directory', 'error'); return; }
  if (parent.children[name]) { print('mkdir: ' + name + ': File exists', 'error'); return; }
  parent.children[name] = { type: 'dir', children: {} };
  if (parentPath === cwd) repaintCanvas();
}

function touchCmd(args) {
  if (!args[0]) { print('touch: missing file operand', 'error'); return; }
  const target = resolvePath(args[0]);
  const { parentPath, name } = parentAndName(target);
  const parent = getNode(parentPath);
  if (!parent || parent.type !== 'dir') { print('touch: cannot create file: No such directory', 'error'); return; }
  if (!parent.children[name]) {
    parent.children[name] = { type: 'file', content: '' };
    if (parentPath === cwd) repaintCanvas();
  }
}

function rmCmd(args) {
  const flag = args[0];
  const isRecursive = flag === '-r' || flag === '-rf';
  const targetArg = isRecursive ? args[1] : args[0];
  if (!targetArg) { print('rm: missing operand. use: rm -r <path>', 'error'); return; }
  const resolved = resolvePath(targetArg);
  const { parentPath, name } = parentAndName(resolved);
  const parent = getNode(parentPath);
  if (!parent || !parent.children[name]) { print('rm: ' + name + ': No such file or directory', 'error'); return; }
  const node = parent.children[name];
  if (node.type === 'dir' && !isRecursive) { print('rm: ' + name + ': is a directory (use rm -r)', 'error'); return; }
  delete parent.children[name];
  // strip from any ancestor repo git state
  const repo = findRepo(parentPath);
  if (repo && node.type === 'file') {
    const g = repo.node.git;
    const rel = relToRepo(repo.path, resolved);
    g.staged = g.staged.filter(function(f) { return f !== rel; });
    g.committed = g.committed.filter(function(f) { return f !== rel; });
    g.pushed = g.pushed.filter(function(f) { return f !== rel; });
  }
  if (parentPath === cwd && (node.type === 'dir' || node.type === 'file')) {
    const items = visualCanvas.querySelectorAll('.folder-item');
    items.forEach(function(item) {
      const label = item.querySelector('.folder-name');
      if (label && label.textContent === name) {
        item.classList.add('removing');
        item.addEventListener('animationend', function() { item.remove(); }, { once: true });
      }
    });
  }
}

function pwdCmd() {
  print(cwd);
}

function helpCmd() {
  print('available commands:', 'info');
  print('  ls                   list directory contents', 'dim');
  print('  cd <dir>             change directory', 'dim');
  print('  mkdir <dir>          make directory', 'dim');
  print('  touch <file>         create file', 'dim');
  print('  rm -r <path>         remove file or directory', 'dim');
  print('  pwd                  print working directory', 'dim');
  print('  clear                clear terminal', 'dim');
  print('', 'dim');
  print('  git init                    initialize repo', 'dim');
  print('  git status                  show status', 'dim');
  print('  git add <file|.>            stage file(s)', 'dim');
  print('  git commit -m "msg"         commit staged files', 'dim');
  print('  git log                     show commit history', 'dim');
  print('  git branch                  list branches', 'dim');
  print('  git checkout -b <branch>    create & switch branch', 'dim');
  print('  git checkout <branch>       switch branch', 'dim');
  print('  git merge <branch>          merge branch into current', 'dim');
  print('  git remote add origin <url> set remote', 'dim');
  print('  git remote -v               list remotes', 'dim');
  print('  git push                    push to remote', 'dim');
  print('  git diff                    show unstaged changes', 'dim');
}

function gitCmd(args) {
  const sub = args[0];

  if (!sub) {
    print('git — version control for your project', 'info');
    print('');
    print('think of git as a save system for code. it tracks every change you make,', 'dim');
    print('lets you go back in time, and lets you share work with others.', 'dim');
    print('');
    print('the basics (in order you usually use them):', 'info');
    print('');
    print('  git init', 'success');
    print('    start tracking this folder. creates a hidden .git/ store.', 'dim');
    print('    run this once, the first time. you only "init" a project once.', 'dim');
    print('');
    print('  git add <file>     (or  git add .  for everything)', 'success');
    print('    pick which changes you want to save next. this is called "staging".', 'dim');
    print('    think of it as putting items into a box before sealing it.', 'dim');
    print('');
    print('  git commit -m "message"', 'success');
    print('    seal the box. saves a snapshot of the staged files with a note.', 'dim');
    print('    the message describes what changed, so you remember later.', 'dim');
    print('');
    print('  git remote add origin <url>', 'success');
    print('    tell git where the online copy lives (e.g. on GitHub).', 'dim');
    print('    "origin" is just a nickname for that remote location.', 'dim');
    print('');
    print('  git push', 'success');
    print('    upload your commits to the remote. now your code lives online too.', 'dim');
    print('    teammates can pull it, or you can get it back if your laptop dies.', 'dim');
    print('');
    print("type 'help' for full command list, or try 'git init' to begin.", 'dim');
    return;
  }

  if (sub === 'init') {
    const node = getNode(cwd);
    if (!node || node.type !== 'dir') { print('fatal: cwd not a directory', 'error'); return; }
    if (node.git) { print('Reinitialized existing Git repository in ' + cwd + '/.git/', 'success'); return; }
    node.git = newGitState();
    print('Initialized empty Git repository in ' + cwd + '/.git/', 'success');
    repaintCanvas();
    return;
  }

  const repo = currentRepo();
  if (!repo) { print('fatal: not a git repository', 'error'); return; }
  const g = repo.node.git;

  if (sub === 'status') {
    print('On branch ' + g.branch, 'info');
    if (g.staged.length > 0) {
      print('Changes to be committed:', 'success');
      g.staged.forEach(function(f) { print('  new file: ' + f, 'success'); });
    }
    const node = getNode(cwd);
    const allFiles = node ? Object.keys(node.children).filter(function(k) { return node.children[k].type === 'file'; }) : [];
    const cwdRel = cwd === repo.path ? '' : cwd.slice(repo.path === '/' ? 1 : repo.path.length + 1) + '/';
    const unstaged = allFiles.filter(function(f) {
      const rel = cwdRel + f;
      return !g.staged.includes(rel) && !g.committed.includes(rel);
    });
    if (unstaged.length > 0) {
      print('Untracked files:', 'error');
      unstaged.forEach(function(f) { print('  ' + f, 'error'); });
    }
    if (g.staged.length === 0 && unstaged.length === 0) {
      print('nothing to commit, working tree clean', 'dim');
    }
    return;
  }

  if (sub === 'add') {
    const target = args[1];
    if (!target) { print('Nothing specified. Maybe you meant: git add .', 'error'); return; }
    const node = getNode(cwd);
    if (!node) { print('fatal: pathspec did not match any files', 'error'); return; }
    const cwdRel = cwd === repo.path ? '' : cwd.slice(repo.path === '/' ? 1 : repo.path.length + 1) + '/';
    if (target === '.') {
      const files = Object.keys(node.children).filter(function(k) { return node.children[k].type === 'file'; });
      files.forEach(function(f) {
        const rel = cwdRel + f;
        if (!g.staged.includes(rel)) g.staged.push(rel);
      });
      print('staged ' + files.length + ' file(s)', 'success');
    } else {
      if (!node.children[target]) { print("fatal: pathspec '" + target + "' did not match any files", 'error'); return; }
      const rel = cwdRel + target;
      if (!g.staged.includes(rel)) g.staged.push(rel);
      print('staged ' + target, 'success');
    }
    repaintCanvas();
    return;
  }

  if (sub === 'commit') {
    if (args[1] !== '-m') { print('usage: git commit -m "message"', 'error'); return; }
    const msg = args.slice(2).join(' ').replace(/^["']|["']$/g, '');
    if (!msg) { print('error: empty commit message', 'error'); return; }
    if (g.staged.length === 0) { print('nothing to commit, working tree clean', 'dim'); return; }
    const hash = Math.random().toString(16).slice(2, 9);
    g.commits.push({ hash: hash, message: msg, files: g.staged.slice(), branch: g.branch });
    g.committed = g.committed.concat(g.staged);
    g.staged = [];
    g.hasUnpushedCommits = true;
    print('[' + g.branch + ' ' + hash + '] ' + msg, 'success');
    repaintCanvas();
    return;
  }

  if (sub === 'log') {
    const branchCommits = g.commits.filter(function(c) { return c.branch === g.branch; });
    if (branchCommits.length === 0) { print('(no commits yet)', 'dim'); return; }
    branchCommits.slice().reverse().forEach(function(c) {
      print('commit ' + c.hash, 'info');
      print('    ' + c.message);
      print('');
    });
    return;
  }

  if (sub === 'branch') {
    if (!args[1]) { print('* ' + g.branch, 'success'); return; }
    print("error: use 'git checkout -b <name>' to create a branch", 'error');
    return;
  }

  if (sub === 'checkout') {
    if (args[1] === '-b') {
      const name = args[2];
      if (!name) { print('error: branch name required', 'error'); return; }
      g.branch = name;
      print("Switched to a new branch '" + name + "'", 'success');
      return;
    }
    const name = args[1];
    if (!name) { print('error: branch name required', 'error'); return; }
    g.branch = name;
    print("Switched to branch '" + name + "'", 'success');
    return;
  }

  if (sub === 'merge') {
    const branch = args[1];
    if (!branch) { print('error: branch name required', 'error'); return; }
    print("Merge made by 'ort' strategy.", 'success');
    return;
  }

  if (sub === 'remote') {
    if (args[1] === 'add' && args[2] === 'origin') {
      g.remote = args[3] || 'origin';
      print('remote origin added', 'success');
      repaintCanvas();
      return;
    }
    if (args[1] === '-v') {
      if (g.remote) {
        print('origin  ' + g.remote + ' (fetch)', 'dim');
        print('origin  ' + g.remote + ' (push)', 'dim');
      } else {
        print('(no remotes)', 'dim');
      }
      return;
    }
    print('usage: git remote add origin <url>', 'error');
    return;
  }

  if (sub === 'push') {
    if (!g.remote) { print("fatal: 'origin' does not appear to be a git repository", 'error'); return; }
    if (g.commits.length === 0) { print('Everything up-to-date', 'dim'); return; }
    if (!g.hasUnpushedCommits) { print('Everything up-to-date', 'dim'); return; }
    print('Enumerating objects: ' + g.commits.length, 'dim');
    print('Writing objects: 100%', 'dim');
    print('To ' + g.remote, 'success');
    print(' * [new branch]      ' + g.branch + ' -> ' + g.branch, 'success');
    g.pushed = g.committed.slice();
    g.hasUnpushedCommits = false;
    repaintCanvas();
    return;
  }

  if (sub === 'diff') {
    if (g.staged.length === 0 && g.committed.length === 0) {
      print('(nothing to diff)', 'dim');
    } else {
      print('--- a/file', 'error');
      print('+++ b/file', 'success');
      print('(sandbox: no real file content to diff)', 'dim');
    }
    return;
  }

  print("git: '" + sub + "' is not a git command. type 'help' for list.", 'error');
}

function parseInput(raw) {
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function runCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  history.unshift(trimmed);
  historyIndex = -1;

  printCommand(trimmed);

  const tokens = parseInput(trimmed);
  const cmd = tokens[0];
  const args = tokens.slice(1);

  const dispatch = {
    ls: lsCmd,
    cd: cdCmd,
    mkdir: mkdirCmd,
    touch: touchCmd,
    rm: rmCmd,
    pwd: pwdCmd,
    clear: clearOutput,
    help: helpCmd,
    git: gitCmd
  };

  if (dispatch[cmd]) {
    dispatch[cmd](args);
  } else {
    print("command not found: " + cmd + ". type 'help' to see commands.", 'error');
  }
}

input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    const val = input.value;
    input.value = '';
    runCommand(val);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex < history.length - 1) {
      historyIndex++;
      input.value = history[historyIndex];
    }
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      input.value = history[historyIndex];
    } else {
      historyIndex = -1;
      input.value = '';
    }
  }
});

terminalBody.addEventListener('click', function() { input.focus(); });
input.focus();

print("how git works — interactive sandbox", 'info');
print("type 'help' to see available commands.", 'dim');
print('');
