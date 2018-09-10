'use strict';

const moment = require('moment');
const multiparty = require('multiparty');
const fs = require('fs');

exports.init = init;
exports.initAccessLog = initAccessLog;

exports.setActionConfigToAccessLog = setActionConfigToAccessLog;
exports.setApiRequestToAccessLog = setApiRequestToAccessLog;
exports.setContentJsonToAccessLog = setContentJsonToAccessLog;

exports.emitAccessLog = emitAccessLog;

let io = null;
function init(server) {
  io = require("socket.io").listen(server);
}

function initAccessLog(){
  let accessLog = {
    timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),
    startTime: new Date().getTime()
  };
  return accessLog;
}

function setActionConfigToAccessLog(accessLog, actionConfig) {
  accessLog["actionConfig"] = actionConfig;
}
function setApiRequestToAccessLog(accessLog, apiRequestMethod, apiUrl, apiParams, apiCookie) {
  accessLog["apiReq"] = {
    requestMethod: apiRequestMethod,
    url: apiUrl,
    params: JSON.stringify(apiParams),
    cookies: apiCookie
  };
}

function setContentJsonToAccessLog(accessLog, contentJson) {
  accessLog["contentJson"] = contentJson;
}

function emitAccessLog(req, res, accessLog) {
  if( io !== null && accessLog !== null ){
    let json = {
      method: req.method,
      reqUrl: req.url,
      statusCode: res.statusCode,
      timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),
      performanceTime: new Date().getTime() - accessLog.startTime,
    };

    json = Object.assign(json, accessLog);

    io.sockets.emit("addAccessLog", json);
  }
}
