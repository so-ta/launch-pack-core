function findActionAndParams(routing, pathString) {
  // 末尾がスラッシュであるときは削除する
  if (pathString.endsWith('/')) {
    pathString = pathString.slice(0, -1);
  }

  const routes = pathString.split('/');
  let actionString = '';
  const actionParams = {};

  // exsample.comに直接アクセスされるとroutesが["",""]になるので、その場合は例外的なルーティングを行う
  if (routes.length > 1 && routes[1] !== '') {
    for (let i = 1; i < routes.length; i++) {
      const key = routes[i];
      if (key === '') {
        actionString = '';
        routing = {};
        break;
      }
      switch (typeof routing[key]) {
        case 'object': {
          routing = routing[key];
          break;
        }
        case 'string': {
          actionString = routing[key];
          routing = {};
          break;
        }
        case 'undefined': {
          // 「:」からはじまるkeyが存在するか判定する
          const routingKeys = Object.keys(routing);
          let keyStartWithColon = '';
          for (let j = 0; j < routingKeys.length; j++) {
            const checkedKey = routingKeys[j];
            if (checkedKey.lastIndexOf(':', 0) === 0) { // 「:」からはじまる場合
              keyStartWithColon = checkedKey;
              break;
            }
          }

          // 「:」からはじまるkeyがない場合break
          if (keyStartWithColon === '') {
            actionString = '';
            routing = {};
            break;
          }

          // 「:」以降をkeyとしてdictに追加する
          actionParams[keyStartWithColon.substr(1)] = key;

          switch (typeof routing[keyStartWithColon]) {
            case 'object':
              routing = routing[keyStartWithColon];
              break;
            case 'string':
              actionString = routing[keyStartWithColon];
              routing = {};
              break;
          }
          break;
        }
      }
    }
  }
  if (typeof routing['#'] === 'string') {
    actionString = routing['#'];
  }

  if (actionString === '') {
    actionString = 'System.404';
  }

  const routeAndPathDictionary = {};
  routeAndPathDictionary.actionString = actionString;
  routeAndPathDictionary.actionParams = actionParams;

  return routeAndPathDictionary;
}

function _generateActionStringToUrlMap(routing, urlPrefix) {
  const actionToUrl = {};
  Object.keys(routing).forEach((key) => {
    switch (typeof routing[key]) {
      case 'object': {
        Object.assign(actionToUrl, _generateActionStringToUrlMap(routing[key], `${urlPrefix}/${key}`));
        break;
      }
      case 'string': {
        const action = routing[key];
        if (key === '#') {
          actionToUrl[action] = urlPrefix;
          if (urlPrefix === '') {
            actionToUrl[action] = '/';
          }
        } else {
          actionToUrl[action] = `${urlPrefix}/${key}`;
        }
        break;
      }
    }
  });
  return actionToUrl;
}

function generateActionStringToUrlMap(routing) {
  return _generateActionStringToUrlMap(routing, '');
}

module.exports = {
  findActionAndParams, // routingとpath(/hoge/123)からactionとactionParamsを返す
  generateActionStringToUrlMap, // routingから[ActionString:URL]の連想配列を返す
};
