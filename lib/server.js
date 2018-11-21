// httpモジュールを読み込み、インスタンスを生成
const http = require('http');
const fs = require('fs');
const path = require('path');
const cookie = require('cookie');
const moment = require('moment');

const routing = require('./routing');
const distribution = require('./distribution');
const render = require('./render');
const dataManager = require('./data-manager');
const debug = require('./debug');

let actionStringToUrl = {};

exports.launchServer = (cwd) => {
  global.NODE_ENV = 'local';
  const envIndex = 2;
  if (process.argv.length > envIndex) {
    global.NODE_ENV = process.argv[envIndex];
  }

  let launchpackCustomFunc = null;
  if (fs.existsSync(path.join(cwd, 'launchpack.js'))) {
    launchpackCustomFunc = require(path.join(cwd, 'launchpack.js')); // eslint-disable-line global-require
    console.log('[LaunchPack]successfully load launchpack.js');
  } else {
    console.log('[LaunchPack]launchpack.js not found');
  }

  let launchpackConfig = {};
  if (fs.existsSync(path.join(cwd, 'launchpack.json'))) {
    launchpackConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'launchpack.json'), 'utf-8'));
    launchpackConfig = launchpackConfig[global.NODE_ENV];
    console.log('[LaunchPack]successfully load launchpack.json');
  } else {
    console.log('[LaunchPack]launchpack.json not found');
    return;
  }

  let resourcesmap = {};
  if (fs.existsSync(path.join(cwd, 'public', 'resourcesmap.json'))) {
    resourcesmap = JSON.parse(fs.readFileSync(path.join(cwd, 'public', 'resourcesmap.json'), 'utf-8'));
    console.log('[LaunchPack]successfully load resourcesmap.json');
  } else {
    console.log('[LaunchPack]resourcesmap.json not found');
    return;
  }

  let routingJsonObj = {};
  if (fs.existsSync(path.join(cwd, 'config', 'routing.json')) && fs.existsSync(path.join(cwd, 'config', 'resources.json'))) {
    routingJsonObj = JSON.parse(fs.readFileSync(path.join(cwd, 'config', 'routing.json'), 'utf-8'));
    console.log('[LaunchPack]successfully load routing.json and resources.json');
  } else {
    console.log('[LaunchPack]routing.json or resources.json not found');
    return;
  }

  const serverLaunchMoment = moment();

  http.createServer((req, res) => {
    const accessLog = debug.initAccessLog(global.NODE_ENV);
    if (global.NODE_ENV === 'local') {
      launchpackCustomFunc = null;
      if (fs.existsSync(path.join(cwd, 'launchpack.js'))) {
        delete require.cache[require.resolve(path.join(cwd, 'launchpack.js'))];
        launchpackCustomFunc = require(path.join(cwd, 'launchpack.js')); // eslint-disable-line global-require
      }

      if (fs.existsSync(path.join(cwd, 'launchpack.json'))) {
        launchpackConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'launchpack.json'), 'utf-8'));
        launchpackConfig = launchpackConfig[global.NODE_ENV];
      } else {
        distribution.distributePlainText(500, 'launchpack.json not found', req, res, accessLog);
        return;
      }

      if (fs.existsSync(path.join(cwd, 'public', 'resourcesmap.json'))) {
        resourcesmap = JSON.parse(fs.readFileSync(path.join(cwd, 'public', 'resourcesmap.json'), 'utf-8'));
      } else {
        distribution.distributePlainText(500, 'resourcesmap.json not found', req, res, accessLog);
        return;
      }

      if (fs.existsSync(path.join(cwd, 'config', 'routing.json')) && fs.existsSync(path.join(cwd, 'config', 'resources.json'))) {
        routingJsonObj = JSON.parse(fs.readFileSync(path.join(cwd, 'config', 'routing.json'), 'utf-8'));
      } else {
        distribution.distributePlainText(500, 'routing.json not found', req, res, accessLog);
        return;
      }
    }

    let reqUrl;
    try {
      reqUrl = decodeURI(req.url);
    } catch (e) {
      distribution.distributePlainText(400, 'Bad request', req, res, accessLog);
      return;
    }

    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} :: ${req.headers.host}${reqUrl}`);

    if (reqUrl === '/health') {
      res.setHeader('launch-date', serverLaunchMoment.format());
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      distribution.distributePlainText(200, 'ok', req, res, accessLog);
      return;
    }

    const viewRootDirectory = path.join(cwd, 'views');

    /* public以下のリソースに存在しているものの場合は、そのまま返す */
    if (launchpackConfig.use_resources_map) {
      resourcesmap = JSON.parse(fs.readFileSync(path.join(cwd, 'public', 'resourcesmap.json'), 'utf-8'));
    }

    if (reqUrl in resourcesmap) {
      /* 通常のpathのものはhashしたURLから配信 */
      const hashedFilePath = path.join(cwd, 'public', 'hashed', resourcesmap[reqUrl]);
      distribution.distributeByFilePath(hashedFilePath, req, res, accessLog);
      return;
    }

    const filePath = path.join(cwd, 'public', reqUrl);
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      /* hash以下にあるものだったら、キャッシュするようにして配信 */
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      res.setHeader('Expires', new Date(Date.now() + 315360000 * 1000).toUTCString());
      distribution.distributeByFilePath(filePath, req, res, accessLog);
      return;
    }

    /* ルーティング */
    const actionAndParams = routing.findActionAndParams(routingJsonObj, reqUrl.split('?')[0]);
    const { actionString, actionParams } = actionAndParams;
    actionStringToUrl = routing.generateActionStringToUrlMap(routingJsonObj);
    render.setRenderParams(actionStringToUrl, cwd);

    /* 使用するActionの探索 */
    let actionConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'config', 'resources.json'), 'utf-8'));
    const route = actionString.split('.');
    for (let i = 0; i < route.length; i++) {
      actionConfig = actionConfig[route[i]];
    }

    const reqMethod = req.method.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(actionConfig, reqMethod)) {
      actionConfig = actionConfig[reqMethod];
    }

    if (actionConfig === undefined) {
      const distributeString = 'actionConfig Not found';
      distribution.distributePlainText(500, distributeString, req, res, accessLog);
      return;
    }
    debug.setActionConfigToAccessLog(accessLog, actionConfig);

    /* ActionConfigのURLをアクセスに応じて切り替え */
    Object.keys(actionParams).forEach((pathKey) => {
      const param = encodeURI(actionParams[pathKey]);
      const actionConfigKeys = ['api', 'json'];
      for (let i = 0; i < actionConfigKeys.length; i++) {
        const actionConfigKey = actionConfigKeys[i];
        if (Object.prototype.hasOwnProperty.call(actionParams, pathKey)
          && Object.prototype.hasOwnProperty.call(actionConfig, actionConfigKey)) {
          actionConfig[actionConfigKey] = actionConfig[actionConfigKey].replace(`{${pathKey}}`, param);
        }
      }
    });
    const isUrlReg = new RegExp('^https?://');
    if (Object.prototype.hasOwnProperty.call(actionConfig, 'api')
      && Object.prototype.hasOwnProperty.call(launchpackConfig, 'api_base_url')
      && !actionConfig.api.match(isUrlReg)) {
      actionConfig.api = launchpackConfig.api_base_url + actionConfig.api;
    }

    let statusCode = 200;
    if ('statusCode' in actionConfig) {
      ({ statusCode } = actionConfig);
    }
    res.statusCode = statusCode;

    let template = null;
    if ('template' in actionConfig) {
      ({ template } = actionConfig);
    }

    /* 埋め込むデータの探索 */
    dataManager
      .getRenderData(req, res, cwd, actionConfig, accessLog)
      .then(
        /* テンプレートを元にレンダリングする */
        (contentString) => {
          debug.setContentJsonToAccessLog(accessLog, contentString);

          let renderObj;
          try {
            renderObj = JSON.parse(contentString);
            if ('app_status_code' in renderObj) {
              res.statusCode = renderObj.app_status_code;
            }
            // リダイレクトの処理が挟まっていた場合、リダイレクトする
            if ([301, 302, 303, 307].indexOf(renderObj.app_status_code) >= 0) {
              if ('redirect' in renderObj) {
                let redirectUrl = renderObj.redirect;
                const urlReg = new RegExp('^https?:\\/\\/.*');
                const isUrl = redirectUrl.match(urlReg);
                if (!isUrl) {
                  const routeString = renderObj.redirect;
                  let params = {};
                  if ('redirect_params' in renderObj) {
                    params = renderObj.redirect_params;
                  }
                  if (routeString in actionStringToUrl) {
                    const routingUrlDir = actionStringToUrl[routeString].split('/');
                    for (let i = 0; i < routingUrlDir.length; i++) {
                      if (routingUrlDir[i].lastIndexOf(':', 0) === 0) { // 「:」からはじまる場合
                        const paramKey = routingUrlDir[i].slice(1);
                        if (paramKey in params) {
                          routingUrlDir[i] = params[paramKey];
                        }
                      }
                      routingUrlDir[i] = encodeURI(routingUrlDir[i]);
                    }
                    redirectUrl = routingUrlDir.join('/');
                  } else {
                    return Promise.reject(new Error(`リダイレクト先のURLが見つかりませんでした::${routeString}`));
                  }
                }
                res.setHeader('Location', redirectUrl);

                const cookies = [];
                if ('flash' in renderObj) {
                  cookies.push(cookie.serialize('lp-flash', JSON.stringify(renderObj.flash), { path: '/' }));
                }
                if ('set-cookie' in res.getHeaders()) {
                  cookies.push(res.getHeaders()['set-cookie']);
                }
                res.setHeader('set-cookie', cookies);
                return Promise.resolve('');
              }
              return Promise.reject(new Error('redirect先のアドレスが見つかりませんでした'));
            }
            if (template !== null) {
              return render.renderTemplate(
                launchpackConfig,
                req,
                res,
                viewRootDirectory,
                template,
                renderObj,
                launchpackCustomFunc,
                actionAndParams,
              );
            }
          } catch (e) {
            if (template !== null) {
              // templateにrenderするべきなのに、JSONがparseできなかった場合はエラー処理を行う
              return Promise.reject(e);
            }
          }
          return Promise.resolve(contentString);
        }, err => Promise.reject(err),
      )
      .then(
        /* 実際に配信する */
        (resultText) => {
          distribution.distributeText(resultText, req, res, accessLog);
        },
        (err) => {
          console.log(err);
          const errorStatusCode = (typeof (err) === 'object' && 'statusCode' in err) ? err.statusCode : 500;
          res.statusCode = errorStatusCode;

          let errorTemplate = 'errors/default.ect';
          const specificErrorTemplate = path.join(cwd, 'views', 'errors', `${errorStatusCode}.ect`);
          if (fs.existsSync(specificErrorTemplate)
            && !fs.statSync(specificErrorTemplate).isDirectory()) {
            errorTemplate = `errors/${errorStatusCode}.ect`;
          }

          /* catch可能なエラーだった場合はエラーページをrenderする */
          const errorRenderObj = {
            statusCode: res.statusCode,
            err,
          };
          render.renderTemplate(
            launchpackConfig,
            req,
            res,
            viewRootDirectory,
            errorTemplate,
            errorRenderObj,
            launchpackCustomFunc,
            actionAndParams,
          ).then((resultText) => {
            distribution.distributeText(resultText, req, res, accessLog);
          }, () => {
            // エラーページのレンダリングでエラーがおきたら、テキストだけのエラーを出す。
            const distributeString = `${res.statusCode} Error`;
            distribution.distributePlainText(statusCode, distributeString, req, res, accessLog);
          });
        },
      );
  }).listen(1337, '0.0.0.0');

  /* local起動時はdebug用として起動し、その他の場合はSSLのURLへリダイレクトする */
  if (global.NODE_ENV !== 'local') {
    http.createServer((req, res) => {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} :: http ::${req.headers.host}${req.url}`);
      if (req.headers.host !== 'localhost:1338') {
        res.statusCode = 301;
        res.setHeader('Location', `https://${req.headers.host}${req.url}`);
      }
      res.end();
    }).listen(1338, '0.0.0.0');
  } else {
    const server = http.createServer((req, res) => {
      let reqUrl;
      try {
        reqUrl = decodeURI(req.url);
        if (reqUrl === '/') {
          reqUrl = '/index.html';
        }
      } catch (e) {
        distribution.distributePlainText(400, 'Bad request', req, res, null);
        return;
      }

      const filePath = path.join(__dirname, '../', 'debug', reqUrl);
      if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
        distribution.distributeByFilePath(filePath, req, res, null);
        return;
      }
      distribution.distributePlainText(404, 'Not found', req, res, null);
    }).listen(1338, '0.0.0.0');
    debug.init(server);
  }
};
