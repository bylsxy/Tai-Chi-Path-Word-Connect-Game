'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'grid-worker.js'), 'utf8');

function runtime(seed = 1, mode = 'node') {
    let state = seed >>> 0;
    let randomCalls = 0;
    const math = Object.create(Math);
    math.random = () => {
        randomCalls++;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const listeners = [];
    const messages = [];
    const context = { Math: math };
    if (mode !== 'node') {
        context.self = {
            addEventListener: (type, handler) => listeners.push({ type, handler }),
            postMessage: message => messages.push(message)
        };
    }
    if (mode === 'page') context.window = context.self;
    vm.createContext(context);
    vm.runInContext(source, context, { timeout: 1000 });
    return {
        generate: (pool, size) => context.TaiChiGrid.generate(pool, size),
        listeners, messages, randomCalls: () => randomCalls
    };
}

function verify(result, pool, size) {
    assert.equal(result.success, true);
    assert.equal(typeof result.fallback, 'boolean');
    assert.equal(result.grid.length, size);
    assert.equal(result.targetPaths.length, result.targetWords.length);
    assert.ok(result.targetWords.length > 0);
    const occupied = new Set();
    const signatures = new Set();
    result.targetWords.forEach((word, wordId) => {
        assert.ok(pool.includes(word), '目标必须来自词库');
        const chars = Array.from(word);
        const coords = result.targetPaths[wordId];
        assert.equal(coords.length, chars.length);
        const local = new Set();
        coords.forEach(({ r, c }, index) => {
            assert.ok(Number.isInteger(r) && Number.isInteger(c));
            assert.ok(r >= 0 && c >= 0 && r < size && c < size);
            const id = r * size + c;
            assert.ok(!local.has(id), '词内不重复使用格子');
            assert.ok(!occupied.has(id), '不同目标的 canonical 路径不重叠');
            local.add(id);
            occupied.add(id);
            const cell = result.grid[r][c];
            assert.equal(cell.char, chars[index]);
            assert.equal(cell.originWord, word);
            assert.equal(cell.wordId, wordId);
            assert.equal(cell.charIndex, index);
            if (index > 0) {
                const previous = coords[index - 1];
                assert.equal(Math.abs(r - previous.r) + Math.abs(c - previous.c), 1);
            }
        });
        const signature = coords.map(({ r, c }) => r * size + c).join(',');
        assert.ok(!signatures.has(signature), '重复词也须有独立路径 signature');
        signatures.add(signature);
    });
    let fillerCount = 0;
    result.grid.forEach((row, r) => {
        assert.equal(row.length, size);
        row.forEach((cell, c) => {
            for (const key of ['char', 'originWord', 'wordId', 'done', 'r', 'c', 'id']) {
                assert.ok(Object.hasOwn(cell, key), `保留旧 cell 字段 ${key}`);
            }
            assert.equal(cell.r, r);
            assert.equal(cell.c, c);
            assert.equal(cell.id, r * size + c);
            assert.equal(cell.done, false);
            assert.equal(Array.from(cell.char).length, 1);
            if (!occupied.has(cell.id)) {
                fillerCount++;
                assert.equal(cell.wordId, -1);
                assert.equal(cell.charIndex, -1);
                assert.equal(cell.originWord, null);
            }
        });
    });
    assert.equal(fillerCount, result.fillerCount);
    assert.ok(result.operations.dfs <= 4000);
    assert.equal(result.operations.dfsLimit, 4000);
    // 不计读取输入的线性成本，选词最多两次容量乘不同长度数。
    assert.ok(result.operations.selection <= 2 * size ** 4);
}

test('6/8/10 棋盘在固定种子下可复现，所有目标均有完整可解路径', () => {
    const pools = [
        ['太极拳', '阴阳', '八卦掌法', '虚实刚柔动'],
        ['😀太𠮷极拳', '𠮷😀', '阴阳'],
        ['太太太太太'],
        ['甲'],
        ['天地玄黄宇', '洪荒日月盈昃辰']
    ];
    for (const size of [6, 8, 10]) {
        for (const pool of pools) {
            for (let seed = 1; seed <= 20; seed++) {
                const result = runtime(seed).generate(pool, size);
                verify(result, pool, size);
                assert.equal(JSON.stringify(result), JSON.stringify(runtime(seed).generate(pool, size)));
            }
        }
    }
});

test('每种可容纳词长均终止，不可整除的配字不进入目标', () => {
    for (const size of [6, 8, 10]) {
        for (let length = 1; length <= size * size; length++) {
            const pool = ['😀'.repeat(length)];
            const result = runtime(length).generate(pool, size);
            verify(result, pool, size);
            assert.equal(result.targetWords.length, Math.floor(size * size / length));
            assert.equal(result.fillerCount, size * size % length);
        }
    }
});

test('可整除混合长度不留下随机贪心造成的配字', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const pool = ['甲乙丙丁戊', '一二三四五六七'];
        const result = runtime(seed).generate(pool, 6);
        verify(result, pool, 6);
        assert.equal(result.fillerCount, 0);
    }
});

test('DFS 达到预算后一次蛇形后备，长词跨行仍上下邻接', () => {
    const pool = ['😀'.repeat(100)];
    const result = runtime(1).generate(pool, 10);
    verify(result, pool, 10);
    assert.equal(result.fallback, true);
    assert.equal(result.operations.dfs, 4000);
    const coords = result.targetPaths[0];
    assert.equal(JSON.stringify(coords[9]), JSON.stringify({ r: 0, c: 9 }));
    assert.equal(JSON.stringify(coords[10]), JSON.stringify({ r: 1, c: 9 }));
    assert.equal(JSON.stringify(coords[19]), JSON.stringify({ r: 1, c: 0 }));
    assert.equal(JSON.stringify(coords[20]), JSON.stringify({ r: 2, c: 0 }));
});

test('异常输入及全超长词一次失败，不随机重试或使用默认词', () => {
    const invalidPools = [undefined, null, {}, '太极', [], [''], ['   '], [42], ['太极', null]];
    for (const pool of invalidPools) {
        const env = runtime();
        const result = env.generate(pool, 6);
        assert.equal(result.success, false);
        assert.equal(typeof result.error, 'string');
        assert.equal(env.randomCalls(), 0);
    }
    for (const size of [0, 7, '6', null, NaN, Infinity, 100]) {
        assert.equal(runtime().generate(['太极'], size).success, false);
    }
    for (const size of [6, 8, 10]) {
        const env = runtime();
        const result = env.generate(['😀'.repeat(size * size + 1)], size);
        assert.equal(result.success, false);
        assert.match(result.error, /所有词都超过/);
        assert.equal(env.randomCalls(), 0);
        assert.equal(Object.hasOwn(result, 'targetWords'), false);
        const pool = ['长'.repeat(size * size + 1), '太极'];
        verify(env.generate(pool, size), pool, size);
    }
});

test('旧 Worker 消息 API 保留，忽略不一致 targetSize 并只回复一次', () => {
    const env = runtime(1, 'worker');
    assert.equal(env.listeners.length, 1);
    assert.equal(env.listeners[0].type, 'message');
    env.listeners[0].handler({ data: { pool: ['太极拳'], boardSize: 6, targetSize: 999 } });
    assert.equal(env.messages.length, 1);
    verify(env.messages[0], ['太极拳'], 6);
    env.listeners[0].handler({ data: { pool: ['长'.repeat(37)], boardSize: 6, targetSize: 36 } });
    assert.equal(env.messages.length, 2);
    assert.equal(env.messages[1].success, false);
    env.listeners[0].handler({ data: null });
    assert.equal(env.messages.length, 3);
    assert.equal(env.messages[2].success, false);
});

test('主页面动态 script 暴露 generate，不能注册 message 监听', () => {
    const env = runtime(1, 'page');
    assert.equal(env.listeners.length, 0);
    verify(env.generate(['太极拳'], 6), ['太极拳'], 6);
    assert.equal(env.messages.length, 0);
});
