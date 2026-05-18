let pyodide = null;
let editor  = null;
let testCases = [];
let tcCounter = 0;

// ── 자동 저장 / 불러오기 (localStorage) ──────────────────────
const STORAGE_CODE = 'algojudge_code';
const STORAGE_TCS  = 'algojudge_testcases';

function saveAll() {
  localStorage.setItem(STORAGE_CODE, editor.getValue());
  const data = testCases.map(tc => ({
    id:       tc.id,
    inputVal: document.getElementById(`tc-input-${tc.id}`)?.value    ?? '',
    expected: document.getElementById(`tc-expected-${tc.id}`)?.value ?? '',
  }));
  localStorage.setItem(STORAGE_TCS, JSON.stringify(data));
}

function loadSaved() {
  const savedCode = localStorage.getItem(STORAGE_CODE);
  if (savedCode !== null) editor.setValue(savedCode);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_TCS) || '[]');
    saved.forEach(tc => addTestCase(tc.inputVal, tc.expected));
  } catch (_) {}
}

// ── CodeMirror 초기화 ─────────────────────────────────────────
window.addEventListener('load', () => {
  editor = CodeMirror(document.getElementById('code-editor-wrap'), {
    mode: 'python',
    theme: 'dracula',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    extraKeys: {
      'Tab': cm => cm.execCommand('indentMore'),
      'Shift-Tab': cm => cm.execCommand('indentLess'),
      'Ctrl-Enter': () => runAllTests(),
      'Cmd-Enter':  () => runAllTests(),
      'Ctrl-/': cm => cm.execCommand('toggleComment'),
    },
    value: '',
  });

  // 코드 변경 시 자동 저장 (300ms 디바운스)
  let saveTimer = null;
  editor.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 300);
  });

  initPyodide();
  loadSaved();
});

// ── Pyodide 초기화 ────────────────────────────────────────────
async function initPyodide() {
  try {
    pyodide = await loadPyodide();
    setStatus('ready', '파이썬 엔진 준비됨');
    setLog('✓ Pyodide (Python 3.12) 로드 완료.');
    document.getElementById('run-btn').disabled = false;
  } catch (e) {
    setStatus('error', '엔진 로드 실패');
    setLog('✗ Pyodide 로드 실패: ' + e.message);
  }
}

function setStatus(type, text) {
  document.getElementById('status-dot').className = 'status-dot ' + type;
  document.getElementById('status-text').textContent = text;
}

// ── 출력 정규화: 줄별 trailing space 제거 ─────────────────────
function normalize(str) {
  return str
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n')
    .trimEnd();
}

// ── 테스트케이스 관리 ─────────────────────────────────────────
function addTestCase(inputVal = '', expectedVal = '') {
  const id = ++tcCounter;
  testCases.push({ id });
  renderTestCase(id, inputVal, expectedVal);
  updateEmptyState();
  updateCounter();
  saveAll();
}

function renderTestCase(id, inputVal = '', expectedVal = '') {
  const list = document.getElementById('testcase-list');
  const el = document.createElement('div');
  el.className = 'testcase-item';
  el.id = `tc-${id}`;
  el.innerHTML = `
    <div class="tc-header" onclick="toggleTC(${id})">
      <div class="tc-title">
        <span style="color:var(--muted);font-size:11px;">#${id}</span>
        <span>테스트 ${id}</span>
      </div>
      <div id="tc-badge-${id}" class="tc-badge badge-wait">대기</div>
    </div>
    <div class="tc-body" id="tc-body-${id}">
      <div class="tc-field">
        <label>입력 (Input)</label>
        <textarea id="tc-input-${id}" placeholder="표준 입력값&#10;줄바꿈으로 구분" rows="3" oninput="resetTC(${id}); saveAll()">${escHtml(inputVal)}</textarea>
      </div>
      <div class="tc-field">
        <label>예상 출력 (Expected)</label>
        <textarea id="tc-expected-${id}" placeholder="예상 출력값" rows="2" oninput="resetTC(${id}); saveAll()">${escHtml(expectedVal)}</textarea>
      </div>
      <div class="tc-field">
        <label>실제 출력 (Actual)</label>
        <div class="tc-result" id="tc-result-${id}">아직 실행하지 않았습니다</div>
      </div>
      <div class="tc-actions">
        <button class="btn btn-ghost btn-sm" onclick="runSingleTest(${id})" style="margin-right:6px;">▶ 실행</button>
        <button class="btn btn-danger btn-sm" onclick="removeTC(${id})">✕ 삭제</button>
      </div>
    </div>
  `;
  list.appendChild(el);
}

function resetTC(id) {
  setBadge(id, 'wait', '대기');
  setResult(id, '아직 실행하지 않았습니다', '');
  document.getElementById(`tc-${id}`).className = 'testcase-item';
}

function toggleTC(id) {
  const b = document.getElementById(`tc-body-${id}`);
  b.style.display = b.style.display === 'none' ? '' : 'none';
}

function removeTC(id) {
  testCases = testCases.filter(t => t.id !== id);
  document.getElementById(`tc-${id}`)?.remove();
  updateEmptyState();
  updateCounter();
  updateSummary();
  saveAll();
}

function updateEmptyState() {
  document.getElementById('empty-state').style.display = testCases.length ? 'none' : '';
}
function updateCounter() {
  document.getElementById('tc-count').textContent = testCases.length + '개';
}

// ── 실행 ──────────────────────────────────────────────────────
async function runAllTests() {
  if (!pyodide)          { toast('파이썬 엔진이 아직 준비되지 않았습니다', 'err'); return; }
  if (!testCases.length) { toast('테스트 케이스가 없습니다', 'err'); return; }

  const btn = document.getElementById('run-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 실행 중...';

  addLog('── 전체 테스트 실행 ──');
  for (const tc of testCases) await runSingleTest(tc.id);
  addLog('── 완료 ──');

  btn.disabled = false;
  btn.innerHTML = '<span>▶</span> 전체 실행';
  updateSummary();
}

async function runSingleTest(id) {
  if (!pyodide) { toast('파이썬 엔진이 아직 준비되지 않았습니다', 'err'); return; }

  const inputEl    = document.getElementById(`tc-input-${id}`);
  const expectedEl = document.getElementById(`tc-expected-${id}`);
  if (!inputEl) return;

  const inputVal = inputEl.value;
  const expected = normalize(expectedEl.value);

  setBadge(id, 'run', '실행중');
  setResult(id, '실행 중...', '');

  const code = editor.getValue();

  try {
    const raw    = await runPython(code, inputVal);
    const actual = normalize(raw);

    if (actual === expected) {
      setBadge(id, 'pass', '✓ PASS');
      setResult(id, actual || '(빈 출력)', 'pass');
      addLog(`#${id} ✓ PASS`);
      document.getElementById(`tc-${id}`).className = 'testcase-item pass';
    } else {
      setBadge(id, 'fail', '✗ FAIL');
      setResult(id, `실제:\n${actual || '(빈 출력)'}\n\n예상:\n${expected || '(빈 출력)'}`, 'fail');
      addLog(`#${id} ✗ FAIL`);
      document.getElementById(`tc-${id}`).className = 'testcase-item fail';
    }
  } catch (e) {
    setBadge(id, 'err', '! ERROR');
    const msg = e.message.split('\n').slice(-4).join('\n');
    setResult(id, msg, 'err');
    addLog(`#${id} ERROR: ${msg.split('\n')[0]}`);
    document.getElementById(`tc-${id}`).className = 'testcase-item fail';
  }
  updateSummary();
}

// ── Python 실행 (exec 기반) ───────────────────────────────────
async function runPython(code, inputData) {
  return new Promise((resolve, reject) => {
    try {
      pyodide.globals.set('__stdin_str__', inputData);
      pyodide.globals.set('__user_code__', code);

      pyodide.runPython(`
import sys, io, builtins

_stdin_buf  = io.StringIO(__stdin_str__)
_output_buf = io.StringIO()

def _mock_input(prompt=''):
    line = _stdin_buf.readline()
    return line.rstrip('\\n')

builtins.input = _mock_input
sys.stdin  = _stdin_buf
sys.stdout = _output_buf

try:
    exec(compile(__user_code__, '<solution>', 'exec'))
except SystemExit:
    pass
finally:
    sys.stdout = sys.__stdout__
    sys.stdin  = sys.__stdin__
    builtins.input = input

__result__ = _output_buf.getvalue()
`);
      resolve(pyodide.globals.get('__result__') || '');
    } catch (e) {
      reject(e);
    }
  });
}

// ── UI 헬퍼 ──────────────────────────────────────────────────
function setBadge(id, type, text) {
  const el = document.getElementById(`tc-badge-${id}`);
  if (!el) return;
  const map = { wait:'badge-wait', pass:'badge-pass', fail:'badge-fail', run:'badge-run', err:'badge-err' };
  el.className = 'tc-badge ' + (map[type] || 'badge-wait');
  el.textContent = text;
}

function setResult(id, text, cls) {
  const el = document.getElementById(`tc-result-${id}`);
  if (!el) return;
  el.textContent = text;
  el.className = 'tc-result' + (cls ? ' ' + cls : '');
}

function updateSummary() {
  const badges = document.querySelectorAll('[id^="tc-badge-"]');
  let pass = 0, total = 0;
  badges.forEach(b => {
    const t = b.textContent;
    if (t.includes('PASS') || t.includes('FAIL') || t.includes('ERROR')) total++;
    if (t.includes('PASS')) pass++;
  });
  const score = document.getElementById('summary-score');
  const fill  = document.getElementById('summary-fill');
  if (!total) {
    score.textContent = '—'; score.style.color = 'var(--muted)';
    fill.style.width = '0%'; return;
  }
  const pct = Math.round(pass / total * 100);
  score.textContent = `${pass} / ${total}  (${pct}%)`;
  score.style.color = pass === total ? 'var(--green)' : pass === 0 ? 'var(--red)' : 'var(--yellow)';
  fill.style.width  = pct + '%';
}

let logLines = [];
function setLog(t) { logLines = [t]; document.getElementById('output-log').textContent = t; }
function addLog(t) {
  logLines.push(t);
  const el = document.getElementById('output-log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}
function clearLog() { setLog(''); }

function clearCode() {
  if (confirm('코드를 초기화하시겠습니까?')) {
    editor.setValue('');
    saveAll();
  }
}

function loadTemplate() {
  const templates = [
`import sys
input = sys.stdin.readline

def solve():
    n = int(input())
    print(n * 2)

solve()`,
`import sys
input = sys.stdin.readline

T = int(input())
for _ in range(T):
    n = int(input())
    print(n)`,
`import sys
input = sys.stdin.readline

n, m = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(n)]
print(grid[0][0])`,
  ];
  editor.setValue(templates[Math.floor(Math.random() * templates.length)]);
}

function toast(msg, type = 'ok') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = (type === 'ok' ? '✓ ' : '✗ ') + msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
