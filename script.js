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
    btnNextLevel: document.getElementById('btn-next-level')
};

// Application Init
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
        if (confirm("确定要恢复默认设置吗？这将清空您自定义的词语列表。")) {
            localStorage.removeItem('taichi_words');
            localStorage.removeItem('taichi_size');
            loadSettings();
            DOM.settingsModal.classList.add('hidden');
            startGame();
        }
    });
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function startTimer() {
    stopTimer();
    timerSeconds = 60 * (boardSize === 6 ? 1 : boardSize === 8 ? 2 : 3); // 60s, 120s, 180s depending on mode
    updateTimerUI();

    timerInterval = setInterval(() => {
        timerSeconds--;
        updateTimerUI();
        if (timerSeconds <= 0) {
            stopTimer();
            // TODO: handle game over?
            alert("时间到! 自动重新开始。");
            startGame();
        }
    }, 1000);
}

function updateTimerUI() {
    DOM.timer.textContent = timerSeconds;
}

function startGame() {
    stopTimer();
    DOM.winModal.classList.add('hidden');

    // 1. Pick words that exact sum to N*N
    const wordsRaw = DOM.wordListInput.value.split('\n').map(w => w.trim()).filter(w => w.length > 0);
    const pool = wordsRaw.length > 0 ? wordsRaw : defaultWords;

    const targetSize = boardSize * boardSize;
    targetWords = selectWordsToFill(pool, targetSize);
    totalWordsToFind = targetWords.length;
    foundWordsCount = 0;

    DOM.remainingWords.textContent = totalWordsToFind;

    // 2. Generate Grid using DFS
    let generated = false;
    let attempts = 0;
    while (!generated && attempts < 100) {
        generated = generateGridLayout();
        attempts++;
    }

    if (!generated) {
        alert("无法生成棋盘，可能是因为词语组合太难排布。试试更小的词或更大的棋盘！我们将用随机字填充剩余空格。");
        // Fallback or retry logic
        fillWithRandomGrid();
    }

    // 3. Render
    renderBoard();

    // 4. Start play state
    currentPath = [];
    currentWordIndex = -1;
    currentWordProgress = 0;
    startTimer();
}

function selectWordsToFill(pool, targetSum) {
    let selected = [];
    let currentSum = 0;
    let attempts = 0;

    // Continuously pull words from the pool until the targetSum is reached.
    // Pool allows repeating words.
    while (currentSum !== targetSum && attempts < 1000) {
        selected = [];
        currentSum = 0;

        let localAttempts = 0;
        while (currentSum < targetSum && localAttempts < 1000) {
            // Find words in pool that still fit
            let validWords = pool.filter(w => currentSum + w.length <= targetSum);
            if (validWords.length === 0) break; // no words can fit anymore (gap too small)

            let w = validWords[Math.floor(Math.random() * validWords.length)];
            selected.push(w);
            currentSum += w.length;
            localAttempts++;
            if (currentSum === targetSum) break;
        }
        attempts++;
    }

    // If exact sum not reachable (e.g. gap of 1 but no length-1 words in pool), pad remainder with 1-char arbitrary words
    if (currentSum < targetSum) {
        const paddingChars = "太极八卦两仪四象阴阳虚实刚柔动静";
        while (currentSum < targetSum) {
            selected.push(paddingChars[Math.floor(Math.random() * paddingChars.length)]);
            currentSum++;
        }
    }

    return selected;
}

function generateGridLayout() {
    // Initialize empty grid
    grid = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));

    // Sort words longer first might be easier to place
    const sortedWords = [...targetWords].sort((a, b) => b.length - a.length);

    // Metadata for each word: the cells it takes
    const wordPaths = [];

    // Limit maximum operations to prevent infinite backtracking freeze
    let ops = 0;
    const MAX_OPS = 2000;

    // Recursive DFS for exact grid fill (Hamiltonian-ish path approach per word)
    function placeWord(wordIdx) {
        if (ops > MAX_OPS) return false;
        ops++;

        if (wordIdx === sortedWords.length) {
            return true; // All words placed!
        }

        const word = sortedWords[wordIdx];

        // Find a starting point
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (grid[r][c] === null) {
                    // Try to place word starting at (r, c)
                    const path = [];
                    if (dfsWordPlace(word, wordIdx, 0, r, c, path)) {
                        wordPaths.push({ word: word, path: [...path] });
                        if (placeWord(wordIdx + 1)) return true;

                        // Backtrack
                        wordPaths.pop();
                        // dfsWordPlace cleaned up grid automatically on fail, but on success we must revert
                        path.forEach(p => { grid[p.r][p.c] = null; });
                    }
                }
            }
        }
        return false;
    }

    function dfsWordPlace(word, wordIdx, charIdx, r, c, currentWordPath) {
        if (ops > MAX_OPS) return false;
        ops++;

        if (charIdx === word.length) return true;

        // Bounds and empty check
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return false;
        if (grid[r][c] !== null) return false;

        // Place character
        grid[r][c] = {
            char: word[charIdx],
            originWord: word,
            wordId: wordIdx,
            done: false,
            r: r,
            c: c,
            id: r * boardSize + c
        };
        currentWordPath.push({ r, c });

        if (charIdx === word.length - 1) return true;

        // Try directions (shuffle to make paths random)
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]].sort(() => 0.5 - Math.random());

        for (let [dr, dc] of dirs) {
            if (dfsWordPlace(word, wordIdx, charIdx + 1, r + dr, c + dc, currentWordPath)) {
                return true;
            }
        }

        // Backtrack
        grid[r][c] = null;
        currentWordPath.pop();
        return false;
    }

    return placeWord(0);
}

function fillWithRandomGrid() {
    // If generator fails, just dump them linearly
    grid = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));
    let flatIdx = 0;
    const allChars = targetWords.join('');
    // shuffle chars? No, they need to be grouped as words to be playable.
    // However, if we dump them linearly they are trivial.
    // This is just a simple fallback to prevent crashes.
    let wordIdx = 0;
    for (let w of targetWords) {
        for (let char of w) {
            if (flatIdx >= boardSize * boardSize) return;
            let r = Math.floor(flatIdx / boardSize);
            let c = flatIdx % boardSize;
            grid[r][c] = { char: char, originWord: w, wordId: wordIdx, done: false, r: r, c: c, id: r * boardSize + c };
            flatIdx++;
        }
        wordIdx++;
    }
}

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
        // Not adjacent, invalid click OR starting new? 
        // Let's reset path
        resetCurrentPath(true);
        startNewPath(r, c, cellData, cellEl);
        return;
    }

    // 3. Check if cell is already in the path
    if (currentPath.some(p => p.r === r && p.c === c)) {
        // clicked self or previous, ignore broadly
        return;
    }

    // 4. Validate next character of the word
    const targetWordStr = currentPath[0].data.originWord; // We lock into the word of the first clicked cell
    const targetWordId = currentPath[0].data.wordId;      // We lock into the specific instance initially generated
    const expectedChar = targetWordStr[currentPath.length];

    if (cellData.char === expectedChar && cellData.wordId === targetWordId) {
        // Success match logically

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

    // If it's a 1-character word??
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
    // Identify the first character block
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
