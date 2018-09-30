const ECT = require('ect');
const path = require('path');
const fs = require('fs');
const junk = require('junk');
const moment = require('moment');
const cookie = require('cookie');

exports.setRenderParams = setRenderParams;
exports.renderTemplate = renderTemplate;

let actionStringToUrl = {};
let resourcesmaps = {};
let workDirectory = "";

function setRenderParams(_actionStringToUrl, _workDirectory) {
  actionStringToUrl = _actionStringToUrl;
  workDirectory = _workDirectory;
}

function renderTemplate(config, req, res, viewRootDirectory, template, renderObj, appFuncs, actionAndParams) {
  return new Promise(function (resolve, reject) {
    try {
      let ectRender = ECT({root: viewRootDirectory});
      res.setHeader('content-type', 'text/html; charset=utf-8');

      let reqCookie = req.headers.cookie;
      if (typeof (reqCookie) !== "undefined") {
        let parsedCookie = cookie.parse(reqCookie);
        if ('lp-flash' in parsedCookie && parsedCookie['lp-flash'] !== '') {
          try {
            renderObj["flash"] = JSON.parse(parsedCookie["lp-flash"]);
            res.setHeader('Set-Cookie', cookie.serialize('lp-flash', '', {maxage: 0, path: '/'}));
          } catch (e) {
            console.log(e)
          }
        }
      }

      renderObj = appendFunction(config, req, renderObj, appFuncs, actionAndParams);
      let resultHtml = ectRender.render(template, renderObj);

      resolve(resultHtml);
    } catch (err) {
      reject(err);
    }
  });
}

function appendFunction(config, req, json, appFuncs, actionAndParams) {
  json.baseUrl = "http://" + req.headers.host;

  json.funcs = {
    url: function (routeString, params) {
      if (routeString in actionStringToUrl) {
        let routingUrlDic = actionStringToUrl[routeString].split("/");
        for (let i = 0; i < routingUrlDic.length; i++) {
          if (routingUrlDic[i].lastIndexOf(":", 0) === 0) { //「:」からはじまる場合
            let paramKey = routingUrlDic[i].slice(1);
            if (paramKey in params) {
              routingUrlDic[i] = params[paramKey];
            }
          }
        }
        return routingUrlDic.join("/");
      }
      return "";
    },
    resourcesmap: function (reqUrl) {
      // 初回 or develop時はresourcesmap.jsonの読み込みをし、それ以外はキャッシュから引いてくる
      let resourcesMapJsonObj = {};
      if (workDirectory in resourcesmaps && config["use_resources_map"]) {
        resourcesMapJsonObj = resourcesmaps[workDirectory];
      } else {
        if (fs.existsSync(path.join(workDirectory, 'public', 'resourcesmap.json'))) {
          resourcesMapJsonObj = JSON.parse(fs.readFileSync(path.join(workDirectory, 'public', 'resourcesmap.json'), 'utf-8'));
        }
        resourcesmaps[workDirectory] = resourcesMapJsonObj;
      }
      if (reqUrl in resourcesMapJsonObj) {
        return "/hashed/" + resourcesMapJsonObj[reqUrl];
      }
      return reqUrl;
    },
    getCurrentURL: function () {
      return "https://" + req.headers.host + req.url;
    },
    getCurrentActionString: function () {
      return actionAndParams.actionString;
    },
    getCurrentActionParams: function () {
      return actionAndParams.actionParams;
    },
    getCurrentActionParam: function (key) {
      if (key in actionAndParams.actionParams) {
        return actionAndParams.actionParams[key]
      }
      return "";
    },
    getConfigValue: function (str) {
      if (config.hasOwnProperty(str)) {
        return config[str];
      }
      return null;
    }
  };

  json.appFuncs = appFuncs;
  return json;
}
