const ECT = require('ect');
const path = require('path');
const fs = require('fs');
const cookie = require('cookie');
const querystring = require('querystring');

const errors = require('./errors');

let actionStringToUrl = {};
const resourcesmaps = {};
let workDirectory = '';

function setRenderParams(_actionStringToUrl, _workDirectory) {
  actionStringToUrl = _actionStringToUrl;
  workDirectory = _workDirectory;
}

function appendFunction(config, req, json, appFuncs, actionAndParams) {
  // リクエストURLオブジェクトの作成
  // TODO: 最適化: server.jsと処置が重複
  let requestUrl;
  if (config.launchpack_origin) {
    requestUrl = new URL(req.url, config.launchpack_origin);
  } else {
    const defaultProtocol = 'https:';
    requestUrl = new URL(req.url, `${defaultProtocol}//${req.headers.host}`);
  }

  json.funcs = {
    url(routeString, actionParams, getParams = {}) {
      if (!(routeString in actionStringToUrl)) {
        console.error('URLを返却できません: `%s`がルーティングに定義されていません', routeString);
        return '';
      }

      const routingUrlDic = actionStringToUrl[routeString].split('/');
      for (let i = 0; i < routingUrlDic.length; i++) {
        if (routingUrlDic[i].lastIndexOf(':', 0) === 0) { // 「:」からはじまる場合
          const paramKey = routingUrlDic[i].slice(1);
          if (actionParams && paramKey in actionParams) {
            routingUrlDic[i] = actionParams[paramKey];
          } else {
            routingUrlDic[i] = '';
          }
        }
      }
      let result = routingUrlDic.join('/');
      if (Object.keys(getParams).length > 0) {
        result += `?${querystring.stringify(getParams)}`;
      }

      return result;
    },
    updateCurrentUrl(getParams = {}) {
      getParams = Object.assign(this.getCurrentURLSearchParams(), getParams)
      console.log(this.getCurrentURLSearchParams());
      console.log(getParams);
      return this.url(this.getCurrentActionString(), this.getCurrentActionParams(), getParams)
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
    getRequestURL() {
      return requestUrl;
    },
    getCurrentHost() {
      return requestUrl.host;
    },
    getCurrentURL() {
      return requestUrl.href;
    },
    getCurrentURLSearchParams() {
      // get paramsをObjectとして返却する
      const entries = requestUrl.searchParams.entries();
      var result = {};
      for (let [key, value] of entries) {
        result[key] = value;
      }
      return result;
    },
    getCurrentActionString() {
      return actionAndParams.actionString;
    },
    getCurrentActionParams() {
      // todo:各要素に対して、decodeURIComponentを行う
      return actionAndParams.actionParams;
    },
    getCurrentActionParam(key) {
      if (key in actionAndParams.actionParams) {
        return decodeURIComponent(actionAndParams.actionParams[key]);
      }
      return '';
    },
    getConfigValue(str) {
      if (Object.prototype.hasOwnProperty.call(config, str)) {
        return config[str];
      }
      return null;
    },
    dump(obj) {
      return JSON.stringify(obj);
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
            res.setHeader('Set-Cookie', cookie.serialize('lp-flash', '', {
              maxage: 0,
              path: '/',
            }));
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
