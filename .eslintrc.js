module.exports = {
  "extends": "airbnb-base",
  "rules": {
    "default-case": "off",
    "import/no-dynamic-require": "off",
    "no-console": "off",
    "no-param-reassign": "off",
    "no-plusplus": "off",
    "no-underscore-dangle": "off",
  },
  "overrides": [
    {
      "files": "bin/*.js",
      "parserOptions": {
        "sourceType": "script",
      },
    },
    {
      "files": "debug/debug.js",
      "globals": {
        "$": true,
        "io": true,
      },
      "rules": {
        "func-names": "off",
        "no-var": "off",
        "prefer-arrow-callback": "off",
        "prefer-template": "off",
      },
    },
  ],
};
