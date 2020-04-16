const requestPromise = require('request-promise');
const fs = require('fs');
const path = require('path');
const multiparty = require('multiparty');
const { parse } = require('querystring');

function generateRequest(req, apiResource, dataObj, reqCookie) {
  const requestObj = {
    method: req.method,
    timeout: 24 * 60 * 60 * 1000,
    transform2xxOnly: false,
    transform(body, response) {
      return {
        headers: response.headers,
        body,
      };
    },
  };

  requestObj.uri = apiResource;

  if (dataObj !== null && Object.keys(dataObj).length > 0) {
    requestObj.formData = dataObj;
  }

  requestObj.headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
    cookie: reqCookie,
    'request-host': req.headers.host,
  };

  return requestObj;
}

function request(req, res, actionConfig, dataObj) {
  return new Promise(((resolve, reject) => {
    const reqCookie = req.headers.cookie;
    const apiRequest = generateRequest(req, actionConfig.api, dataObj, reqCookie);
    requestPromise(apiRequest)
      .then((apiResponse) => {
        // レスポンスに含まれるヘッダ情報を一部転送する
        // TODO: ヘッダーの設定はリクエスト&レスポンスのハンドリングを担当するサーバ処理の階層で処理する
        ['set-cookie', 'content-type', 'content-disposition'].forEach((key) => {
          if (apiResponse.headers[key]) {
            res.setHeader(key, apiResponse.headers[key]);
          }
        });
        resolve(apiResponse.body);
      }, (err) => {
        reject(err);
      });
  }));
}

exports.getRenderData = (
  req,
  res,
  workDirectory,
  actionConfig,
) => new Promise(((resolve, reject) => {
  if ('api' in actionConfig) {
    // URLクエリパラメータがあるときはAPIリクエストに含める
    const index = req.url.indexOf('?');
    if (index !== -1) {
      const requestQuery = new URLSearchParams(req.url.slice(index));
      const requestUri = new URL(actionConfig.api);

      requestQuery.forEach((value, name) => {
        requestUri.searchParams.append(name, value);
      });

      actionConfig.api = requestUri;
    }

    const doRequest = (dataObj) => {
      request(req, res, actionConfig, dataObj).then(
        (resolveObj) => {
          resolve(resolveObj);
        }, (reqError) => {
          reject(reqError);
        },
      );
    };

    switch (req.method) {
      case 'GET':
        doRequest(null);
        break;
      case 'POST':
        /**
         * TODO:
         *   1. [future] `Content-Type: application/json`をハンドルできるようにする
         *   2. [future] データサーバへJSONでリクエストできるようにする
         */

        if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            doRequest(Object.assign({}, parse(body)));
          });
        } else {
          // `multipart/form-data; *`を想定
          const form = new multiparty.Form();
          form.parse(req, (err, fields, files) => {
            const dataObj = {};
            /* text params */
            if (typeof (fields) === 'object') {
              const fieldKeys = Object.keys(fields);
              for (let i = 0; i < fieldKeys.length; i++) {
                const fieldKey = fieldKeys[i];
                dataObj[fieldKey] = [];
                for (let j = 0; j < fields[fieldKey].length; j++) {
                  dataObj[fieldKey].push(fields[fieldKey][j]);
                }
              }
            }
            /* file params */
            if (typeof (files) === 'object') {
              const fileKeys = Object.keys(files);
              for (let i = 0; i < fileKeys.length; i++) {
                const fileKey = fileKeys[i];
                dataObj[fileKey] = [];
                for (let j = 0; j < files[fileKey].length; j++) {
                  dataObj[fileKey].push({
                    value: fs.createReadStream(files[fileKey][j].path),
                    options: {
                      filename: files[fileKey][j].originalFilename,
                    },
                  });
                }
              }
            }
            doRequest(dataObj);
          });
        }
        break;
    }
  } else if ('json' in actionConfig) {
    const json = fs.readFileSync(path.join(workDirectory, 'data', actionConfig.json), 'utf-8');
    resolve(json);
  } else {
    resolve('{}');
  }
}));
