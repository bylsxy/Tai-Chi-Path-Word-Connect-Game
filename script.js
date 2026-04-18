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
let currentWordIndex = -1;
let currentWordProgress = 0;
let foundWordsCount = 0;
let totalWordsToFind = 0;

let timerInterval = null;
let timerSeconds = 0;

// Web Worker 实例（延迟初始化）
let gridWorker = null;
let workerTimeout = null;

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

    if (savedSize) {
        boardSize = parseInt(savedSize, 10);
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
}

function startTimer() {
    stopTimer();
    timerSeconds = 60 * (boardSize === 6 ? 1 : boardSize === 8 ? 2 : 3);
    updateTimerUI();

    timerInterval = setInterval(() => {
        timerSeconds--;
        updateTimerUI();
        if (timerSeconds <= 0) {
            stopTimer();
            showToast("⏰ 时间到！自动重新开始");
            setTimeout(() => startGame(), 1500);
        }
    }, 1000);
}

function updateTimerUI() {
    DOM.timer.textContent = timerSeconds;
}

// ============================================================
// 游戏启动 — 使用 Web Worker 异步生成棋盘
// ============================================================

function startGame() {
    stopTimer();
    DOM.winModal.classList.add('hidden');

    const wordsRaw = DOM.wordListInput.value.split('\n').map(w => w.trim()).filter(w => w.length > 0);
    const pool = wordsRaw.length > 0 ? wordsRaw : defaultWords;
    const targetSize = boardSize * boardSize;

    // 显示加载动画
    showLoading(true);

    // 禁用按钮防止重复点击
    DOM.btnRestart.disabled = true;
    DOM.btnHint.disabled = true;

    // 终止之前的 Worker（如果存在）
    if (gridWorker) {
        gridWorker.terminate();
        gridWorker = null;
    }
    if (workerTimeout) {
        clearTimeout(workerTimeout);
        workerTimeout = null;
    }

    // 创建新的 Worker
    gridWorker = new Worker('./grid-worker.js');

    // 设置超时保护：8秒后如果 Worker 还没返回，强制终止
    workerTimeout = setTimeout(() => {
        if (gridWorker) {
            gridWorker.terminate();
            gridWorker = null;
        }
        showLoading(false);
        DOM.btnRestart.disabled = false;
        DOM.btnHint.disabled = false;
        showToast("⚠️ 生成超时，正在重试…");
        setTimeout(() => startGame(), 500);
    }, 8000);

    // Worker 返回结果
    gridWorker.onmessage = (e) => {
        clearTimeout(workerTimeout);
        workerTimeout = null;
        gridWorker.terminate();
        gridWorker = null;

        const { success, grid: newGrid, targetWords: newTargetWords, fallback, error } = e.data;

        if (!success) {
            showLoading(false);
            DOM.btnRestart.disabled = false;
            DOM.btnHint.disabled = false;
            showAlert("棋盘生成失败：" + (error || "未知错误")).then(() => startGame());
            return;
        }

        if (fallback) {
            showToast("词语难以排布，已使用简单布局");
        }

        // 应用生成结果
        grid = newGrid;
        targetWords = newTargetWords;
        totalWordsToFind = targetWords.length;
        foundWordsCount = 0;

        DOM.remainingWords.textContent = totalWordsToFind;

        // 渲染棋盘
        renderBoard();

        // 初始化游戏状态
        currentPath = [];
        currentWordIndex = -1;
        currentWordProgress = 0;

        // 隐藏加载、恢复按钮
        showLoading(false);
        DOM.btnRestart.disabled = false;
        DOM.btnHint.disabled = false;

        // 启动计时器
        startTimer();
    };

    // Worker 错误处理
    gridWorker.onerror = (err) => {
        clearTimeout(workerTimeout);
        workerTimeout = null;
        if (gridWorker) {
            gridWorker.terminate();
            gridWorker = null;
        }
        showLoading(false);
        DOM.btnRestart.disabled = false;
        DOM.btnHint.disabled = false;
        console.error('Grid Worker Error:', err);
        showToast("⚠️ 生成出错，正在重试…");
        setTimeout(() => startGame(), 500);
    };

    // 发送任务给 Worker
    gridWorker.postMessage({ pool, boardSize, targetSize });
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

function handleCellClick(r, c) {
    const cellData = grid[r][c];
    if (!cellData || cellData.done) return;

    const cellEl = document.getElementById(`cell-${r}-${c}`);

    // 1. If no word is currently being formed
    if (currentPath.length === 0) {
        // Enforce that a path must begin with the first character of the assigned word instance
        if (cellData.char !== cellData.originWord[0]) {
            cellEl.classList.add('error');
            setTimeout(() => cellEl.classList.remove('error'), 300);
            return;
        }
        startNewPath(r, c, cellData, cellEl);
        return;
    }

    // 2. Check Adjacency
    const lastCellRaw = currentPath[currentPath.length - 1];
    const dx = Math.abs(lastCellRaw.r - r);
    const dy = Math.abs(lastCellRaw.c - c);

    // Must be orthogonally adjacent
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) {
        // Not adjacent, reset and start new path
        resetCurrentPath(true);
        startNewPath(r, c, cellData, cellEl);
        return;
    }

    // 3. Check if cell is already in the path
    if (currentPath.some(p => p.r === r && p.c === c)) {
        return;
    }

    // 4. Validate next character of the word
    const targetWordStr = currentPath[0].data.originWord;
    const targetWordId = currentPath[0].data.wordId;
    const expectedChar = targetWordStr[currentPath.length];

    if (cellData.char === expectedChar && cellData.wordId === targetWordId) {
        currentPath.push({ r, c, data: cellData, el: cellEl });
        cellEl.classList.add('selected');
        DOM.currentWordDisplay.textContent = currentPath.map(p => p.data.char).join('');

        // Check if word completed
        if (currentPath.length === targetWordStr.length) {
            completeWord();
        }
    } else {
        // Error!
        cellEl.classList.add('error');
        setTimeout(() => cellEl.classList.remove('error'), 300);
        resetCurrentPath(true);
    }
}

function startNewPath(r, c, cellData, cellEl) {
    currentPath = [{ r, c, data: cellData, el: cellEl }];
    cellEl.classList.add('selected');
    DOM.currentWordDisplay.textContent = cellData.char;

    // If it's a 1-character word
    if (cellData.originWord.length === 1) {
        completeWord();
    }
}

function resetCurrentPath(isError = false) {
    currentPath.forEach(p => {
        p.el.classList.remove('selected');
    });
    currentPath = [];
    DOM.currentWordDisplay.textContent = '';
}

function completeWord() {
    currentPath.forEach(p => {
        p.el.classList.remove('selected');
        p.el.classList.add('done');
        p.data.done = true;
    });
    currentPath = [];
    foundWordsCount++;
    DOM.remainingWords.textContent = totalWordsToFind - foundWordsCount;

    if (foundWordsCount >= totalWordsToFind) {
        stopTimer();
        setTimeout(() => {
            DOM.winModal.classList.remove('hidden');
        }, 500);
    }
}

function showHint() {
    // Find a word that is not done yet
    if (currentPath.length > 0) {
        resetCurrentPath();
    }

    // naive scan for not done
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
            if (grid[r][c] && !grid[r][c].done) {
                const el = document.getElementById(`cell-${r}-${c}`);
                el.style.transform = 'scale(1.1)';
                el.style.backgroundColor = '#FFDE82';
                setTimeout(() => {
                    el.style.transform = '';
                    el.style.backgroundColor = '';
                }, 500);
                return; // just hint the first one we find
            }
        }
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
