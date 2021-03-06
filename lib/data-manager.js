const requestPromise = require('request-promise');
const fs = require('fs');
const path = require('path');
const multiparty = require('multiparty');
const moment = require('moment');
const {parse} = require('querystring');
const {Iconv} = require('iconv');

function generateRequest(req, apiResource, dataObj, reqCookie) {
  const requestObj = {
    method: req.method,
    timeout: 24 * 60 * 60 * 1000,
    transform2xxOnly: false,
    transform(body, response) {
      let responseBody = response.body;
      if (response.headers['content-type']) {
        const charset = getCharsetByContentType(response.headers['content-type']);
        switch (charset) {
          case 'sjis':
            // APIのレスポンスがsjisのときにエンコーディングを行う
            // ref: https://qiita.com/fumihiko-hidaka/items/ebec856eaecbbe632167
            responseBody = (new Iconv('SHIFT_JIS', 'UTF-8//TRANSLIT//IGNORE')).convert(responseBody).toString();
            break;
          case '':
            // charsetの指定がない場合，何もしない
            break;
          default:
            responseBody = (new TextDecoder(charset)).decode(Uint8Array.from(responseBody))
            break;
        }
      }

      response.body = responseBody
      return response;
    },
    encoding: null,
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


const CHARTSET_RE = /(?:charset|encoding)\s{0,10}=\s{0,10}['"]? {0,10}([\w-]{1,100})/i;

// HTTPヘッダのContent-Typeから、文字コード(charset)を取得する
function getCharsetByContentType(contentType) {
  let charset = '';
  const matchs = CHARTSET_RE.exec(contentType);
  if (matchs) {
    charset = matchs[1].toLowerCase();
  }
  return charset;
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

        const charset = getCharsetByContentType(apiResponse.headers['content-type']);
        switch (charset) {
          case 'sjis':
            // 内部では UTF-8 で扱っているので、再度sjisに変換する
            apiResponse.body = new Iconv('UTF-8', 'Shift_JIS').convert(apiResponse.body);
            break;
          case '':
            // charsetの指定がない場合，何もしない
            break;
          default:
            break;
        }

        resolve(apiResponse.body);
      }, (err) => {
        if (Buffer.isBuffer(err.error)) {
          err.message = err.response.body
        }
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

    const doRequest = (dataObj) => request(req, res, actionConfig, dataObj)
      .then(
        (resolveObj) => {
          resolve(resolveObj);
        }, (reqError) => {
          reject(reqError);
        },
      );

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
        const contentType = req.headers['content-type'].split(';');
        if (contentType[0] === 'application/x-www-form-urlencoded') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            doRequest({...parse(body)});
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
            const attachFilepaths = [];
            if (typeof (files) === 'object') {
              const fileKeys = Object.keys(files);
              for (let i = 0; i < fileKeys.length; i++) {
                const fileKey = fileKeys[i];
                dataObj[fileKey] = [];
                for (let j = 0; j < files[fileKey].length; j++) {
                  attachFilepaths.push(files[fileKey][j].path);
                  dataObj[fileKey].push({
                    value: fs.createReadStream(files[fileKey][j].path),
                    options: {
                      filename: files[fileKey][j].originalFilename,
                    },
                  });
                }
              }
            }

            doRequest(dataObj)
              .then(
                (resolveObj) => {
                  for (let i = 0; i < attachFilepaths.length; i++) {
                    fs.unlink(attachFilepaths[i], (unlinkErr) => {
                      if (unlinkErr) {
                        console.error(`[LaunchPack] An error occurred to file upload: ${unlinkErr}`);
                      } else {
                        console.info(`${moment()
                          .format('YYYY-MM-DD HH:mm:ss')} :: File upload done`);
                      }
                    });
                  }
                  resolve(resolveObj);
                }, (reqError) => {
                  reject(reqError);
                },
              );
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
