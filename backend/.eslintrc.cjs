module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ["eslint:recommended"],
  ignorePatterns: ["node_modules/", "data/", "*.log"],
  parserOptions: {
    ecmaVersion: "latest",
  },
  globals: {
    AbortController: "readonly",
    Buffer: "readonly",
    fetch: "readonly",
  },
  rules: {
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
};
