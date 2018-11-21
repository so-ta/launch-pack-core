const moment = require('moment');
const socket = require('socket.io');

let io = null;

function init(server) {
  io = socket.listen(server);
}

function initAccessLog(env) {
  if (env !== 'local') {
    return null;
  }
  const accessLog = {
    timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
    startTime: new Date().getTime(),
  };
  return accessLog;
}

function setActionConfigToAccessLog(accessLog, actionConfig) {
  if (accessLog === null) {
    return;
  }
  accessLog.actionConfig = actionConfig;
}

function setApiRequestToAccessLog(accessLog, apiRequestMethod, apiUrl, apiParams, apiCookie) {
  if (accessLog === null) {
    return;
  }
  accessLog.apiReq = {
    requestMethod: apiRequestMethod,
    url: apiUrl,
    params: JSON.stringify(apiParams),
    cookies: apiCookie,
  };
}

function setContentJsonToAccessLog(accessLog, contentJson) {
  if (accessLog === null) {
    return;
  }
  accessLog.contentJson = contentJson;
}

function emitAccessLog(req, res, accessLog) {
  if (io !== null && accessLog !== null) {
    let json = {
      method: req.method,
      reqUrl: req.url,
      statusCode: res.statusCode,
      timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
      performanceTime: new Date().getTime() - accessLog.startTime,
    };

    json = Object.assign(json, accessLog);

    io.sockets.emit('addAccessLog', json);
  }
}

module.exports = {
  init,
  initAccessLog,
  setActionConfigToAccessLog,
  setApiRequestToAccessLog,
  setContentJsonToAccessLog,
  emitAccessLog,
};
