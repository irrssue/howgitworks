const input = document.getElementById('terminal-input');
const outputArea = document.getElementById('output-area');
const terminalBody = document.getElementById('terminal-body');
const visualCanvas = document.getElementById('visual-canvas');


const fs = {
  '/': { type: 'dir', children: {} }
};

let cwd = '/';
let gitInitialized = false;
let stagedFiles = [];
let committedFiles = [];
let commits = [];
let gitRemote = null;
let currentBranch = 'main';
let history = [];
let historyIndex = -1;

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
  const out = entries.map(e => node.children[e].type === 'dir' ? e + '/' : e);
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
  Object.keys(node.children).forEach(function(childName) {
    if (node.children[childName].type === 'dir') {
      spawnFolderIcon(childName);
    }
  });
}

function spawnFolderIcon(name) {
  const item = document.createElement('div');
  item.className = 'folder-item';

  const wrap = document.createElement('div');
  wrap.className = 'folder-icon-wrap';

  const img = document.createElement('img');
  img.src = 'folder.png';
  img.alt = name;
  wrap.appendChild(img);

  const label = document.createElement('div');
  label.className = 'folder-name';
  label.textContent = name;

  item.appendChild(wrap);
  item.appendChild(label);

  visualCanvas.appendChild(item);
}

function mkdirCmd(args) {
  if (!args[0]) { print('mkdir: missing operand', 'error'); return; }
  const target = resolvePath(args[0]);
  const { parentPath, name } = parentAndName(target);
  const parent = getNode(parentPath);
  if (!parent || parent.type !== 'dir') { print('mkdir: cannot create directory: No such file or directory', 'error'); return; }
  if (parent.children[name]) { print('mkdir: ' + name + ': File exists', 'error'); return; }
  parent.children[name] = { type: 'dir', children: {} };
  // only show icon if created in current view
  if (parentPath === cwd) spawnFolderIcon(name);
}

function touchCmd(args) {
  if (!args[0]) { print('touch: missing file operand', 'error'); return; }
  const target = resolvePath(args[0]);
  const { parentPath, name } = parentAndName(target);
  const parent = getNode(parentPath);
  if (!parent || parent.type !== 'dir') { print('touch: cannot create file: No such directory', 'error'); return; }
  if (!parent.children[name]) {
    parent.children[name] = { type: 'file', content: '' };
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

  if (sub === 'init') {
    if (gitInitialized) { print('Reinitialized existing Git repository in ' + cwd + '/.git/', 'success'); return; }
    gitInitialized = true;
    stagedFiles = [];
    committedFiles = [];
    commits = [];
    print('Initialized empty Git repository in ' + cwd + '/.git/', 'success');
    return;
  }

  if (!gitInitialized) { print('fatal: not a git repository', 'error'); return; }

  if (sub === 'status') {
    print('On branch ' + currentBranch, 'info');
    if (stagedFiles.length > 0) {
      print('Changes to be committed:', 'success');
      stagedFiles.forEach(function(f) { print('  new file: ' + f, 'success'); });
    }
    const node = getNode(cwd);
    const allFiles = node ? Object.keys(node.children).filter(function(k) { return node.children[k].type === 'file'; }) : [];
    const unstaged = allFiles.filter(function(f) { return !stagedFiles.includes(f) && !committedFiles.includes(f); });
    if (unstaged.length > 0) {
      print('Untracked files:', 'error');
      unstaged.forEach(function(f) { print('  ' + f, 'error'); });
    }
    if (stagedFiles.length === 0 && unstaged.length === 0) {
      print('nothing to commit, working tree clean', 'dim');
    }
    return;
  }

  if (sub === 'add') {
    const target = args[1];
    if (!target) { print('Nothing specified. Maybe you meant: git add .', 'error'); return; }
    const node = getNode(cwd);
    if (!node) { print('fatal: pathspec did not match any files', 'error'); return; }
    if (target === '.') {
      const files = Object.keys(node.children).filter(function(k) { return node.children[k].type === 'file'; });
      files.forEach(function(f) { if (!stagedFiles.includes(f)) stagedFiles.push(f); });
      print('staged ' + files.length + ' file(s)', 'success');
    } else {
      if (!node.children[target]) { print("fatal: pathspec '" + target + "' did not match any files", 'error'); return; }
      if (!stagedFiles.includes(target)) stagedFiles.push(target);
      print('staged ' + target, 'success');
    }
    return;
  }

  if (sub === 'commit') {
    if (args[1] !== '-m') { print('usage: git commit -m "message"', 'error'); return; }
    const msg = args.slice(2).join(' ').replace(/^["']|["']$/g, '');
    if (!msg) { print('error: empty commit message', 'error'); return; }
    if (stagedFiles.length === 0) { print('nothing to commit, working tree clean', 'dim'); return; }
    const hash = Math.random().toString(16).slice(2, 9);
    commits.push({ hash: hash, message: msg, files: stagedFiles.slice(), branch: currentBranch });
    committedFiles = committedFiles.concat(stagedFiles);
    stagedFiles = [];
    print('[' + currentBranch + ' ' + hash + '] ' + msg, 'success');
    return;
  }

  if (sub === 'log') {
    const branchCommits = commits.filter(function(c) { return c.branch === currentBranch; });
    if (branchCommits.length === 0) { print('(no commits yet)', 'dim'); return; }
    branchCommits.slice().reverse().forEach(function(c) {
      print('commit ' + c.hash, 'info');
      print('    ' + c.message);
      print('');
    });
    return;
  }

  if (sub === 'branch') {
    if (!args[1]) {
      print('* ' + currentBranch, 'success');
      return;
    }
    print("error: use 'git checkout -b <name>' to create a branch", 'error');
    return;
  }

  if (sub === 'checkout') {
    if (args[1] === '-b') {
      const name = args[2];
      if (!name) { print('error: branch name required', 'error'); return; }
      currentBranch = name;
      print("Switched to a new branch '" + name + "'", 'success');
      return;
    }
    const name = args[1];
    if (!name) { print('error: branch name required', 'error'); return; }
    currentBranch = name;
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
      gitRemote = args[3] || 'origin';
      print('remote origin added', 'success');
      return;
    }
    if (args[1] === '-v') {
      if (gitRemote) {
        print('origin  ' + gitRemote + ' (fetch)', 'dim');
        print('origin  ' + gitRemote + ' (push)', 'dim');
      } else {
        print('(no remotes)', 'dim');
      }
      return;
    }
    print('usage: git remote add origin <url>', 'error');
    return;
  }

  if (sub === 'push') {
    if (!gitRemote) { print("fatal: 'origin' does not appear to be a git repository", 'error'); return; }
    if (commits.length === 0) { print('Everything up-to-date', 'dim'); return; }
    print('Enumerating objects: ' + commits.length, 'dim');
    print('Writing objects: 100%', 'dim');
    print('To ' + gitRemote, 'success');
    print(' * [new branch]      ' + currentBranch + ' -> ' + currentBranch, 'success');
    return;
  }

  if (sub === 'diff') {
    if (stagedFiles.length === 0 && committedFiles.length === 0) {
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
