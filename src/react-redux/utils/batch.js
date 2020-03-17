// Default to a dummy "batch" implementation that just runs the callback
function defaultNoopBatch(callback) {
  callback();
}

let batch = defaultNoopBatch;

// Allow injecting another batching function later
// 在index.js里把react-dom里的unstable_batchedUpdates赋值进来了
export const setBatch = newBatch => (batch = newBatch);

// Supply a getter just to skip dealing with ESM bindings
export const getBatch = () => batch;
