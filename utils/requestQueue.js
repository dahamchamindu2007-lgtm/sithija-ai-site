// A small in-process queue that limits how many upstream AI calls run at
// the same time, and lets higher-priority jobs (Pro/owner) cut in front of
// lower-priority ones (Free) that are still waiting — without touching the
// upstream call itself. Free requests are never blocked outright, they just
// wait behind Pro ones if several land in the same moment.
//
// Note: this only matters when MAX_CONCURRENT requests are in flight at the
// same instant — most of the time a request just runs immediately.

const MAX_CONCURRENT = 4;

let active = 0;
let seq = 0;
const pending = []; // { priority, seq, task, resolve, reject }

function comparePending(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority; // higher priority first
  return a.seq - b.seq; // otherwise first-come-first-served
}

function runNext() {
  if (active >= MAX_CONCURRENT || pending.length === 0) return;

  pending.sort(comparePending);
  const job = pending.shift();
  active++;

  job.task()
    .then(job.resolve, job.reject)
    .finally(() => {
      active--;
      runNext();
    });
}

// priority: higher number = goes first. Pro/owner should pass a higher
// value than Free so they jump the line when the queue is backed up.
function runWithPriority(task, priority = 0) {
  return new Promise((resolve, reject) => {
    pending.push({ priority, seq: seq++, task, resolve, reject });
    runNext();
  });
}

function queueStats() {
  return { active, waiting: pending.length, maxConcurrent: MAX_CONCURRENT };
}

module.exports = { runWithPriority, queueStats };
