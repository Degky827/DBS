const { createWorker } = require("tesseract.js");

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    const pendingWorker = createWorker("eng");
    workerPromise = pendingWorker;
    pendingWorker.catch(() => {
      if (workerPromise === pendingWorker) workerPromise = undefined;
    });
  }
  return workerPromise;
}

async function recognize(buffer) {
  const worker = await getWorker();
  const result = await worker.recognize(buffer);
  return {
    text: result.data.text,
    confidence: result.data.confidence,
  };
}

async function terminate() {
  const pendingWorker = workerPromise;
  if (!pendingWorker) return;
  workerPromise = undefined;
  const worker = await pendingWorker;
  await worker.terminate();
}

module.exports = { recognize, terminate };
