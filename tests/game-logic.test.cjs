'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const generatorSource = fs.readFileSync(path.join(__dirname, '..', 'grid-worker.js'), 'utf8');

// 测试端独立寻找正交路径，给 Worker fake 提供与生成器相同的坐标格式。
function fixturePaths(words, rows) {
    const size = rows.length;
    const used = new Set();
    return words.map(word => {
        const chars = [...word];
        function search(r, c, trail) {
            if (r < 0 || c < 0 || r >= size || c >= size ||
                rows[r][c] !== chars[trail.length] || trail.some(p => p.r === r && p.c === c)) return null;
            const next = [...trail, { r, c }];
            if (next.length === chars.length) {
                const ids = next.map(p => p.r * size + p.c);
                const key = JSON.stringify([word, [ids.join(','), [...ids].reverse().join(',')].sort()[0]]);
                if (used.has(key)) return null;
                used.add(key);
                return next;
            }
            for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                const result = search(r + dr, c + dc, next);
                if (result) return result;
            }
            return null;
        }
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const result = search(r, c, []);
                if (result) return result;
            }
        }
        return [];
    });
}

// 只模拟脚本实际使用的 DOM；不改源码、不暴露生产环境测试入口。
class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.style = {};
        this.listeners = new Map();
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.id = '';
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const enabled = force === undefined ? !this.classes.has(name) : force;
                if (enabled) this.classes.add(name);
                else this.classes.delete(name);
                return enabled;
            }
        };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set innerHTML(value) {
        assert.equal(value, '', 'fake DOM 只支持清空容器');
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
        if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter(child => child !== this);
            this.parentNode = null;
        }
    }
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
}

function createGame(options = {}) {
    const ids = ['board', 'current-word-display', 'timer', 'btn-settings', 'btn-restart',
        'btn-hint', 'settings-modal', 'btn-close-settings', 'btn-save-settings',
        'btn-clear-storage', 'difficulty-select', 'word-list-input', 'win-modal',
        'btn-next-level', 'loading-overlay', 'toast-container', 'alert-modal',
        'alert-modal-msg', 'btn-alert-ok', 'lose-modal', 'lose-remaining', 'btn-try-again'];
    const roots = new Map(ids.map(id => {
        const element = new Element();
        element.id = id;
        if (id.endsWith('modal') || id === 'loading-overlay') element.classList.add('hidden');
        return [id, element];
    }));
    const remaining = new Element('span');
    const walk = (element, id) => element.id === id ? element :
        element.children.map(child => walk(child, id)).find(Boolean);
    const document = {
        head: new Element('head'),
        getElementById: id => roots.get(id) || walk(roots.get('board'), id) || null,
        querySelector: selector => {
            assert.equal(selector, '#remaining-words span');
            return remaining;
        },
        createElement: tag => new Element(tag)
    };
    const tasks = new Map();
    let nextTaskId = 1;
    const schedule = (callback, delay, kind) => {
        const id = nextTaskId++;
        tasks.set(id, { callback, delay, kind, canceled: false });
        return id;
    };
    const cancel = id => { if (tasks.has(id)) tasks.get(id).canceled = true; };
    const workers = [];
    const workerStats = { attempts: 0 };
    class Worker {
        constructor(url) {
            workerStats.attempts++;
            if (options.workerConstructionFails) throw new Error('模拟 Worker 构造失败');
            this.url = url;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(message) { this.request = message; }
        terminate() { this.terminated = true; }
    }
    const storage = new Map();
    if (options.words) storage.set('taichi_words', options.words.join('\n'));
    const context = vm.createContext({
        document, Worker, navigator: {}, window: { addEventListener() {} }, console,
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        confirm: () => false,
        requestAnimationFrame: callback => schedule(callback, 0, 'frame'),
        setTimeout: (callback, delay) => schedule(callback, delay, 'timeout'),
        clearTimeout: cancel,
        setInterval: (callback, delay) => schedule(callback, delay, 'interval'),
        clearInterval: cancel
    });
    // 浏览器的 window 就是全局对象，真实生成器向 globalThis 导出入口。
    context.window = context;
    context.addEventListener = () => {};
    vm.runInContext(source, context, { filename: 'script.js', timeout: 1000 });
    const evaluate = expression => vm.runInContext(expression, context, { timeout: 1000 });
    const load = (words, rows, metadata = {}) => {
        const size = rows.length;
        assert.ok(rows.every(row => [...row].length === size), '测试棋盘必须为正方形');
        context.fixture = rows.map((row, r) => [...row].map((char, c) => ({
            char, wordId: r * size + c,
            originWord: words.find(word => word.includes(char)) || '干扰文字', done: false,
            ...(metadata[`${r},${c}`] || {})
        })));
        roots.get('word-list-input').value = words.join('\n');
        evaluate(`boardSize = ${size}; startGame()`);
        workers.at(-1).onmessage({ data: {
            success: true, grid: context.fixture, targetWords: words,
            targetPaths: fixturePaths(words, rows), fallback: false
        } });
        assert.equal(evaluate('gamePhase'), 'playing');
    };
    const click = (...coordinates) => coordinates.forEach(([r, c]) => evaluate(`handleCellClick(${r}, ${c})`));
    const count = () => evaluate('foundWordsCount');
    const current = () => evaluate('currentPath.map(p => grid[p.r][p.c].char).join("")');
    const lastTask = (delay, kind = 'timeout') => [...tasks.values()]
        .filter(task => task.delay === delay && task.kind === kind && !task.canceled).at(-1);
    return { context, document, evaluate, load, click, count, current, roots, remaining,
        workers, workerStats, tasks, lastTask };
}

test('相邻正确文字可以跨隐藏 wordId 与 originWord 完成', () => {
    const game = createGame();
    game.load(['甲乙丙'], ['甲乙丙', '□□□', '□□□'], {
        '0,0': { originWord: '其他词' },
        '0,1': { originWord: '不相关' },
        '0,2': { originWord: '另一词' }
    });
    game.click([0, 0], [0, 1], [0, 2]);
    assert.equal(game.count(), 1);
    assert.equal(Number(game.remaining.textContent), 0);
    assert.equal(game.evaluate('foundWordCounts.get("甲乙丙")'), 1);
    assert.equal(game.evaluate('usedWordPaths.size'), 1);
});

test('已完成绿色格可以借用，且能完成第二个目标词', () => {
    const game = createGame();
    game.load(['甲乙', '丙乙'], ['甲乙□', '□丙□', '□□□']);
    game.click([0, 0], [0, 1]);
    assert.equal(game.count(), 1);
    assert.equal(game.evaluate('grid[0][1].done'), true);
    game.click([1, 1], [0, 1]);
    assert.equal(game.count(), 2);
});

test('重复目标词按数量完成，同一物理路径正反均不能重复计数', () => {
    const game = createGame();
    game.load(['甲乙甲', '甲乙甲'], ['甲乙甲', '□□□', '甲乙甲']);
    game.click([0, 0], [0, 1], [0, 2]);
    assert.equal(game.count(), 1);
    game.click([0, 2], [0, 1], [0, 0]);
    assert.equal(game.count(), 1, '回文词反向使用相同路径不能填充第二份目标');
    game.evaluate('resetCurrentPath()');
    game.click([0, 0], [0, 1], [0, 2]);
    assert.equal(game.count(), 1, '同方向重选也不能重复计数');
    game.evaluate('resetCurrentPath()');
    game.click([2, 0], [2, 1], [2, 2]);
    assert.equal(game.count(), 2, '另一条真实路径应完成重复词的剩余数量');
    assert.equal(Number(game.remaining.textContent), 0);
    assert.equal(game.evaluate('foundWordCounts.get("甲乙甲")'), 2);
    assert.equal(game.evaluate('remainingCopies("甲乙甲")'), 0);
    assert.equal(game.evaluate('usedWordPaths.size'), 2);
});

test('目标数量用完后，其他同文字路径不会超额计分', () => {
    const game = createGame();
    game.load(['甲乙', '丙丁'], ['甲乙□', '丙丁□', '甲乙□']);
    game.click([0, 0], [0, 1]);
    assert.equal(game.evaluate('gamePhase'), 'playing', '保留另一目标，避免胜利状态屏蔽超额计分检查');
    game.click([2, 0], [2, 1]);
    assert.equal(game.count(), 1);
    assert.equal(Number(game.remaining.textContent), 1);
});

test('点非首字不会开路；跳格到非首字也不能绕过首字验证', () => {
    const game = createGame();
    game.load(['甲乙'], ['甲□□', '□□□', '乙□□']);
    game.click([2, 0]);
    assert.equal(game.current(), '');
    game.click([0, 0]);
    assert.equal(game.current(), '甲');
    game.click([2, 0]);
    assert.equal(game.current(), '');
    assert.equal(game.count(), 0);
});

test('对角格和跳格不能拼成目标词', () => {
    for (const end of [[1, 1], [2, 0]]) {
        const game = createGame();
        const rows = end[0] === 1 ? ['甲□□', '□乙□', '□□□'] : ['甲□□', '□□□', '乙□□'];
        game.load(['甲乙'], rows);
        game.click([0, 0], end);
        assert.equal(game.count(), 0);
    }
});

test('同一格不能在一条路径中被重复使用', () => {
    const game = createGame();
    game.load(['甲乙甲'], ['甲乙□', '□□□', '□□□']);
    game.click([0, 0], [0, 1], [0, 0]);
    assert.equal(game.count(), 0);
});

test('单字和短词自动计分，同时保留剩余长词的前缀', () => {
    const game = createGame();
    game.load(['甲', '甲乙', '甲乙丙'], ['甲乙丙', '□□□', '□□□']);
    game.click([0, 0]);
    assert.equal(game.count(), 1);
    assert.equal(game.current(), '甲');
    game.click([0, 1]);
    assert.equal(game.count(), 2);
    assert.equal(game.current(), '甲乙');
    game.click([0, 2]);
    assert.equal(game.count(), 3);
    assert.equal(game.current(), '');
});

test('提示避开没有完整路径的首字，并允许从绿色格开始', () => {
    const game = createGame();
    game.load(['甲乙', '甲乙丙'], ['甲□□□', '□□甲乙', '□□□丙', '□□□□']);
    game.click([1, 2], [1, 3]);
    assert.equal(game.count(), 1);
    game.evaluate('showHint()');
    const hinted = game.roots.get('board').children.filter(element =>
        element.style.backgroundColor || element.style.transform || element.classList.contains('hint'));
    assert.ok(hinted.length > 0, '提示应留下可观察的高亮');
    assert.ok(hinted.some(element => element.id === 'cell-1-2'), '应提示真实未完成长词的起点');
    assert.ok(!hinted.some(element => element.id === 'cell-0-0'), '孤立首字不能作为提示');
    assert.equal(game.count(), 1, '提示不能自动计分');
});

test('旧 Worker 成功消息不能覆盖新局或终止新 Worker', () => {
    const game = createGame();
    const oldWorker = game.workers.at(-1);
    const oldMessage = oldWorker.onmessage;
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    const snapshot = game.evaluate('JSON.stringify(grid)');
    game.evaluate('startGame()');
    const newWorker = game.workers.at(-1);
    oldMessage({ data: { success: true, grid: [], targetWords: ['旧局'], fallback: false } });
    assert.equal(game.evaluate('JSON.stringify(grid)'), snapshot);
    assert.equal(newWorker.terminated, false);
    assert.equal(game.roots.get('btn-restart').disabled, true);
});

test('新局重置完成数量和路径记录，加载期间禁止点击旧棋盘', () => {
    const game = createGame();
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    game.click([0, 0], [0, 1]);
    assert.equal(game.count(), 1);
    game.evaluate('startGame()');
    game.click([0, 0]);
    assert.equal(game.current(), '');
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    assert.equal(game.count(), 0);
    assert.equal(game.evaluate('foundWordCounts.size'), 0);
    assert.equal(game.evaluate('usedWordPaths.size'), 0);
    game.click([0, 0], [0, 1]);
    assert.equal(game.count(), 1);
});

test('重复词提示跳过已用路径，指向剩余那一份', () => {
    const game = createGame();
    game.load(['甲乙甲', '甲乙甲'], ['甲乙甲', '□□□', '甲乙甲']);
    game.click([0, 0], [0, 1], [0, 2]);
    game.evaluate('showHint()');
    assert.equal(game.document.getElementById('cell-0-0').style.backgroundColor, undefined);
    assert.ok(game.document.getElementById('cell-2-0').style.backgroundColor);
    assert.equal(game.count(), 1);
});

test('旧 Worker 错误与已排队的超时回调不能干扰新局', () => {
    for (const event of ['error', 'timeout']) {
        const game = createGame();
        const oldWorker = game.workers.at(-1);
        const oldError = oldWorker.onerror;
        const oldCallback = event === 'error' ? () => oldError({ message: '旧错误' }) :
            game.lastTask(8000).callback;
        game.evaluate('startGame()');
        const newWorker = game.workers.at(-1);
        oldCallback();
        assert.equal(newWorker.terminated, false, `${event} 不得终止新 Worker`);
        assert.equal(game.roots.get('btn-restart').disabled, true);
        assert.ok(!game.lastTask(500), `${event} 不得安排旧局重试`);
    }
});

test('旧 Worker 的延迟重试或异步回退不能在手动新局后重新开局', async () => {
    const game = createGame();
    game.workers.at(-1).onerror({ message: '生成失败' });
    const retry = game.lastTask(500);
    const loader = game.document.head.children.at(-1);
    assert.ok(retry || loader, '失败后应进入延迟重试或脚本回退');
    game.evaluate('startGame()');
    const workerCount = game.workers.length;
    let fallbackCalls = 0;
    if (retry) retry.callback();
    else {
        game.context.window.TaiChiGrid = {
            generate() {
                fallbackCalls++;
                return { success: true, grid: [], targetWords: ['旧局'] };
            }
        };
        loader.onload();
        await Promise.resolve();
        await Promise.resolve();
    }
    assert.equal(game.workers.length, workerCount);
    assert.equal(fallbackCalls, 0, '旧局回退不得生成并应用旧棋盘');
});

test('倒计时结束弹出失败窗口，保留棋盘直到主动重试', () => {
    const game = createGame();
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    const snapshot = game.evaluate('JSON.stringify(grid)');
    const workerCount = game.workers.length;
    game.evaluate('timerSeconds = 11; updateTimerUI()');
    assert.equal(game.roots.get('timer').classList.contains('timer-warning'), false);
    game.lastTask(1000, 'interval').callback();
    assert.equal(game.roots.get('timer').classList.contains('timer-warning'), true,
        '倒计时到十秒时开始反复提醒');
    game.evaluate('timerSeconds = 1');
    game.lastTask(1000, 'interval').callback();
    assert.equal(game.evaluate('gamePhase'), 'expired');
    assert.equal(game.roots.get('timer').classList.contains('timer-warning'), false,
        '归零后停止闪动，失败窗口负责提示');
    assert.equal(game.roots.get('lose-modal').classList.contains('hidden'), false);
    assert.equal(Number(game.roots.get('lose-remaining').textContent), 1);
    assert.equal(game.evaluate('JSON.stringify(grid)'), snapshot);
    assert.ok(!game.lastTask(1500), '时间到不得自动换局');
    assert.equal(game.workers.length, workerCount);
    game.click([0, 0], [0, 1]);
    assert.equal(game.count(), 0, '失败后不能继续计分');
    const retry = [...game.roots.get('btn-try-again').listeners.get('click')][0];
    retry();
    assert.equal(game.workers.length, workerCount + 1);
    assert.equal(game.roots.get('lose-modal').classList.contains('hidden'), true);
});

test('旧局胜利延迟回调不能让新局弹出胜利窗口', () => {
    const game = createGame();
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    game.click([0, 0], [0, 1]);
    const win = game.lastTask(500);
    assert.ok(win, '完成目标应安排胜利窗口');
    game.evaluate('startGame()');
    win.callback();
    assert.equal(game.roots.get('win-modal').classList.contains('hidden'), true);
});

function triggerFallback(game, failure) {
    const worker = game.workers.at(-1);
    const timeout = game.lastTask(8000)?.callback;
    const error = worker?.onerror;
    if (failure === '运行错误') error({ message: '模拟 Worker 运行错误', preventDefault() {} });
    if (failure === '超时') timeout();
    // 故意重复调用已取消/已排队的回调，验证一次回退的保护。
    const repeat = () => {
        error?.({ message: '重复错误', preventDefault() {} });
        timeout?.();
    };
    repeat();
    return repeat;
}

async function loadRealGenerator(game) {
    assert.equal(game.document.head.children.length, 1, '动态生成器脚本只能加载一次');
    const loader = game.document.head.children[0];
    assert.equal(loader.src, './grid-worker.js');
    vm.runInContext(generatorSource, game.context, { filename: 'grid-worker.js', timeout: 1000 });
    const generate = game.context.TaiChiGrid.generate;
    const stats = { calls: 0, results: [] };
    game.context.TaiChiGrid.generate = (...args) => {
        stats.calls++;
        const result = generate(...args);
        stats.results.push(result);
        return result;
    };
    loader.onload();
    // 等待 script.onload 兑现的 Promise 与 finish，避免真实 sleep。
    await Promise.resolve();
    await Promise.resolve();
    return stats;
}

function assertNoAutomaticRetry(game) {
    assert.equal(game.workerStats.attempts, 1, '回退期间不得重复构造 Worker');
    assert.equal(game.document.head.children.length, 1);
    assert.ok(!game.lastTask(8000), '旧 Worker 超时必须取消');
    assert.ok(!game.lastTask(500), '不得安排重复生成重试');
    assert.ok(!game.lastTask(1500), '不得安排自动开局重试');
}

for (const failure of ['构造失败', '运行错误', '超时']) {
    test(`集成：Worker ${failure}后真实生成器仅运行一次并渲染6x6`, async () => {
        const game = createGame({ workerConstructionFails: failure === '构造失败' });
        const repeat = triggerFallback(game, failure);
        assert.equal(game.evaluate('gamePhase'), 'loading');
        const stats = await loadRealGenerator(game);
        repeat();
        await Promise.resolve();
        assert.equal(stats.calls, 1);
        assert.equal(stats.results[0].success, true);
        assert.equal(game.evaluate('gamePhase'), 'playing');
        assert.equal(game.roots.get('board').children.length, 36);
        assert.equal(game.roots.get('board').style.gridTemplateColumns, 'repeat(6, 1fr)');
        assert.equal(game.evaluate('grid.length === 6 && grid.every(row => row.length === 6)'), true);
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                assert.equal(game.document.getElementById(`cell-${r}-${c}`).textContent,
                    stats.results[0].grid[r][c].char);
            }
        }
        assert.ok(game.evaluate('targetWords.length > 0 && targetPaths.length === targetWords.length'));
        assert.equal(game.evaluate('JSON.stringify(grid)'), JSON.stringify(stats.results[0].grid));
        assert.equal(Number(game.remaining.textContent), stats.results[0].targetWords.length);
        assert.equal(game.roots.get('loading-overlay').classList.contains('hidden'), true);
        assert.equal(game.roots.get('btn-restart').disabled, false);
        assert.equal(game.roots.get('btn-hint').disabled, false);
        assert.ok(game.lastTask(1000, 'interval'), '成功回退后应启动正常倒计时');
        assertNoAutomaticRetry(game);
    });

    test(`集成：Worker ${failure}且全超长词库只报告一次明确错误并恢复重玩`, async () => {
        const game = createGame({
            workerConstructionFails: failure === '构造失败',
            words: ['甲'.repeat(37), '乙'.repeat(40)]
        });
        const repeat = triggerFallback(game, failure);
        const stats = await loadRealGenerator(game);
        repeat();
        await Promise.resolve();
        assert.equal(stats.calls, 1);
        assert.equal(stats.results[0].success, false);
        assert.match(stats.results[0].error, /所有词都超过棋盘容量/);
        assert.equal(game.evaluate('gamePhase'), 'error');
        assert.match(game.roots.get('alert-modal-msg').textContent, /棋盘生成失败.*所有词都超过棋盘容量/);
        assert.equal(game.roots.get('alert-modal').classList.contains('hidden'), false);
        assert.equal(game.roots.get('btn-alert-ok').listeners.get('click').size, 1,
            '只允许一次错误弹窗监听器，不能重复报告');
        assert.equal(game.roots.get('loading-overlay').classList.contains('hidden'), true);
        assert.equal(game.roots.get('btn-restart').disabled, false);
        assert.equal(game.roots.get('btn-hint').disabled, true);
        assert.equal(game.roots.get('board').children.length, 0);
        assert.ok(!game.lastTask(1000, 'interval'), '失败局不能启动倒计时');
        assertNoAutomaticRetry(game);
    });
}

test('集成：旧局回退脚本到达及旧错误/超时不能覆盖已就绪新局', async () => {
    const game = createGame();
    const repeat = triggerFallback(game, '运行错误');
    game.load(['甲乙'], ['甲乙□', '□□□', '□□□']);
    const snapshot = game.evaluate('JSON.stringify([grid, targetWords, targetPaths])');
    const attempts = game.workerStats.attempts;
    const stats = await loadRealGenerator(game);
    repeat();
    await Promise.resolve();
    assert.equal(stats.calls, 0, '旧局的脚本加载完成后不得执行过期生成');
    assert.equal(game.workerStats.attempts, attempts);
    assert.equal(game.evaluate('JSON.stringify([grid, targetWords, targetPaths])'), snapshot);
    assert.equal(game.evaluate('gamePhase'), 'playing');
    assert.equal(game.roots.get('board').children.length, 9);
    assert.equal(game.roots.get('btn-restart').disabled, false);
    assert.equal(game.roots.get('btn-hint').disabled, false);
    assert.equal(game.roots.get('alert-modal').classList.contains('hidden'), true);
});
