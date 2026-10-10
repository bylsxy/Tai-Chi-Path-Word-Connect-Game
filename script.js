const defaultWords = [
    "白鹤亮翅", "野马分鬃", "搂膝拗步", "手挥琵琶", "倒卷肱",
    "揽雀尾", "揽雀尾", "单鞭", "云手", "高探马",
    "蹬脚", "双峰贯耳", "下势独立", "左右穿梭", "海底针",
    "闪通臂", "转身搬拦捶", "如封似闭", "十字手"
];

let targetWords = [];
let boardSize = 6;
let grid = [];
let currentPath = [];
let targetPaths = [];
let foundWordCounts = new Map();
let usedWordPaths = new Set();
let foundWordsCount = 0;
let totalWordsToFind = 0;
let gameGeneration = 0;
let gamePhase = 'loading';
let pendingRoundTimeout = null;

let timerInterval = null;
let timerSeconds = 0;

// Web Worker 实例（延迟初始化）
let gridWorker = null;
let workerTimeout = null;
let gridGeneratorPromise = null;

const DOM = {
    board: document.getElementById('board'),
    remainingWords: document.querySelector('#remaining-words span'),
    currentWordDisplay: document.getElementById('current-word-display'),
    timer: document.getElementById('timer'),
    btnSettings: document.getElementById('btn-settings'),
    btnRestart: document.getElementById('btn-restart'),
    btnHint: document.getElementById('btn-hint'),
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnClearStorage: document.getElementById('btn-clear-storage'),
    difficultySelect: document.getElementById('difficulty-select'),
    wordListInput: document.getElementById('word-list-input'),
    winModal: document.getElementById('win-modal'),
    btnNextLevel: document.getElementById('btn-next-level'),
    loseModal: document.getElementById('lose-modal'),
    loseRemaining: document.getElementById('lose-remaining'),
    btnTryAgain: document.getElementById('btn-try-again'),
    // 新增 DOM 引用
    loadingOverlay: document.getElementById('loading-overlay'),
    toastContainer: document.getElementById('toast-container'),
    alertModal: document.getElementById('alert-modal'),
    alertModalMsg: document.getElementById('alert-modal-msg'),
    btnAlertOk: document.getElementById('btn-alert-ok')
};

// ============================================================
// 自定义弹窗 & Toast（替代 alert() 避免 PWA 卡死）
// ============================================================

function showToast(message, duration = 2500) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

function showAlert(message) {
    return new Promise(resolve => {
        DOM.alertModalMsg.textContent = message;
        DOM.alertModal.classList.remove('hidden');

        function onOk() {
            DOM.btnAlertOk.removeEventListener('click', onOk);
            DOM.alertModal.classList.add('hidden');
            resolve();
        }
        DOM.btnAlertOk.addEventListener('click', onOk);
    });
}

function showLoading(show) {
    if (show) {
        DOM.loadingOverlay.classList.remove('hidden');
    } else {
        DOM.loadingOverlay.classList.add('hidden');
    }
}

// ============================================================
// 应用初始化
// ============================================================

function init() {
    loadSettings();
    setupEventListeners();
    startGame();
}

function loadSettings() {
    const savedWords = localStorage.getItem('taichi_words');
    const savedSize = localStorage.getItem('taichi_size');

    if (savedWords) {
        DOM.wordListInput.value = savedWords;
    } else {
        DOM.wordListInput.value = defaultWords.join('\n');
    }

    if (['6', '8', '10'].includes(savedSize)) {
        boardSize = Number(savedSize);
        DOM.difficultySelect.value = boardSize;
    } else {
        boardSize = 6;
        DOM.difficultySelect.value = "6";
    }
}

function saveSettings() {
    const wordsRaw = DOM.wordListInput.value.split('\n');
    const wordsClean = wordsRaw.map(w => w.trim()).filter(w => w.length > 0);

    // Fallback if empty
    if (wordsClean.length === 0) {
        DOM.wordListInput.value = defaultWords.join('\n');
    } else {
        localStorage.setItem('taichi_words', wordsClean.join('\n'));
    }

    boardSize = parseInt(DOM.difficultySelect.value, 10);
    localStorage.setItem('taichi_size', boardSize.toString());
}

function setupEventListeners() {
    DOM.btnSettings.addEventListener('click', () => {
        DOM.settingsModal.classList.remove('hidden');
    });

    DOM.btnCloseSettings.addEventListener('click', () => {
        DOM.settingsModal.classList.add('hidden');
    });

    DOM.btnSaveSettings.addEventListener('click', () => {
        saveSettings();
        DOM.settingsModal.classList.add('hidden');
        startGame();
    });

    DOM.btnRestart.addEventListener('click', () => {
        startGame();
    });

    DOM.btnNextLevel.addEventListener('click', () => {
        DOM.winModal.classList.add('hidden');
        startGame();
    });

    DOM.btnTryAgain.addEventListener('click', startGame);

    DOM.btnHint.addEventListener('click', () => {
        showHint();
    });

    DOM.btnClearStorage.addEventListener('click', () => {
        // 用自定义弹窗替代 confirm (这里保留 confirm，因为它是用户主动触发的)
        if (confirm("确定要恢复默认设置吗？这将清空您自定义的词语列表。")) {
            localStorage.removeItem('taichi_words');
            localStorage.removeItem('taichi_size');
            loadSettings();
            DOM.settingsModal.classList.add('hidden');
            startGame();
        }
    });
}

// ============================================================
// 计时器
// ============================================================

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    DOM.timer.classList.remove('timer-warning');
}

function startTimer() {
    stopTimer();
    const generation = gameGeneration;
    timerSeconds = 60 * (boardSize === 6 ? 1 : boardSize === 8 ? 2 : 3);
    updateTimerUI();

    timerInterval = setInterval(() => {
        if (generation !== gameGeneration || gamePhase !== 'playing') return;
        if (document.hidden || !DOM.settingsModal.classList.contains('hidden')) return;
        timerSeconds--;
        updateTimerUI();
        if (timerSeconds <= 0) {
            stopTimer();
            gamePhase = 'expired';
            resetCurrentPath();
            DOM.btnHint.disabled = true;
            DOM.loseRemaining.textContent = totalWordsToFind - foundWordsCount;
            DOM.loseModal.classList.remove('hidden');
        }
    }, 1000);
}

function updateTimerUI() {
    DOM.timer.textContent = timerSeconds;
    DOM.timer.classList.toggle('timer-warning', gamePhase === 'playing' && timerSeconds > 0 && timerSeconds <= 10);
}

// ============================================================
// 游戏启动 — 使用 Web Worker 异步生成棋盘
// ============================================================

function loadGridGenerator() {
    if (window.TaiChiGrid) return Promise.resolve(window.TaiChiGrid);
    if (!gridGeneratorPromise) {
        gridGeneratorPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './grid-worker.js';
            script.onload = () => {
                if (window.TaiChiGrid) resolve(window.TaiChiGrid);
                else { gridGeneratorPromise = null; reject(new Error('棋盘生成器未就绪')); }
            };
            script.onerror = () => {
                gridGeneratorPromise = null;
                reject(new Error('无法加载棋盘生成器，请检查本地文件'));
            };
            document.head.appendChild(script);
        });
    }
    return gridGeneratorPromise;
}

function startGame() {
    const generation = ++gameGeneration;
    stopTimer();
    clearTimeout(pendingRoundTimeout);
    pendingRoundTimeout = null;
    if (gridWorker) gridWorker.terminate();
    gridWorker = null;
    clearTimeout(workerTimeout);
    workerTimeout = null;
    gamePhase = 'loading';
    resetCurrentPath();
    DOM.winModal.classList.add('hidden');
    DOM.loseModal.classList.add('hidden');
    const wordsRaw = DOM.wordListInput.value.split('\n').map(w => w.trim()).filter(Boolean);
    const pool = wordsRaw.length ? wordsRaw : defaultWords;
    const size = boardSize;
    showLoading(true);
    DOM.btnRestart.disabled = true;
    DOM.btnHint.disabled = true;

    let activeWorker = null;
    let settled = false;
    let fallbackStarted = false;
    function finish(result) {
        // 旧局的 Worker、超时回调或回退结果不能覆盖新局。
        if (settled || generation !== gameGeneration) return;
        settled = true;
        clearTimeout(workerTimeout);
        workerTimeout = null;
        if (activeWorker) activeWorker.terminate();
        if (gridWorker === activeWorker) gridWorker = null;
        showLoading(false);
        DOM.btnRestart.disabled = false;
        if (!result.success) {
            gamePhase = 'error';
            DOM.btnHint.disabled = true;
            showAlert('棋盘生成失败：' + (result.error || '未知错误'));
            return;
        }
        grid = result.grid;
        targetWords = result.targetWords;
        targetPaths = result.targetPaths || [];
        foundWordCounts = new Map();
        usedWordPaths = new Set();
        totalWordsToFind = targetWords.length;
        foundWordsCount = 0;
        DOM.remainingWords.textContent = totalWordsToFind;
        renderBoard();
        gamePhase = 'playing';
        DOM.btnHint.disabled = false;
        startTimer();
    }
    function fallback() {
        if (settled || fallbackStarted || generation !== gameGeneration) return;
        fallbackStarted = true;
        clearTimeout(workerTimeout);
        workerTimeout = null;
        if (activeWorker) activeWorker.terminate();
        if (gridWorker === activeWorker) gridWorker = null;
        // 使用同一有界生成器回退一次，避免 Worker 不可用时无限重试。
        loadGridGenerator().then(generator => {
            if (generation === gameGeneration) finish(generator.generate(pool, size));
        }).catch(error => finish({ success: false, error: error.message }));
    }
    try {
        activeWorker = new Worker('./grid-worker.js');
        gridWorker = activeWorker;
        activeWorker.onmessage = event => {
            if (!fallbackStarted) finish(event.data);
        };
        activeWorker.onerror = event => {
            if (event.preventDefault) event.preventDefault();
            fallback();
        };
        workerTimeout = setTimeout(fallback, 8000);
        activeWorker.postMessage({ pool, boardSize: size, targetSize: size * size });
    } catch (_) {
        fallback();
    }
}

// ============================================================
// 棋盘渲染
// ============================================================

function renderBoard() {
    DOM.board.innerHTML = '';
    DOM.board.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
    DOM.board.style.gridTemplateRows = `repeat(${boardSize}, 1fr)`;

    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
            const cellData = grid[r][c];
            const cellEl = document.createElement('div');
            cellEl.classList.add('cell');
            cellEl.dataset.r = r;
            cellEl.dataset.c = c;

            if (cellData) {
                cellEl.textContent = cellData.char;
                cellEl.id = `cell-${r}-${c}`;
            }

            cellEl.addEventListener('click', () => handleCellClick(r, c));
            DOM.board.appendChild(cellEl);
        }
    }
}

// ============================================================
// 游戏逻辑
// ============================================================

function pathText(path = currentPath) {
    return path.map(p => p.data.char).join('');
}

function remainingCopies(word) {
    return targetWords.filter(target => target === word).length - (foundWordCounts.get(word) || 0);
}

function matchingWords(prefix) {
    return [...new Set(targetWords)].filter(word => remainingCopies(word) > 0 && word.startsWith(prefix));
}

function wordPathKey(word, path) {
    const cells = path.map(p => p.r * boardSize + p.c);
    const forward = cells.join(',');
    const backward = cells.slice().reverse().join(',');
    // 同一物理路径正反都只能计一次，重复词仍需找到不同路径。
    return JSON.stringify([word, forward < backward ? forward : backward]);
}

function markPathError(cellEl) {
    cellEl.classList.add('error');
    setTimeout(() => cellEl.classList.remove('error'), 300);
}

function handleCellClick(r, c) {
    if (gamePhase !== 'playing') return;
    const cellData = grid[r] && grid[r][c];
    if (!cellData) return;
    const cellEl = document.getElementById(`cell-${r}-${c}`);
    if (!cellEl) return;
    if (!currentPath.length) {
        startNewPath(r, c, cellData, cellEl);
        return;
    }
    if (currentPath.some(p => p.r === r && p.c === c)) return;
    const last = currentPath[currentPath.length - 1];
    if (Math.abs(last.r - r) + Math.abs(last.c - c) !== 1) {
        resetCurrentPath();
        startNewPath(r, c, cellData, cellEl);
        return;
    }
    const prefix = pathText() + cellData.char;
    if (!matchingWords(prefix).length) {
        markPathError(cellEl);
        resetCurrentPath();
        return;
    }
    // 按可见文字判定，不再要求玩家猜格子的隐藏编号；点亮的字也可借用。
    currentPath.push({ r, c, data: cellData, el: cellEl });
    cellEl.classList.add('selected');
    DOM.currentWordDisplay.textContent = prefix;
    completeWord();
}

function startNewPath(r, c, cellData, cellEl) {
    if (!matchingWords(cellData.char).length) {
        markPathError(cellEl);
        return;
    }
    currentPath = [{ r, c, data: cellData, el: cellEl }];
    cellEl.classList.add('selected');
    DOM.currentWordDisplay.textContent = cellData.char;
    completeWord();
}

function resetCurrentPath() {
    currentPath.forEach(p => {
        p.el.classList.remove('selected');
    });
    currentPath = [];
    DOM.currentWordDisplay.textContent = '';
}

function completeWord() {
    const word = pathText();
    if (!word || remainingCopies(word) <= 0) return;
    const key = wordPathKey(word, currentPath);
    if (usedWordPaths.has(key)) {
        if (!matchingWords(word).some(candidate => candidate.length > word.length)) resetCurrentPath();
        return;
    }
    usedWordPaths.add(key);
    foundWordCounts.set(word, (foundWordCounts.get(word) || 0) + 1);
    currentPath.forEach(p => {
        p.el.classList.remove('selected');
        p.el.classList.add('done');
        p.data.done = true;
    });
    foundWordsCount++;
    DOM.remainingWords.textContent = totalWordsToFind - foundWordsCount;

    // 短词自动计分后仍可接成长词，无需给原界面增加确认按钮。
    if (!matchingWords(word).some(candidate => candidate.length > word.length)) resetCurrentPath();

    if (foundWordsCount >= totalWordsToFind) {
        gamePhase = 'won';
        DOM.btnHint.disabled = true;
        stopTimer();
        const generation = gameGeneration;
        pendingRoundTimeout = setTimeout(() => {
            if (generation === gameGeneration && gamePhase === 'won') DOM.winModal.classList.remove('hidden');
        }, 500);
    }
}

function showHint() {
    if (gamePhase !== 'playing') return;
    resetCurrentPath();
    for (let i = 0; i < targetWords.length; i++) {
        const word = targetWords[i];
        const path = targetPaths[i];
        if (remainingCopies(word) <= 0 || !path || !path.length || usedWordPaths.has(wordPathKey(word, path))) continue;
        const { r, c } = path[0];
        const el = document.getElementById(`cell-${r}-${c}`);
        DOM.currentWordDisplay.textContent = `试试连接「${word}」`;
        el.style.transform = 'scale(1.1)';
        el.style.backgroundColor = '#FFDE82';
        setTimeout(() => {
            el.style.transform = '';
            el.style.backgroundColor = '';
        }, 500);
        return;
    }
}

// Start
init();

// Register Service Worker for Offline PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Registration Failed', err));
    });
}
