const requestPromise = require('request-promise');
const fs = require('fs');
const path = require('path');
const multiparty = require('multiparty');
const debug = require('./debug');

function generateRequest(req, apiResource, dataObj, reqCookie) {
  const requestObj = {
    method: req.method,
    timeout: 30 * 1000,
    transform2xxOnly: false,
    transform(body, response) {
      return {
        headers: response.headers,
        body,
      };
    },
  };

  /* uri */
  requestObj.uri = apiResource;

  /* body */
  if (dataObj !== null && Object.keys(dataObj).length > 0) {
    requestObj.formData = dataObj;
  }

  /* header */
  requestObj.headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
    cookie: reqCookie,
    'request-host': req.headers.host,
  };

  return requestObj;
}

function request(req, res, actionConfig, dataObj, accessLog) {
  return new Promise(((resolve, reject) => {
    const reqCookie = req.headers.cookie;
    const apiRequest = generateRequest(req, actionConfig.api, dataObj, reqCookie);
    debug.setApiRequestToAccessLog(accessLog, req.method, actionConfig.api, dataObj, reqCookie);
    requestPromise(apiRequest)
      .then((apiResponse) => {
        if ('set-cookie' in apiResponse.headers) {
          res.setHeader('set-cookie', apiResponse.headers['set-cookie']);
        }
        if ('content-type' in apiResponse.headers) {
          res.setHeader('content-type', apiResponse.headers['content-type']);
        }
        resolve(apiResponse.body);
      }, (err) => {
        reject(err);
      });
  }));
}

exports.getRenderData = (req, res, workDirectory, actionConfig, accessLog) => {
  const reqUrl = decodeURI(req.url);
  return new Promise(((resolve, reject) => {
    if ('api' in actionConfig) {
      const pathAndParamString = reqUrl.split('?');
      if (pathAndParamString.length > 1) {
        actionConfig.api = `${actionConfig.api}?${pathAndParamString[1]}`;
      }

      if (req.method === 'POST') {
        const form = new multiparty.Form();
        form.parse(req, (err, fields, files) => {
          const dataObj = {};

          if (typeof (fields) === 'object') {
            /* text params */
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
              for (let j = 0; i < files[fileKey].length; i++) {
                dataObj[fileKey].push({
                  value: fs.createReadStream(files[fileKey][j].path),
                  options: {
                    filename: files[fileKey][j].originalFilename,
                  },
                });
              }
            }
          }

          request(req, res, actionConfig, dataObj, accessLog).then(
            (resolveObj) => {
              resolve(resolveObj);
            }, (reqError) => {
              reject(reqError);
            },
          );
        });
      } else if (req.method === 'GET') {
        return request(req, res, actionConfig, null, accessLog).then(
          (resolveObj) => {
            resolve(resolveObj);
          }, (reqError) => {
            reject(reqError);
          },
        );
      }
    } else if ('json' in actionConfig) {
      const json = fs.readFileSync(path.join(workDirectory, 'datas', actionConfig.json), 'utf-8');
      resolve(json);
    } else {
      resolve('{}');
    }
    return undefined;
  }));
};
