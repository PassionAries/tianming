'use strict';

const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DEFAULT_WORKER_THRESHOLD = 4 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

function errorRecord(error) {
  return {
    name: String(error && error.name || 'Error'),
    message: String(error && error.message || error),
    code: error && error.code ? String(error.code) : '',
    stack: error && error.stack ? String(error.stack) : ''
  };
}

function reviveWorkerError(record) {
  const error = new Error(record && record.message || 'JSON worker failed');
  if (record && record.name) error.name = record.name;
  if (record && record.code) error.code = record.code;
  if (record && record.stack) error.stack = record.stack;
  return error;
}

if (!isMainThread && workerData && workerData.tmJsonFileWorker === 1) {
  try {
    const text = fs.readFileSync(workerData.file, 'utf8');
    const data = JSON.parse(text);
    parentPort.postMessage({ ok: true, data });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: errorRecord(error) });
  }
} else {
  async function readJsonFileOffMainThread(file, options) {
    options = options || {};
    const stat = await fs.promises.stat(file);
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES;
    if (!stat.isFile()) throw new Error('JSON 路径不是文件');
    if (stat.size > maxBytes) throw new RangeError('JSON 文件超过读取上限');

    const threshold = Number.isFinite(options.workerThresholdBytes)
      ? Math.max(0, options.workerThresholdBytes)
      : DEFAULT_WORKER_THRESHOLD;
    if (stat.size < threshold) {
      const text = await fs.promises.readFile(file, 'utf8');
      return JSON.parse(text);
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { tmJsonFileWorker: 1, file: file }
      });
      const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate().catch(() => {});
        reject(new Error('JSON 文件解析超时'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      }

      worker.once('message', message => {
        if (message && message.ok === true) finish(resolve, message.data);
        else finish(reject, reviveWorkerError(message && message.error));
      });
      worker.once('error', error => finish(reject, error));
      worker.once('exit', code => {
        if (!settled) finish(reject, new Error('JSON worker exited before returning data (code ' + code + ')'));
      });
    });
  }

  module.exports = {
    readJsonFileOffMainThread,
    DEFAULT_WORKER_THRESHOLD,
    DEFAULT_MAX_BYTES
  };
}
