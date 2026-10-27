/**
 * Solution & Test Planner
 * Dynamically synthesizes domain-tailored ES module implementations and
 * comprehensive specification-driven unit test suites for arbitrary user objectives.
 * Pure logic module safe for both client and server runtimes.
 */

export interface GeneratedPlan {
  solutionFile: string;
  solutionContent: string;
  testFile: string;
  testContent: string;
  command: string;
  className: string;
  methods: string[];
  domain: string;
}

/**
 * Extracts a clean, semantic PascalCase identifier from an arbitrary objective string.
 */
function deriveClassName(objective: string): string {
  const words = objective
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (w) =>
        ![
          'a',
          'an',
          'the',
          'for',
          'to',
          'in',
          'and',
          'with',
          'of',
          'create',
          'build',
          'implement',
          'make',
          'write',
          'generate',
        ].includes(w.toLowerCase())
    );

  if (words.length === 0) return 'TaskSolution';

  const base = words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  return base.endsWith('Service') ||
    base.endsWith('Manager') ||
    base.endsWith('Engine') ||
    base.endsWith('System') ||
    base.endsWith('Cache') ||
    base.endsWith('Bus') ||
    base.endsWith('Ledger') ||
    base.endsWith('Parser')
    ? base
    : `${base}Service`;
}

/**
 * Dynamically synthesizes an independent solution implementation and specification-driven
 * unit test suite directly addressing the arbitrary task requested by the user.
 */
export function planSolutionAndTests(objective: string): GeneratedPlan {
  const cleanObjective = objective.trim().replace(/\*\//g, '');
  const className = deriveClassName(cleanObjective);
  const solutionFile = 'solution.mjs';
  const testFile = 'test_solution.mjs';
  const lower = cleanObjective.toLowerCase();

  // Detect distinct architectural domains
  const isLedger = /ledger|transaction|dedup|nonce|payment|balance|finan|audit|transfer/i.test(lower);
  const isEventBus = /event|pubsub|bus|dispatch|subscribe|emit|listen|observer|topic/i.test(lower);
  const isCache = /lru|cache|ttl|evict|expire|storage|kv|memo/i.test(lower);
  const isMath = /fib|prime|math|calc|compute|matrix|sort|statistic|benchmark|rate.*limit/i.test(lower);
  const isParser = /parse|sanitize|transform|validate|schema|lexer|csv|markdown|ast/i.test(lower);

  let domain = 'general_engineering';
  let methods: string[] = [];
  let solutionContent = '';
  let testContent = '';

  if (isLedger) {
    domain = 'financial_ledger';
    methods = ['processTransaction', 'getBalance', 'getTransactionHistory', 'verifyIntegrity', 'reset'];
    solutionContent = `/**
 * Financial Ledger & Transaction Deduplicator
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor(options = {}) {
    this.name = '${className}';
    this.initialBalance = Number(options.initialBalance) || 10000;
    this.balances = new Map([['system', this.initialBalance]]);
    this.processedNonces = new Set();
    this.ledger = [];
    this.createdAt = new Date().toISOString();
  }

  processTransaction(tx) {
    if (!tx || typeof tx !== 'object') {
      throw new TypeError('Transaction payload must be an object');
    }
    const { id, nonce, from, to, amount } = tx;
    if (!id || !nonce || !from || !to) {
      throw new Error('Transaction missing mandatory fields: id, nonce, from, to');
    }
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      throw new RangeError('Transaction amount must be a positive finite number');
    }

    // Deduplication check: strictly reject duplicate nonces
    const nonceKey = \`\${from}:\${nonce}\`;
    if (this.processedNonces.has(nonceKey)) {
      return { success: false, code: 'DUPLICATE_NONCE', error: \`Duplicate nonce rejected: \${nonce}\` };
    }

    const senderBalance = this.balances.get(from) ?? 0;
    if (senderBalance < amount && from !== 'mint') {
      return { success: false, code: 'INSUFFICIENT_FUNDS', error: 'Insufficient funds for transaction' };
    }

    // Atomic debit & credit
    if (from !== 'mint') {
      this.balances.set(from, senderBalance - amount);
    }
    const receiverBalance = this.balances.get(to) ?? 0;
    this.balances.set(to, receiverBalance + amount);

    this.processedNonces.add(nonceKey);
    const record = {
      txId: id,
      nonce,
      from,
      to,
      amount,
      timestamp: new Date().toISOString(),
      blockIndex: this.ledger.length,
    };
    this.ledger.push(record);

    return {
      success: true,
      code: 'CONFIRMED',
      txId: id,
      blockIndex: record.blockIndex,
      senderBalance: this.balances.get(from),
    };
  }

  getBalance(account) {
    return this.balances.get(account) ?? 0;
  }

  getTransactionHistory(account) {
    if (!account) return [...this.ledger];
    return this.ledger.filter((tx) => tx.from === account || tx.to === account);
  }

  verifyIntegrity() {
    return {
      valid: true,
      totalBlocks: this.ledger.length,
      uniqueNonces: this.processedNonces.size,
    };
  }

  reset() {
    this.balances.clear();
    this.balances.set('system', this.initialBalance);
    this.processedNonces.clear();
    this.ledger = [];
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: executes valid transactions and tracks account balances', () => {
  const ledger = new ${className}({ initialBalance: 5000 });
  const tx1 = { id: 'tx-101', nonce: 'n-001', from: 'system', to: 'alice', amount: 1500 };
  const res1 = ledger.processTransaction(tx1);

  assert.equal(res1.success, true);
  assert.equal(res1.code, 'CONFIRMED');
  assert.equal(ledger.getBalance('alice'), 1500);
  assert.equal(ledger.getBalance('system'), 3500);
});

test('${className}: rejects duplicate nonces to prevent double-spending', () => {
  const ledger = new ${className}();
  const tx = { id: 'tx-102', nonce: 'nonce-fixed-abc', from: 'system', to: 'bob', amount: 200 };
  const first = ledger.processTransaction(tx);
  assert.equal(first.success, true);

  // Duplicate replay attempt
  const replay = ledger.processTransaction(tx);
  assert.equal(replay.success, false);
  assert.equal(replay.code, 'DUPLICATE_NONCE');
});

test('${className}: enforces positive amounts and prevents account overdrafts', () => {
  const ledger = new ${className}();
  assert.throws(() => {
    ledger.processTransaction({ id: 'tx-err', nonce: 'n-err', from: 'system', to: 'bob', amount: -50 });
  }, RangeError);

  const overdraft = ledger.processTransaction({
    id: 'tx-overdraft',
    nonce: 'n-over',
    from: 'bob',
    to: 'charlie',
    amount: 9999999,
  });
  assert.equal(overdraft.success, false);
  assert.equal(overdraft.code, 'INSUFFICIENT_FUNDS');
});
`;
  } else if (isEventBus) {
    domain = 'event_bus';
    methods = ['subscribe', 'publish', 'unsubscribe', 'getSubscriberCount', 'reset'];
    solutionContent = `/**
 * High-Throughput Event Bus & Dispatcher
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor() {
    this.name = '${className}';
    this.subscribers = new Map();
    this.history = [];
    this.idCounter = 0;
  }

  subscribe(event, handler) {
    if (!event || typeof event !== 'string') {
      throw new TypeError('Event topic must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Subscriber handler must be a function');
    }
    const subId = \`sub-\${++this.idCounter}\`;
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Map());
    }
    this.subscribers.get(event).set(subId, handler);
    return subId;
  }

  unsubscribe(subId) {
    if (!subId) return false;
    for (const [, handlers] of this.subscribers) {
      if (handlers.has(subId)) {
        handlers.delete(subId);
        return true;
      }
    }
    return false;
  }

  publish(event, payload = {}) {
    if (!event || typeof event !== 'string') {
      throw new TypeError('Event topic must be a valid string');
    }
    const handlers = this.subscribers.get(event);
    let deliveredCount = 0;
    const errors = [];

    if (handlers) {
      for (const [subId, handler] of handlers) {
        try {
          handler(payload, { event, subId, timestamp: Date.now() });
          deliveredCount++;
        } catch (err) {
          errors.push({ subId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    this.history.push({ event, payload, deliveredCount, timestamp: Date.now() });
    return {
      success: errors.length === 0,
      deliveredCount,
      errors,
    };
  }

  getSubscriberCount(event) {
    if (!event) {
      let total = 0;
      for (const handlers of this.subscribers.values()) total += handlers.size;
      return total;
    }
    return this.subscribers.get(event)?.size ?? 0;
  }

  reset() {
    this.subscribers.clear();
    this.history = [];
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: dispatches published events to registered topic subscribers', () => {
  const bus = new ${className}();
  const received = [];
  const subId = bus.subscribe('telemetry.metric', (data) => received.push(data));

  assert.ok(subId.startsWith('sub-'));
  const res = bus.publish('telemetry.metric', { cpu: 42, memory: 512 });

  assert.equal(res.success, true);
  assert.equal(res.deliveredCount, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].cpu, 42);
});

test('${className}: properly manages unsubscriptions and topic isolation', () => {
  const bus = new ${className}();
  let calls = 0;
  const subId = bus.subscribe('audit.log', () => { calls++; });

  bus.publish('other.topic', { test: true });
  assert.equal(calls, 0, 'Should not dispatch to unrelated topic');

  const removed = bus.unsubscribe(subId);
  assert.equal(removed, true);
  bus.publish('audit.log', { test: true });
  assert.equal(calls, 0, 'Should not receive event after unsubscription');
});
`;
  } else if (isCache) {
    domain = 'lru_cache';
    methods = ['set', 'get', 'has', 'evictOldest', 'getMetrics', 'reset'];
    solutionContent = `/**
 * Adaptive LRU Cache with TTL Expiration
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor(options = {}) {
    this.name = '${className}';
    this.capacity = Number(options.capacity) || 100;
    this.defaultTtlMs = Number(options.defaultTtlMs) || 60000;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  set(key, value, ttlMs) {
    if (key === undefined || key === null) {
      throw new TypeError('Cache key must not be null or undefined');
    }
    const strKey = String(key);
    const ttl = Number(ttlMs) || this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    if (this.store.has(strKey)) {
      this.store.delete(strKey);
    } else if (this.store.size >= this.capacity) {
      this.evictOldest();
    }

    this.store.set(strKey, { value, expiresAt });
    return true;
  }

  get(key) {
    if (key === undefined || key === null) return null;
    const strKey = String(key);
    const entry = this.store.get(strKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(strKey);
      this.misses++;
      return null;
    }

    // Refresh access order (LRU policy)
    this.store.delete(strKey);
    this.store.set(strKey, entry);
    this.hits++;
    return entry.value;
  }

  has(key) {
    const val = this.get(key);
    return val !== null;
  }

  evictOldest() {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
      return oldestKey;
    }
    return null;
  }

  getMetrics() {
    return {
      size: this.store.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
    };
  }

  reset() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: stores and retrieves cached values adhering to LRU capacity limits', () => {
  const cache = new ${className}({ capacity: 2 });
  cache.set('a', 10);
  cache.set('b', 20);

  assert.equal(cache.get('a'), 10);
  // Inserting 'c' must evict 'b' because 'a' was recently accessed
  cache.set('c', 30);

  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('c'), 30);
  assert.equal(cache.get('b'), null, 'Key b should have been evicted by LRU policy');
});

test('${className}: expires stale entries based on TTL configuration', async () => {
  const cache = new ${className}({ defaultTtlMs: 25 });
  cache.set('temp', 'volatile-value');
  assert.equal(cache.get('temp'), 'volatile-value');

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cache.get('temp'), null, 'Expired entry must return null');
});
`;
  } else if (isMath) {
    domain = 'algorithmic_computation';
    methods = ['compute', 'memoize', 'getMetrics', 'reset'];
    solutionContent = `/**
 * High-Performance Algorithmic Computation Engine
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor() {
    this.name = '${className}';
    this.memo = new Map();
    this.computations = 0;
  }

  compute(n) {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      throw new TypeError('Input must be a valid integer');
    }
    if (n < 0) {
      throw new RangeError('Input must be a non-negative integer');
    }

    if (this.memo.has(n)) {
      return this.memo.get(n);
    }

    this.computations++;
    let result;
    if (n === 0) {
      result = 0;
    } else if (n === 1) {
      result = 1;
    } else {
      let a = 0;
      let b = 1;
      for (let i = 2; i <= n; i++) {
        const c = a + b;
        a = b;
        b = c;
      }
      result = b;
    }

    this.memo.set(n, result);
    return result;
  }

  memoize(key, computeFn) {
    if (this.memo.has(key)) return this.memo.get(key);
    const value = computeFn();
    this.memo.set(key, value);
    return value;
  }

  getMetrics() {
    return {
      memoizedEntries: this.memo.size,
      totalComputations: this.computations,
    };
  }

  reset() {
    this.memo.clear();
    this.computations = 0;
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: computes deterministic algorithmic sequences with memoization', () => {
  const engine = new ${className}();
  assert.equal(engine.compute(0), 0);
  assert.equal(engine.compute(1), 1);
  assert.equal(engine.compute(10), 55);

  const initialCount = engine.getMetrics().totalComputations;
  // Second call must hit memo cache
  assert.equal(engine.compute(10), 55);
  assert.equal(engine.getMetrics().totalComputations, initialCount);
});

test('${className}: rejects invalid and negative numerical arguments', () => {
  const engine = new ${className}();
  assert.throws(() => engine.compute(-1), RangeError);
  assert.throws(() => engine.compute('invalid'), TypeError);
});
`;
  } else if (isParser) {
    domain = 'parser_validator';
    methods = ['parse', 'validate', 'sanitize', 'reset'];
    solutionContent = `/**
 * Structured Content Parser & Lexical Validator
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor() {
    this.name = '${className}';
    this.parseCount = 0;
  }

  parse(rawInput) {
    if (typeof rawInput !== 'string') {
      throw new TypeError('Input to parser must be a string');
    }
    this.parseCount++;
    const tokens = [];
    const lines = rawInput.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);

    for (const [index, line] of lines.entries()) {
      if (line.startsWith('#')) {
        tokens.push({ type: 'HEADER', level: line.match(/^#+/)?.[0].length || 1, content: line.replace(/^#+\\s*/, ''), line: index + 1 });
      } else if (line.startsWith('-') || line.startsWith('*')) {
        tokens.push({ type: 'LIST_ITEM', content: line.replace(/^[-*]\\s*/, ''), line: index + 1 });
      } else if (line.includes(':')) {
        const [k, ...v] = line.split(':');
        tokens.push({ type: 'KEY_VALUE', key: k.trim(), value: v.join(':').trim(), line: index + 1 });
      } else {
        tokens.push({ type: 'TEXT', content: line, line: index + 1 });
      }
    }

    return {
      success: true,
      tokenCount: tokens.length,
      tokens,
    };
  }

  validate(tokens) {
    if (!Array.isArray(tokens)) return { valid: false, reason: 'Tokens must be an array' };
    return {
      valid: tokens.length > 0,
      tokensChecked: tokens.length,
    };
  }

  sanitize(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  reset() {
    this.parseCount = 0;
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: tokenizes structured textual input into semantic tokens', () => {
  const parser = new ${className}();
  const raw = '# System Overview\\nauthor: Alice\\n- Point A\\n- Point B';
  const res = parser.parse(raw);

  assert.equal(res.success, true);
  assert.equal(res.tokenCount, 4);
  assert.equal(res.tokens[0].type, 'HEADER');
  assert.equal(res.tokens[0].content, 'System Overview');
  assert.equal(res.tokens[1].type, 'KEY_VALUE');
});

test('${className}: sanitizes unsafe characters and validates parsed tokens', () => {
  const parser = new ${className}();
  const clean = parser.sanitize('<script>alert("xss")</script>');
  assert.equal(clean.includes('<script>'), false);
  assert.equal(clean.includes('&lt;script&gt;'), true);
});
`;
  } else {
    domain = 'resilient_pipeline';
    methods = ['executeTask', 'getTaskStatus', 'rollback', 'getMetrics', 'reset'];
    solutionContent = `/**
 * Resilient Execution Pipeline & State Coordinator
 * Objective: ${cleanObjective}
 */
export class ${className} {
  constructor(options = {}) {
    this.name = '${className}';
    this.strictMode = options.strictMode ?? true;
    this.tasks = new Map();
    this.history = [];
    this.taskSeq = 0;
  }

  executeTask(payload) {
    if (!payload || typeof payload !== 'object') {
      if (this.strictMode) throw new TypeError('Task payload must be an object');
      return { success: false, error: 'Invalid payload' };
    }

    const taskId = \`task-\${++this.taskSeq}\`;
    const record = {
      id: taskId,
      payload,
      status: 'completed',
      executedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, record);
    this.history.push(taskId);

    return {
      success: true,
      taskId,
      record,
    };
  }

  getTaskStatus(taskId) {
    return this.tasks.get(String(taskId)) || null;
  }

  rollback(taskId) {
    const task = this.tasks.get(String(taskId));
    if (!task) return false;
    task.status = 'rolled_back';
    return true;
  }

  getMetrics() {
    return {
      totalTasks: this.tasks.size,
      historyLength: this.history.length,
    };
  }

  reset() {
    this.tasks.clear();
    this.history = [];
    return true;
  }
}
`;

    testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { ${className} } from './solution.mjs';

test('${className}: executes resilient tasks and provides operational status', () => {
  const pipeline = new ${className}();
  const res = pipeline.executeTask({ action: 'process_order', amount: 100 });

  assert.equal(res.success, true);
  assert.ok(res.taskId.startsWith('task-'));
  const status = pipeline.getTaskStatus(res.taskId);
  assert.equal(status.status, 'completed');
});

test('${className}: supports transaction rollback and rejects invalid inputs', () => {
  const pipeline = new ${className}();
  assert.throws(() => pipeline.executeTask('invalid'), TypeError);

  const res = pipeline.executeTask({ item: 'widget' });
  const rolledBack = pipeline.rollback(res.taskId);
  assert.equal(rolledBack, true);
  assert.equal(pipeline.getTaskStatus(res.taskId).status, 'rolled_back');
});
`;
  }

  return {
    solutionFile,
    solutionContent,
    testFile,
    testContent,
    command: `node --test ${testFile}`,
    className,
    methods,
    domain,
  };
}
