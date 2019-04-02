// httpモジュールを読み込み、インスタンスを生成
const http = require('http');
const fs = require('fs');
const path = require('path');
const cookie = require('cookie');
const moment = require('moment');
const cloneDeep = require('lodash.clonedeep');
const requestPromiseErrors = require('request-promise/errors');
const chokidar = require('chokidar');

const routing = require('./routing');
const distribution = require('./distribution');
const render = require('./render');
const dataManager = require('./data-manager');
const errors = require('./errors');
const debug = require('./debug');

const launchpackPort = 1337;
const debuggerPort = 1338;

const watchers = [];
const watchingFilesHealth = {};

/**
 * `Object.prototype.hasOwnProperty.call`のショートハンド
 * @param {Object} obj  検査対象のオブジェクト
 * @param {string} prop 検査する
 */
function ObjHasProp(obj, prop) {
  if (!obj) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function fileExists(filepath) {
  return fs.existsSync(filepath);
}

function loadJsonFile(filename, filepath) {
  let contents;
  try {
    contents = JSON.parse(fs.readFileSync(filepath), 'utf-8');
  } catch (e) {
    console.error(`[LaunchPack] failed to parse ${filename}: ${e.message}`);
  }
  return contents;
}

function loadFile(filename, filepath, required, loadingFunc, errorFunc) {
  const loadingErrorOnRequired = (name) => {
    if (!global.LaunchPack.DEBUG_MODE) {
      process.exit(1); // デバッグモードでなければ異常終了する
    } else {
      watchingFilesHealth[name] = false;
    }
  };

  if (!fileExists(filepath)) { // 対象ファイルが存在しないとき
    if (ObjHasProp(errorFunc, 'notFound')) {
      errorFunc.notFound();
    }

    if (required) { // 必須ファイルが見つからないとき
      console.error(`[LaunchPack] ${filename} is not found`);
      loadingErrorOnRequired(filename);
    } else {
      console.warn(`[LaunchPack] ${filename} does not exist`);
    }
  } else if (loadingFunc()) { // ファイルの読み込みに成功
    console.info(`[LaunchPack] ${filename} is loaded`);
  } else { // ファイルの読み込みに失敗
    console.error(`[LaunchPack] Failed to load ${filename}`);

    if (ObjHasProp(errorFunc, 'loadError')) {
      errorFunc.loadError();
    }

    if (required) {
      loadingErrorOnRequired(filename);
    }
  }

  // デバッグモードのときはファイルの変更を監視する
  if (global.LaunchPack.DEBUG_MODE) {
    console.info(`[LaunchPack] watching ${filename}`);

    const watcher = chokidar.watch(filepath);

    let ready = false; // watchの準備が完了したらtrue
    watcher.on('ready', () => {
      ready = true;
    });

    watcher.on('all', (event) => {
      switch (event) {
        case 'add':
          if (!ready) { // 準備が完了していないときはイベントに対して何もしない
            break;
          }
          // eslint-disable-next-line no-fallthrough
        case 'change':
          if (loadingFunc()) {
            if (required) {
              watchingFilesHealth[filename] = true;
            }
            console.info(`[LaunchPack] ${filename} is reloaded`);
          } else {
            if (ObjHasProp(errorFunc, 'loadError')) {
              errorFunc.loadError();
            }
            if (required) { // 必須ファイルの読み込みに失敗したとき
              loadingErrorOnRequired(filename);
            }
          }
          break;
      }
    });

    watcher.on('error', e => console.error(`[LaunchPack] An error occured on watching ${filename}: ${e.message}`));

    watchers.push(watcher);
  }
}

exports.launchServer = () => {
  const cwd = process.cwd();
  const viewRootDirectory = path.join(cwd, 'views');

  // 設定の読み込み（任意）
  let config = {};
  {
    const configFileName = 'launchpack.json';
    const configFilePath = path.join(cwd, configFileName);
    const loadConfig = () => {
      const configFileContents = loadJsonFile(configFileName, configFilePath);
      if (!configFileContents) {
        return false;
      }

      if (!ObjHasProp(
        configFileContents,
        global.LaunchPack.RUN_MODE,
      )) { // 動作モードに対する設定がないとき
        console.warn(`[LaunchPack] configurations for RunMode ${global.LaunchPack.RUN_MODE} are not specified in ${configFileName}`);
        return false;
      }

      config = configFileContents[global.LaunchPack.RUN_MODE];
      if (config.launchpack_debug_mode) {
        global.LaunchPack.DEBUG_MODE = true;
      } else {
        global.LaunchPack.DEBUG_MODE = false;
        // ファイルの監視を停止する
        if (watchers.length !== 0) {
          console.warn('[LaunchPack] stopping file watchers');
          watchers.forEach((watcher) => {
            watcher.close();
          });
        }
      }
      // originの設定があるときは値を検証する
      if (config.launchpack_origin) {
        const origin = new URL(config.launchpack_origin);
        if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
          console.warn("[LaunchPack] a value of `launchpack_origin` is invalid: protocol have to be 'https:' or 'http:'");
          return false;
        } else if (origin.host === '') {
          console.warn('[LaunchPack] a value of `launchpack_origin` is invalid: a value does not have host');
          return false;
        }
      }
      return true;
    };
    const errorFunc = {
      loadError: () => {
        config = {};
      },
    };
    loadFile(configFileName, configFilePath, false, loadConfig, errorFunc);
  }

  // ルーティングの読み込み（必須）
  let routingConfig = {};
  {
    const routingFileName = 'routing.json';
    const routingFilePath = path.join(cwd, 'config', routingFileName);
    const loadRouting = () => {
      const routingFileContents = loadJsonFile(routingFileName, routingFilePath);
      if (!routingFileContents) {
        return false;
      }

      routingConfig = routingFileContents;
      return true;
    };
    loadFile(routingFileName, routingFilePath, true, loadRouting);
  }

  // リソース定義の読み込み（必須）
  let resources = {};
  {
    const resourcesFileName = 'resources.json';
    const resourcesFilePath = path.join(cwd, 'config', resourcesFileName);
    const loadResources = () => {
      const resourcesFileContents = loadJsonFile(resourcesFileName, resourcesFilePath);
      if (!resourcesFileContents) {
        return false;
      }

      resources = resourcesFileContents;
      return true;
    };
    loadFile(resourcesFileName, resourcesFilePath, true, loadResources);
  }

  // リソースマップの読み込み（必須）
  let resourcesmap = {};
  {
    const resourcesmapFileName = 'resourcesmap.json';
    const resourcesmapFilePath = path.join(cwd, 'public', resourcesmapFileName);
    const loadResourcesmap = () => {
      const resourcesmapFileContents = loadJsonFile(resourcesmapFileName, resourcesmapFilePath);
      if (!resourcesmapFileContents) {
        return false;
      }

      resourcesmap = resourcesmapFileContents;
      return true;
    };
    loadFile(resourcesmapFileName, resourcesmapFilePath, true, loadResourcesmap);
  }

  // カスタムスクリプトの読み込み（任意）
  let customScript = null;
  {
    const customScriptFileName = 'launchpack.js';
    const customScriptFilePath = path.join(cwd, customScriptFileName);
    const loadCustomScript = () => {
      try {
        delete require.cache[require.resolve(customScriptFilePath)];
        customScript = require(customScriptFilePath); // eslint-disable-line global-require
        return true;
      } catch (e) {
        console.error(`[LaunchPack] An error occurred to load ${customScriptFileName}: ${e.message}`);
        return false;
      }
    };
    loadFile(customScriptFileName, customScriptFilePath, false, loadCustomScript);
  }

  // サーバの設定と監視
  const serverLaunchTimeStamp = moment();
  http.createServer((req, res) => {
    const accessLog = debug.initAccessLog(global.LaunchPack.DEBUG_MODE);

    // リクエストURLオブジェクトの作成
    // TODO: 最適化: render.jsと処置が重複
    let reqUrl;
    try {
      if (config.launchpack_origin) {
        reqUrl = new URL(req.url, config.launchpack_origin);
      } else {
        const defaultProtocol = 'https:';
        reqUrl = new URL(req.url, `${defaultProtocol}//${req.headers.host}`);
      }
    } catch (e) {
      distribution.distributePlainText(400, 'Bad Request', req, res, accessLog);
      return;
    }

    // アクセスログの出力
    console.info(`${moment().format('YYYY-MM-DD HH:mm:ss')} :: ${req.method} ${req.headers.host}${reqUrl.toString()}`);

    // デバッグモードで起動しているときは監視しているファイルの状態が正常であるかを確認する
    if (global.LaunchPack.DEBUG_MODE) {
      const badHealthFile = Object.keys(watchingFilesHealth)
        .find(filename => !watchingFilesHealth[filename]);
      if (badHealthFile) {
        distribution.distributePlainText(500, `Failed to load ${badHealthFile}`, req, res, accessLog);
        return;
      }
    }

    if (reqUrl.pathname === '/health') {
      res.setHeader('launch-date', serverLaunchTimeStamp.format());
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      distribution.distributePlainText(200, 'ok', req, res, accessLog);
      return;
    }

    /* public以下のリソースに存在しているものの場合は、そのまま返す */
    if (reqUrl.pathname in resourcesmap) {
      /* 通常のpathのものはhashしたURLから配信 */
      const hashedFilePath = path.join(cwd, 'public', 'hashed', resourcesmap[reqUrl.pathname]);
      distribution.distributeByFilePath(hashedFilePath, req, res, accessLog);
      return;
    }

    const filePath = path.join(cwd, 'public', reqUrl.pathname);
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      /* hash以下にあるものだったら、キャッシュするようにして配信 */
      res.setHeader('Cache-Control', 'max-age=315360000, must-revalidate');
      res.setHeader('Expires', new Date(Date.now() + 315360000 * 1000).toUTCString());
      distribution.distributeByFilePath(filePath, req, res, accessLog);
      return;
    }

    /* ルーティング */
    const actionAndParams = routing.findActionAndParams(routingConfig, reqUrl.pathname);
    const { actionString, actionParams } = actionAndParams;
    const actionStringToUrl = routing.generateActionStringToUrlMap(routingConfig);
    render.setRenderParams(actionStringToUrl, cwd);

    /* 使用するActionの探索 */
    let provisionalActionConfig = resources; // 暫定的にすべての設定を格納して探索していく
    const route = actionString.split('.');
    for (let i = 0; i < route.length; i++) {
      provisionalActionConfig = provisionalActionConfig[route[i]];
    }

    const reqMethod = req.method.toLowerCase();
    if (ObjHasProp(provisionalActionConfig, reqMethod)) {
      provisionalActionConfig = provisionalActionConfig[reqMethod];
    }

    if (provisionalActionConfig === undefined) {
      distribution.distributePlainText(500, 'ActionConfig Not Found', req, res, accessLog);
      return;
    }

    // Actionに対応する設定が見つかったところでディープコピーする
    // （元の設定オブジェクトに書き換えの影響を与えないようにするため）
    const actionConfig = cloneDeep(provisionalActionConfig);

    debug.setActionConfigToAccessLog(accessLog, actionConfig);

    // APIとJSONのURLに含まれるプレースホルダを処理する
    ['api', 'json'].forEach((key) => {
      if (ObjHasProp(actionConfig, key)) {
        Object.keys(actionParams).forEach((pathKey) => {
          const param = encodeURI(actionParams[pathKey]);
          actionConfig[key] = actionConfig[key].replace(`{${pathKey}}`, param);
        });

        // 残るパラメータのプレースホルダを取り除く
        actionConfig[key] = actionConfig[key].replace(/{[^}]*}/g, '');
      }
    });

    // APIのリクエストURLが完全でないときは各種設定からOriginを読み取り付与する
    if (ObjHasProp(actionConfig, 'api') && !actionConfig.api.match(/^https?:\/\//)) {
      // eslint-disable-next-line max-len
      actionConfig.api = (process.env.LAUNCHPACK_API_ORIGIN || config.launchpack_api_origin || config.api_base_url) + actionConfig.api;
    }

    // アクションに対応するステータスコードが設定されているときは取得する
    let specifiedStatusCode;
    if (ObjHasProp(actionConfig, 'statusCode')) {
      specifiedStatusCode = actionConfig.statusCode;
    }

    let template = null;
    if (ObjHasProp(actionConfig, 'template')) {
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

            // ステータスコードの決定
            let statusCode;
            if (specifiedStatusCode) { // アクションに特定のステータスコードが設定されているとき
              statusCode = specifiedStatusCode;
            } else if (ObjHasProp(renderObj, 'app_status_code')) { // レスポンスで`app_status_code`が指定されているとき
              statusCode = renderObj.app_status_code;
            } else {
              statusCode = 200; // 成功ステータスコード
            }

            // TODO: ステータスコードの設定を最適化
            res.statusCode = statusCode;
            renderObj.statusCode = statusCode;

            // リダイレクトの処理が挟まっていた場合、リダイレクトする
            if (ObjHasProp(renderObj, 'app_status_code')
              && [301, 302, 303, 307].indexOf(renderObj.app_status_code) >= 0) {
              if ('redirect' in renderObj) {
                let redirectUrl = renderObj.redirect;
                if (!redirectUrl.match(/^https?:\/\/.*/)) {
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
                    return Promise.reject(new errors.RedirectError(`指定されたリダイレクト先が見つかりませんでした: ${routeString}`));
                  }
                }

                res.setHeader('Location', redirectUrl);

                let setCookies = [];
                if ('set-cookie' in res.getHeaders()) {
                  const responseSetCookie = res.getHeaders()['set-cookie'];
                  if (Array.isArray(responseSetCookie)) {
                    setCookies = responseSetCookie;
                  } else if (typeof responseSetCookie === 'string') {
                    setCookies.push(responseSetCookie);
                  }
                }
                if ('flash' in renderObj) {
                  setCookies.push(cookie.serialize('lp-flash', JSON.stringify(renderObj.flash), { path: '/' }));
                }

                res.setHeader('set-cookie', setCookies);

                return Promise.resolve('');
              }
              return Promise.reject(new errors.RedirectError('リダイレクト先が指定されていません'));
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

          // テンプレートが指定されていないときは取得したデータをそのまま返却する
          return Promise.resolve(contentString);
        }, err => Promise.reject(err),
      )
      .then(
        /* 実際に配信する */
        (resultText) => {
          distribution.distributeText(resultText, req, res, accessLog);
        },
        (err) => {
          console.error(`[LaunchPack] An error occurred: ${err.name}`);
          if (global.LaunchPack.DEBUG_MODE) {
            console.error(err.message);
          }

          const errorStatusCode = (typeof (err) === 'object' && 'statusCode' in err) ? err.statusCode : 500;
          res.statusCode = errorStatusCode;

          // TODO: ステータスコードがリダイレクト関連のときにリダイレクト処理をする

          // 取得したデータでエラーが返却され，かつ要求されたアクションに対するテンプレートの指定がないときは
          // レスポンスをそのまま返却する
          if (err instanceof requestPromiseErrors.StatusCodeError
            && template === null) {
            // レスポンスに含まれるヘッダ情報を一部転送する
            ['set-cookie', 'content-type'].forEach((key) => {
              if (err.response.headers[key]) {
                res.setHeader(key, err.response.headers[key]);
              }
            });
            distribution.distributeText(err.response.body, req, res, accessLog);
            return;
          }

          // デバッグモードのときにテンプレートのレンダリングでエラーが発生したらエラー内容を返却する
          if (global.LaunchPack.DEBUG_MODE && err instanceof errors.RenderError) {
            distribution.distributeText(err.message, req, res, accessLog);
            return;
          }

          // エラーテンプレートを特定する
          let errorTemplate = 'errors/default.ect';
          const specificErrorTemplate = path.join(cwd, 'views', 'errors', `${errorStatusCode}.ect`);
          if (fs.existsSync(specificErrorTemplate)
            && !fs.statSync(specificErrorTemplate).isDirectory()) {
            errorTemplate = `errors/${errorStatusCode}.ect`;
          }

          /* catch可能なエラーだった場合はエラーページをrenderする */
          const errorRenderObj = {
            statusCode: res.statusCode,
            error: err,
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
          }, (renderError) => {
            // デバッグモードのときにエラーページのレンダリングでエラーが発生したらエラー内容を返却する
            if (global.LaunchPack.DEBUG_MODE && renderError instanceof errors.RenderError) {
              distribution.distributeText(renderError.message, req, res, accessLog);
              return;
            }

            // テキストでエラーを返却する
            distribution.distributePlainText(res.statusCode, `${res.statusCode} Error`, req, res, accessLog);
          });
        },
      );
  }).listen(launchpackPort, '0.0.0.0');

  console.info('[LaunchPack] LaunchPack is launched! Listening on :%d', launchpackPort);

  // デバッグサーバの設定と監視
  const debugServer = http.createServer((req, res) => {
    if (!global.LaunchPack.DEBUG_MODE) {
      return;
    }

    let reqUrl;
    try {
      reqUrl = decodeURIComponent(req.url);
      if (reqUrl === '/') {
        reqUrl = '/index.html';
      }
    } catch (e) {
      distribution.distributePlainText(400, 'Bad Request', req, res, null);
      return;
    }

    const filePath = path.join(__dirname, '../', 'debug', reqUrl);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      distribution.distributePlainText(404, 'Not Found', req, res, null);
      return;
    }

    distribution.distributeByFilePath(filePath, req, res, null);
  }).listen(debuggerPort, '0.0.0.0');

  debug.init(debugServer);
  console.info('[LaunchPack] debugger is ready on :%d', debuggerPort);
};
