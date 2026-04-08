async function runNonCriticalOperation(operation, { fallbackValue = null, onError } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (typeof onError === "function") {
      onError(error);
    }
    return fallbackValue;
  }
}

module.exports = {
  runNonCriticalOperation,
};
