import assert from "node:assert/strict";

/** Mirrors promoteInStack in src/background/mru.ts — fails if that logic drifts. */
function promoteInStack(stack, tabId, max = 8) {
  const idx = stack.indexOf(tabId);
  if (idx === 0) return;
  if (idx > 0) stack.splice(idx, 1);
  stack.unshift(tabId);
  if (stack.length > max) stack.length = max;
}

const stack = [10, 20, 30, 40];
promoteInStack(stack, 30);
assert.deepEqual(stack, [30, 10, 20, 40], "mid-stack tab must move to front");

promoteInStack(stack, 30);
assert.deepEqual(stack, [30, 10, 20, 40], "already-front tab is a no-op");

promoteInStack(stack, 99);
assert.deepEqual(stack, [99, 30, 10, 20, 40], "unknown tab is prepended");

const capped = [1, 2, 3, 4, 5, 6, 7, 8];
promoteInStack(capped, 9, 8);
assert.deepEqual(capped, [9, 1, 2, 3, 4, 5, 6, 7], "overflow trims the oldest");

console.log("check-mru: ok");
