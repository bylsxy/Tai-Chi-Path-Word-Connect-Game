/** 棋盘生成器：Worker 与主线程动态 script 共用同一入口。 */
(function (root) {
    'use strict';

    const DFS_LIMIT = 4000;
    const PADDING = Array.from('太极八卦两仪四象阴阳虚实刚柔动静');

    function shuffle(values) {
        for (let i = values.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [values[i], values[j]] = [values[j], values[i]];
        }
        return values;
    }

    function cell(char, word, wordId, charIndex, r, c, size) {
        return { char, originWord: word, wordId, charIndex, done: false,
            r, c, id: r * size + c };
    }

    function generate(pool, boardSize) {
        try {
            if (![6, 8, 10].includes(boardSize)) {
                throw new Error('boardSize 必须为 6、8 或 10');
            }
            if (!Array.isArray(pool) || pool.length === 0) {
                throw new Error('pool 必须为非空词库数组');
            }
            const capacity = boardSize * boardSize;
            const groups = new Map();
            for (const word of pool) {
                if (typeof word !== 'string' || word.trim().length === 0) {
                    throw new Error('词库中的词必须为非空字符串');
                }
                const chars = Array.from(word);
                if (chars.length > capacity) continue;
                if (!groups.has(chars.length)) groups.set(chars.length, []);
                groups.get(chars.length).push({ word, chars });
            }
            if (groups.size === 0) {
                throw new Error('词库中的所有词都超过棋盘容量');
            }

            // 完全背包只计算一次可达容量，不通过随机重试寻找整除组合。
            const lengths = [...groups.keys()];
            const reachable = Array(capacity + 1).fill(false);
            reachable[0] = true;
            let selectionOps = 0;
            for (let sum = 1; sum <= capacity; sum++) {
                for (const length of lengths) {
                    selectionOps++;
                    if (length <= sum && reachable[sum - length]) {
                        reachable[sum] = true;
                        break;
                    }
                }
            }
            let covered = capacity;
            while (!reachable[covered]) covered--;
            const selected = [];
            for (let remaining = covered; remaining > 0;) {
                const choices = lengths.filter(length => {
                    selectionOps++;
                    return length <= remaining && reachable[remaining - length];
                });
                const length = choices[Math.floor(Math.random() * choices.length)];
                const words = groups.get(length);
                selected.push(words[Math.floor(Math.random() * words.length)]);
                remaining -= length;
            }

            let grid = Array.from({ length: boardSize }, () => Array(boardSize).fill(null));
            let targetPaths = [];
            let dfsOps = 0;
            function spend() {
                if (dfsOps >= DFS_LIMIT) return false;
                dfsOps++;
                return true;
            }
            function search(entry, wordId, index, r, c, path) {
                if (!spend()) return false;
                if (r < 0 || c < 0 || r >= boardSize || c >= boardSize || grid[r][c]) {
                    return false;
                }
                grid[r][c] = cell(entry.chars[index], entry.word, wordId, index, r, c, boardSize);
                path.push({ r, c });
                if (index + 1 === entry.chars.length) return true;
                for (const [dr, dc] of shuffle([[0, 1], [1, 0], [0, -1], [-1, 0]])) {
                    if (search(entry, wordId, index + 1, r + dr, c + dc, path)) return true;
                    if (dfsOps >= DFS_LIMIT) break;
                }
                grid[r][c] = null;
                path.pop();
                return false;
            }

            let fallback = false;
            for (let wordId = 0; wordId < selected.length; wordId++) {
                const starts = shuffle(Array.from({ length: capacity }, (_, id) => id));
                const path = [];
                let placed = false;
                for (const id of starts) {
                    if (search(selected[wordId], wordId, 0,
                        Math.floor(id / boardSize), id % boardSize, path)) {
                        placed = true;
                        break;
                    }
                    if (dfsOps >= DFS_LIMIT) break;
                }
                if (!placed) {
                    fallback = true;
                    break;
                }
                targetPaths.push(path);
            }

            if (fallback) {
                // 蛇形是覆盖全部格子的连续路径，跨行时仍保持上下邻接。
                grid = Array.from({ length: boardSize }, () => Array(boardSize).fill(null));
                targetPaths = [];
                let offset = 0;
                selected.forEach((entry, wordId) => {
                    const path = [];
                    entry.chars.forEach((char, charIndex) => {
                        const r = Math.floor(offset / boardSize);
                        const column = offset % boardSize;
                        const c = r % 2 === 0 ? column : boardSize - 1 - column;
                        grid[r][c] = cell(char, entry.word, wordId, charIndex, r, c, boardSize);
                        path.push({ r, c });
                        offset++;
                    });
                    targetPaths.push(path);
                });
            }

            // 配字只装饰剩余格子，不能冒充词库目标或目标路径的一部分。
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (!grid[r][c]) {
                        grid[r][c] = cell(PADDING[Math.floor(Math.random() * PADDING.length)],
                            null, -1, -1, r, c, boardSize);
                    }
                }
            }
            return { success: true, grid, targetWords: selected.map(entry => entry.word),
                fallback, targetPaths, fillerCount: capacity - covered,
                operations: { selection: selectionOps, dfs: dfsOps, dfsLimit: DFS_LIMIT } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    root.TaiChiGrid = { generate };
    // 主页面有 window，不能给它安装 Worker 的 message 监听器。
    if (typeof window === 'undefined' && typeof self !== 'undefined'
        && typeof self.addEventListener === 'function' && typeof self.postMessage === 'function') {
        self.addEventListener('message', event => {
            const data = event.data || {};
            self.postMessage(generate(data.pool, data.boardSize));
        });
    }
})(globalThis);
