const ECT = require('ect');
const path = require('path');
const fs = require('fs');
const cookie = require('cookie');

const errors = require('./errors');

let actionStringToUrl = {};
const resourcesmaps = {};
let workDirectory = '';

function setRenderParams(_actionStringToUrl, _workDirectory) {
  actionStringToUrl = _actionStringToUrl;
  workDirectory = _workDirectory;
}

function appendFunction(config, req, json, appFuncs, actionAndParams) {
  json.baseUrl = `http://${req.headers.host}`;

  json.funcs = {
    url(routeString, params) {
      if (routeString in actionStringToUrl) {
        const routingUrlDic = actionStringToUrl[routeString].split('/');
        for (let i = 0; i < routingUrlDic.length; i++) {
          if (routingUrlDic[i].lastIndexOf(':', 0) === 0) { // 「:」からはじまる場合
            const paramKey = routingUrlDic[i].slice(1);
            if (paramKey in params) {
              routingUrlDic[i] = params[paramKey];
            }
          }
        }
        return routingUrlDic.join('/');
      }
      return '';
    },
    resourcesmap(reqUrl) {
      // 初回 or develop時はresourcesmap.jsonの読み込みをし、それ以外はキャッシュから引いてくる
      let resourcesMapJsonObj = {};
      if (workDirectory in resourcesmaps && config.use_resources_map) {
        resourcesMapJsonObj = resourcesmaps[workDirectory];
      } else {
        if (fs.existsSync(path.join(workDirectory, 'public', 'resourcesmap.json'))) {
          resourcesMapJsonObj = JSON.parse(fs.readFileSync(path.join(workDirectory, 'public', 'resourcesmap.json'), 'utf-8'));
        }
        resourcesmaps[workDirectory] = resourcesMapJsonObj;
      }
      if (reqUrl in resourcesMapJsonObj) {
        return `/hashed/${resourcesMapJsonObj[reqUrl]}`;
      }
      return reqUrl;
    },
    getCurrentURL() {
      return `https://${req.headers.host}${req.url}`;
    },
    getCurrentActionString() {
      return actionAndParams.actionString;
    },
    getCurrentActionParams() {
      return actionAndParams.actionParams;
    },
    getCurrentActionParam(key) {
      if (key in actionAndParams.actionParams) {
        return actionAndParams.actionParams[key];
      }
      return '';
    },
    getConfigValue(str) {
      if (Object.prototype.hasOwnProperty.call(config, str)) {
        return config[str];
      }
      return null;
    },
  };

  json.appFuncs = appFuncs;
  return json;
}

function renderTemplate(
  config,
  req,
  res,
  viewRootDirectory,
  template,
  renderObj,
  appFuncs,
  actionAndParams,
) {
  return new Promise(((resolve, reject) => {
    try {
      const ectRender = ECT({ root: viewRootDirectory });
      res.setHeader('content-type', 'text/html; charset=utf-8');

      const reqCookie = req.headers.cookie;
      if (typeof (reqCookie) !== 'undefined') {
        const parsedCookie = cookie.parse(reqCookie);
        if ('lp-flash' in parsedCookie && parsedCookie['lp-flash'] !== '') {
          try {
            renderObj.flash = JSON.parse(parsedCookie['lp-flash']);
            res.setHeader('Set-Cookie', cookie.serialize('lp-flash', '', { maxage: 0, path: '/' }));
          } catch (e) {
            console.error(e);
          }
        }
      }

      renderObj = appendFunction(config, req, renderObj, appFuncs, actionAndParams);
      const resultHtml = ectRender.render(template, renderObj);

      resolve(resultHtml);
    } catch (err) {
      reject(new errors.RenderError(err));
    }
  }));
}

module.exports = {
  setRenderParams,
  renderTemplate,
};
