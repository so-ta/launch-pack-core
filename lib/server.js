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

const launchpackPort = 1337;
const debuggerPort = 1338;

exports.launchServer = () => {
  const cwd = process.cwd();
  const viewRootDirectory = path.join(cwd, 'views');
  const accessLog = debug.initAccessLog(global.LaunchPack.RUN_MODE);

  let customScript = null;
  if (fs.existsSync(path.join(cwd, 'launchpack.js'))) {
    customScript = require(path.join(cwd, 'launchpack.js')); // eslint-disable-line global-require
    console.info('[LaunchPack] launchpack.js is loaded');
  } else {
    console.error('[LaunchPack] launchpack.js is not found');
  }

  let config = {};
  if (fs.existsSync(path.join(cwd, 'launchpack.json'))) {
    config = JSON.parse(fs.readFileSync(path.join(cwd, 'launchpack.json'), 'utf-8'));
    config = config[global.LaunchPack.RUN_MODE];
    console.info('[LaunchPack] launchpack.json is loaded');
  } else {
    console.error('[LaunchPack] launchpack.json is not found');
    return;
  }

  let resourcesmap = {};
  if (fs.existsSync(path.join(cwd, 'public', 'resourcesmap.json'))) {
    resourcesmap = JSON.parse(fs.readFileSync(path.join(cwd, 'public', 'resourcesmap.json'), 'utf-8'));
    console.info('[LaunchPack] resourcesmap.json is loaded');
  } else {
    console.error('[LaunchPack] resourcesmap.json is not found');
    return;
  }

  let routingConfig = {};
  if (fs.existsSync(path.join(cwd, 'config', 'routing.json')) && fs.existsSync(path.join(cwd, 'config', 'resources.json'))) {
    routingConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'config', 'routing.json'), 'utf-8'));
    console.info('[LaunchPack] routing.json and resources.json are loaded');
  } else {
    console.error('[LaunchPack] routing.json or resources.json is not found');
    return;
  }

  // サーバの設定と監視
  const serverLaunchTimeStamp = moment();
  http.createServer((req, res) => {
    if (global.LaunchPack.RUN_MODE === 'local') {
      customScript = null;
      if (fs.existsSync(path.join(cwd, 'launchpack.js'))) {
        delete require.cache[require.resolve(path.join(cwd, 'launchpack.js'))];
        customScript = require(path.join(cwd, 'launchpack.js')); // eslint-disable-line global-require
      }

      if (fs.existsSync(path.join(cwd, 'launchpack.json'))) {
        config = JSON.parse(fs.readFileSync(path.join(cwd, 'launchpack.json'), 'utf-8'));
        config = config[global.LaunchPack.RUN_MODE];
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
        routingConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'config', 'routing.json'), 'utf-8'));
      } else {
        distribution.distributePlainText(500, 'routing.json not found', req, res, accessLog);
        return;
      }
    }

    let reqUrl;
    try {
      reqUrl = decodeURIComponent(req.url);
    } catch (e) {
      distribution.distributePlainText(400, 'Bad Request', req, res, accessLog);
      return;
    }

    // アクセスログの出力
    console.info(`${moment().format('YYYY-MM-DD HH:mm:ss')} :: ${req.method} ${req.headers.host}${reqUrl}`);

    if (reqUrl === '/health') {
      res.setHeader('launch-date', serverLaunchTimeStamp.format());
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      distribution.distributePlainText(200, 'ok', req, res, accessLog);
      return;
    }

    /* public以下のリソースに存在しているものの場合は、そのまま返す */
    if (config.use_resources_map) {
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
    const actionAndParams = routing.findActionAndParams(routingConfig, reqUrl.split('?')[0]);
    const { actionString, actionParams } = actionAndParams;
    const actionStringToUrl = routing.generateActionStringToUrlMap(routingConfig);
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
      const distributeString = 'actionConfig Not Found';
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
      && Object.prototype.hasOwnProperty.call(config, 'api_base_url')
      && !actionConfig.api.match(isUrlReg)) {
      actionConfig.api = config.api_base_url + actionConfig.api;
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
                config,
                req,
                res,
                viewRootDirectory,
                template,
                renderObj,
                customScript,
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
            config,
            req,
            res,
            viewRootDirectory,
            errorTemplate,
            errorRenderObj,
            customScript,
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
  }).listen(launchpackPort, '0.0.0.0');

  console.info('[LaunchPack] LaunchPack is launched! Listening on :%d', launchpackPort);

  /* local起動時はdebug用として起動し、その他の場合はSSLのURLへリダイレクトする */
  if (global.LaunchPack.RUN_MODE !== 'local') {
    http.createServer((req, res) => {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} :: http ::${req.headers.host}${req.url}`);
      if (req.headers.host !== (`localhost:${debuggerPort}`)) {
        res.statusCode = 301;
        res.setHeader('Location', `https://${req.headers.host}${req.url}`);
      }
      res.end();
    }).listen(debuggerPort, '0.0.0.0');
  } else {
    const server = http.createServer((req, res) => {
      let reqUrl;
      try {
        reqUrl = decodeURI(req.url);
        if (reqUrl === '/') {
          reqUrl = '/index.html';
        }
      } catch (e) {
        distribution.distributePlainText(400, 'Bad Request', req, res, null);
        return;
      }

      const filePath = path.join(__dirname, '../', 'debug', reqUrl);
      if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
        distribution.distributeByFilePath(filePath, req, res, null);
        return;
      }
      distribution.distributePlainText(404, 'Not Found', req, res, null);
    }).listen(debuggerPort, '0.0.0.0');
    debug.init(server);
    console.info('[LaunchPack] debugger is ready on :%d', debuggerPort);
  }
};
