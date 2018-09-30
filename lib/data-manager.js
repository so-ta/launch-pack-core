'use strict';

exports.getRenderData = getRenderData;

const requestPromise = require('request-promise');
const cookie = require('cookie');
const fs = require('fs');
const path = require('path');
const multiparty = require('multiparty');
const debug = require('./debug');

function request(req, res, actionConfig, dataObj, accessLog) {
  return new Promise(function (resolve, reject) {
    let reqCookie = req.headers.cookie;
    let apiRequest = generateRequest(req, actionConfig["api"], dataObj, reqCookie);
    debug.setApiRequestToAccessLog(accessLog, req.method, actionConfig["api"], dataObj, reqCookie);
    requestPromise(apiRequest)
      .then(function (apiResponse) {
        if ("set-cookie" in apiResponse.headers) {
          res.setHeader('set-cookie', apiResponse.headers["set-cookie"]);
        }
        if ("content-type" in apiResponse.headers) {
          res.setHeader('content-type', apiResponse.headers["content-type"]);
        }
        resolve(apiResponse.body);
      }, function (err) {
        reject(err);
      })
  });
}

function generateRequest(req, apiResource, dataObj, reqCookie) {
  let request = {
    method: req.method,
    timeout: 30 * 1000,
    transform2xxOnly: false,
    transform: function (body, response, resolveWithFullResponse) {
      return {
        'headers': response.headers,
        'body': body
      };
    }
  };

  /* uri */
  request.uri = apiResource;

  /* body */
  if (dataObj !== null && Object.keys(dataObj).length > 0) {
    request.formData = dataObj;
  }

  /* header */
  request.headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
    'cookie': reqCookie,
    'request-host': req.headers.host
  };

  return request;
}

function getRenderData(req, res, workDirectory, actionConfig, accessLog) {
  let reqUrl = decodeURI(req.url);
  return new Promise(function (resolve, reject) {
    if ('api' in actionConfig) {
      let pathAndParamString = reqUrl.split("?");
      if (pathAndParamString.length > 1) {
        actionConfig["api"] = actionConfig["api"] + "?" + pathAndParamString[1];
      }

      /***** POST Request *****/
      if (req.method === 'POST') {
        let form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
          let dataObj = {};

          if (typeof(fields) === "object") {
            /* text params */
            let fieldKeys = Object.keys(fields);
            for (let i = 0; i < fieldKeys.length; i++) {
              let fieldKey = fieldKeys[i];
              dataObj[fieldKey] = [];
              for (let j = 0; j < fields[fieldKey].length; j++) {
                dataObj[fieldKey].push(fields[fieldKey][j]);
              }
            }
          }

          /* file params */
          if (typeof(files) === "object") {
            let fileKeys = Object.keys(files);
            for (let i = 0; i < fileKeys.length; i++) {
              let fileKey = fileKeys[i];
              dataObj[fileKey] = [];
              for (let j = 0; i < files[fileKey].length; i++) {
                dataObj[fileKey].push({
                  value: fs.createReadStream(files[fileKey][j].path),
                  options: {
                    filename: files[fileKey][j].originalFilename
                  }
                });
              }
            }
          }

          request(req, res, actionConfig, dataObj, accessLog).then(
            function (resolveObj) {
              resolve(resolveObj);
            }, function (err) {
              reject(err);
            }
          );
        });
      }

      /***** GET Request *****/
      else if (req.method === 'GET') {
        return request(req, res, actionConfig, null, accessLog).then(
          function (resolveObj) {
            resolve(resolveObj);
          }, function (err) {
            reject(err);
          }
        );
      }
    } else if ('json' in actionConfig) {
      let json = fs.readFileSync(path.join(workDirectory, 'datas', actionConfig["json"]), 'utf-8');
      resolve(json);
    } else {
      resolve("{}");
    }
  });
}
