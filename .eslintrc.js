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
  ],
};
