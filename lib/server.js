// httpモジュールを読み込み、インスタンスを生成
const http = require('http');
const fs = require('fs');
const path = require('path');
const cookie = require('cookie');

const moment = require('moment');

const routing = require('./routing');
const distribution = require('./distribution');
const render = require('./render');
const data_manager = require('./data-manager');

let actionStringToUrl = {};


exports.launchServer = launchServer;

function launchServer(workdic) {
  global.NODE_ENV = "local";
  if (process.argv.length > 2) {
    global.NODE_ENV = process.argv[2];
  }

  let workDirectory = path.join(workdic);

  let launchpackConfig = {};
  if (fs.existsSync(path.join(workDirectory, 'launchpack.json'))) {
    launchpackConfig = JSON.parse(fs.readFileSync(path.join(workDirectory, 'launchpack.json'), 'utf-8'));
    launchpackConfig = launchpackConfig[global.NODE_ENV];
  } else {
    console.log('[LaunchPack]launchpack.json not found');
    return;
  }

  let resourcesmap = {};
  if (fs.existsSync(path.join(workDirectory, 'public', 'resourcesmap.json'))) {
    resourcesmap = JSON.parse(fs.readFileSync(path.join(workDirectory, 'public', 'resourcesmap.json'), 'utf-8'));
  } else {
    console.log('[LaunchPack]resourcesmap.json not found');
    return;
  }

  let routingJsonObj = {};
  if (fs.existsSync(path.join(workDirectory, 'config', 'routing.json')) && fs.existsSync(path.join(workDirectory, 'config', 'resources.json'))) {
    routingJsonObj = JSON.parse(fs.readFileSync(path.join(workDirectory, 'config', 'routing.json'), 'utf-8'));
  } else {
    console.log('[LaunchPack]routing.json or resources.json not found');
    return;
  }

  http.createServer(function (req, res) {
    if (global.NODE_ENV === "local") {
      launchpackConfig = JSON.parse(fs.readFileSync(path.join(workDirectory, 'launchpack.json'), 'utf-8'));
      launchpackConfig = launchpackConfig[global.NODE_ENV];
      resourcesmap = JSON.parse(fs.readFileSync(path.join(workDirectory, 'public', 'resourcesmap.json'), 'utf-8'));
      routingJsonObj = JSON.parse(fs.readFileSync(path.join(workDirectory, 'config', 'routing.json'), 'utf-8'));
    }

    let i, reqUrl;
    try {
      reqUrl = decodeURI(req.url);
    } catch (e) {
      res.writeHead(400, {'Content-Type': 'text/plain'});
      res.end('Bad Request');
      return;
    }

    console.log(moment().format("YYYY-MM-DD HH:mm:ss") + " :: " + req.headers.host + reqUrl);

    if (reqUrl === '/health') {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('ok');
      return;
    }

    let viewRootDirectory = path.join(workDirectory, 'views');

    /* public以下のリソースに存在しているものの場合は、そのまま返す */
    if (launchpackConfig["use_resources_map"]) {
      resourcesmap = JSON.parse(fs.readFileSync(path.join(workDirectory, 'public', 'resourcesmap.json'), 'utf-8'));
    }

    if (reqUrl in resourcesmap) {
      /* 通常のpathのものはhashしたURLから配信 */
      let hashedFilePath = path.join(workDirectory, 'public', 'hashed', resourcesmap[reqUrl]);
      distribution.distributeByFilePath(hashedFilePath, req, res);
      return;
    }

    let filePath = path.join(workDirectory, 'public', reqUrl);
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      /* hash以下にあるものだったら、キャッシュするようにして配信 */
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      res.setHeader("Expires", new Date(Date.now() + 315360000 * 1000).toUTCString());
      distribution.distributeByFilePath(filePath, req, res);
      return;
    }

    /* ルーティング */
    let actionAndParams = routing.findActionAndParams(routingJsonObj, reqUrl.split("?")[0]);
    let actionString = actionAndParams.actionString;
    let actionParams = actionAndParams.actionParams;
    actionStringToUrl = routing.generateActionStringToUrlMap(routingJsonObj);
    render.setRenderParams(actionStringToUrl, workDirectory);

    /* 使用するActionの探索 */
    let actionConfig = JSON.parse(fs.readFileSync(path.join(workDirectory, 'config', 'resources.json'), 'utf-8'));
    let route = actionString.split(".");
    for (i = 0; i < route.length; i++) {
      actionConfig = actionConfig[route[i]];
    }

    let reqMethod = req.method.toLowerCase();
    if (actionConfig.hasOwnProperty(reqMethod)) {
      actionConfig = actionConfig[reqMethod];
    }

    if (actionConfig === undefined) {
      let distributeString = "actionConfig Not found";
      res.statusCode = statusCode;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      distribution.textDistribute(distributeString, req, res);
      return;
    }

    /* ActionConfigのURLをアクセスに応じて切り替え */
    for (let pathKey in actionParams) {
      let param = encodeURI(actionParams[pathKey]);
      let actionConfigKeys = ["api", "json"];
      for (i = 0; i < actionConfigKeys.length; i++) {
        let actionConfigKey = actionConfigKeys[i];
        if (actionParams.hasOwnProperty(pathKey) && actionConfig.hasOwnProperty(actionConfigKey)) {
          actionConfig[actionConfigKey] = actionConfig[actionConfigKey].replace("{" + pathKey + "}", param);
        }
      }
    }
    let is_url_reg = new RegExp("^https?:\/\/");
    if (actionConfig.hasOwnProperty("api") && launchpackConfig.hasOwnProperty("api_base_url") && !actionConfig["api"].match(is_url_reg)) {
      actionConfig["api"] = launchpackConfig["api_base_url"] + actionConfig["api"];
    }

    let statusCode = 200;
    if ('statusCode' in actionConfig) {
      statusCode = actionConfig["statusCode"];
    }
    res.statusCode = statusCode;

    let template = null;
    if ('template' in actionConfig) {
      template = actionConfig["template"];
    }

    /* 埋め込むデータの探索 */
    data_manager
      .getRenderData(req, res, workDirectory, actionConfig)
      .then(
        /* テンプレートを元にレンダリングする */
        function (contentString) {
          let renderObj;
          try {
            renderObj = JSON.parse(contentString);
            if('app_status_code' in renderObj){
              res.statusCode = renderObj["app_status_code"];
            }
            // リダイレクトの処理が挟まっていた場合、リダイレクトする
            if ([301, 302, 303, 307].indexOf(renderObj["app_status_code"]) >= 0) {
              if ('redirect' in renderObj) {
                let redirectUrl = renderObj['redirect'];
                let urlReg = new RegExp("^https?:\\/\\/.*");
                let isUrl = redirectUrl.match(urlReg);
                if (!isUrl) {
                  let routeString = renderObj['redirect'];
                  let params = {};
                  if ('redirect_params' in renderObj) {
                    params = renderObj['redirect_params'];
                  }
                  if (routeString in actionStringToUrl) {
                    let routingUrlDic = actionStringToUrl[routeString].split("/");
                    for (let i = 0; i < routingUrlDic.length; i++) {
                      if (routingUrlDic[i].lastIndexOf(":", 0) === 0) { //「:」からはじまる場合
                        let paramKey = routingUrlDic[i].slice(1);
                        if (paramKey in params) {
                          routingUrlDic[i] = params[paramKey];
                        }
                      }
                      routingUrlDic[i] = encodeURI(routingUrlDic[i]);
                    }
                    redirectUrl = routingUrlDic.join("/");
                  } else {
                    return Promise.reject("リダイレクト先のURLが見つかりませんでした::" + routeString);
                  }
                }
                res.setHeader('Location', redirectUrl);

                let cookies = [];
                if( "flash" in renderObj ){
                  cookies.push(cookie.serialize("lp-flash", JSON.stringify(renderObj["flash"]), {path: '/'}));
                }
                if ('set-cookie' in res.getHeaders()) {
                  cookies.push(res.getHeaders()['set-cookie']);
                }
                res.setHeader('set-cookie', cookies);
                res.end();
                return;
              }
              return Promise.reject("redirect先のアドレスが見つかりませんでした");
            }
            if (template !== null) {
              return render.renderTemplate(launchpackConfig, req, res, viewRootDirectory, template, renderObj, actionAndParams);
            }
          } catch (e) {
            if (template !== null) {
              // templateにrenderするべきなのに、JSONがparseできなかった場合はエラー処理を行う
              return Promise.reject(e);
            }
          }
          return Promise.resolve(contentString);
        }, function (err) {
          return Promise.reject(err);
        })
      .then(
        /* 実際に配信する */
        function (resultText) {
          distribution.textDistribute(resultText, req, res);
        },
        function (err) {
          console.log(err);
          let statusCode = (typeof (err) === 'object' && 'statusCode' in err) ? err.statusCode : 500;
          res.statusCode = statusCode;

          let errorTemplate = "errors/default.ect";
          let specificErrorTemplate = path.join(workDirectory, 'views', 'errors', statusCode + '.ect');
          if (fs.existsSync(specificErrorTemplate) && !fs.statSync(specificErrorTemplate).isDirectory()) {
            errorTemplate = 'errors/' + statusCode + '.ect';
          }

          /* catch可能なエラーだった場合はエラーページをrenderする */
          let errorRenderObj = {
            statusCode: res.statusCode,
            err: err
          };
          render.renderTemplate(launchpackConfig, req, res, viewRootDirectory, errorTemplate, errorRenderObj, actionAndParams)
            .then(function (resultText) {
              distribution.textDistribute(resultText, req, res);
            }, function (err) {
              // エラーページのレンダリングでエラーがおきたら、テキストだけのエラーを出す。
              let distributeString = res.statusCode + " Error";
              res.statusCode = statusCode;
              res.setHeader('content-type', 'text/plain; charset=utf-8');
              distribution.textDistribute(distributeString, req, res);
            })
        }
      );
  }).listen(1337, '0.0.0.0');

  http.createServer(function (req, res) {
    console.log(moment().format("YYYY-MM-DD HH:mm:ss") + " :: http ::" + req.headers.host + req.url);
    if (req.headers.host !== 'localhost:1338') {
      res.statusCode = 301;
      res.setHeader('Location', "https://" + req.headers.host + req.url);
    }
    res.end();
  }).listen(1338, '0.0.0.0');
}
