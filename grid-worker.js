/**
 * grid-worker.js
 * Web Worker — 在独立线程中执行棋盘生成的 DFS 回溯计算，
 * 避免阻塞主线程导致平板设备卡死。
 */

self.addEventListener('message', (e) => {
    const { pool, boardSize, targetSize } = e.data;

    try {
        // 1. 选词填满棋盘
        const targetWords = selectWordsToFill(pool, targetSize);

        // 2. DFS 生成棋盘布局
        let grid = null;
        let generated = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 50; // 降低重试上限（原来100次太多）

        while (!generated && attempts < MAX_ATTEMPTS) {
            const result = generateGridLayout(targetWords, boardSize);
            if (result) {
                grid = result;
                generated = true;
            }
            attempts++;
        }

        // 3. 如果 DFS 失败，用线性填充作为后备
        if (!generated) {
            grid = fillWithRandomGrid(targetWords, boardSize);
            self.postMessage({
                success: true,
                grid: grid,
                targetWords: targetWords,
                fallback: true
            });
            return;
        }

        self.postMessage({
            success: true,
            grid: grid,
            targetWords: targetWords,
            fallback: false
        });
    } catch (err) {
        self.postMessage({
            success: false,
            error: err.message
        });
    }
});

function selectWordsToFill(pool, targetSum) {
    let selected = [];
    let currentSum = 0;
    let attempts = 0;
    const MAX_OUTER = 200; // 从1000降到200

    while (currentSum !== targetSum && attempts < MAX_OUTER) {
        selected = [];
        currentSum = 0;

        let localAttempts = 0;
        const MAX_INNER = 200; // 从1000降到200
        while (currentSum < targetSum && localAttempts < MAX_INNER) {
            let validWords = pool.filter(w => currentSum + w.length <= targetSum);
            if (validWords.length === 0) break;

            let w = validWords[Math.floor(Math.random() * validWords.length)];
            selected.push(w);
            currentSum += w.length;
            localAttempts++;
            if (currentSum === targetSum) break;
        }
        attempts++;
    }

    // 用单字填充剩余空间
    if (currentSum < targetSum) {
        const paddingChars = "太极八卦两仪四象阴阳虚实刚柔动静";
        while (currentSum < targetSum) {
            selected.push(paddingChars[Math.floor(Math.random() * paddingChars.length)]);
            currentSum++;
        }
    }

    return selected;
}

function generateGridLayout(targetWords, boardSize) {
    let grid = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));

    const sortedWords = [...targetWords].sort((a, b) => b.length - a.length);

    let ops = 0;
    const MAX_OPS = 1500; // 从2000降到1500，平板足够快又不卡

    function placeWord(wordIdx) {
        if (ops > MAX_OPS) return false;
        ops++;

        if (wordIdx === sortedWords.length) {
            return true;
        }

        const word = sortedWords[wordIdx];

        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (grid[r][c] === null) {
                    const path = [];
                    if (dfsWordPlace(word, wordIdx, 0, r, c, path)) {
                        if (placeWord(wordIdx + 1)) return true;
                        // 回溯
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

        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return false;
        if (grid[r][c] !== null) return false;

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

        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]].sort(() => 0.5 - Math.random());

        for (let [dr, dc] of dirs) {
            if (dfsWordPlace(word, wordIdx, charIdx + 1, r + dr, c + dc, currentWordPath)) {
                return true;
            }
        }

        grid[r][c] = null;
        currentWordPath.pop();
        return false;
    }

    if (placeWord(0)) {
        return grid;
    }
    return null;
}

function fillWithRandomGrid(targetWords, boardSize) {
    let grid = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));
    let flatIdx = 0;
    let wordIdx = 0;
    for (let w of targetWords) {
        for (let char of w) {
            if (flatIdx >= boardSize * boardSize) return grid;
            let r = Math.floor(flatIdx / boardSize);
            let c = flatIdx % boardSize;
            grid[r][c] = { char: char, originWord: w, wordId: wordIdx, done: false, r: r, c: c, id: r * boardSize + c };
            flatIdx++;
        }
        wordIdx++;
    }
    return grid;
}
